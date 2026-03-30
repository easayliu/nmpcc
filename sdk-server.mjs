import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { query } from "@anthropic-ai/claude-code";

// ── Config ──
const PORT = parseInt(process.env.SDK_PORT || "3001", 10);
const API_KEYS = (process.env.SDK_API_KEYS || process.env.SERVICE_API_KEYS || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TURNS = parseInt(process.env.SDK_MAX_TURNS || "10", 10);

// ── Helpers ──
function generateID(prefix = "msg_") {
  return prefix + randomBytes(12).toString("hex");
}

function sendJSON(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJSON(res, status, {
    type: "error",
    error: { type: "api_error", message },
  });
}

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function authenticate(req) {
  if (API_KEYS.length === 0) return true;
  const auth = req.headers["authorization"] || req.headers["x-api-key"] || "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  return API_KEYS.includes(key);
}

function messagesToPrompt(messages) {
  return messages
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
      }
      return "";
    })
    .join("\n\n");
}

function extractSystemPrompt(system) {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

// ── SSE Stream Handler ──
async function handleStream(res, prompt, model, systemPrompt) {
  const messageID = generateID();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // message_start
  sendSSE(res, "message_start", {
    type: "message_start",
    message: {
      id: messageID,
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  sendSSE(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });

  sendSSE(res, "ping", { type: "ping" });

  const opts = { maxTurns: MAX_TURNS, model };
  if (systemPrompt) opts.systemPrompt = systemPrompt;

  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const response = query({ prompt, options: opts });

    for await (const message of response) {
      if (res.destroyed) break;

      // Handle assistant messages with content
      if (message.type === "assistant" && message.message?.content) {
        // Extract usage
        if (message.message.usage) {
          inputTokens = message.message.usage.input_tokens || 0;
          outputTokens = message.message.usage.output_tokens || 0;
        }
        for (const block of message.message.content) {
          if (block.type === "text" && block.text) {
            sendSSE(res, "content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: block.text },
            });
          }
        }
      }

      // Handle streaming text deltas
      if (message.type === "content_block_delta") {
        const text = message.delta?.text || "";
        if (text) {
          sendSSE(res, "content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text },
          });
        }
      }

      // Handle result
      if (message.type === "result") {
        if (message.usage) {
          outputTokens = message.usage.output_tokens || outputTokens;
          inputTokens = message.usage.input_tokens || inputTokens;
        }
        if (message.result && typeof message.result === "string") {
          // Fallback: emit result text if no content_block_delta was sent
        }
      }
    }
  } catch (err) {
    console.error("[stream] error:", err.message);
  }

  // Finalize
  sendSSE(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  sendSSE(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  sendSSE(res, "message_stop", { type: "message_stop" });
  res.end();
}

// ── Request Handler ──
async function handleMessages(req, res) {
  if (req.method !== "POST") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  if (!authenticate(req)) {
    sendError(res, 401, "Unauthorized");
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    sendError(res, 400, "Invalid JSON");
    return;
  }

  if (!body.messages || !body.messages.length) {
    sendError(res, 400, "messages is required and must be non-empty");
    return;
  }

  if (!body.stream) {
    sendError(res, 400, 'Only streaming is supported, set "stream": true');
    return;
  }

  const prompt = messagesToPrompt(body.messages);
  if (!prompt) {
    sendError(res, 400, "Empty prompt");
    return;
  }

  const model = body.model || DEFAULT_MODEL;
  const systemPrompt = extractSystemPrompt(body.system);

  console.log(
    `[req] model=${model} messages=${body.messages.length} prompt_len=${prompt.length}`
  );

  await handleStream(res, prompt, model, systemPrompt);
}

// ── Models endpoint ──
function handleModels(_req, res) {
  sendJSON(res, 200, {
    data: [
      { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
  });
}

// ── Server ──
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/v1/messages") {
    handleMessages(req, res);
  } else if (url.pathname === "/v1/models") {
    handleModels(req, res);
  } else if (url.pathname === "/health") {
    sendJSON(res, 200, { status: "ok" });
  } else {
    sendError(res, 404, "Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Claude Code SDK Server listening on http://0.0.0.0:${PORT}`);
  console.log(`Auth: ${API_KEYS.length > 0 ? "enabled" : "DISABLED (no API keys set)"}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
});
