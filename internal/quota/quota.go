package quota

import (
	"encoding/json"
	"fmt"
	"log"
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

var pctPattern = regexp.MustCompile(`(\d+)%\s*used`)

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
				log.Printf("[quota] account=%s reader stopped: %v", accountName, err)
				close(dataCh)
				return
			}
		}
	}()

	// Phase 1: Wait for interactive prompt to be ready (drain init output)
	initRaw := drainUntilIdle(dataCh, 20*time.Second, 4*time.Second)
	log.Printf("[quota] account=%s init phase: %d bytes", accountName, len(initRaw))

	// Phase 2: Send /usage
	if _, err := ptmx.Write([]byte("/usage\r")); err != nil {
		return nil, fmt.Errorf("write /usage: %w", err)
	}
	log.Printf("[quota] account=%s sent /usage", accountName)

	// Phase 3: Collect /usage output
	raw := drainUntilIdle(dataCh, 20*time.Second, 5*time.Second)
	log.Printf("[quota] account=%s usage phase: %d bytes", accountName, len(raw))

	// Exit
	ptmx.Write([]byte("/exit\r"))

	text := stripANSI(raw)
	log.Printf("[quota] account=%s raw usage: %s", accountName, text)

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

var ansiPattern = regexp.MustCompile(`\x1b\[[^a-zA-Z]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[\]]\S*`)

func stripANSI(s string) string {
	s = ansiPattern.ReplaceAllString(s, "")
	var clean []byte
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' || (s[i] >= 32 && s[i] <= 126) {
			clean = append(clean, s[i])
		}
	}
	return string(clean)
}

func parseUsage(text string) *UsageResult {
	result := &UsageResult{}

	labels := []string{
		"Current session",
		"Current week (all models)",
		"Current week (Sonnet only)",
		"Extra usage",
	}

	for _, label := range labels {
		idx := strings.Index(text, label)
		if idx == -1 {
			continue
		}

		after := text[idx+len(label):]
		end := len(after)
		for _, other := range labels {
			if other == label {
				continue
			}
			if pos := strings.Index(after, other); pos > 0 && pos < end {
				end = pos
			}
		}
		section := after[:end]

		entry := UsageEntry{Label: label}

		if m := pctPattern.FindStringSubmatch(section); m != nil {
			entry.Used, _ = strconv.ParseFloat(m[1], 64)
		}

		if pos := strings.Index(section, "Reset"); pos >= 0 {
			rest := section[pos:]
			if paren := strings.Index(rest, ")"); paren > 0 {
				entry.ResetsAt = strings.TrimSpace(rest[:paren+1])
			} else {
				entry.ResetsAt = strings.TrimSpace(rest)
			}
		}

		if label == "Extra usage" {
			if strings.Contains(section, "not enabled") {
				entry.ExtraUsage = "not enabled"
			} else if strings.Contains(section, "enabled") {
				entry.ExtraUsage = "enabled"
			}
		}

		result.Entries = append(result.Entries, entry)
	}

	return result
}
