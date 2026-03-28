package pool

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"nmpcc/internal/config"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type RateLimitInfo struct {
	Status       string `json:"status"`        // "allowed" or "limited"
	ResetsAt     int64  `json:"resetsAt"`       // Unix timestamp
	Type         string `json:"rateLimitType"`  // "five_hour"
	OverageStatus string `json:"overageStatus"` // "rejected" etc
	UpdatedAt    int64  `json:"updatedAt"`      // When this info was last updated
}

type UsageInfo struct {
	InputTokens              int64   `json:"inputTokens"`
	OutputTokens             int64   `json:"outputTokens"`
	CacheReadInputTokens     int64   `json:"cacheReadInputTokens"`
	CacheCreationInputTokens int64   `json:"cacheCreationInputTokens"`
	CacheCreation1h          int64   `json:"cacheCreation1h"`
	CacheCreation5m          int64   `json:"cacheCreation5m"`
	TotalCostUSD             float64 `json:"totalCostUsd"`
	UpdatedAt                int64   `json:"updatedAt"`
}

// PlanUsage holds the quota utilization from /usage.
type PlanUsage struct {
	SessionUsed    float64 `json:"sessionUsed"`    // Current session %
	SessionResets  string  `json:"sessionResets"`   // Reset time string
	WeeklyUsed     float64 `json:"weeklyUsed"`     // Current week (all models) %
	WeeklyResets   string  `json:"weeklyResets"`    // Reset time string
	SonnetUsed     float64 `json:"sonnetUsed"`     // Current week (Sonnet only) %
	SonnetResets   string  `json:"sonnetResets"`    // Reset time string
	ExtraUsage     string  `json:"extraUsage"`     // "enabled" / "not enabled"
	UpdatedAt      int64   `json:"updatedAt"`
}

// RequestLog records a single API request.
type RequestLog struct {
	Timestamp                int64   `json:"timestamp"`
	Account                  string  `json:"account"`
	Model                    string  `json:"model"`
	InputTokens              int64   `json:"inputTokens"`
	OutputTokens             int64   `json:"outputTokens"`
	CacheReadInputTokens     int64   `json:"cacheReadInputTokens"`
	CacheCreationInputTokens int64   `json:"cacheCreationInputTokens"`
	CacheCreation1h          int64   `json:"cacheCreation1h"`
	CacheCreation5m          int64   `json:"cacheCreation5m"`
	TotalCostUSD             float64 `json:"totalCostUsd"`
	DurationMs               int64   `json:"durationMs"`
	Stream                   bool    `json:"stream"`
}

// AccountProfile holds identity info read from .claude.json and .credentials.json.
type AccountProfile struct {
	DisplayName           string `json:"displayName"`
	EmailAddress          string `json:"emailAddress"`
	OrganizationName      string `json:"organizationName,omitempty"`
	OrganizationRole      string `json:"organizationRole,omitempty"`
	BillingType           string `json:"billingType,omitempty"`
	SubscriptionType      string `json:"subscriptionType,omitempty"`      // e.g. "max", "pro"
	RateLimitTier         string `json:"rateLimitTier,omitempty"`         // e.g. "default_claude_max_5x"
	AccountCreatedAt      string `json:"accountCreatedAt,omitempty"`      // ISO 8601
	SubscriptionCreatedAt string `json:"subscriptionCreatedAt,omitempty"` // ISO 8601
	TokenExpiresAt        int64  `json:"tokenExpiresAt,omitempty"`        // Unix ms
}

type Account struct {
	Name           string          `json:"name"`
	Profile        *AccountProfile `json:"profile,omitempty"`
	Busy           bool            `json:"busy"`
	Active         int             `json:"active"`
	MaxConcurrency int             `json:"maxConcurrency"` // 0 means use global default
	Healthy        bool            `json:"healthy"`
	RequestCount   int64           `json:"requestCount"`
	Proxy          string          `json:"proxy,omitempty"` // Per-account proxy (socks5://... or http://...), empty = use global
	RateLimit      *RateLimitInfo  `json:"rateLimit,omitempty"`
	Usage          *UsageInfo      `json:"usage,omitempty"`
	PlanUsage      *PlanUsage      `json:"planUsage,omitempty"`
	lastUsed       time.Time
}

// effectiveMaxConcurrency returns the account's limit, or the global default.
func (a *Account) effectiveMaxConcurrency(globalMax int) int {
	if a.MaxConcurrency > 0 {
		return a.MaxConcurrency
	}
	return globalMax
}

type Slot struct {
	Account *Account
	Release func()
}

const maxRequestLogs = 200

type AccountPool struct {
	mu             sync.Mutex
	accounts       []*Account
	requestLogs    []RequestLog
	notify         chan struct{}
	cfg            *config.Config
	onAccountAdded func(name string)
}

func New(cfg *config.Config) *AccountPool {
	names := cfg.Accounts

	// Auto-discover accounts from AccountsDir if none configured
	if len(names) == 0 {
		names = discoverAccounts(cfg.AccountsDir)
	}

	// Load per-account concurrency and proxy from runtime settings
	var accConc map[string]int
	var accProxy map[string]string
	if rs := cfg.LoadRuntime(); rs != nil {
		if rs.AccountConcurrency != nil {
			accConc = rs.AccountConcurrency
		}
		if rs.AccountProxy != nil {
			accProxy = rs.AccountProxy
		}
	}

	accounts := make([]*Account, len(names))
	for i, name := range names {
		accounts[i] = &Account{
			Name:           name,
			Profile:        loadAccountProfile(cfg.AccountsDir, name),
			Healthy:        true,
			MaxConcurrency: accConc[name],
			Proxy:          accProxy[name],
		}
	}
	return &AccountPool{
		accounts: accounts,
		notify:   make(chan struct{}, 1),
		cfg:      cfg,
	}
}

// discoverAccounts scans the accounts directory for subdirectories
// that contain a .claude.json file (i.e. logged-in accounts).
func discoverAccounts(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("[pool] failed to scan accounts dir %s: %v", dir, err)
		return nil
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		// Only include directories that have .credentials.json (logged in)
		credFile := filepath.Join(dir, e.Name(), ".credentials.json")
		if _, err := os.Stat(credFile); err == nil {
			names = append(names, e.Name())
		}
	}
	log.Printf("[pool] auto-discovered %d accounts from %s: %v", len(names), dir, names)
	return names
}

// loadAccountProfile reads .claude.json (oauthAccount) and .credentials.json (subscription info).
func loadAccountProfile(accountsDir, name string) *AccountProfile {
	profile := &AccountProfile{}
	hasData := false

	// Read .claude.json for oauthAccount
	if raw, err := os.ReadFile(filepath.Join(accountsDir, name, ".claude.json")); err == nil {
		var data struct {
			OAuthAccount *AccountProfile `json:"oauthAccount"`
		}
		if json.Unmarshal(raw, &data) == nil && data.OAuthAccount != nil {
			profile = data.OAuthAccount
			hasData = true
		}
	}

	// Read .credentials.json for subscription type, rate limit tier, and token expiry
	if raw, err := os.ReadFile(filepath.Join(accountsDir, name, ".credentials.json")); err == nil {
		var creds struct {
			ClaudeAiOauth struct {
				SubscriptionType string `json:"subscriptionType"`
				RateLimitTier    string `json:"rateLimitTier"`
				ExpiresAt        int64  `json:"expiresAt"`
			} `json:"claudeAiOauth"`
		}
		if json.Unmarshal(raw, &creds) == nil {
			if creds.ClaudeAiOauth.SubscriptionType != "" {
				profile.SubscriptionType = creds.ClaudeAiOauth.SubscriptionType
				hasData = true
			}
			if creds.ClaudeAiOauth.RateLimitTier != "" {
				profile.RateLimitTier = creds.ClaudeAiOauth.RateLimitTier
				hasData = true
			}
			if creds.ClaudeAiOauth.ExpiresAt > 0 {
				profile.TokenExpiresAt = creds.ClaudeAiOauth.ExpiresAt
				hasData = true
			}
		}
	}

	if !hasData {
		return nil
	}
	return profile
}

func (p *AccountPool) Acquire(ctx context.Context) (*Slot, error) {
	for {
		p.mu.Lock()
		acc := p.pickAvailable()
		if acc != nil {
			acc.Active++
			acc.Busy = acc.Active >= acc.effectiveMaxConcurrency(p.cfg.MaxConcurrency)
			acc.RequestCount++
			acc.lastUsed = time.Now()
			p.mu.Unlock()
			return &Slot{
				Account: acc,
				Release: func() { p.release(acc) },
			}, nil
		}
		p.mu.Unlock()

		select {
		case <-p.notify:
			// An account was released, retry
		case <-ctx.Done():
			return nil, fmt.Errorf("no available account: %w", ctx.Err())
		}
	}
}

// AcquireByName tries to acquire a specific account by name.
// Returns error if the account is at max concurrency, unhealthy, or not found.
func (p *AccountPool) AcquireByName(ctx context.Context, name string) (*Slot, error) {
	for {
		p.mu.Lock()
		for _, acc := range p.accounts {
			if acc.Name == name && acc.Healthy && acc.Active < acc.effectiveMaxConcurrency(p.cfg.MaxConcurrency) {
				acc.Active++
				acc.Busy = acc.Active >= acc.effectiveMaxConcurrency(p.cfg.MaxConcurrency)
				acc.RequestCount++
				acc.lastUsed = time.Now()
				p.mu.Unlock()
				return &Slot{
					Account: acc,
					Release: func() { p.release(acc) },
				}, nil
			}
		}
		p.mu.Unlock()

		select {
		case <-p.notify:
		case <-ctx.Done():
			return nil, fmt.Errorf("account %s not available: %w", name, ctx.Err())
		}
	}
}

func (p *AccountPool) MarkUnhealthy(name string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if acc.Name == name {
			acc.Healthy = false
			acc.Busy = false
			log.Printf("[pool] account %s marked unhealthy", name)
			break
		}
	}
}

// AddAccount dynamically adds a new account to the pool.
// Returns false if the account already exists.
func (p *AccountPool) AddAccount(name string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if acc.Name == name {
			return false
		}
	}

	p.accounts = append(p.accounts, &Account{
		Name:    name,
		Profile: loadAccountProfile(p.cfg.AccountsDir, name),
		Healthy: true,
	})
	log.Printf("[pool] account %s added", name)
	// Remove from removed list if it was previously removed
	unremoveAccount(p.cfg.AccountsDir, name)
	p.signal()
	if p.onAccountAdded != nil {
		go p.onAccountAdded(name)
	}
	return true
}

// RemoveAccount removes an account from the pool and persists the removal.
// Returns false if the account doesn't exist or is currently busy.
func (p *AccountPool) RemoveAccount(name string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	for i, acc := range p.accounts {
		if acc.Name == name {
			if acc.Active > 0 {
				return false
			}
			p.accounts = append(p.accounts[:i], p.accounts[i+1:]...)
			log.Printf("[pool] account %s removed", name)
			// Persist removal so it survives restart
			appendRemovedAccount(p.cfg.AccountsDir, name)
			return true
		}
	}
	return false
}

// SetMaxConcurrency sets the per-account concurrency limit. 0 means use global default.
func (p *AccountPool) SetMaxConcurrency(name string, max int) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if acc.Name == name {
			acc.MaxConcurrency = max
			acc.Busy = acc.Active >= acc.effectiveMaxConcurrency(p.cfg.MaxConcurrency)
			log.Printf("[pool] account %s maxConcurrency set to %d", name, max)
			p.signal()
			return true
		}
	}
	return false
}

// SetProxy sets the per-account proxy URL. Empty string means use global proxy.
func (p *AccountPool) SetProxy(name, proxy string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if acc.Name == name {
			acc.Proxy = proxy
			log.Printf("[pool] account %s proxy set to %q", name, proxy)
			return true
		}
	}
	return false
}

// GetAccountProxy returns per-account proxy overrides (non-empty only).
func (p *AccountPool) GetAccountProxy() map[string]string {
	p.mu.Lock()
	defer p.mu.Unlock()

	m := make(map[string]string)
	for _, acc := range p.accounts {
		if acc.Proxy != "" {
			m[acc.Name] = acc.Proxy
		}
	}
	return m
}

// GetEffectiveProxy returns the proxy URL to use for a given account.
// Per-account proxy takes priority over global proxy.
func (p *AccountPool) GetEffectiveProxy(name string) string {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if acc.Name == name {
			if acc.Proxy != "" {
				return acc.Proxy
			}
			return p.cfg.GlobalProxy
		}
	}
	return p.cfg.GlobalProxy
}

// GetAccountConcurrency returns per-account concurrency overrides (non-zero only).
func (p *AccountPool) GetAccountConcurrency() map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()

	m := make(map[string]int)
	for _, acc := range p.accounts {
		if acc.MaxConcurrency > 0 {
			m[acc.Name] = acc.MaxConcurrency
		}
	}
	return m
}

// UpdateRateLimit updates the rate limit info for an account.
func (p *AccountPool) UpdateRateLimit(name string, info *RateLimitInfo) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if acc.Name == name {
			info.UpdatedAt = time.Now().Unix()
			acc.RateLimit = info
			break
		}
	}
}

// AccumulateUsage adds usage from a single request to the account's cumulative usage.
func (p *AccountPool) AccumulateUsage(name string, delta *UsageInfo) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if acc.Name == name {
			if acc.Usage == nil {
				acc.Usage = &UsageInfo{}
			}
			acc.Usage.InputTokens += delta.InputTokens
			acc.Usage.OutputTokens += delta.OutputTokens
			acc.Usage.CacheReadInputTokens += delta.CacheReadInputTokens
			acc.Usage.CacheCreationInputTokens += delta.CacheCreationInputTokens
			acc.Usage.CacheCreation1h += delta.CacheCreation1h
			acc.Usage.CacheCreation5m += delta.CacheCreation5m
			acc.Usage.TotalCostUSD += delta.TotalCostUSD
			acc.Usage.UpdatedAt = time.Now().Unix()
			break
		}
	}
}

// UpdatePlanUsage stores the /usage quota data for an account.
func (p *AccountPool) UpdatePlanUsage(name string, pu *PlanUsage) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if acc.Name == name {
			pu.UpdatedAt = time.Now().Unix()
			acc.PlanUsage = pu
			break
		}
	}
}

// AddRequestLog appends a request log entry, keeping at most maxRequestLogs.
func (p *AccountPool) AddRequestLog(entry RequestLog) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.requestLogs = append(p.requestLogs, entry)
	if len(p.requestLogs) > maxRequestLogs {
		p.requestLogs = p.requestLogs[len(p.requestLogs)-maxRequestLogs:]
	}
}

// GetRequestLogs returns recent request logs, newest first.
func (p *AccountPool) GetRequestLogs() []RequestLog {
	p.mu.Lock()
	defer p.mu.Unlock()

	result := make([]RequestLog, len(p.requestLogs))
	for i, l := range p.requestLogs {
		result[len(p.requestLogs)-1-i] = l // reverse order
	}
	return result
}

func (p *AccountPool) MarkHealthy(name string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, acc := range p.accounts {
		if acc.Name == name {
			acc.Healthy = true
			log.Printf("[pool] account %s marked healthy", name)
			break
		}
	}
	// Notify waiters
	p.signal()
}

// OnAccountAdded registers a callback for when a new account is added.
func (p *AccountPool) OnAccountAdded(fn func(name string)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.onAccountAdded = fn
}

// AccountNames returns the names of all accounts.
func (p *AccountPool) AccountNames() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	names := make([]string, len(p.accounts))
	for i, a := range p.accounts {
		names[i] = a.Name
	}
	return names
}

func (p *AccountPool) Status() []Account {
	p.mu.Lock()
	defer p.mu.Unlock()

	result := make([]Account, len(p.accounts))
	for i, a := range p.accounts {
		result[i] = Account{
			Name:           a.Name,
			Profile:        a.Profile,
			Busy:           a.Busy,
			Active:         a.Active,
			MaxConcurrency: a.effectiveMaxConcurrency(p.cfg.MaxConcurrency),
			Healthy:        a.Healthy,
			RequestCount:   a.RequestCount,
			Proxy:          a.Proxy,
			RateLimit:      a.RateLimit,
			Usage:          a.Usage,
			PlanUsage:      a.PlanUsage,
		}
	}
	return result
}

func (p *AccountPool) pickAvailable() *Account {
	avail := make([]*Account, 0)
	for _, a := range p.accounts {
		if a.Healthy && a.Active < a.effectiveMaxConcurrency(p.cfg.MaxConcurrency) {
			avail = append(avail, a)
		}
	}
	if len(avail) == 0 {
		return nil
	}
	// Prefer least-active, then least-recently-used
	sort.Slice(avail, func(i, j int) bool {
		if avail[i].Active != avail[j].Active {
			return avail[i].Active < avail[j].Active
		}
		return avail[i].lastUsed.Before(avail[j].lastUsed)
	})
	return avail[0]
}

func (p *AccountPool) release(acc *Account) {
	p.mu.Lock()
	acc.Active--
	if acc.Active < 0 {
		acc.Active = 0
	}
	acc.Busy = acc.Active >= acc.effectiveMaxConcurrency(p.cfg.MaxConcurrency)
	p.mu.Unlock()

	p.signal()
}

func (p *AccountPool) signal() {
	select {
	case p.notify <- struct{}{}:
	default:
	}
}

// ── Removed accounts persistence ──

const removedFile = ".removed"

func removedFilePath(accountsDir string) string {
	return filepath.Join(accountsDir, removedFile)
}

// loadRemovedAccounts reads the .removed file and returns a set of account names.
func loadRemovedAccounts(accountsDir string) map[string]bool {
	f, err := os.Open(removedFilePath(accountsDir))
	if err != nil {
		return nil
	}
	defer f.Close()

	removed := make(map[string]bool)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		name := strings.TrimSpace(scanner.Text())
		if name != "" {
			removed[name] = true
		}
	}
	return removed
}

// appendRemovedAccount appends an account name to the .removed file.
func appendRemovedAccount(accountsDir, name string) {
	f, err := os.OpenFile(removedFilePath(accountsDir), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("[pool] failed to write .removed file: %v", err)
		return
	}
	defer f.Close()
	f.WriteString(name + "\n")
}

// StartDiscovery periodically scans the accounts directory for new accounts.
func (p *AccountPool) StartDiscovery() {
	go func() {
		for {
			time.Sleep(30 * time.Second)
			discovered := discoverAccounts(p.cfg.AccountsDir)
			for _, name := range discovered {
				p.AddAccount(name)
			}
		}
	}()
}

// unremoveAccount removes an account from the .removed file (when re-adding).
func unremoveAccount(accountsDir, name string) {
	removed := loadRemovedAccounts(accountsDir)
	if removed == nil || !removed[name] {
		return
	}
	delete(removed, name)

	var lines []string
	for n := range removed {
		lines = append(lines, n)
	}
	content := strings.Join(lines, "\n")
	if content != "" {
		content += "\n"
	}
	if err := os.WriteFile(removedFilePath(accountsDir), []byte(content), 0644); err != nil {
		log.Printf("[pool] failed to update .removed file: %v", err)
	}
}
