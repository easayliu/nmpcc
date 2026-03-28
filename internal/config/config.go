package config

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Config struct {
	Port          int
	ServiceAPIKey string
	WebPassword   string
	Accounts      []string
	AccountsDir   string
	SandboxDir    string
	MaxTurns       int
	MaxConcurrency int
	Timeout        time.Duration
	QueueTimeout   time.Duration

	mu sync.Mutex // protects runtime settings file writes
}

// RuntimeSettings is the persisted runtime config (not env vars).
type RuntimeSettings struct {
	MaxConcurrency     int            `json:"maxConcurrency,omitempty"`
	MaxTurns           int            `json:"maxTurns,omitempty"`
	AccountConcurrency map[string]int `json:"accountConcurrency,omitempty"`
}

func Load() *Config {
	cfg := &Config{
		Port:          getInt("PORT", 3000),
		ServiceAPIKey: getStr("SERVICE_API_KEY", ""),
		WebPassword:   getStr("WEB_PASSWORD", ""),
		Accounts:      getList("ACCOUNTS"),
		AccountsDir:   getStr("ACCOUNTS_DIR", "/accounts"),
		SandboxDir:    getStr("SANDBOX_DIR", "/tmp/nmpcc-sandbox"),
		MaxTurns:       getInt("MAX_TURNS", 10),
		MaxConcurrency: getInt("MAX_CONCURRENCY", 1),
		Timeout:       time.Duration(getInt("TIMEOUT_MS", 300000)) * time.Millisecond,
		QueueTimeout:  time.Duration(getInt("QUEUE_TIMEOUT_MS", 60000)) * time.Millisecond,
	}
	// Override with persisted runtime settings
	if rs := cfg.LoadRuntime(); rs != nil {
		if rs.MaxConcurrency > 0 {
			cfg.MaxConcurrency = rs.MaxConcurrency
		}
		if rs.MaxTurns > 0 {
			cfg.MaxTurns = rs.MaxTurns
		}
	}
	return cfg
}

func (c *Config) runtimePath() string {
	return filepath.Join(c.AccountsDir, "runtime.json")
}

// LoadRuntime reads the persisted runtime settings file.
func (c *Config) LoadRuntime() *RuntimeSettings {
	data, err := os.ReadFile(c.runtimePath())
	if err != nil {
		return nil
	}
	var rs RuntimeSettings
	if json.Unmarshal(data, &rs) != nil {
		return nil
	}
	return &rs
}

// SaveRuntime writes the current runtime settings to disk.
func (c *Config) SaveRuntime(rs *RuntimeSettings) {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := json.MarshalIndent(rs, "", "  ")
	if err != nil {
		log.Printf("[config] failed to marshal runtime settings: %v", err)
		return
	}
	if err := os.WriteFile(c.runtimePath(), data, 0o644); err != nil {
		log.Printf("[config] failed to save runtime settings: %v", err)
	}
}

func getStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func getList(key string) []string {
	raw := os.Getenv(key)
	if raw == "" {
		return nil
	}
	var result []string
	for _, s := range strings.Split(raw, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			result = append(result, s)
		}
	}
	return result
}
