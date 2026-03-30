import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createServer as createHttpServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";

// ── OAuth 常量 (参考 https://gist.github.com/troykelly/6fdb3845d3c53a39469c338c125dfff6) ──
const OAUTH_CONFIG = {
  AUTHORIZE_URL: "https://claude.ai/oauth/authorize",
  TOKEN_URL: "https://platform.claude.com/v1/oauth/token",
  CLIENT_ID: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  SCOPES: ["org:create_api_key", "user:profile", "user:inference", "user:sessions:claude_code", "user:mcp_servers", "user:file_upload"],
  CALLBACK_URL: "https://platform.claude.com/oauth/code/callback",
  PROFILE_URL: "https://api.anthropic.com/api/oauth/profile",
  ROLES_URL: "https://api.anthropic.com/api/oauth/claude_cli/roles",
};

// ── PKCE 工具函数 (精确复现 CLI 的 hGB / gGB / uGB) ──
function generateCodeVerifier() {
  return randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generateCodeChallenge(verifier) {
  return createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generateState() {
  return randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ── 账号状态 ──
const AccountStatus = {
  ACTIVE: "active",
  EXPIRED: "expired",
  COOLDOWN: "cooldown",
  ERROR: "error",
  PENDING: "pending", // 等待 OAuth 授权
};

/**
 * AccountManager — 多账号管理器
 *
 * 账号目录结构:
 *   accounts/
 *     {name}/
 *       credentials.json   — OAuth 凭据 / API Key
 *     runtime.json          — 全局配置
 */
export class AccountManager {
  constructor(accountsDir) {
    this.accountsDir = accountsDir;
    this.accounts = new Map(); // name → account object
    this.accountList = [];     // 有序列表用于轮询
    this.currentIndex = 0;
    this.pendingAuths = new Map(); // name → { state, codeVerifier, server, resolve, reject }
    this.runtimeConfig = this._loadRuntime();
    this._loadAllAccounts();
  }

  // ── 运行时配置 ──
  _loadRuntime() {
    const rtPath = join(this.accountsDir, "runtime.json");
    try {
      if (existsSync(rtPath)) {
        return JSON.parse(readFileSync(rtPath, "utf-8"));
      }
    } catch {}
    return { maxConcurrency: 5, maxTurns: 5, serviceApiKeys: [] };
  }

  _saveRuntime() {
    const rtPath = join(this.accountsDir, "runtime.json");
    writeFileSync(rtPath, JSON.stringify(this.runtimeConfig, null, 2));
  }

  // ── 加载所有账号 ──
  _loadAllAccounts() {
    if (!existsSync(this.accountsDir)) {
      mkdirSync(this.accountsDir, { recursive: true });
    }

    const entries = readdirSync(this.accountsDir);
    for (const name of entries) {
      if (name === "runtime.json" || name === ".removed" || name === "example" || name.startsWith(".")) continue;
      const dir = join(this.accountsDir, name);
      if (!statSync(dir).isDirectory()) continue;
      this._loadAccount(name);
    }

    this._rebuildList();
    console.log(`[accounts] loaded ${this.accountList.length} account(s)`);
  }

  _loadAccount(name) {
    const dir = join(this.accountsDir, name);
    const credFile = join(dir, "credentials.json");

    if (!existsSync(credFile)) {
      return null;
    }

    try {
      const cred = JSON.parse(readFileSync(credFile, "utf-8"));
      const account = {
        name,
        credentials: cred,
        status: AccountStatus.ACTIVE,
        lastUsed: 0,
        cooldownUntil: 0,
        errorCount: 0,
        lastError: null,
        requestCount: 0,
      };

      // 验证凭据有效性
      if (!cred.accessToken && !cred.apiKey) {
        account.status = AccountStatus.ERROR;
        account.lastError = "No accessToken or apiKey in credentials";
      }

      // 检查是否过期
      if (cred.expiresAt && new Date(cred.expiresAt).getTime() < Date.now()) {
        if (cred.refreshToken) {
          account.status = AccountStatus.EXPIRED; // 可以刷新
        } else {
          account.status = AccountStatus.ERROR;
          account.lastError = "Token expired and no refreshToken";
        }
      }

      this.accounts.set(name, account);
      console.log(`[accounts] loaded: ${name} (${cred.apiKey ? "apiKey" : "oauth"}, ${account.status})`);
      return account;
    } catch (e) {
      console.error(`[accounts] failed to load ${name}:`, e.message);
      return null;
    }
  }

  _rebuildList() {
    this.accountList = [...this.accounts.values()].filter(
      (a) => a.status !== AccountStatus.ERROR && a.status !== AccountStatus.PENDING
    );
  }

  // ── 持久化凭据 ──
  _saveCredentials(name, credentials) {
    const dir = join(this.accountsDir, name);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const credFile = join(dir, "credentials.json");
    writeFileSync(credFile, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  }

  // ── 账号选取 (Round-Robin + 冷却跳过) ──
  pick() {
    const now = Date.now();
    const len = this.accountList.length;
    if (len === 0) return null;

    // 第一轮：跳过冷却和过期
    for (let i = 0; i < len; i++) {
      const idx = (this.currentIndex + i) % len;
      const acc = this.accountList[idx];
      if (acc.cooldownUntil > now) continue;
      if (acc.status === AccountStatus.EXPIRED) continue;
      if (acc.status !== AccountStatus.ACTIVE) continue;

      this.currentIndex = (idx + 1) % len;
      acc.lastUsed = now;
      acc.requestCount++;
      return acc;
    }

    // 第二轮：包含过期但有 refreshToken 的（会在使用前刷新）
    for (let i = 0; i < len; i++) {
      const idx = (this.currentIndex + i) % len;
      const acc = this.accountList[idx];
      if (acc.status === AccountStatus.EXPIRED && acc.credentials.refreshToken) {
        this.currentIndex = (idx + 1) % len;
        acc.lastUsed = now;
        acc.requestCount++;
        return acc;
      }
    }

    // 第三轮：返回冷却时间最短的
    const sorted = [...this.accountList]
      .filter((a) => a.status === AccountStatus.ACTIVE || a.status === AccountStatus.COOLDOWN)
      .sort((a, b) => a.cooldownUntil - b.cooldownUntil);

    return sorted[0] || null;
  }

  // ── 冷却 ──
  cooldown(account, durationMs = 60000) {
    account.cooldownUntil = Date.now() + durationMs;
    account.status = AccountStatus.COOLDOWN;
    console.log(`[accounts] ${account.name} cooldown ${durationMs / 1000}s`);

    // 冷却结束后恢复
    setTimeout(() => {
      if (account.status === AccountStatus.COOLDOWN) {
        account.status = AccountStatus.ACTIVE;
        account.cooldownUntil = 0;
      }
    }, durationMs);
  }

  // ── 标记错误 ──
  markError(account, error) {
    account.errorCount++;
    account.lastError = error;
    if (account.errorCount >= 5) {
      account.status = AccountStatus.ERROR;
      this._rebuildList();
      console.error(`[accounts] ${account.name} disabled after ${account.errorCount} errors: ${error}`);
    }
  }

  // ── Token 刷新 ──
  async refreshToken(account) {
    const cred = account.credentials;
    if (!cred.refreshToken) return false;

    console.log(`[accounts] refreshing token for ${account.name}...`);
    try {
      const resp = await fetch(OAUTH_CONFIG.TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "axios/1.13.4",
          "Accept": "application/json, text/plain, */*",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: cred.refreshToken,
          client_id: OAUTH_CONFIG.CLIENT_ID,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error(`[accounts] refresh failed for ${account.name}: ${resp.status} ${text}`);
        if (resp.status === 401 || resp.status === 403) {
          account.status = AccountStatus.ERROR;
          account.lastError = `Refresh token invalid: ${resp.status}`;
          this._rebuildList();
        }
        return false;
      }

      const data = await resp.json();
      cred.accessToken = data.access_token;
      if (data.refresh_token) cred.refreshToken = data.refresh_token;
      cred.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

      this._saveCredentials(account.name, cred);
      account.status = AccountStatus.ACTIVE;
      account.errorCount = 0;
      console.log(`[accounts] token refreshed for ${account.name}`);
      return true;
    } catch (e) {
      console.error(`[accounts] refresh error for ${account.name}:`, e.message);
      return false;
    }
  }

  // ── 检查 token 是否快过期 ──
  isTokenExpiring(account) {
    const cred = account.credentials;
    if (cred.apiKey) return false; // API Key 不过期
    if (!cred.expiresAt) return false;
    return new Date(cred.expiresAt).getTime() < Date.now() + 5 * 60 * 1000; // 5分钟提前量
  }

  // ── 确保 token 有效（使用前调用） ──
  async ensureValidToken(account) {
    if (account.credentials.apiKey) return true;

    if (this.isTokenExpiring(account)) {
      const ok = await this.refreshToken(account);
      if (!ok && account.status === AccountStatus.EXPIRED) {
        return false;
      }
    }
    return account.status === AccountStatus.ACTIVE;
  }

  // ═══════════════════════════════════════════════
  // OAuth 授权流程
  // ═══════════════════════════════════════════════

  /**
   * 启动 OAuth 授权流程
   * 使用 platform.claude.com 固定回调地址，用户授权后手动粘贴回调 URL
   * 返回 { authorizeUrl, accountName }
   */
  async startOAuthLogin(accountName, options = {}) {
    if (this.pendingAuths.has(accountName)) {
      await this._cleanupPendingAuth(accountName);
    }

    const dir = join(this.accountsDir, accountName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    const scopes = options.scopes || OAUTH_CONFIG.SCOPES;
    const redirectUri = OAUTH_CONFIG.CALLBACK_URL;

    const params = new URLSearchParams({
      code: "true",
      client_id: OAUTH_CONFIG.CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    const authorizeUrl = `${OAUTH_CONFIG.AUTHORIZE_URL}?${params.toString()}`;

    // 存储待处理状态（无本地服务器）
    this.pendingAuths.set(accountName, {
      state,
      codeVerifier,
      redirectUri,
      scopes,
      createdAt: Date.now(),
    });

    // 30分钟超时自动清理
    setTimeout(() => this._cleanupPendingAuth(accountName), 30 * 60 * 1000);

    console.log(`[oauth] login started for ${accountName}`);

    return { authorizeUrl, accountName };
  }

  /**
   * 用户授权后，粘贴回调 URL（或 code）完成授权
   */
  async completeManualAuth(accountName, authorizationCode) {
    const pending = this.pendingAuths.get(accountName);
    if (!pending) {
      return this._exchangeToken(accountName, {
        authorizationCode,
        codeVerifier: generateCodeVerifier(),
        redirectUri: OAUTH_CONFIG.CALLBACK_URL,
        state: generateState(),
        scopes: OAUTH_CONFIG.SCOPES,
      });
    }

    return this._exchangeToken(accountName, {
      authorizationCode,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
      state: pending.state,
      scopes: pending.scopes,
    });
  }

  // ── 内部：启动本地回调服务器 ──
  _startCallbackServer(expectedState) {
    return new Promise((resolve, reject) => {
      let callbackResolve, callbackReject;
      const callbackPromise = new Promise((res, rej) => {
        callbackResolve = res;
        callbackReject = rej;
      });

      const server = createHttpServer((req, res) => {
        const url = new URL(req.url, `http://localhost`);

        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code) {
          res.writeHead(400);
          res.end("Missing authorization code");
          callbackReject(new Error("Missing authorization code"));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400);
          res.end("Invalid state parameter");
          callbackReject(new Error("State mismatch — possible CSRF attack"));
          return;
        }

        // 重定向到成功页面
        res.writeHead(302, { Location: OAUTH_CONFIG.CONSOLE_SUCCESS_URL });
        res.end();

        callbackResolve(code);
      });

      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        resolve({
          server,
          port,
          waitForCallback: () => callbackPromise,
        });
      });

      server.on("error", reject);
    });
  }

  // ── 内部：异步等待回调并交换 token ──
  async _waitAndExchange(accountName) {
    const pending = this.pendingAuths.get(accountName);
    if (!pending) return;

    try {
      const authorizationCode = await pending.waitForCallback();
      console.log(`[oauth] ${accountName} received callback, exchanging token...`);

      await this._exchangeToken(accountName, {
        authorizationCode,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri,
        state: pending.state,
        scopes: pending.scopes,
      });
    } finally {
      await this._cleanupPendingAuth(accountName);
    }
  }

  // ── 内部：Token 交换 ──
  async _exchangeToken(accountName, { authorizationCode, codeVerifier, redirectUri, state, scopes }) {
    const body = {
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: redirectUri,
      client_id: OAUTH_CONFIG.CLIENT_ID,
      code_verifier: codeVerifier,
      state,
    };

    const resp = await fetch(OAUTH_CONFIG.TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "axios/1.13.4",
        "Accept": "application/json, text/plain, */*",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      const msg = resp.status === 401
        ? "Invalid authorization code"
        : `Token exchange failed (${resp.status}): ${text}`;
      throw new Error(msg);
    }

    const data = await resp.json();
    console.log(`[oauth] ${accountName} token obtained`);

    // 获取用户信息
    let profile = null;
    let roles = null;
    try {
      [profile, roles] = await Promise.all([
        this._fetchProfile(data.access_token),
        this._fetchRoles(data.access_token),
      ]);
    } catch (e) {
      console.warn(`[oauth] ${accountName} failed to fetch profile:`, e.message);
    }

    // 构造凭据
    const credentials = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      scopes: scopes,
      accountUuid: data.account?.uuid || profile?.account?.uuid,
      emailAddress: data.account?.email_address || profile?.account?.email_address,
      organizationUuid: data.organization?.uuid || profile?.organization?.uuid,
      displayName: profile?.account?.display_name,
      organizationRole: roles?.organization_role,
      workspaceRole: roles?.workspace_role,
      organizationName: roles?.organization_name,
    };

    // 保存
    this._saveCredentials(accountName, credentials);

    // 加载到内存
    this._loadAccount(accountName);
    this._rebuildList();

    console.log(`[oauth] ${accountName} login complete (${credentials.emailAddress || "unknown"})`);
    return { success: true, accountName, email: credentials.emailAddress };
  }

  // ── 内部：获取用户 Profile ──
  async _fetchProfile(accessToken) {
    const resp = await fetch(OAUTH_CONFIG.PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) return null;
    return resp.json();
  }

  // ── 内部：获取用户 Roles ──
  async _fetchRoles(accessToken) {
    const resp = await fetch(OAUTH_CONFIG.ROLES_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!resp.ok) return null;
    return resp.json();
  }

  // ── 内部：清理 pending auth ──
  async _cleanupPendingAuth(accountName) {
    const pending = this.pendingAuths.get(accountName);
    if (!pending) return;
    if (pending.server) {
      pending.server.close();
    }
    this.pendingAuths.delete(accountName);
  }

  // ═══════════════════════════════════════════════
  // 账号管理 CRUD
  // ═══════════════════════════════════════════════

  /** 列出所有账号 */
  listAccounts() {
    const result = [];
    for (const [name, acc] of this.accounts) {
      result.push({
        name,
        status: acc.status,
        type: acc.credentials.apiKey ? "apiKey" : "oauth",
        email: acc.credentials.emailAddress || null,
        organization: acc.credentials.organizationName || null,
        lastUsed: acc.lastUsed ? new Date(acc.lastUsed).toISOString() : null,
        cooldownUntil: acc.cooldownUntil > Date.now() ? new Date(acc.cooldownUntil).toISOString() : null,
        requestCount: acc.requestCount,
        errorCount: acc.errorCount,
        lastError: acc.lastError,
        expiresAt: acc.credentials.expiresAt || null,
      });
    }

    // 加上 pending 的
    for (const [name, pending] of this.pendingAuths) {
      if (!this.accounts.has(name)) {
        result.push({
          name,
          status: AccountStatus.PENDING,
          type: "oauth",
          email: null,
          port: pending.port,
          createdAt: new Date(pending.createdAt).toISOString(),
        });
      }
    }
    return result;
  }

  /** 获取单个账号状态 */
  getAccount(name) {
    const acc = this.accounts.get(name);
    if (!acc) {
      const pending = this.pendingAuths.get(name);
      if (pending) {
        return { name, status: AccountStatus.PENDING, port: pending.port };
      }
      return null;
    }
    return {
      name,
      status: acc.status,
      type: acc.credentials.apiKey ? "apiKey" : "oauth",
      email: acc.credentials.emailAddress || null,
      organization: acc.credentials.organizationName || null,
      organizationUuid: acc.credentials.organizationUuid || null,
      accountUuid: acc.credentials.accountUuid || null,
      lastUsed: acc.lastUsed ? new Date(acc.lastUsed).toISOString() : null,
      requestCount: acc.requestCount,
      expiresAt: acc.credentials.expiresAt || null,
    };
  }

  /** 手动添加 API Key 账号 */
  addApiKeyAccount(name, apiKey) {
    const credentials = { apiKey };
    this._saveCredentials(name, credentials);
    this._loadAccount(name);
    this._rebuildList();
    return { success: true, name };
  }

  /** 手动添加 OAuth 凭据（直接提供 token） */
  addOAuthAccount(name, { accessToken, refreshToken, expiresAt, organizationUuid }) {
    const credentials = {
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt: expiresAt || null,
      organizationUuid: organizationUuid || null,
    };
    this._saveCredentials(name, credentials);
    this._loadAccount(name);
    this._rebuildList();
    return { success: true, name };
  }

  /** 删除账号 */
  removeAccount(name) {
    this._cleanupPendingAuth(name);
    this.accounts.delete(name);
    this._rebuildList();
    // 不删除文件，只是从内存中移除。追加到 .removed
    try {
      const removedPath = join(this.accountsDir, ".removed");
      const existing = existsSync(removedPath) ? readFileSync(removedPath, "utf-8") : "";
      if (!existing.split("\n").includes(name)) {
        writeFileSync(removedPath, existing + name + "\n");
      }
    } catch {}
    return { success: true, name };
  }

  /** 强制刷新某个账号的 token */
  async forceRefresh(name) {
    const acc = this.accounts.get(name);
    if (!acc) return { success: false, error: "Account not found" };
    const ok = await this.refreshToken(acc);
    return { success: ok, name, status: acc.status };
  }
}
