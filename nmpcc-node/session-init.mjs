import { randomUUID, createHash, randomBytes } from "node:crypto";

// ── Constants matching real CLI 2.1.87 ──
const CLI_VERSION = "2.1.87";
const GROWTHBOOK_CLIENT_KEY = "sdk-zAZezfDKGoZuXXKe";
const OAUTH_BETA = "oauth-2025-04-20";
const MCP_BETA = "mcp-servers-2025-12-04";

const SESSION_BASE_TTL = 6 * 3600_000; // 6 hours
const SESSION_JITTER = 6 * 3600_000;   // +0~6 hours

// ── Device Identity (stable per account) ──
const deviceProfiles = new Map();

export function getOrCreateDeviceProfile(accountKey) {
  if (deviceProfiles.has(accountKey)) return deviceProfiles.get(accountKey);
  const profile = {
    deviceId: randomBytes(32).toString("hex"),
    accountUuid: randomUUID(),
    sessionId: randomUUID(),
    createdAt: Date.now(),
  };
  deviceProfiles.set(accountKey, profile);
  return profile;
}

export function buildUserID(accountKey) {
  const p = getOrCreateDeviceProfile(accountKey);
  return JSON.stringify({
    device_id: p.deviceId,
    account_uuid: p.accountUuid,
    session_id: p.sessionId,
  });
}

// ── Session Init Emitter ──
const sessions = new Map();

function needsInit(sessionKey) {
  const now = Date.now();
  const existing = sessions.get(sessionKey);
  if (existing && now < existing.expireAt) return false;
  sessions.set(sessionKey, {
    createdAt: now,
    expireAt: now + SESSION_BASE_TTL + Math.random() * SESSION_JITTER,
  });
  return true;
}

function authHeaders(token, isOAuth) {
  if (isOAuth) {
    return { Authorization: `Bearer ${token}`, "anthropic-beta": OAUTH_BETA };
  }
  return { "x-api-key": token };
}

async function fireRequest(label, url, options = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // Drain body
    await resp.text().catch(() => {});
    console.log(`[session-init] ${label} status=${resp.status}`);
    return resp.status < 400;
  } catch (err) {
    console.log(`[session-init] ${label} failed: ${err.message}`);
    return false;
  }
}

// ── Individual init requests matching MITM capture ──

async function fireGrowthBookEval(baseURL, token, isOAuth, profile) {
  const body = {
    attributes: {
      id: profile.deviceId,
      deviceID: profile.deviceId,
      accountUUID: profile.accountUuid,
      organizationUUID: "",
      sessionId: profile.sessionId,
      platform: "darwin",
      userType: "external",
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_20x",
      appVersion: CLI_VERSION,
      firstTokenTime: Date.now(),
    },
    forcedFeatures: [],
    forcedVariations: {},
    url: "",
  };
  return fireRequest("growthbook_eval", `${baseURL}/api/eval/${GROWTHBOOK_CLIENT_KEY}`, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "User-Agent": "Bun/1.3.11",
      Connection: "keep-alive",
      ...authHeaders(token, isOAuth),
    },
    body: JSON.stringify(body),
  });
}

async function fireBootstrap(baseURL, token, isOAuth) {
  return fireRequest("bootstrap", `${baseURL}/api/claude_cli/bootstrap`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": `claude-code/${CLI_VERSION}`,
      Connection: "close",
      ...authHeaders(token, isOAuth),
    },
  });
}

async function fireGrove(baseURL, token, isOAuth) {
  return fireRequest("grove", `${baseURL}/api/claude_code_grove`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": `claude-cli/${CLI_VERSION} (external, cli)`,
      Connection: "close",
      ...authHeaders(token, isOAuth),
    },
  });
}

async function fireAccountSettings(baseURL, token, isOAuth) {
  return fireRequest("account_settings", `${baseURL}/api/oauth/account/settings`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": `claude-code/${CLI_VERSION}`,
      Connection: "close",
      ...authHeaders(token, isOAuth),
    },
  });
}

async function firePenguinMode(baseURL, token, isOAuth) {
  return fireRequest("penguin_mode", `${baseURL}/api/claude_code_penguin_mode`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "axios/1.13.6",
      Connection: "close",
      ...authHeaders(token, isOAuth),
    },
  });
}

async function fireMCPServers(baseURL, token, isOAuth) {
  return fireRequest("mcp_servers", `${baseURL}/v1/mcp_servers?limit=1000`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": "axios/1.13.6",
      "anthropic-beta": MCP_BETA,
      "anthropic-version": "2023-06-01",
      Connection: "close",
      ...authHeaders(token, isOAuth),
    },
  });
}

async function fireMCPRegistry(baseURL) {
  return fireRequest("mcp_registry",
    `${baseURL}/mcp-registry/v0/servers?version=latest&visibility=commercial`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "axios/1.13.6",
      Connection: "close",
    },
  });
}

async function fireCLIVersionCheck() {
  return fireRequest("cli_version_check",
    "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest", {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "axios/1.13.6",
      Connection: "close",
    },
  });
}

async function fireQuotaCheck(baseURL, token, isOAuth, profile) {
  const userID = JSON.stringify({
    device_id: profile.deviceId,
    account_uuid: profile.accountUuid,
    session_id: profile.sessionId,
  });
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1,
    messages: [{ role: "user", content: "quota" }],
    metadata: { user_id: userID },
  };
  const stainlessHeaders = {
    "X-Stainless-Arch": "arm64",
    "X-Stainless-Lang": "js",
    "X-Stainless-Os": "MacOS",
    "X-Stainless-Package-Version": "0.74.0",
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": "v24.3.0",
    "X-Stainless-Timeout": "600",
  };
  return fireRequest("quota_check", `${baseURL}/v1/messages?beta=true`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05",
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-version": "2023-06-01",
      "User-Agent": `claude-cli/${CLI_VERSION} (external, cli)`,
      "x-app": "cli",
      "x-client-request-id": randomUUID(),
      Connection: "keep-alive",
      ...stainlessHeaders,
      ...authHeaders(token, isOAuth),
    },
    body: JSON.stringify(body),
  });
}

async function fireTitleGeneration(baseURL, token, isOAuth, profile) {
  const userID = JSON.stringify({
    device_id: profile.deviceId,
    account_uuid: profile.accountUuid,
    session_id: profile.sessionId,
  });

  // Build hash for billing header
  const chars = [4, 7, 20].map((i) => "hello"[i] || "0").join("");
  const hash = createHash("sha256").update("59cf53e54c78" + chars + CLI_VERSION).digest("hex").slice(0, 3);
  const cch = randomBytes(3).toString("hex").slice(0, 5);
  const billingHeader = `x-anthropic-billing-header: cc_version=${CLI_VERSION}.${hash}; cc_entrypoint=cli; cch=${cch};`;

  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 32000,
    stream: true,
    temperature: 1,
    tools: [],
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    metadata: { user_id: userID },
    system: [
      { type: "text", text: billingHeader },
      { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: "text", text: "Generate a concise, sentence-case title (3-7 words) that captures the main topic or goal of this coding session. The title should be clear enough that the user recognizes the session in a list. Use sentence case: capitalize only the first word and proper nouns.\n\nReturn JSON with a single \"title\" field.\n\nGood examples:\n{\"title\": \"Fix login button on mobile\"}\n{\"title\": \"Add OAuth authentication\"}\n{\"title\": \"Debug failing CI tests\"}\n{\"title\": \"Refactor API client error handling\"}\n\nBad (too vague): {\"title\": \"Code changes\"}\nBad (too long): {\"title\": \"Investigate and fix the issue where the login button does not respond on mobile devices\"}\nBad (wrong case): {\"title\": \"Fix Login Button On Mobile\"}" },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
          additionalProperties: false,
        },
      },
    },
  };

  const stainlessHeaders = {
    "X-Stainless-Arch": "arm64",
    "X-Stainless-Lang": "js",
    "X-Stainless-Os": "MacOS",
    "X-Stainless-Package-Version": "0.74.0",
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": "v24.3.0",
    "X-Stainless-Timeout": "600",
  };

  return fireRequest("title_generation", `${baseURL}/v1/messages?beta=true`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,structured-outputs-2025-12-15",
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-version": "2023-06-01",
      "User-Agent": `claude-cli/${CLI_VERSION} (external, cli)`,
      "x-app": "cli",
      "x-client-request-id": randomUUID(),
      Connection: "keep-alive",
      ...stainlessHeaders,
      ...authHeaders(token, isOAuth),
    },
    body: JSON.stringify(body),
  });
}

// ── Main emitter ──
export async function emitSessionInit(accountKey, token, isOAuth, baseURL = "https://api.anthropic.com") {
  if (!needsInit(accountKey)) {
    return false;
  }

  console.log(`[session-init] triggering for ${accountKey}`);
  const profile = getOrCreateDeviceProfile(accountKey);

  // Wave 1: all startup requests in parallel
  const wave1 = [
    fireGrowthBookEval(baseURL, token, isOAuth, profile),
    fireAccountSettings(baseURL, token, isOAuth),
    fireGrove(baseURL, token, isOAuth),
    fireBootstrap(baseURL, token, isOAuth),
    firePenguinMode(baseURL, token, isOAuth),
    fireMCPServers(baseURL, token, isOAuth),
    fireMCPRegistry(baseURL),
    fireQuotaCheck(baseURL, token, isOAuth, profile),
    fireCLIVersionCheck(),
  ];
  await Promise.allSettled(wave1);

  // Wave 2: mcp_servers again + title generation
  const wave2 = [
    fireMCPServers(baseURL, token, isOAuth),
    fireTitleGeneration(baseURL, token, isOAuth, profile),
  ];
  const results = await Promise.allSettled(wave2);

  const titleOK = results[1].status === "fulfilled" && results[1].value === true;
  if (titleOK) {
    console.log(`[session-init] all startup requests completed for ${accountKey}`);
  } else {
    console.warn(`[session-init] title_generation failed for ${accountKey}, will retry next request`);
    sessions.delete(accountKey);
  }
  return titleOK;
}

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of sessions) {
    if (now >= val.expireAt) sessions.delete(key);
  }
}, 15 * 60_000);
