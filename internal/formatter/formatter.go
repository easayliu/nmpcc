package formatter

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const DefaultModel = "claude-sonnet-4-20250514"

// BuildNonStreamResponse builds a complete Anthropic-compatible JSON response.
func BuildNonStreamResponse(resultEvent map[string]any, allEvents []map[string]any, model string) map[string]any {
	text, _ := resultEvent["result"].(string)
	if model == "" {
		model = DefaultModel
	}

	u := extractUsage(resultEvent, allEvents)

	return map[string]any{
		"id":            generateMessageID(),
		"type":          "message",
		"role":          "assistant",
		"content":       []map[string]any{{"type": "text", "text": text}},
		"model":         model,
		"stop_reason":   "end_turn",
		"stop_sequence": nil,
		"usage": map[string]any{
			"input_tokens":                u.InputTokens,
			"output_tokens":               u.OutputTokens,
			"cache_read_input_tokens":     u.CacheReadInputTokens,
			"cache_creation_input_tokens": u.CacheCreationInputTokens,
			"cache_creation": map[string]any{
				"ephemeral_1h_input_tokens": u.CacheCreation1h,
				"ephemeral_5m_input_tokens": u.CacheCreation5m,
			},
		},
	}
}

type usageData struct {
	InputTokens              int
	OutputTokens             int
	CacheReadInputTokens     int
	CacheCreationInputTokens int
	CacheCreation1h          int
	CacheCreation5m          int
}

func extractUsage(resultEvent map[string]any, allEvents []map[string]any) usageData {
	// Try assistant event first
	for _, e := range allEvents {
		if t, _ := e["type"].(string); t == "assistant" {
			if msg, ok := e["message"].(map[string]any); ok {
				if usage, ok := msg["usage"].(map[string]any); ok {
					return usageFromMap(usage)
				}
			}
		}
	}
	// Fallback to result event
	if usage, ok := resultEvent["usage"].(map[string]any); ok {
		return usageFromMap(usage)
	}
	return usageData{}
}

func usageFromMap(m map[string]any) usageData {
	u := usageData{
		InputTokens:              toInt(m["input_tokens"]),
		OutputTokens:             toInt(m["output_tokens"]),
		CacheReadInputTokens:     toInt(m["cache_read_input_tokens"]),
		CacheCreationInputTokens: toInt(m["cache_creation_input_tokens"]),
	}
	if cc, ok := m["cache_creation"].(map[string]any); ok {
		u.CacheCreation1h = toInt(cc["ephemeral_1h_input_tokens"])
		u.CacheCreation5m = toInt(cc["ephemeral_5m_input_tokens"])
	}
	return u
}

// StreamFormatter writes Anthropic-compatible SSE events to an HTTP response.
type StreamFormatter struct {
	mu           sync.Mutex
	w            http.ResponseWriter
	flusher      http.Flusher
	model        string
	messageID    string
	started      bool
	done         chan struct{}
	outputTokens int
	inputTokens  int
	cacheRead    int
	cacheCreate  int
	lastEventAt  time.Time // track last sent event for keepalive
}

func NewStreamFormatter(w http.ResponseWriter, model string) *StreamFormatter {
	if model == "" {
		model = DefaultModel
	}
	flusher, _ := w.(http.Flusher)
	sf := &StreamFormatter{
		w:           w,
		flusher:     flusher,
		model:       model,
		messageID:   generateMessageID(),
		done:        make(chan struct{}),
		lastEventAt: time.Now(),
	}
	go sf.keepaliveLoop()
	return sf
}

// keepaliveLoop sends periodic keepalives to prevent client/proxy timeouts.
// Before the stream starts, it sends SSE comments (": keepalive\n\n") which
// are silently ignored by SSE clients but keep the TCP connection alive.
// After the stream starts, it sends proper ping events.
func (sf *StreamFormatter) keepaliveLoop() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-sf.done:
			return
		case <-ticker.C:
			sf.mu.Lock()
			if time.Since(sf.lastEventAt) >= 10*time.Second {
				if sf.started {
					sf.writeSSELocked("ping", map[string]any{"type": "ping"})
				} else {
					// SSE comment: keeps connection alive without starting the event stream
					fmt.Fprint(sf.w, ": keepalive\n\n")
					sf.lastEventAt = time.Now()
					if sf.flusher != nil {
						sf.flusher.Flush()
					}
				}
			}
			sf.mu.Unlock()
		}
	}
}

// Stop terminates the keepalive loop. Must be called when streaming is done.
func (sf *StreamFormatter) Stop() {
	close(sf.done)
}

func (sf *StreamFormatter) HandleEvent(event map[string]any) {
	sf.mu.Lock()
	defer sf.mu.Unlock()

	t, _ := event["type"].(string)

	switch t {
	case "assistant":
		if msg, ok := event["message"].(map[string]any); ok {
			// Extract usage before starting so message_start has real values
			if usage, ok := msg["usage"].(map[string]any); ok {
				sf.outputTokens = toInt(usage["output_tokens"])
				sf.inputTokens = toInt(usage["input_tokens"])
				sf.cacheRead = toInt(usage["cache_read_input_tokens"])
				sf.cacheCreate = toInt(usage["cache_creation_input_tokens"])
			}

			sf.ensureStartedLocked()

			if content, ok := msg["content"].([]any); ok {
				for _, c := range content {
					block, ok := c.(map[string]any)
					if !ok {
						continue
					}
					if bt, _ := block["type"].(string); bt == "text" {
						if text, _ := block["text"].(string); text != "" {
							sf.writeSSELocked("content_block_delta", map[string]any{
								"type":  "content_block_delta",
								"index": 0,
								"delta": map[string]any{"type": "text_delta", "text": text},
							})
						}
					}
				}
			}
		}

	case "content_block_delta":
		sf.ensureStartedLocked()
		delta, _ := event["delta"].(map[string]any)
		text, _ := delta["text"].(string)
		if text != "" {
			sf.writeSSELocked("content_block_delta", map[string]any{
				"type":  "content_block_delta",
				"index": 0,
				"delta": map[string]any{"type": "text_delta", "text": text},
			})
		}

	case "result":
		hadContent := sf.started
		sf.ensureStartedLocked()

		if !hadContent {
			if text, _ := event["result"].(string); text != "" {
				sf.writeSSELocked("content_block_delta", map[string]any{
					"type":  "content_block_delta",
					"index": 0,
					"delta": map[string]any{"type": "text_delta", "text": text},
				})
			}
		}

		outTokens := sf.outputTokens
		if outTokens == 0 {
			if usage, ok := event["usage"].(map[string]any); ok {
				outTokens = toInt(usage["output_tokens"])
			}
		}

		sf.writeSSELocked("content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})
		sf.writeSSELocked("message_delta", map[string]any{
			"type":  "message_delta",
			"delta": map[string]any{"stop_reason": "end_turn", "stop_sequence": nil},
			"usage": map[string]any{"output_tokens": outTokens},
		})
		sf.writeSSELocked("message_stop", map[string]any{"type": "message_stop"})
	}
}

func (sf *StreamFormatter) End() {
	sf.mu.Lock()
	defer sf.mu.Unlock()
	if !sf.started {
		sf.ensureStartedLocked()
	}
	sf.writeSSELocked("content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})
	sf.writeSSELocked("message_delta", map[string]any{
		"type":  "message_delta",
		"delta": map[string]any{"stop_reason": "end_turn", "stop_sequence": nil},
		"usage": map[string]any{"output_tokens": 0},
	})
	sf.writeSSELocked("message_stop", map[string]any{"type": "message_stop"})
}

func (sf *StreamFormatter) ensureStartedLocked() {
	if sf.started {
		return
	}
	sf.started = true

	sf.writeSSELocked("message_start", map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id":            sf.messageID,
			"type":          "message",
			"role":          "assistant",
			"content":       []any{},
			"model":         sf.model,
			"stop_reason":   nil,
			"stop_sequence": nil,
			"usage": map[string]any{
				"input_tokens":                sf.inputTokens,
				"output_tokens":               0,
				"cache_read_input_tokens":     sf.cacheRead,
				"cache_creation_input_tokens": sf.cacheCreate,
			},
		},
	})

	sf.writeSSELocked("content_block_start", map[string]any{
		"type":          "content_block_start",
		"index":         0,
		"content_block": map[string]any{"type": "text", "text": ""},
	})

	sf.writeSSELocked("ping", map[string]any{"type": "ping"})
}

// writeSSELocked writes an SSE event. Caller must hold sf.mu.
func (sf *StreamFormatter) writeSSELocked(event string, data any) {
	b, err := json.Marshal(data)
	if err != nil {
		return
	}
	fmt.Fprintf(sf.w, "event: %s\ndata: %s\n\n", event, b)
	sf.lastEventAt = time.Now()
	if sf.flusher != nil {
		sf.flusher.Flush()
	}
}

func generateMessageID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return "msg_" + hex.EncodeToString(b)
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}
