import { query } from "@anthropic-ai/claude-code";

const start = Date.now();
function ts() { return `[+${((Date.now() - start) / 1000).toFixed(1)}s]`; }

console.log(`${ts()} calling query()...`);

const response = query({
  prompt: "say hi",
  options: {
    model: "claude-sonnet-4-6",
    permissionMode: "bypassPermissions",
    includePartialMessages: true,
    maxTurns: 1,
  },
});

console.log(`${ts()} query() returned, starting iteration...`);

for await (const msg of response) {
  const summary = msg.type === "stream_event"
    ? `stream_event → ${msg.event?.type} ${msg.event?.delta?.type || msg.event?.content_block?.type || ""}`
    : `${msg.type}${msg.subtype ? `:${msg.subtype}` : ""}`;

  console.log(`${ts()} ${summary}`);

  if (msg.type === "result") break;
}

console.log(`${ts()} done`);
