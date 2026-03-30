package logstore

import (
	"database/sql"
	"nmpcc/internal/logger"
	"nmpcc/internal/pool"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Summary holds aggregated stats for a query result set.
type Summary struct {
	Count        int64   `json:"count"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	TotalCostUSD float64 `json:"totalCostUsd"`
}

// QueryResult contains both the logs and their summary stats.
type QueryResult struct {
	Logs    []pool.RequestLog `json:"logs"`
	Summary Summary           `json:"summary"`
	HasMore bool              `json:"hasMore"`
}

type Store struct {
	db   *sql.DB
	stop chan struct{}
}

const retentionDays = 30

func New(dataDir string) (*Store, error) {
	dbPath := filepath.Join(dataDir, "logs.db")
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}

	// Performance tuning
	db.Exec(`PRAGMA synchronous = NORMAL`)
	db.Exec(`PRAGMA cache_size = -2000`) // 2MB cache
	db.Exec(`PRAGMA temp_store = MEMORY`)

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS request_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp INTEGER NOT NULL,
		account TEXT NOT NULL,
		model TEXT NOT NULL DEFAULT '',
		input_tokens INTEGER NOT NULL DEFAULT 0,
		output_tokens INTEGER NOT NULL DEFAULT 0,
		cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
		cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
		cache_creation_1h INTEGER NOT NULL DEFAULT 0,
		cache_creation_5m INTEGER NOT NULL DEFAULT 0,
		total_cost_usd REAL NOT NULL DEFAULT 0,
		duration_ms INTEGER NOT NULL DEFAULT 0,
		stream INTEGER NOT NULL DEFAULT 1
	)`); err != nil {
		db.Close()
		return nil, err
	}

	// Composite index covers the most common query pattern
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_logs_ts_account ON request_logs(timestamp DESC, account)`)
	// Drop old single-column indexes if they exist (covered by composite)
	db.Exec(`DROP INDEX IF EXISTS idx_logs_timestamp`)
	db.Exec(`DROP INDEX IF EXISTS idx_logs_account`)

	s := &Store{db: db, stop: make(chan struct{})}
	go s.retentionLoop()
	return s, nil
}

func (s *Store) Add(entry pool.RequestLog) {
	_, err := s.db.Exec(`INSERT INTO request_logs
		(timestamp, account, model, input_tokens, output_tokens,
		 cache_read_input_tokens, cache_creation_input_tokens,
		 cache_creation_1h, cache_creation_5m, total_cost_usd, duration_ms, stream)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.Timestamp, entry.Account, entry.Model,
		entry.InputTokens, entry.OutputTokens,
		entry.CacheReadInputTokens, entry.CacheCreationInputTokens,
		entry.CacheCreation1h, entry.CacheCreation5m,
		entry.TotalCostUSD, entry.DurationMs,
		boolToInt(entry.Stream),
	)
	if err != nil {
		logger.Warn("[logstore] insert error: %v", err)
	}
}

// Query returns logs filtered by account and/or time range, with server-side summary.
func (s *Store) Query(account string, since, until int64, limit, offset int) *QueryResult {
	where, args := buildWhere(account, since, until)

	if limit <= 0 {
		limit = 200
	}

	// Get summary in one query (uses covering index)
	var summary Summary
	sumQuery := `SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(total_cost_usd),0) FROM request_logs` + where
	s.db.QueryRow(sumQuery, args...).Scan(&summary.Count, &summary.InputTokens, &summary.OutputTokens, &summary.TotalCostUSD)

	// Fetch page of logs
	dataQuery := `SELECT
		timestamp, account, model, input_tokens, output_tokens,
		cache_read_input_tokens, cache_creation_input_tokens,
		cache_creation_1h, cache_creation_5m, total_cost_usd, duration_ms, stream
		FROM request_logs` + where + ` ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`
	dataArgs := make([]any, len(args), len(args)+2)
	copy(dataArgs, args)
	dataArgs = append(dataArgs, limit+1, offset)

	rows, err := s.db.Query(dataQuery, dataArgs...)
	if err != nil {
		logger.Warn("[logstore] query error: %v", err)
		return &QueryResult{Summary: summary}
	}
	defer rows.Close()

	var logs []pool.RequestLog
	for rows.Next() {
		var l pool.RequestLog
		var stream int
		if err := rows.Scan(
			&l.Timestamp, &l.Account, &l.Model,
			&l.InputTokens, &l.OutputTokens,
			&l.CacheReadInputTokens, &l.CacheCreationInputTokens,
			&l.CacheCreation1h, &l.CacheCreation5m,
			&l.TotalCostUSD, &l.DurationMs, &stream,
		); err != nil {
			continue
		}
		l.Stream = stream != 0
		logs = append(logs, l)
	}

	hasMore := len(logs) > limit
	if hasMore {
		logs = logs[:limit]
	}

	return &QueryResult{
		Logs:    logs,
		Summary: summary,
		HasMore: hasMore,
	}
}

func (s *Store) Close() error {
	close(s.stop)
	return s.db.Close()
}

// retentionLoop deletes logs older than retentionDays every hour.
func (s *Store) retentionLoop() {
	s.deleteOld()
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.deleteOld()
		case <-s.stop:
			return
		}
	}
}

func (s *Store) deleteOld() {
	cutoff := time.Now().AddDate(0, 0, -retentionDays).Unix()
	result, err := s.db.Exec(`DELETE FROM request_logs WHERE timestamp < ?`, cutoff)
	if err != nil {
		logger.Warn("[logstore] retention cleanup error: %v", err)
		return
	}
	if n, _ := result.RowsAffected(); n > 0 {
		logger.Info("[logstore] cleaned up %d logs older than %d days", n, retentionDays)
		s.db.Exec(`PRAGMA incremental_vacuum`)
	}
}

func buildWhere(account string, since, until int64) (string, []any) {
	where := ` WHERE 1=1`
	var args []any
	if account != "" {
		where += ` AND account = ?`
		args = append(args, account)
	}
	if since > 0 {
		where += ` AND timestamp >= ?`
		args = append(args, since)
	}
	if until > 0 {
		where += ` AND timestamp <= ?`
		args = append(args, until)
	}
	return where, args
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
