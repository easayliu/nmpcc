package logger

import (
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
)

// Level represents log severity.
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

var levelNames = map[Level]string{
	LevelDebug: "DEBUG",
	LevelInfo:  "INFO",
	LevelWarn:  "WARN",
	LevelError: "ERROR",
}

var nameToLevel = map[string]Level{
	"debug": LevelDebug,
	"info":  LevelInfo,
	"warn":  LevelWarn,
	"error": LevelError,
}

var (
	mu       sync.RWMutex
	minLevel = LevelInfo
	std      = log.New(os.Stderr, "", log.LstdFlags)
)

// SetLevel sets the minimum log level.
func SetLevel(l Level) {
	mu.Lock()
	minLevel = l
	mu.Unlock()
}

// SetLevelFromString parses a level name and sets it. Returns false if invalid.
func SetLevelFromString(s string) bool {
	l, ok := nameToLevel[strings.ToLower(strings.TrimSpace(s))]
	if !ok {
		return false
	}
	SetLevel(l)
	return true
}

// GetLevel returns the current minimum log level.
func GetLevel() Level {
	mu.RLock()
	defer mu.RUnlock()
	return minLevel
}

// GetLevelName returns the current level as a string.
func GetLevelName() string {
	return levelNames[GetLevel()]
}

func logf(level Level, format string, args ...any) {
	mu.RLock()
	min := minLevel
	mu.RUnlock()
	if level < min {
		return
	}
	prefix := levelNames[level]
	std.Output(2, fmt.Sprintf("[%s] %s", prefix, fmt.Sprintf(format, args...)))
}

func Debug(format string, args ...any) { logf(LevelDebug, format, args...) }
func Info(format string, args ...any)  { logf(LevelInfo, format, args...) }
func Warn(format string, args ...any)  { logf(LevelWarn, format, args...) }
func Error(format string, args ...any) { logf(LevelError, format, args...) }
