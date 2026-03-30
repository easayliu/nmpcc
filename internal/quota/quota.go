package quota

import (
	"encoding/json"
	"fmt"
	"nmpcc/internal/logger"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/creack/pty"
)

// UsageEntry represents one usage line from /usage output.
type UsageEntry struct {
	Label      string  `json:"label"`
	Used       float64 `json:"used"`
	ResetsAt   string  `json:"resetsAt"`
	ExtraUsage string  `json:"extraUsage,omitempty"`
}

// UsageResult holds the parsed /usage output for an account.
type UsageResult struct {
	Entries []UsageEntry `json:"entries"`
	Raw     string       `json:"raw"`
}

var pctPattern = regexp.MustCompile(`(\d+)\s*%\s*used`)

// ensureOnboarded makes sure the account's .claude.json has onboarding completed
// so that interactive mode doesn't show setup dialogs.
func ensureOnboarded(configDir string) {
	path := filepath.Join(configDir, ".claude.json")
	data := make(map[string]any)

	if raw, err := os.ReadFile(path); err == nil {
		json.Unmarshal(raw, &data)
	}

	changed := false
	defaults := map[string]any{
		"hasCompletedOnboarding":      true,
		"numStartups":                 10,
		"lastOnboardingVersion":       "2.1.85",
		"shiftEnterKeyBindingInstalled": true,
		"opusProMigrationComplete":    true,
		"sonnet1m45MigrationComplete": true,
		"opus1mMergeNoticeSeenCount":  1,
	}
	for k, v := range defaults {
		if _, ok := data[k]; !ok {
			data[k] = v
			changed = true
		}
	}

	// Ensure the current project directory is trusted
	projects, _ := data["projects"].(map[string]any)
	if projects == nil {
		projects = make(map[string]any)
		data["projects"] = projects
		changed = true
	}

	if changed {
		raw, _ := json.MarshalIndent(data, "", "  ")
		os.WriteFile(path, raw, 0o644)
	}
}

// trustProject marks a directory as trusted in the account's .claude.json.
func trustProject(configDir, projectDir string) {
	path := filepath.Join(configDir, ".claude.json")
	data := make(map[string]any)

	if raw, err := os.ReadFile(path); err == nil {
		json.Unmarshal(raw, &data)
	}

	projects, _ := data["projects"].(map[string]any)
	if projects == nil {
		projects = make(map[string]any)
	}

	if _, ok := projects[projectDir]; !ok {
		projects[projectDir] = map[string]any{
			"allowedTools":       []any{},
			"hasTrustDialogAccepted": true,
		}
		data["projects"] = projects
		raw, _ := json.MarshalIndent(data, "", "  ")
		os.WriteFile(path, raw, 0o644)
	}
}

// FetchUsage runs an interactive claude session, sends /usage, and parses the output.
// proxy is optional; if non-empty, it's set as HTTP_PROXY/HTTPS_PROXY/ALL_PROXY on the process.
func FetchUsage(accountsDir, accountName, proxy string) (*UsageResult, error) {
	configDir := filepath.Join(accountsDir, accountName)
	ensureOnboarded(configDir)

	// Use a sandbox dir inside the config dir — path must be exact (no symlinks)
	sandboxDir := filepath.Join(configDir, "usage-sandbox")
	os.MkdirAll(sandboxDir, 0o755)
	// Resolve real path for macOS symlink issues
	realSandbox, _ := filepath.EvalSymlinks(sandboxDir)
	if realSandbox == "" {
		realSandbox = sandboxDir
	}
	trustProject(configDir, realSandbox)

	cmd := exec.Command("claude")
	cmd.Dir = realSandbox
	cmd.Env = append(os.Environ(), "CLAUDE_CONFIG_DIR="+configDir)

	if proxy != "" {
		cmd.Env = append(cmd.Env,
			"HTTP_PROXY="+proxy,
			"HTTPS_PROXY="+proxy,
			"http_proxy="+proxy,
			"https_proxy="+proxy,
			"ALL_PROXY="+proxy,
			"all_proxy="+proxy,
		)
	}

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("start claude: %w", err)
	}
	defer func() {
		cmd.Process.Kill()
		ptmx.Close()
	}()

	// Single reader goroutine
	dataCh := make(chan []byte, 128)
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				tmp := make([]byte, n)
				copy(tmp, buf[:n])
				dataCh <- tmp
			}
			if err != nil {
				logger.Warn("[quota] account=%s reader stopped: %v", accountName, err)
				close(dataCh)
				return
			}
		}
	}()

	// Phase 1: Wait for interactive prompt to be ready (drain init output)
	initRaw := drainUntilIdle(dataCh, 20*time.Second, 4*time.Second)
	logger.Debug("[quota] account=%s init phase: %d bytes", accountName, len(initRaw))

	// Phase 2: Send /usage
	if _, err := ptmx.Write([]byte("/usage\r")); err != nil {
		return nil, fmt.Errorf("write /usage: %w", err)
	}
	logger.Debug("[quota] account=%s sent /usage", accountName)

	// Phase 3: Collect /usage output
	raw := drainUntilIdle(dataCh, 20*time.Second, 5*time.Second)
	logger.Debug("[quota] account=%s usage phase: %d bytes", accountName, len(raw))

	// Exit
	ptmx.Write([]byte("/exit\r"))

	text := stripANSI(raw)
	logger.Debug("[quota] account=%s raw usage: %s", accountName, text)

	result := parseUsage(text)
	result.Raw = text
	return result, nil
}

// drainUntilIdle reads from dataCh until no data arrives for idleTimeout after
// the first chunk is received, or deadline is reached.
func drainUntilIdle(dataCh <-chan []byte, deadline, idleTimeout time.Duration) string {
	var output []byte
	timer := time.NewTimer(deadline)
	defer timer.Stop()

	// Wait for first data or deadline
	for {
		select {
		case data, ok := <-dataCh:
			if !ok {
				return string(output)
			}
			output = append(output, data...)
			goto drainRest
		case <-timer.C:
			return string(output)
		}
	}

drainRest:
	idle := time.NewTimer(idleTimeout)
	defer idle.Stop()

	for {
		select {
		case data, ok := <-dataCh:
			if !ok {
				return string(output)
			}
			output = append(output, data...)
			if !idle.Stop() {
				select {
				case <-idle.C:
				default:
				}
			}
			idle.Reset(idleTimeout)
		case <-idle.C:
			return string(output)
		case <-timer.C:
			return string(output)
		}
	}
}

// ansiPattern covers CSI sequences, OSC sequences, and other escape sequences.
var ansiPattern = regexp.MustCompile(
	`\x1b\[[0-9;?]*[a-zA-Z]` + // CSI sequences (e.g. \e[1m, \e[?25l, \e[2J, \e[H)
		`|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)` + // OSC sequences
		`|\x1b[()][0-9A-Za-z]` + // charset selection
		`|\x1b[=>NOM78]` + // single-char escapes
		`|\x1b\[[\d;]*m` + // SGR (redundant safety)
		`|\r`,
)

func stripANSI(s string) string {
	// Step 1: Remove ANSI escape sequences (don't replace with space — they can appear mid-word)
	s = ansiPattern.ReplaceAllString(s, "")

	// Step 2: Walk bytes, keep printable ASCII and newlines.
	// Replace control chars with a space to separate TUI cells, but collapse runs.
	var clean []byte
	lastSpace := false
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			clean = append(clean, '\n')
			lastSpace = false
		} else if s[i] >= 32 && s[i] <= 126 {
			if s[i] == ' ' {
				if !lastSpace {
					clean = append(clean, ' ')
				}
				lastSpace = true
			} else {
				clean = append(clean, s[i])
				lastSpace = false
			}
		} else {
			// Control chars / non-ASCII → treat as word boundary (space)
			if !lastSpace {
				clean = append(clean, ' ')
				lastSpace = true
			}
		}
	}
	return string(clean)
}

// Fuzzy patterns that tolerate broken/missing characters from TUI output.
// Each pattern matches a label region followed by a percentage.
var usagePatterns = []struct {
	label   string
	pattern *regexp.Regexp
}{
	// Allow arbitrary whitespace/garbage between characters of key words
	{"Current session", regexp.MustCompile(`(?i)C\s*u\s*r\s*r\s*e\s*n?\s*t?\s*s\s*e?\s*s\s*s?\s*i?\s*o?\s*n\s+(\d+)\s*%\s*u\s*s\s*e\s*d`)},
	{"Current week (all models)", regexp.MustCompile(`(?i)C\s*u\s*r\s*r\s*e\s*n?\s*t?\s*w\s*e\s*e\s*k\s*\(?\s*a\s*l\s*l\s*m\s*o\s*d\s*e?\s*l?\s*s?\s*\)?\s+(\d+)\s*%\s*u\s*s\s*e\s*d`)},
	{"Current week (Sonnet only)", regexp.MustCompile(`(?i)C\s*u\s*r\s*r\s*e\s*n?\s*t?\s*w\s*e\s*e\s*k\s*\(?\s*S\s*o\s*n\s*n?\s*e?\s*t?\s*o\s*n\s*l\s*y\s*\)?\s+(\d+)\s*%\s*u\s*s\s*e\s*d`)},
}

var resetPattern = regexp.MustCompile(`(?i)R\s*e\s*s\s*e?\s*t?\s*s?\s*([\w\s,:.]*?\(\s*[\w/]+\s*\))`)

// resetTimePattern extracts time and timezone from a reset string.
// The prefix R...s is consumed by the fuzzy reset word, then we capture the rest.
var resetTimePattern = regexp.MustCompile(`(?i)R\s*e\s*s\s*e?\s*t?\s*s?\s*([\w\s,:.]+?)\s*\(\s*([\w/]+)\s*\)`)
var extraUsagePattern = regexp.MustCompile(`(?i)E\s*x\s*t\s*r\s*a\s*u\s*s\s*a\s*g\s*e\s*(n\s*o\s*t\s*e\s*n\s*a\s*b\s*l\s*e\s*d|e\s*n\s*a\s*b\s*l\s*e\s*d)`)

// cleanResetTime normalizes garbled reset strings like "Reses6m (Asia/Shanghai)"
// into "Resets 6am (Asia/Shanghai)".
func cleanResetTime(raw string) string {
	m := resetTimePattern.FindStringSubmatch(raw)
	if m == nil {
		return strings.TrimSpace(raw)
	}
	timeStr := strings.TrimSpace(m[1])
	tz := strings.TrimSpace(m[2])

	// Fix truncated am/pm: "6m" → "6am", "7:59p" → "7:59pm", "8p" → "8pm"
	// The TUI sometimes eats the 'a' from 'am' or 'p' from 'pm'
	if matched, _ := regexp.MatchString(`(?i)\d+[:.]*\d*[ap]$`, timeStr); matched {
		timeStr += "m"
	} else if matched, _ := regexp.MatchString(`(?i)\d+[:.]*\d*m$`, timeStr); matched {
		// Could be "6m" (missing 'a') — check if it looks like a bare hour+m
		if matched2, _ := regexp.MatchString(`(?i)^\d{1,2}m$`, timeStr); matched2 {
			// "6m" → "6am" (most likely; reset times are typically am)
			timeStr = timeStr[:len(timeStr)-1] + "am"
		}
	}

	return "Resets " + timeStr + " (" + tz + ")"
}

func parseUsage(text string) *UsageResult {
	result := &UsageResult{}

	for _, up := range usagePatterns {
		m := up.pattern.FindStringSubmatch(text)
		if m == nil {
			continue
		}
		entry := UsageEntry{Label: up.label}
		entry.Used, _ = strconv.ParseFloat(m[1], 64)

		// Find the reset time after the match position
		loc := up.pattern.FindStringIndex(text)
		if loc != nil {
			after := text[loc[1]:]
			if rm := resetPattern.FindStringSubmatch(after); rm != nil {
				entry.ResetsAt = cleanResetTime(rm[0])
			}
		}

		result.Entries = append(result.Entries, entry)
	}

	// Extra usage
	if m := extraUsagePattern.FindStringSubmatch(text); m != nil {
		entry := UsageEntry{Label: "Extra usage"}
		if strings.Contains(strings.ToLower(m[1]), "not") {
			entry.ExtraUsage = "not enabled"
		} else {
			entry.ExtraUsage = "enabled"
		}
		result.Entries = append(result.Entries, entry)
	}

	return result
}
