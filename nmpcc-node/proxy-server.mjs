import { createServer } from "node:http";
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

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
const PORT = parseInt(process.env.PROXY_PORT || "3001", 10);
const ACCOUNTS_DIR = resolve(process.env.ACCOUNTS_DIR || "./accounts");
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "600000", 10);
const SERVICE_API_KEYS = (process.env.SERVICE_API_KEYS || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

// ── Claude Code 逆向常量 ──
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLI_VERSION = "1.0.128";

// Beta flags — 按 Claude Code CLI 逆向得到的精确值
const BETA_FLAGS = {
  claudeCode: "claude-code-20250219",
  oauth: "oauth-2025-04-20",
  context1m: "context-1m-2025-08-07",
  interleavedThinking: "interleaved-thinking-2025-05-14",
  fineGrainedToolStreaming: "fine-grained-tool-streaming-2025-05-14",
};

// ── Account Manager ──
class AccountManager {
  constructor(accountsDir) {
    this.accountsDir = accountsDir;
    this.accounts = []; // { name, credentials, lastUsed, cooldownUntil }
    this.currentIndex = 0;
    this.loadAccounts();
  }

  loadAccounts() {
    if (!existsSync(this.accountsDir)) {
      console.error(`[accounts] dir not found: ${this.accountsDir}`);
      return;
    }

    const entries = readdirSync(this.accountsDir);
    for (const name of entries) {
      if (name === "runtime.json" || name === ".removed" || name.startsWith(".")) continue;
      const dir = join(this.accountsDir, name);
      if (!statSync(dir).isDirectory()) continue;

      const credFile = join(dir, "credentials.json");
      if (!existsSync(credFile)) {
        console.log(`[accounts] skip ${name}: no credentials.json`);
        continue;
      }

      try {
        const cred = JSON.parse(readFileSync(credFile, "utf-8"));
        if (!cred.accessToken && !cred.apiKey) {
          console.log(`[accounts] skip ${name}: no accessToken or apiKey`);
          continue;
        }
        this.accounts.push({
          name,
          credentials: cred,
          lastUsed: 0,
          cooldownUntil: 0,
          refreshing: false,
        });
        console.log(`[accounts] loaded: ${name} (${cred.apiKey ? "apiKey" : "oauth"})`);
      } catch (e) {
        console.error(`[accounts] failed to load ${name}:`, e.message);
      }
    }

    console.log(`[accounts] total: ${this.accounts.length}`);
  }

  // Round-robin 选账号，跳过冷却中的
  pick() {
    if (this.accounts.length === 0) return null;
    const now = Date.now();
    const len = this.accounts.length;

    for (let i = 0; i < len; i++) {
      const idx = (this.currentIndex + i) % len;
      const acc = this.accounts[idx];
      if (acc.cooldownUntil > now) continue;
      if (acc.refreshing) continue;

      this.currentIndex = (idx + 1) % len;
      acc.lastUsed = now;
      return acc;
    }

    // 全部冷却中，返回冷却时间最短的
    const sorted = [...this.accounts].sort((a, b) => a.cooldownUntil - b.cooldownUntil);
    return sorted[0];
  }

  // 标记账号进入冷却（被限流时）
  cooldown(account, durationMs = 60000) {
    account.cooldownUntil = Date.now() + durationMs;
    console.log(`[accounts] ${account.name} cooldown ${durationMs / 1000}s`);
  }

  // 刷新 OAuth token
  async refreshToken(account) {
    const cred = account.credentials;
    if (!cred.refreshToken) return false;
    if (account.refreshing) return false;

    account.refreshing = true;
    console.log(`[accounts] refreshing token for ${account.name}...`);

    try {
      const resp = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: cred.refreshToken,
          client_id: OAUTH_CLIENT_ID,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error(`[accounts] refresh failed for ${account.name}: ${resp.status} ${text}`);
        return false;
      }

      const data = await resp.json();
      cred.accessToken = data.access_token;
      if (data.refresh_token) cred.refreshToken = data.refresh_token;
      cred.expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined;

      // 持久化
      const credFile = join(this.accountsDir, account.name, "credentials.json");
      writeFileSync(credFile, JSON.stringify(cred, null, 2));
      console.log(`[accounts] token refreshed for ${account.name}`);
      return true;
    } catch (e) {
      console.error(`[accounts] refresh error for ${account.name}:`, e.message);
      return false;
    } finally {
      account.refreshing = false;
    }
  }

  // 检查 token 是否过期
  isTokenExpired(account) {
    const cred = account.credentials;
    if (!cred.expiresAt) return false;
    return new Date(cred.expiresAt).getTime() < Date.now() + 60000; // 提前1分钟
  }
}

const accountManager = new AccountManager(ACCOUNTS_DIR);

// ── 构造模拟 Claude Code 的请求头 ──
function buildClaudeCodeHeaders(account, model) {
  const cred = account.credentials;
  const isOAuth = !!cred.accessToken && !cred.apiKey;

  // 动态构造 beta flags，模拟 CLI 的 JV0() 函数
  const betas = [BETA_FLAGS.claudeCode];
  if (isOAuth) betas.push(BETA_FLAGS.oauth);
  if (model && model.includes("[1m]")) betas.push(BETA_FLAGS.context1m);
  // interleaved thinking — 默认开启（CLI 默认行为）
  betas.push(BETA_FLAGS.interleavedThinking);

  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": betas.join(","),
    "User-Agent": `claude-cli/${CLI_VERSION} (external, cli)`,
    "x-app": "cli",
  };

  // 认证头
  if (cred.apiKey) {
    headers["X-Api-Key"] = cred.apiKey;
  } else if (cred.accessToken) {
    headers["Authorization"] = `Bearer ${cred.accessToken}`;
  }

  // 组织 UUID
  if (cred.organizationUuid) {
    headers["x-organization-uuid"] = cred.organizationUuid;
  }

  return headers;
}

// ── 构造请求体 ──
function buildRequestBody(body) {
  const result = { ...body };

  // 确保 system prompt 带 cache_control（模拟 CLI 的 E2B() 行为）
  if (result.system && typeof result.system === "string") {
    result.system = [
      {
        type: "text",
        text: result.system,
        cache_control: { type: "ephemeral" },
      },
    ];
  } else if (Array.isArray(result.system)) {
    result.system = result.system.map((block) => {
      if (block.type === "text" && !block.cache_control) {
        return { ...block, cache_control: { type: "ephemeral" } };
      }
      return block;
    });
  }

  // 模拟 CLI 的 metadata 构造（zj() 函数）
  if (!result.metadata) {
    result.metadata = {
      user_id: `user_proxy_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    };
  }

  // 默认 max_tokens（CLI 默认 8192，Opus/Sonnet 可用 CLAUDE_CODE_MAX_OUTPUT_TOKENS 调整）
  if (!result.max_tokens) {
    const model = result.model || "";
    if (model.includes("haiku")) {
      result.max_tokens = 8192;
    } else {
      result.max_tokens = 16384;
    }
  }

  return result;
}

// ── 处理模型名 ──
function normalizeModel(model) {
  // 去掉 [1m] 后缀传给 API（CLI 的 Tx() 函数行为）
  if (model) return model.replace(/\[1m\]$/, "");
  return model;
}

// ── Stream 处理 ──
async function handleStream(res, body, account) {
  const model = body.model || "claude-sonnet-4-6";
  const headers = buildClaudeCodeHeaders(account, model);
  const requestBody = buildRequestBody({ ...body, stream: true });
  requestBody.model = normalizeModel(requestBody.model);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages?beta=true`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error(`[stream] upstream ${upstream.status}: ${errText}`);

      // 429 限流 → 冷却该账号
      if (upstream.status === 429) {
        const retryAfter = parseInt(upstream.headers.get("retry-after") || "60", 10);
        accountManager.cooldown(account, retryAfter * 1000);
      }
      // 401 认证失败 → 尝试刷新
      if (upstream.status === 401 && account.credentials.refreshToken) {
        await accountManager.refreshToken(account);
      }

      res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: errText } })}\n\n`);
      res.end();
      return;
    }

    // 直接透传 SSE
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed) {
        reader.cancel();
        break;
      }
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(`[stream] error:`, err.message);
    }
    if (!res.destroyed) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: err.message } })}\n\n`);
    }
  } finally {
    clearTimeout(timer);
    if (!res.destroyed) res.end();
  }
}

// ── Non-stream 处理 ──
async function handleNonStream(res, body, account) {
  const model = body.model || "claude-sonnet-4-6";
  const headers = buildClaudeCodeHeaders(account, model);
  const requestBody = buildRequestBody({ ...body, stream: false });
  requestBody.model = normalizeModel(requestBody.model);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages?beta=true`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const respText = await upstream.text();

    if (!upstream.ok) {
      console.error(`[non-stream] upstream ${upstream.status}: ${respText}`);
      if (upstream.status === 429) {
        const retryAfter = parseInt(upstream.headers.get("retry-after") || "60", 10);
        accountManager.cooldown(account, retryAfter * 1000);
      }
      if (upstream.status === 401 && account.credentials.refreshToken) {
        await accountManager.refreshToken(account);
      }
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      res.end(respText);
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(respText);
  } catch (err) {
    clearTimeout(timer);
    console.error(`[non-stream] error:`, err.message);
    sendError(res, 500, err.message);
  } finally {
    clearTimeout(timer);
  }
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
  if (SERVICE_API_KEYS.length === 0) return true;
  const auth = req.headers["authorization"] || "";
  const xKey = req.headers["x-api-key"] || "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  return SERVICE_API_KEYS.includes(key) || SERVICE_API_KEYS.includes(xKey);
}

let requestCount = 0;

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

  // 选账号
  const account = accountManager.pick();
  if (!account) return sendError(res, 503, "No available accounts");

  // 检查 token 过期
  if (accountManager.isTokenExpired(account)) {
    const refreshed = await accountManager.refreshToken(account);
    if (!refreshed && !account.credentials.apiKey) {
      return sendError(res, 503, `Account ${account.name} token expired and refresh failed`);
    }
  }

  requestCount++;
  console.log(
    `[req] #${requestCount} account=${account.name} model=${body.model || "claude-sonnet-4-6"} stream=${!!body.stream}`
  );

  if (body.stream) {
    await handleStream(res, body, account);
  } else {
    await handleNonStream(res, body, account);
  }
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
  const accountsStatus = accountManager.accounts.map((a) => ({
    name: a.name,
    type: a.credentials.apiKey ? "apiKey" : "oauth",
    cooldownUntil: a.cooldownUntil > Date.now() ? new Date(a.cooldownUntil).toISOString() : null,
    lastUsed: a.lastUsed ? new Date(a.lastUsed).toISOString() : null,
  }));

  sendJSON(res, 200, {
    status: "ok",
    requestCount,
    accounts: accountsStatus,
  });
}

// ── Server ──
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === "/v1/messages") return handleMessages(req, res);
  if (path === "/v1/models") return handleModels(req, res);
  if (path === "/status") return handleStatus(req, res);
  if (path === "/health") return sendJSON(res, 200, { status: "ok" });
  sendError(res, 404, "Not found");
});

server.listen(PORT, () => {
  console.log(`\nnmpcc proxy-server listening on port ${PORT}`);
  console.log(`  Mode: Direct HTTP proxy (Claude Code headers simulation)`);
  console.log(`  Auth: ${SERVICE_API_KEYS.length > 0 ? "enabled" : "DISABLED"}`);
  console.log(`  Accounts: ${accountManager.accounts.length}`);
  console.log(`  POST /v1/messages`);
  console.log(`  GET  /v1/models`);
  console.log(`  GET  /status`);
  console.log();
});
