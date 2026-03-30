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
	"nmpcc/internal/logstore"
	"nmpcc/internal/pool"
)

func main() {
	godotenv.Load()

	cfg := config.Load()

	p := pool.New(cfg)
	p.StartDiscovery()

	logs, err := logstore.New(cfg.AccountsDir)
	if err != nil {
		log.Printf("[warn] failed to open log database, using in-memory only: %v", err)
	}
	if logs != nil {
		defer logs.Close()
	}

	h := handler.New(p, cfg, logs)

	status := p.Status()
	if len(status) == 0 {
		log.Printf("[init] No accounts found. Login on the server: CLAUDE_CONFIG_DIR=%s/<name> claude auth login", cfg.AccountsDir)
	} else {
		accountNames := make([]string, len(status))
		for i, a := range status {
			accountNames[i] = a.Name
		}
		log.Printf("[init] Loaded %d accounts: %s", len(accountNames), strings.Join(accountNames, ", "))
	}

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: h,
	}

	go func() {
		log.Printf("[nmpcc] listening on port %d", cfg.Port)
		log.Println("  POST /v1/messages  - Anthropic-compatible messages API")
		log.Println("  GET  /v1/models    - List available models")
		log.Println("  GET  /status       - Account pool status")

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[nmpcc] server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	sig := <-quit

	log.Printf("[nmpcc] %s received, shutting down...", sig)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("[nmpcc] shutdown error: %v", err)
	}
	log.Println("[nmpcc] stopped")
}
