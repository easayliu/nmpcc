package executor

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"nmpcc/internal/config"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"strconv"

	"crypto/rand"
	"encoding/hex"
)

type Options struct {
	Model        string
	SystemPrompt string
	SessionID    string // If set, resume this session instead of starting new
	Proxy        string // Proxy URL (socks5://... or http://...), applied as env vars
}

type Result struct {
	ResultEvent map[string]any
	AllEvents   []map[string]any
	ExitCode    int
	SessionID   string // Claude CLI session ID from the init/result event
}

func Execute(ctx context.Context, cfg *config.Config, accountName, prompt string, opts Options, onEvent func(map[string]any)) (*Result, error) {
	// Use a stable sandbox per account so --resume can find the session
	sandboxPath := filepath.Join(cfg.SandboxDir, accountName)
	configDir := filepath.Join(cfg.AccountsDir, accountName)

	if err := os.MkdirAll(sandboxPath, 0o755); err != nil {
		return nil, fmt.Errorf("create sandbox: %w", err)
	}

	args := buildArgs(opts, cfg.GetMaxTurns())

	execCtx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "claude", args...)
	cmd.Dir = sandboxPath
	cmd.Env = append(os.Environ(), "CLAUDE_CONFIG_DIR="+configDir)

	// Apply proxy environment variables
	if opts.Proxy != "" {
		cmd.Env = append(cmd.Env,
			"HTTP_PROXY="+opts.Proxy,
			"HTTPS_PROXY="+opts.Proxy,
			"http_proxy="+opts.Proxy,
			"https_proxy="+opts.Proxy,
			"ALL_PROXY="+opts.Proxy,
			"all_proxy="+opts.Proxy,
		)
	}

	// Pass prompt via stdin to avoid "argument list too long" on large prompts
	cmd.Stdin = strings.NewReader(prompt)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}

	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start claude: %w", err)
	}

	var resultEvent map[string]any
	var allEvents []map[string]any
	var cliSessionID string

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var event map[string]any
		if err := json.Unmarshal(line, &event); err != nil {
			continue
		}

		allEvents = append(allEvents, event)

		if t, _ := event["type"].(string); t == "result" {
			resultEvent = event
		}

		// Extract session_id from init or result event
		if sid, _ := event["session_id"].(string); sid != "" && cliSessionID == "" {
			cliSessionID = sid
		}

		if onEvent != nil {
			onEvent(event)
		}
	}

	waitErr := cmd.Wait()
	exitCode := cmd.ProcessState.ExitCode()

	if waitErr != nil && resultEvent == nil {
		if execCtx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("execution timeout after %s", cfg.Timeout)
		}
		return nil, fmt.Errorf("claude CLI exited with code %d: %s", exitCode, stderrBuf.String())
	}

	return &Result{
		ResultEvent: resultEvent,
		AllEvents:   allEvents,
		ExitCode:    exitCode,
		SessionID:   cliSessionID,
	}, nil
}

func buildArgs(opts Options, maxTurns int) []string {
	args := []string{
		"-p",
		"--output-format", "stream-json",
		"--verbose",
		"--max-turns", strconv.Itoa(maxTurns),
	}
	if opts.SessionID != "" {
		args = append(args, "--resume", opts.SessionID)
	}
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	if opts.SystemPrompt != "" {
		args = append(args, "--system-prompt", opts.SystemPrompt)
	}
	return args
}

func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
