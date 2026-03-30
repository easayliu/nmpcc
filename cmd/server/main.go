package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"nmpcc/internal/config"
	"nmpcc/internal/handler"
	"nmpcc/internal/logger"
	"nmpcc/internal/logstore"
	"nmpcc/internal/pool"
)

func main() {
	godotenv.Load()

	// Init log level from env (default: info)
	if lvl := os.Getenv("LOG_LEVEL"); lvl != "" {
		if !logger.SetLevelFromString(lvl) {
			logger.Warn("unknown LOG_LEVEL %q, using info", lvl)
		}
	}
	logger.Info("log level: %s", logger.GetLevelName())

	cfg := config.Load()

	p := pool.New(cfg)
	p.StartDiscovery()

	logs, err := logstore.New(cfg.AccountsDir)
	if err != nil {
		logger.Warn("failed to open log database, using in-memory only: %v", err)
	}
	if logs != nil {
		defer logs.Close()
	}

	h := handler.New(p, cfg, logs)

	status := p.Status()
	if len(status) == 0 {
		logger.Warn("No accounts found. Login on the server: CLAUDE_CONFIG_DIR=%s/<name> claude auth login", cfg.AccountsDir)
	} else {
		accountNames := make([]string, len(status))
		for i, a := range status {
			accountNames[i] = a.Name
		}
		logger.Info("Loaded %d accounts: %s", len(accountNames), strings.Join(accountNames, ", "))
	}

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: h,
	}

	go func() {
		logger.Info("listening on port %d", cfg.Port)
		logger.Info("  POST /v1/messages  - Anthropic-compatible messages API")
		logger.Info("  GET  /v1/models    - List available models")
		logger.Info("  GET  /status       - Account pool status")

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[FATAL] server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	sig := <-quit

	logger.Info("%s received, shutting down...", sig)

	p.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("[FATAL] shutdown error: %v", err)
	}
	logger.Info("stopped")
}
