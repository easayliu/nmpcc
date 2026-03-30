import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import https from "node:https";
import http from "node:http";
import { AccountManager } from "./account-manager.mjs";
import { emitSessionInit, buildUserID } from "./session-init.mjs";

// ── Load .env ──
function loadEnv(path) {
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
loadEnv(join(resolve("."), ".env"));

// ── Config ──
const PORT = parseInt(process.env.PORT || "3000", 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "600000", 10);
const API_KEYS = (process.env.SERVICE_API_KEYS || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const BASE_API_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const CLI_VERSION = "2.1.87";
const STAINLESS_PACKAGE_VERSION = "0.74.0";
const STAINLESS_RUNTIME_VERSION = "v24.3.0";

let requestCount = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCacheReadTokens = 0;
let totalCacheCreationTokens = 0;

// 按账号存储最新的 rate limit 信息
const accountRateLimits = new Map(); // accountName → { fiveHour, sevenDay, updatedAt }

function extractRateLimits(accountName, headers) {
  const get = (k) => headers[k] || headers[k.toLowerCase()] || null;
  const info = {
    fiveHour: {
      status: get("Anthropic-Ratelimit-Unified-5h-Status"),
      utilization: get("Anthropic-Ratelimit-Unified-5h-Utilization"),
      reset: get("Anthropic-Ratelimit-Unified-5h-Reset"),
    },
    sevenDay: {
      status: get("Anthropic-Ratelimit-Unified-7d-Status"),
      utilization: get("Anthropic-Ratelimit-Unified-7d-Utilization"),
      reset: get("Anthropic-Ratelimit-Unified-7d-Reset"),
    },
    overage: {
      status: get("Anthropic-Ratelimit-Unified-Overage-Status"),
      disabledReason: get("Anthropic-Ratelimit-Unified-Overage-Disabled-Reason"),
    },
    current: {
      status: get("Anthropic-Ratelimit-Unified-Status"),
      reset: get("Anthropic-Ratelimit-Unified-Reset"),
      representativeClaim: get("Anthropic-Ratelimit-Unified-Representative-Claim"),
    },
    updatedAt: new Date().toISOString(),
  };
  if (info.fiveHour.status || info.sevenDay.status) {
    accountRateLimits.set(accountName, info);
  }
}

function accumulateUsage(usage) {
  if (!usage) return;
  totalInputTokens += usage.input_tokens || 0;
  totalOutputTokens += usage.output_tokens || 0;
  totalCacheReadTokens += usage.cache_read_input_tokens || 0;
  totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
}

// ── Account Manager ──
const ACCOUNTS_DIR = resolve(process.env.ACCOUNTS_DIR || "./accounts");
const accountManager = new AccountManager(ACCOUNTS_DIR);

// ── 兼容旧逻辑：从 AccountManager 获取认证信息 ──
function isOAuthToken(token) {
  return token && token.startsWith("sk-ant-oat");
}

async function getAuthTokenFromAccount(account) {
  if (!account) return null;
  await accountManager.ensureValidToken(account);
  const cred = account.credentials;
  if (cred.apiKey) {
    return { type: "apiKey", value: cred.apiKey };
  }
  if (cred.accessToken) {
    return { type: "bearer", value: cred.accessToken };
  }
  return null;
}

// 保留 cachedCredentials 引用用于 buildBetas 中的 isOAuthToken 检查
let cachedCredentials = null;

function syncCachedCredentials(account) {
  if (account) {
    cachedCredentials = account.credentials;
  }
}

// ── Build headers matching real Claude CLI MITM capture ──
function isHaikuModel(model) {
  return model.includes("haiku");
}

function buildBetas(model, body) {
  const betaSet = new Set();

  // Always present in real CLI 2.1.87
  betaSet.add("interleaved-thinking-2025-05-14");
  betaSet.add("redact-thinking-2026-02-12");
  betaSet.add("prompt-caching-scope-2026-01-05");

  // Conditional betas based on body features
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  if (hasTools) {
    betaSet.add("claude-code-20250219");
    betaSet.add("advanced-tool-use-2025-11-20");
    betaSet.add("advisor-tool-2026-03-01");
  }

  if (body.thinking || body.output_config?.effort) {
    betaSet.add("effort-2025-11-24");
  }

  if (body.output_config?.format?.type === "json_schema") {
    betaSet.add("structured-outputs-2025-12-15");
  }

  // Context management for non-haiku models
  if (body.context_management || !isHaikuModel(model)) {
    betaSet.add("context-management-2025-06-27");
  }

  // 1M context for opus-4-6
  if (model.includes("opus-4-6") || model.includes("[1m]")) {
    betaSet.add("context-1m-2025-08-07");
  }

  // OAuth beta
  if (isOAuthToken(cachedCredentials?.accessToken)) {
    betaSet.add("oauth-2025-04-20");
  }

  // Extra betas from body
  if (Array.isArray(body.betas)) {
    for (const b of body.betas) {
      if (typeof b === "string" && b.trim()) betaSet.add(b.trim());
    }
  }

  // Stable order matching real CLI
  const betaOrder = [
    "claude-code-20250219",
    "oauth-2025-04-20",
    "context-1m-2025-08-07",
    "interleaved-thinking-2025-05-14",
    "redact-thinking-2026-02-12",
    "context-management-2025-06-27",
    "prompt-caching-scope-2026-01-05",
    "advanced-tool-use-2025-11-20",
    "advisor-tool-2026-03-01",
    "effort-2025-11-24",
    "structured-outputs-2025-12-15",
  ];

  const result = [];
  for (const b of betaOrder) {
    if (betaSet.has(b)) {
      result.push(b);
      betaSet.delete(b);
    }
  }
  // Remaining
  for (const b of betaSet) {
    result.push(b);
  }
  return result;
}

function buildHeaders(auth, betas, sessionID) {
  const headers = {};

  // Auth
  if (auth.type === "apiKey") {
    headers["x-api-key"] = auth.value;
  } else {
    headers["Authorization"] = `Bearer ${auth.value}`;
  }

  // Content
  headers["Content-Type"] = "application/json";

  // Anthropic headers — all lowercase matching real CLI
  headers["anthropic-beta"] = betas.join(",");
  headers["anthropic-version"] = "2023-06-01";
  headers["anthropic-dangerous-direct-browser-access"] = "true";
  headers["x-app"] = "cli";

  // Session ID
  headers["X-Claude-Code-Session-Id"] = sessionID || randomUUID();

  // Stainless SDK headers — Title-Case
  headers["X-Stainless-Retry-Count"] = "0";
  headers["X-Stainless-Runtime-Version"] = STAINLESS_RUNTIME_VERSION;
  headers["X-Stainless-Package-Version"] = STAINLESS_PACKAGE_VERSION;
  headers["X-Stainless-Runtime"] = "node";
  headers["X-Stainless-Lang"] = "js";
  headers["X-Stainless-Arch"] = "arm64";
  headers["X-Stainless-OS"] = "MacOS";
  headers["X-Stainless-Timeout"] = "600";

  // Standard HTTP headers matching real CLI
  headers["User-Agent"] = `claude-cli/${CLI_VERSION} (external, cli)`;
  headers["Accept"] = "application/json";
  headers["accept-encoding"] = "gzip, deflate, br, zstd";
  headers["accept-language"] = "*";
  headers["sec-fetch-mode"] = "cors";
  headers["connection"] = "keep-alive";
  headers["x-client-request-id"] = randomUUID();

  return headers;
}

// ── Billing header (system[0]) — required by Anthropic API for OAuth ──
const BILLING_BUILD_HASH_SALT = "59cf53e54c78";
const BILLING_CLI_VERSION = "2.1.87";

function computeBuildHash(firstUserText) {
  const runes = [...(firstUserText || "")];
  const indices = [4, 7, 20];
  const chars = indices.map((i) => (i < runes.length ? runes[i] : "0"));
  const input = BILLING_BUILD_HASH_SALT + chars.join("") + BILLING_CLI_VERSION;
  return createHash("sha256").update(input).digest("hex").slice(0, 3);
}

function computeCCH() {
  // Real CLI 2.1.87 JS layer sets cch=00000; Bun runtime may replace at wire level.
  // We use 00000 to match JS-observable behavior.
  return "00000";
}

function getFirstUserText(messages) {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && block.text) return block.text;
      }
    }
  }
  return "";
}

function injectBillingSystem(prepared) {
  const firstUserText = getFirstUserText(prepared.messages || []);
  const buildHash = computeBuildHash(firstUserText);
  const cch = computeCCH();
  const billingText = `x-anthropic-billing-header: cc_version=${BILLING_CLI_VERSION}.${buildHash}; cc_entrypoint=cli; cch=${cch};`;

  // system[0]: billing header (no cache_control)
  const billingBlock = { type: "text", text: billingText };
  // system[1]: agent identifier (cache_control: ephemeral)
  const agentBlock = {
    type: "text",
    cache_control: { type: "ephemeral" },
    text: "You are Claude Code, Anthropic's official CLI for Claude.",
  };

  // Preserve existing system blocks as system[2+]
  let existingSystem = prepared.system || [];
  if (typeof existingSystem === "string") {
    existingSystem = [{ type: "text", cache_control: { type: "ephemeral" }, text: existingSystem }];
  }
  if (!Array.isArray(existingSystem)) {
    existingSystem = [];
  }

  // Filter out any existing billing/agent blocks to avoid duplication
  const filtered = existingSystem.filter((block) => {
    const text = block.text || "";
    if (text.startsWith("x-anthropic-billing-header:")) return false;
    if (text.startsWith("You are Claude Code")) return false;
    return true;
  });

  // Add cache_control to existing blocks if missing
  const withCache = filtered.map((block) => {
    if (!block.cache_control) {
      return { ...block, cache_control: { type: "ephemeral" } };
    }
    return block;
  });

  prepared.system = [billingBlock, agentBlock, ...withCache];
}

// ── Prepare request body ──
function prepareBody(body, accountKey) {
  const prepared = { ...body };

  // Remove betas from body (they go into headers)
  delete prepared.betas;

  // Clean model name
  prepared.model = (prepared.model || "claude-sonnet-4-6").replace(/\[1m\]/gi, "");

  // Default max_tokens
  if (!prepared.max_tokens) {
    prepared.max_tokens = isHaikuModel(prepared.model) ? 8192 : 32000;
  }

  // Ensure metadata.user_id — use stable device identity per account
  if (!prepared.metadata?.user_id) {
    prepared.metadata = {
      ...prepared.metadata,
      user_id: buildUserID(accountKey || "default"),
    };
  }

  // Inject billing header into system blocks
  injectBillingSystem(prepared);

  return prepared;
}

// ── Helpers ──
function sendJSON(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJSON(res, status, {
    type: "error",
    error: { type: "api_error", message },
  });
}

function authenticate(req) {
  if (API_KEYS.length === 0) return true;
  const auth = req.headers["authorization"] || "";
  const xKey = req.headers["x-api-key"] || "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  return API_KEYS.includes(key) || API_KEYS.includes(xKey);
}

// ── Proxy Stream: pipe Anthropic SSE directly ──
// 返回 { retryable: true } 表示需要换账号重试，否则响应已发出
async function handleStream(res, body, account) {
  const auth = await getAuthTokenFromAccount(account);
  if (!auth) return sendError(res, 500, "No authentication configured");
  syncCachedCredentials(account);

  // Session init (non-blocking — fires in background on first request per session)
  const accountKey = account.name || "default";
  const isOAuth = isOAuthToken(auth.value);
  emitSessionInit(accountKey, auth.value, isOAuth, BASE_API_URL).catch(() => {});

  const model = body.model || "claude-sonnet-4-6";
  const apiBody = prepareBody({ ...body, stream: true }, accountKey);
  const betas = buildBetas(model, apiBody);
  const headers = buildHeaders(auth, betas);

  const url = new URL("/v1/messages?beta=true", BASE_API_URL);
  const payload = JSON.stringify(apiBody);
  headers["Content-Length"] = Buffer.byteLength(payload).toString();

  // 不要求上游压缩，避免需要解压再转发给客户端
  delete headers["accept-encoding"];

  return new Promise((resolve) => {
    const proxyReq = (url.protocol === "https:" ? https : http).request(
      url,
      { method: "POST", headers, timeout: TIMEOUT_MS },
      (proxyRes) => {
        // 处理上游错误状态
        extractRateLimits(account.name, proxyRes.headers);
        if (proxyRes.statusCode === 429) {
          const retryAfter = parseInt(proxyRes.headers["retry-after"] || "60", 10);
          accountManager.cooldown(account, retryAfter * 1000);
          console.warn(`[proxy] ${account.name} rate limited, cooldown ${retryAfter}s`);
        } else if (proxyRes.statusCode === 401 || proxyRes.statusCode === 403) {
          // 读取错误体用于记录
          let errBody = "";
          proxyRes.on("data", (c) => { errBody += c.toString(); });
          proxyRes.on("end", () => {
            accountManager.markError(account, `${proxyRes.statusCode}: ${errBody.slice(0, 120)}`);
            if (proxyRes.statusCode === 401) accountManager.refreshToken(account).catch(() => {});
          });
        }

        // 如果是可重试的状态码，先消耗响应体再通知上层重试
        if (RETRYABLE_STATUS.has(proxyRes.statusCode)) {
          proxyRes.resume(); // 消耗掉响应体，防止 socket 挂起
          return resolve({ retryable: true });
        }

        // 直接透传上游响应
        const resHeaders = {
          "Content-Type": proxyRes.headers["content-type"] || "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        };
        // 透传 rate limit & request-id headers
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (
            k.startsWith("anthropic-") ||
            k.startsWith("x-ratelimit") ||
            k === "request-id"
          ) {
            resHeaders[k] = v;
          }
        }
        res.writeHead(proxyRes.statusCode, resHeaders);

        // 解析 SSE 流里的 usage（message_start / message_delta 事件）
        let sseBuffer = "";
        proxyRes.on("data", (chunk) => {
          sseBuffer += chunk.toString();
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop(); // 保留不完整的最后一行
          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              try {
                const json = JSON.parse(line.slice(5).trim());
                if (eventType === "message_start" && json.message?.usage) {
                  accumulateUsage(json.message.usage);
                } else if (eventType === "message_delta" && json.usage) {
                  totalOutputTokens += json.usage.output_tokens || 0;
                }
              } catch {}
            }
          }
        });

        proxyRes.pipe(res);
        proxyRes.on("end", () => resolve({}));
      }
    );

    proxyReq.on("error", (err) => {
      console.error("[proxy] error:", err.message);
      if (!res.headersSent) sendError(res, 502, `Upstream error: ${err.message}`);
      resolve({});
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent) sendError(res, 504, "Upstream timeout");
      resolve({});
    });

    proxyReq.write(payload);
    proxyReq.end();
    res.on("close", () => proxyReq.destroy());
  });
}

// 需要服务端换账号重试的状态码
const RETRYABLE_STATUS = new Set([401, 403, 429, 529]);

// ── Non-stream ──
// 返回 { retryable: true } 表示需要换账号重试，否则响应已发出
async function handleNonStream(res, body, account) {
  const auth = await getAuthTokenFromAccount(account);
  if (!auth) return sendError(res, 500, "No authentication configured");
  syncCachedCredentials(account);

  const accountKey = account.name || "default";
  const isOAuth = isOAuthToken(auth.value);
  emitSessionInit(accountKey, auth.value, isOAuth, BASE_API_URL).catch(() => {});

  const model = body.model || "claude-sonnet-4-6";
  const apiBody = prepareBody({ ...body, stream: false }, accountKey);
  const betas = buildBetas(model, apiBody);
  const headers = buildHeaders(auth, betas);

  try {
    const resp = await fetch(`${BASE_API_URL}/v1/messages?beta=true`, {
      method: "POST",
      headers,
      body: JSON.stringify(apiBody),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // 处理上游错误状态
    const respHeadersObj = Object.fromEntries(resp.headers);
    extractRateLimits(account.name, respHeadersObj);
    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get("retry-after") || "60", 10);
      accountManager.cooldown(account, retryAfter * 1000);
      console.warn(`[proxy] ${account.name} rate limited, cooldown ${retryAfter}s`);
    } else if (resp.status === 401 || resp.status === 403) {
      const errBody = await resp.text();
      accountManager.markError(account, `${resp.status}: ${errBody.slice(0, 120)}`);
      if (resp.status === 401) accountManager.refreshToken(account).catch(() => {});
    }

    if (RETRYABLE_STATUS.has(resp.status)) {
      return { retryable: true };
    }

    const resHeaders = { "Content-Type": "application/json" };
    for (const [k, v] of resp.headers) {
      if (k.startsWith("anthropic-") || k.startsWith("x-ratelimit") || k === "request-id") {
        resHeaders[k] = v;
      }
    }
    const data = await resp.text();
    try { accumulateUsage(JSON.parse(data).usage); } catch {}
    res.writeHead(resp.status, resHeaders);
    res.end(data);
  } catch (err) {
    console.error("[non-stream] error:", err.message);
    sendError(res, 502, err.message);
  }
}

// ── Routes ──
async function handleMessages(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  if (!authenticate(req)) return sendError(res, 401, "Unauthorized");

  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return sendError(res, 400, "Invalid JSON");
  }
  if (!body.messages?.length) return sendError(res, 400, "messages is required");

  const totalAccounts = accountManager.accountList.length;
  const tried = new Set();

  for (let attempt = 0; attempt <= totalAccounts; attempt++) {
    // 多账号选取
    const account = accountManager.pick();
    if (!account || tried.has(account.name)) {
      return sendError(res, 503, "No available accounts. All accounts are rate-limited or errored.");
    }
    tried.add(account.name);

    // 确保 token 有效
    const valid = await accountManager.ensureValidToken(account);
    if (!valid) {
      accountManager.markError(account, "Token invalid and refresh failed");
      continue; // 换下一个账号
    }

    if (attempt === 0) {
      requestCount++;
      console.log(
        `[req] #${requestCount} account=${account.name} model=${body.model || "claude-sonnet-4-6"} stream=${!!body.stream} msgs=${body.messages.length}`
      );
    } else {
      console.warn(`[retry] attempt=${attempt} account=${account.name}`);
    }

    const handler = body.stream ? handleStream : handleNonStream;
    const result = await handler(res, body, account);
    if (result?.retryable) continue; // 换账号重试
    return; // 响应已发出或已报错
  }

  sendError(res, 503, "All accounts failed. Please check account status.");
}

function handleModels(_req, res) {
  sendJSON(res, 200, {
    object: "list",
    data: [
      { id: "claude-opus-4-6", object: "model", created: 1700000000, owned_by: "anthropic" },
      { id: "claude-sonnet-4-6", object: "model", created: 1700000000, owned_by: "anthropic" },
      { id: "claude-haiku-4-5-20251001", object: "model", created: 1700000000, owned_by: "anthropic" },
    ],
  });
}

function handleStatus(_req, res) {
  sendJSON(res, 200, {
    status: "ok",
    requestCount,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    accounts: accountManager.listAccounts(),
    rateLimits: Object.fromEntries(accountRateLimits),
  });
}

// ── 账号管理路由 ──
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function handleAccountRoutes(req, res, path) {
  // GET /accounts — 列出所有账号
  if (path === "/accounts" && req.method === "GET") {
    return sendJSON(res, 200, { accounts: accountManager.listAccounts() });
  }

  // POST /accounts/login — 启动 OAuth 登录
  if (path === "/accounts/login" && req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch { return sendError(res, 400, "Invalid JSON"); }
    const name = body.name;
    if (!name) return sendError(res, 400, "name is required");

    try {
      const result = await accountManager.startOAuthLogin(name, {
        provider: body.provider, // "console" or "claude.ai"
        scopes: body.scopes,
      });
      return sendJSON(res, 200, {
        message: `Open the URL below in your browser to authorize account "${name}"`,
        authorizeUrl: result.authorizeUrl,
        callbackUrl: result.callbackUrl,
        callbackPort: result.port,
        accountName: result.accountName,
      });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // POST /accounts/login/complete — 手动完成 OAuth (粘贴 authorization code)
  if (path === "/accounts/login/complete" && req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch { return sendError(res, 400, "Invalid JSON"); }
    const { name, code } = body;
    if (!name || !code) return sendError(res, 400, "name and code are required");

    try {
      const result = await accountManager.completeManualAuth(name, code);
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }

  // POST /accounts/add — 手动添加账号 (API Key 或 OAuth token)
  if (path === "/accounts/add" && req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch { return sendError(res, 400, "Invalid JSON"); }
    const { name } = body;
    if (!name) return sendError(res, 400, "name is required");

    if (body.apiKey) {
      const result = accountManager.addApiKeyAccount(name, body.apiKey);
      return sendJSON(res, 200, result);
    }
    if (body.accessToken) {
      const result = accountManager.addOAuthAccount(name, body);
      return sendJSON(res, 200, result);
    }
    return sendError(res, 400, "apiKey or accessToken is required");
  }

  // GET /accounts/:name — 查看单个账号
  const getMatch = path.match(/^\/accounts\/([^/]+)$/);
  if (getMatch && req.method === "GET") {
    const name = decodeURIComponent(getMatch[1]);
    const info = accountManager.getAccount(name);
    if (!info) return sendError(res, 404, "Account not found");
    return sendJSON(res, 200, info);
  }

  // DELETE /accounts/:name — 删除账号
  if (getMatch && req.method === "DELETE") {
    const name = decodeURIComponent(getMatch[1]);
    const result = accountManager.removeAccount(name);
    return sendJSON(res, 200, result);
  }

  // POST /accounts/:name/refresh — 强制刷新 token
  const refreshMatch = path.match(/^\/accounts\/([^/]+)\/refresh$/);
  if (refreshMatch && req.method === "POST") {
    const name = decodeURIComponent(refreshMatch[1]);
    const result = await accountManager.forceRefresh(name);
    return sendJSON(res, 200, result);
  }

  return sendError(res, 404, "Not found");
}

// ── Server ──
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // API 代理路由
  if (path === "/v1/messages") return handleMessages(req, res);
  if (path === "/v1/models") return handleModels(req, res);

  // 状态
  if (path === "/status") return handleStatus(req, res);
  if (path === "/health") return sendJSON(res, 200, { status: "ok" });

  // 账号管理路由
  if (path.startsWith("/accounts")) return handleAccountRoutes(req, res, path);

  // 管理页面
  if (path === "/" || path === "/index.html") {
    try {
      const html = readFileSync(join(resolve("."), "public", "index.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch {
      return sendError(res, 404, "Management page not found");
    }
  }

  sendError(res, 404, "Not found");
});

server.listen(PORT, () => {
  const accts = accountManager.listAccounts();
  const activeCount = accts.filter((a) => a.status === "active").length;
  console.log(`nmpcc-sdk listening on port ${PORT}`);
  console.log(`  API:  ${BASE_API_URL}`);
  console.log(`  Accounts: ${activeCount} active / ${accts.length} total`);
  console.log(`  Auth: ${API_KEYS.length > 0 ? "enabled" : "DISABLED"}`);
  console.log();
  console.log(`  Proxy:`);
  console.log(`    POST /v1/messages`);
  console.log(`    GET  /v1/models`);
  console.log();
  console.log(`  Account management:`);
  console.log(`    GET    /accounts              — list all`);
  console.log(`    POST   /accounts/login        — start OAuth login`);
  console.log(`    POST   /accounts/login/complete — manual code entry`);
  console.log(`    POST   /accounts/add          — add API key / token`);
  console.log(`    GET    /accounts/:name        — account detail`);
  console.log(`    DELETE /accounts/:name        — remove account`);
  console.log(`    POST   /accounts/:name/refresh — force token refresh`);
  console.log();
  console.log(`  GET  /status`);
});
