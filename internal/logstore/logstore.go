package logstore

import (
	"database/sql"
	"log"
	"nmpcc/internal/pool"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func New(dataDir string) (*Store, error) {
	dbPath := filepath.Join(dataDir, "logs.db")
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}

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

	// Index for common queries
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON request_logs(timestamp DESC)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_logs_account ON request_logs(account)`)

	return &Store{db: db}, nil
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
		log.Printf("[logstore] insert error: %v", err)
	}
}

// Recent returns the most recent N logs, newest first.
func (s *Store) Recent(limit int) []pool.RequestLog {
	rows, err := s.db.Query(`SELECT
		timestamp, account, model, input_tokens, output_tokens,
		cache_read_input_tokens, cache_creation_input_tokens,
		cache_creation_1h, cache_creation_5m, total_cost_usd, duration_ms, stream
		FROM request_logs ORDER BY timestamp DESC, id DESC LIMIT ?`, limit)
	if err != nil {
		log.Printf("[logstore] query error: %v", err)
		return nil
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
	return logs
}

// Query returns logs filtered by account and/or time range.
func (s *Store) Query(account string, since, until int64, limit int) []pool.RequestLog {
	query := `SELECT
		timestamp, account, model, input_tokens, output_tokens,
		cache_read_input_tokens, cache_creation_input_tokens,
		cache_creation_1h, cache_creation_5m, total_cost_usd, duration_ms, stream
		FROM request_logs WHERE 1=1`
	var args []any

	if account != "" {
		query += ` AND account = ?`
		args = append(args, account)
	}
	if since > 0 {
		query += ` AND timestamp >= ?`
		args = append(args, since)
	}
	if until > 0 {
		query += ` AND timestamp <= ?`
		args = append(args, until)
	}

	query += ` ORDER BY timestamp DESC, id DESC`

	if limit <= 0 {
		limit = 500
	}
	query += ` LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		log.Printf("[logstore] query error: %v", err)
		return nil
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
	return logs
}

func (s *Store) Close() error {
	return s.db.Close()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
