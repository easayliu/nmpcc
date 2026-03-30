package handler

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"nmpcc/internal/config"
	"nmpcc/internal/executor"
	"nmpcc/internal/formatter"
	"nmpcc/internal/pool"
	"nmpcc/internal/quota"
	"nmpcc/internal/web"
	"strings"
	"sync"
	"time"
)

type Handler struct {
	pool      *pool.AccountPool
	cfg       *config.Config
	mux       *http.ServeMux
	startTime time.Time
	webSecret []byte // HMAC key for web session tokens
	sessions  *sessionStore
}

// sessionEntry binds a downstream session to a specific account and CLI session.
type sessionEntry struct {
	CLISessionID string `json:"cliSessionId"`
	AccountName  string `json:"accountName"`
}

// sessionStore maps downstream session IDs to CLI session + account bindings.
type sessionStore struct {
	mu   sync.RWMutex
	m    map[string]sessionEntry
	path string // file path for persistence
}

func newSessionStore(path string) *sessionStore {
	s := &sessionStore{m: make(map[string]sessionEntry), path: path}
	s.load()
	return s
}

func (s *sessionStore) get(key string) (sessionEntry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.m[key]
	return e, ok
}

func (s *sessionStore) set(key string, entry sessionEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[key] = entry
	s.saveLocked()
}

func (s *sessionStore) load() {
	if s.path == "" {
		return
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var m map[string]sessionEntry
	if json.Unmarshal(data, &m) == nil {
		s.m = m
	}
}

func (s *sessionStore) saveLocked() {
	if s.path == "" {
		return
	}
	data, _ := json.Marshal(s.m)
	os.WriteFile(s.path, data, 0o644)
}

func New(p *pool.AccountPool, cfg *config.Config) *Handler {
	secret := make([]byte, 32)
	rand.Read(secret)

	h := &Handler{
		pool:      p,
		cfg:       cfg,
		mux:       http.NewServeMux(),
		startTime: time.Now(),
		webSecret: secret,
		sessions:  newSessionStore(filepath.Join(cfg.AccountsDir, ".sessions.json")),
	}
	h.mux.HandleFunc("/v1/messages", h.handleMessages)
	h.mux.HandleFunc("/v1/models", h.handleModels)
	h.mux.HandleFunc("/api/dashboard", h.handleDashboard)
	h.mux.HandleFunc("/api/refresh-quota", h.handleRefreshQuota)
	h.mux.HandleFunc("/api/usage", h.handleUsage)
	h.mux.HandleFunc("/api/logs", h.handleLogs)
	h.mux.HandleFunc("/api/accounts", h.handleAccounts)
	h.mux.HandleFunc("/api/web-auth", h.handleWebAuth)
	h.mux.HandleFunc("/api/settings", h.handleSettings)
	h.mux.HandleFunc("/api/accounts/concurrency", h.handleAccountConcurrency)
	h.mux.HandleFunc("/api/accounts/proxy", h.handleAccountProxy)
	h.mux.HandleFunc("/api/proxy", h.handleGlobalProxy)
	h.mux.HandleFunc("/api/apikey", h.handleAPIKey)
	h.mux.HandleFunc("/status", h.handleStatus)
	h.mux.Handle("/", h.webAuthMiddleware(web.Handler()))
	return h
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mux.ServeHTTP(w, r)
}

// ── Messages ──

type messageRequest struct {
	Messages []message `json:"messages"`
	Model    string    `json:"model"`
	Stream   bool      `json:"stream"`
	System   any       `json:"system"`
	Metadata *metadata `json:"metadata,omitempty"`
}

type metadata struct {
	UserID string `json:"user_id"`
}

type message struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

func (h *Handler) handleMessages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	if !h.authenticate(r) {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		sendError(w, http.StatusBadRequest, "Failed to read request body")
		return
	}
	log.Printf("[DEBUG] Request body: %s", string(rawBody))

	var body messageRequest
	if err := json.Unmarshal(rawBody, &body); err != nil {
		log.Printf("[ERROR] JSON decode failed: %v, body: %s", err, string(rawBody))
		sendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if len(body.Messages) == 0 {
		sendError(w, http.StatusBadRequest, "messages is required and must be a non-empty array")
		return
	}

	if !body.Stream {
		sendError(w, http.StatusBadRequest, "Only streaming requests are supported, set \"stream\": true")
		return
	}

	prompt := messagesToPrompt(body.Messages)
	if prompt == "" {
		sendError(w, http.StatusBadRequest, "Empty prompt")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.cfg.QueueTimeout)
	defer cancel()

	// Extract downstream session ID for session mapping
	downstreamSessionID := extractDownstreamSessionID(body.Metadata)

	opts := executor.Options{
		Model:        body.Model,
		SystemPrompt: extractSystemPrompt(body.System),
	}

	// Try to resume on the same account if session exists.
	// Give the bound account a short window (3s) before falling back to any account.
	var slot *pool.Slot
	var acquireErr error
	if downstreamSessionID != "" {
		if entry, ok := h.sessions.get(downstreamSessionID); ok {
			bindCtx, bindCancel := context.WithTimeout(ctx, 3*time.Second)
			slot, acquireErr = h.pool.AcquireByName(bindCtx, entry.AccountName)
			bindCancel()
			if acquireErr == nil {
				opts.SessionID = entry.CLISessionID
				log.Printf("[session] resuming CLI session %s on account %s", entry.CLISessionID, entry.AccountName)
			} else {
				// Bound account busy, fall through to any account (no resume)
				log.Printf("[session] bound account %s busy, falling back to any", entry.AccountName)
			}
		}
	}
	if slot == nil {
		slot, acquireErr = h.pool.Acquire(ctx)
		if acquireErr != nil {
			sendError(w, http.StatusServiceUnavailable, "No available accounts, please retry later")
			return
		}
	}
	defer slot.Release()

	acc := slot.Account
	opts.Proxy = h.pool.GetEffectiveProxy(acc.Name)
	start := time.Now()
	log.Printf("[req] account=%s model=%s stream=%v session=%s proxy=%q", acc.Name, body.Model, body.Stream, downstreamSessionID, opts.Proxy)

	var result *executor.Result
	if body.Stream {
		result = h.handleStream(w, r, acc, prompt, opts)
	} else {
		result = h.handleNonStream(w, acc, prompt, opts, body.Model)
	}

	// Store CLI session ID + account binding for future resume
	if result != nil && result.SessionID != "" && downstreamSessionID != "" {
		h.sessions.set(downstreamSessionID, sessionEntry{
			CLISessionID: result.SessionID,
			AccountName:  acc.Name,
		})
		log.Printf("[session] mapped downstream %s -> CLI %s @ %s", downstreamSessionID, result.SessionID, acc.Name)
	}

	// Record request log
	if result != nil {
		h.recordRequestLog(acc.Name, body.Model, body.Stream, start, result)
	}
}

func (h *Handler) handleStream(w http.ResponseWriter, r *http.Request, acc *pool.Account, prompt string, opts executor.Options) *executor.Result {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	sf := formatter.NewStreamFormatter(w, opts.Model)

	result, err := executor.Execute(r.Context(), h.cfg, acc.Name, prompt, opts, func(event map[string]any) {
		sf.HandleEvent(event)
	})

	if err != nil {
		log.Printf("[error] account=%s err=%s", acc.Name, err)
		h.maybeMarkUnhealthy(acc, err)
	}
	if result != nil {
		h.extractRateLimit(acc.Name, result.AllEvents)
		h.extractUsage(acc.Name, result.AllEvents)
	}
	return result
}

func (h *Handler) handleNonStream(w http.ResponseWriter, acc *pool.Account, prompt string, opts executor.Options, model string) *executor.Result {
	result, err := executor.Execute(context.Background(), h.cfg, acc.Name, prompt, opts, nil)
	if err != nil {
		log.Printf("[error] account=%s err=%s", acc.Name, err)
		h.maybeMarkUnhealthy(acc, err)
		sendError(w, http.StatusInternalServerError, "Execution error: "+err.Error())
		return nil
	}

	h.extractRateLimit(acc.Name, result.AllEvents)
	h.extractUsage(acc.Name, result.AllEvents)
	resp := formatter.BuildNonStreamResponse(result.ResultEvent, result.AllEvents, model)
	sendJSON(w, http.StatusOK, resp)
	return result
}

func (h *Handler) recordRequestLog(account, model string, stream bool, start time.Time, result *executor.Result) {
	entry := pool.RequestLog{
		Timestamp:  start.Unix(),
		Account:    account,
		Model:      model,
		Stream:     stream,
		DurationMs: time.Since(start).Milliseconds(),
	}

	// Extract usage from result event
	if result.ResultEvent != nil {
		if usage, ok := result.ResultEvent["usage"].(map[string]any); ok {
			entry.InputTokens = toInt64(usage["input_tokens"])
			entry.OutputTokens = toInt64(usage["output_tokens"])
			entry.CacheReadInputTokens = toInt64(usage["cache_read_input_tokens"])
			entry.CacheCreationInputTokens = toInt64(usage["cache_creation_input_tokens"])
			if cc, ok := usage["cache_creation"].(map[string]any); ok {
				entry.CacheCreation1h = toInt64(cc["ephemeral_1h_input_tokens"])
				entry.CacheCreation5m = toInt64(cc["ephemeral_5m_input_tokens"])
			}
		}
		entry.TotalCostUSD = toFloat64(result.ResultEvent["total_cost_usd"])
	}

	h.pool.AddRequestLog(entry)
}

func (h *Handler) extractRateLimit(accountName string, events []map[string]any) {
	for _, e := range events {
		if t, _ := e["type"].(string); t == "rate_limit_event" {
			info, _ := e["rate_limit_info"].(map[string]any)
			if info == nil {
				continue
			}
			rl := &pool.RateLimitInfo{
				Status:        toString(info["status"]),
				ResetsAt:      toInt64(info["resetsAt"]),
				Type:          toString(info["rateLimitType"]),
				OverageStatus: toString(info["overageStatus"]),
			}
			h.pool.UpdateRateLimit(accountName, rl)
			log.Printf("[ratelimit] account=%s status=%s resets=%d", accountName, rl.Status, rl.ResetsAt)
		}
	}
}

func (h *Handler) extractUsage(accountName string, events []map[string]any) {
	for _, e := range events {
		if t, _ := e["type"].(string); t == "result" {
			usage, _ := e["usage"].(map[string]any)
			if usage == nil {
				continue
			}
			delta := &pool.UsageInfo{
				InputTokens:              toInt64(usage["input_tokens"]),
				OutputTokens:             toInt64(usage["output_tokens"]),
				CacheReadInputTokens:     toInt64(usage["cache_read_input_tokens"]),
				CacheCreationInputTokens: toInt64(usage["cache_creation_input_tokens"]),
				TotalCostUSD:             toFloat64(e["total_cost_usd"]),
			}
			if cc, ok := usage["cache_creation"].(map[string]any); ok {
				delta.CacheCreation1h = toInt64(cc["ephemeral_1h_input_tokens"])
				delta.CacheCreation5m = toInt64(cc["ephemeral_5m_input_tokens"])
			}
			h.pool.AccumulateUsage(accountName, delta)
			log.Printf("[usage] account=%s in=%d out=%d cost=$%.6f",
				accountName, delta.InputTokens, delta.OutputTokens, delta.TotalCostUSD)
		}
	}
}

func (h *Handler) maybeMarkUnhealthy(acc *pool.Account, err error) {
	msg := err.Error()
	if strings.Contains(msg, "exited with code") || strings.Contains(msg, "executable file not found") {
		h.pool.MarkUnhealthy(acc.Name)
	}
}

// ── Models ──

func (h *Handler) handleModels(w http.ResponseWriter, _ *http.Request) {
	sendJSON(w, http.StatusOK, map[string]any{
		"object": "list",
		"data": []map[string]any{
			{"id": "claude-sonnet-4-20250514", "object": "model", "created": 1700000000, "owned_by": "anthropic"},
			{"id": "claude-opus-4-20250514", "object": "model", "created": 1700000000, "owned_by": "anthropic"},
			{"id": "claude-haiku-4-20250514", "object": "model", "created": 1700000000, "owned_by": "anthropic"},
		},
	})
}

// ── Status & Dashboard ──

func (h *Handler) handleStatus(w http.ResponseWriter, _ *http.Request) {
	sendJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"accounts": h.pool.Status(),
	})
}

func (h *Handler) handleDashboard(w http.ResponseWriter, r *http.Request) {
	accounts := h.pool.Status()
	var totalReqs int64
	var healthy, busy int
	for _, a := range accounts {
		totalReqs += a.RequestCount
		if a.Healthy {
			healthy++
		}
		if a.Busy {
			busy++
		}
	}

	sendJSON(w, http.StatusOK, map[string]any{
		"uptime_seconds":   int(time.Since(h.startTime).Seconds()),
		"total_requests":   totalReqs,
		"total_accounts":   len(accounts),
		"healthy_accounts": healthy,
		"busy_accounts":    busy,
		"max_concurrency":  h.cfg.MaxConcurrency,
	})
}

// ── Settings ──

func (h *Handler) handleSettings(w http.ResponseWriter, r *http.Request) {
	if !h.authenticateWebOrAPI(r) {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		sendJSON(w, http.StatusOK, map[string]any{
			"maxConcurrency": h.cfg.MaxConcurrency,
			"maxTurns":       h.cfg.MaxTurns,
			"globalProxy":    h.cfg.GlobalProxy,
			"apiKeyCount":    len(h.cfg.ServiceAPIKeys),
		})
	case http.MethodPut:
		var body struct {
			MaxConcurrency *int `json:"maxConcurrency"`
			MaxTurns       *int `json:"maxTurns"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			sendError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		if body.MaxConcurrency != nil && *body.MaxConcurrency >= 1 {
			h.cfg.MaxConcurrency = *body.MaxConcurrency
			log.Printf("[settings] maxConcurrency set to %d", h.cfg.MaxConcurrency)
		}
		if body.MaxTurns != nil && *body.MaxTurns >= 1 {
			h.cfg.MaxTurns = *body.MaxTurns
			log.Printf("[settings] maxTurns set to %d", h.cfg.MaxTurns)
		}
		h.saveRuntimeSettings()
		sendJSON(w, http.StatusOK, map[string]any{
			"maxConcurrency": h.cfg.MaxConcurrency,
			"maxTurns":       h.cfg.MaxTurns,
		})
	default:
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func (h *Handler) handleAccountConcurrency(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !h.authenticateWebOrAPI(r) {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var body struct {
		Account        string `json:"account"`
		MaxConcurrency int    `json:"maxConcurrency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.Account == "" {
		sendError(w, http.StatusBadRequest, "account is required")
		return
	}
	if body.MaxConcurrency < 0 {
		sendError(w, http.StatusBadRequest, "maxConcurrency must be >= 0 (0 = use global default)")
		return
	}

	if !h.pool.SetMaxConcurrency(body.Account, body.MaxConcurrency) {
		sendError(w, http.StatusNotFound, "Account not found")
		return
	}
	h.saveRuntimeSettings()
	sendJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) handleAccountProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !h.authenticateWebOrAPI(r) {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var body struct {
		Account string `json:"account"`
		Proxy   string `json:"proxy"` // empty string to clear (use global)
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.Account == "" {
		sendError(w, http.StatusBadRequest, "account is required")
		return
	}

	if !h.pool.SetProxy(body.Account, body.Proxy) {
		sendError(w, http.StatusNotFound, "Account not found")
		return
	}
	h.saveRuntimeSettings()
	sendJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) handleGlobalProxy(w http.ResponseWriter, r *http.Request) {
	if !h.authenticateWebOrAPI(r) {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		sendJSON(w, http.StatusOK, map[string]any{
			"globalProxy": h.cfg.GlobalProxy,
		})
	case http.MethodPut:
		var body struct {
			Proxy string `json:"proxy"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			sendError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		h.cfg.GlobalProxy = body.Proxy
		log.Printf("[settings] globalProxy set to %q", h.cfg.GlobalProxy)
		h.saveRuntimeSettings()
		sendJSON(w, http.StatusOK, map[string]any{
			"globalProxy": h.cfg.GlobalProxy,
		})
	default:
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func (h *Handler) handleAPIKey(w http.ResponseWriter, r *http.Request) {
	if !h.authenticateWebOrAPI(r) {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		// Return masked keys list
		masked := make([]map[string]string, len(h.cfg.ServiceAPIKeys))
		for i, k := range h.cfg.ServiceAPIKeys {
			m := "****"
			if len(k) > 8 {
				m = k[:4] + "..." + k[len(k)-4:]
			} else if len(k) > 4 {
				m = k[:4] + "****"
			}
			masked[i] = map[string]string{"id": k, "masked": m}
		}
		sendJSON(w, http.StatusOK, map[string]any{"keys": masked})

	case http.MethodPost:
		// Generate a new random key
		b := make([]byte, 24)
		rand.Read(b)
		newKey := "sk-" + hex.EncodeToString(b)
		h.cfg.ServiceAPIKeys = append(h.cfg.ServiceAPIKeys, newKey)
		log.Printf("[settings] new API key generated (total=%d)", len(h.cfg.ServiceAPIKeys))
		h.saveRuntimeSettings()
		sendJSON(w, http.StatusOK, map[string]any{"key": newKey})

	case http.MethodDelete:
		var body struct {
			Key string `json:"key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			sendError(w, http.StatusBadRequest, "Invalid request body")
			return
		}
		found := false
		filtered := make([]string, 0, len(h.cfg.ServiceAPIKeys))
		for _, k := range h.cfg.ServiceAPIKeys {
			if k == body.Key {
				found = true
				continue
			}
			filtered = append(filtered, k)
		}
		if !found {
			sendError(w, http.StatusNotFound, "Key not found")
			return
		}
		h.cfg.ServiceAPIKeys = filtered
		log.Printf("[settings] API key deleted (total=%d)", len(h.cfg.ServiceAPIKeys))
		h.saveRuntimeSettings()
		sendJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// saveRuntimeSettings persists current global + per-account settings to disk.
func (h *Handler) saveRuntimeSettings() {
	rs := &config.RuntimeSettings{
		MaxConcurrency:     h.cfg.MaxConcurrency,
		MaxTurns:           h.cfg.MaxTurns,
		AccountConcurrency: h.pool.GetAccountConcurrency(),
		GlobalProxy:        h.cfg.GlobalProxy,
		AccountProxy:       h.pool.GetAccountProxy(),
		ServiceAPIKeys:     h.cfg.ServiceAPIKeys,
	}
	h.cfg.SaveRuntime(rs)
}

// ── Quota ──

func (h *Handler) handleRefreshQuota(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !h.authenticateWebOrAPI(r) {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	account := r.URL.Query().Get("account")
	if account == "" {
		sendError(w, http.StatusBadRequest, "account query parameter is required")
		return
	}

	// Send a minimal prompt to trigger rate_limit_event
	opts := executor.Options{
		Proxy: h.pool.GetEffectiveProxy(account),
	}
	result, err := executor.Execute(r.Context(), h.cfg, account, "hi", opts, nil)
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to refresh quota: "+err.Error())
		return
	}

	h.extractRateLimit(account, result.AllEvents)
	h.extractUsage(account, result.AllEvents)

	// Return the updated account info
	for _, acc := range h.pool.Status() {
		if acc.Name == account {
			sendJSON(w, http.StatusOK, acc)
			return
		}
	}
	sendError(w, http.StatusNotFound, "Account not found")
}

// ── Accounts ──

func (h *Handler) handleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	sendJSON(w, http.StatusOK, h.pool.GetRequestLogs())
}

func (h *Handler) handleUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	account := r.URL.Query().Get("account")
	if account == "" {
		sendError(w, http.StatusBadRequest, "account query parameter is required")
		return
	}

	result, err := quota.FetchUsage(h.cfg.AccountsDir, account, h.pool.GetEffectiveProxy(account))
	if err != nil {
		sendError(w, http.StatusInternalServerError, "Failed to fetch usage: "+err.Error())
		return
	}

	// Store in pool for dashboard display
	pu := &pool.PlanUsage{
		ExtraUsage: "",
	}
	for _, e := range result.Entries {
		switch e.Label {
		case "Current session":
			pu.SessionUsed = e.Used
			pu.SessionResets = e.ResetsAt
		case "Current week (all models)":
			pu.WeeklyUsed = e.Used
			pu.WeeklyResets = e.ResetsAt
		case "Current week (Sonnet only)":
			pu.SonnetUsed = e.Used
			pu.SonnetResets = e.ResetsAt
		case "Extra usage":
			pu.ExtraUsage = e.ExtraUsage
		}
	}
	h.pool.UpdatePlanUsage(account, pu)

	sendJSON(w, http.StatusOK, result)
}

func (h *Handler) handleAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !h.authenticateWebOrAPI(r) {
		sendError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	account := r.URL.Query().Get("account")
	if account == "" {
		sendError(w, http.StatusBadRequest, "account query parameter is required")
		return
	}

	if !h.pool.RemoveAccount(account) {
		sendError(w, http.StatusConflict, "Account not found or currently busy")
		return
	}

	// Remove the account's config directory so it won't be re-discovered on restart
	configDir := filepath.Join(h.cfg.AccountsDir, account)
	if err := os.RemoveAll(configDir); err != nil {
		log.Printf("[accounts] failed to remove config dir %s: %v", configDir, err)
		sendJSON(w, http.StatusOK, map[string]any{
			"message": "Account " + account + " removed from pool, but failed to delete config dir: " + err.Error(),
		})
		return
	}
	log.Printf("[accounts] removed config dir %s", configDir)

	sendJSON(w, http.StatusOK, map[string]any{"message": "Account " + account + " removed"})
}

// ── Auth ──

func (h *Handler) authenticate(r *http.Request) bool {
	keys := h.cfg.ServiceAPIKeys
	if len(keys) == 0 {
		return true
	}
	auth := r.Header.Get("Authorization")
	xKey := r.Header.Get("X-Api-Key")
	for _, k := range keys {
		if auth == "Bearer "+k || xKey == k {
			return true
		}
	}
	return false
}

// webToken generates an HMAC token for web session authentication.
func (h *Handler) webToken() string {
	mac := hmac.New(sha256.New, h.webSecret)
	mac.Write([]byte("web-session"))
	return hex.EncodeToString(mac.Sum(nil))
}

// verifyWebToken checks if the given token is valid.
func (h *Handler) verifyWebToken(token string) bool {
	expected := h.webToken()
	b1, _ := hex.DecodeString(token)
	b2, _ := hex.DecodeString(expected)
	return len(b1) > 0 && hmac.Equal(b1, b2)
}

// authenticateWeb checks the web session cookie. Returns true if no password is configured.
func (h *Handler) authenticateWeb(r *http.Request) bool {
	if h.cfg.WebPassword == "" {
		return true
	}
	c, err := r.Cookie("nmpcc_web_token")
	if err != nil {
		return false
	}
	return h.verifyWebToken(c.Value)
}

// authenticateWebOrAPI allows access via either web cookie or API key.
// Used for /api/* endpoints that are called from the browser dashboard.
func (h *Handler) authenticateWebOrAPI(r *http.Request) bool {
	return h.authenticate(r) || h.authenticateWeb(r)
}

// handleWebAuth validates the web password and sets a session cookie.
func (h *Handler) handleWebAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var body struct {
		Password string `json:"password"`
		Remember bool   `json:"remember"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		sendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if h.cfg.WebPassword == "" || body.Password != h.cfg.WebPassword {
		sendError(w, http.StatusUnauthorized, "Invalid password")
		return
	}

	token := h.webToken()
	cookie := &http.Cookie{
		Name:     "nmpcc_web_token",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	}
	if body.Remember {
		cookie.MaxAge = 30 * 24 * 60 * 60 // 30 days
	}
	http.SetCookie(w, cookie)
	sendJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// webAuthMiddleware protects static file serving with web password authentication.
func (h *Handler) webAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.cfg.WebPassword == "" {
			next.ServeHTTP(w, r)
			return
		}
		if !h.authenticateWeb(r) {
			// Return the login page HTML inline
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(loginPageHTML))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Helpers ──

// extractDownstreamSessionID extracts the session_id from metadata.user_id JSON.
func extractDownstreamSessionID(meta *metadata) string {
	if meta == nil || meta.UserID == "" {
		return ""
	}
	var parsed struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal([]byte(meta.UserID), &parsed); err != nil {
		return ""
	}
	return parsed.SessionID
}

// extractSystemPrompt handles system as string or array of {type:"text",text:"..."}.
func extractSystemPrompt(system any) string {
	switch s := system.(type) {
	case string:
		return s
	case []any:
		var sb strings.Builder
		for _, item := range s {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if t, _ := block["type"].(string); t == "text" {
				if text, _ := block["text"].(string); text != "" {
					if sb.Len() > 0 {
						sb.WriteString("\n")
					}
					sb.WriteString(text)
				}
			}
		}
		return sb.String()
	default:
		return ""
	}
}

// noiseReminderRe matches <system-reminder> blocks that do NOT contain claudeMd content.
var noiseReminderRe = regexp.MustCompile(`(?s)<system-reminder>(.*?)</system-reminder>`)

func messagesToPrompt(msgs []message) string {
	if len(msgs) == 0 {
		return ""
	}

	// Extract claudeMd from the first user message (system-reminder with claudeMd)
	var claudeMd string
	if first := msgs[0]; first.Role == "user" {
		claudeMd = extractClaudeMd(first.Content)
	}

	// Find the last user message that has actual text content.
	// The last user message may only contain tool_result blocks (no text),
	// so walk backwards until we find one with text.
	var lastUserText string
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			if text := extractText(msgs[i].Content); text != "" {
				lastUserText = text
				break
			}
		}
	}

	if lastUserText == "" {
		return ""
	}

	var sb strings.Builder
	if claudeMd != "" {
		sb.WriteString(claudeMd)
		sb.WriteString("\n\n")
	}
	sb.WriteString(lastUserText)
	return sb.String()
}

// extractClaudeMd finds and returns the claudeMd system-reminder content from message content.
func extractClaudeMd(content any) string {
	var texts []string
	switch c := content.(type) {
	case string:
		texts = []string{c}
	case []any:
		for _, item := range c {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if t, _ := block["type"].(string); t == "text" {
				if s, _ := block["text"].(string); s != "" {
					texts = append(texts, s)
				}
			}
		}
	}

	for _, text := range texts {
		matches := noiseReminderRe.FindAllString(text, -1)
		for _, m := range matches {
			if strings.Contains(m, "claudeMd") {
				return m
			}
		}
	}
	return ""
}

// extractText gets clean text from message content, removing all system-reminder blocks.
func extractText(content any) string {
	switch c := content.(type) {
	case string:
		return cleanText(c)
	case []any:
		var sb strings.Builder
		for _, item := range c {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if t, _ := block["type"].(string); t != "text" {
				continue
			}
			if s, _ := block["text"].(string); s != "" {
				cleaned := cleanText(s)
				if cleaned != "" {
					sb.WriteString(cleaned)
				}
			}
		}
		return sb.String()
	}
	return ""
}

// cleanText removes noise <system-reminder> blocks but preserves those containing claudeMd.
func cleanText(s string) string {
	cleaned := noiseReminderRe.ReplaceAllStringFunc(s, func(match string) string {
		if strings.Contains(match, "claudeMd") {
			return match
		}
		return ""
	})
	return strings.TrimSpace(cleaned)
}

func sendJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func sendError(w http.ResponseWriter, status int, msg string) {
	sendJSON(w, status, map[string]any{
		"type": "error",
		"error": map[string]any{
			"type":    "api_error",
			"message": msg,
		},
	})
}

func toString(v any) string {
	s, _ := v.(string)
	return s
}

func toInt64(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int:
		return int64(n)
	default:
		return 0
	}
}

func toFloat64(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	default:
		return 0
	}
}

const loginPageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>nmpcc — Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', system-ui, sans-serif;
      background: #faf9f7;
      color: #1a1816;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #fff;
      border: 1px solid #d4d1cb;
      border-radius: 16px;
      padding: 40px 36px;
      width: 340px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
    }
    .logo-icon {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: #c05621;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .logo-text { font-size: 16px; font-weight: 600; letter-spacing: -0.3px; }
    label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: #6b6560;
      margin-bottom: 8px;
    }
    input[type="password"] {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #d4d1cb;
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      background: #faf9f7;
      color: #1a1816;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input[type="password"]:focus {
      border-color: #c05621;
      box-shadow: 0 0 0 3px rgba(192,86,33,0.1);
    }
    button {
      width: 100%;
      margin-top: 16px;
      padding: 10px;
      background: #c05621;
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #a84d1e; }
    button:disabled { background: #d4a58a; cursor: not-allowed; }
    .remember {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 14px;
    }
    .remember input[type="checkbox"] {
      width: 15px;
      height: 15px;
      accent-color: #c05621;
      cursor: pointer;
    }
    .remember label {
      margin: 0;
      font-size: 13px;
      color: #6b6560;
      cursor: pointer;
    }
    .error {
      display: none;
      margin-top: 12px;
      font-size: 12px;
      color: #dc2626;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">N</div>
      <span class="logo-text">nmpcc</span>
    </div>
    <label for="pwd">Password</label>
    <input type="password" id="pwd" autofocus placeholder="Enter password" onkeydown="if(event.key==='Enter')login()">
    <div class="remember">
      <input type="checkbox" id="rem" checked>
      <label for="rem">Remember me for 30 days</label>
    </div>
    <button id="btn" onclick="login()">Sign in</button>
    <div class="error" id="err">Invalid password</div>
  </div>
  <script>
    async function login() {
      const pwd = document.getElementById('pwd').value;
      if (!pwd) return;
      const btn = document.getElementById('btn');
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      try {
        const res = await fetch('/api/web-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd, remember: document.getElementById('rem').checked }),
        });
        if (res.ok) {
          location.reload();
        } else {
          document.getElementById('err').style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Sign in';
          document.getElementById('pwd').value = '';
          document.getElementById('pwd').focus();
        }
      } catch {
        document.getElementById('err').style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    }
  </script>
</body>
</html>`
