import { query } from "@anthropic-ai/claude-code";

const response = query({
  prompt: "说一句话证明你在工作，用中文回答，不要使用任何工具",
  options: {
    maxTurns: 1,
    model: "claude-opus-4-6",
  },
});

for await (const message of response) {
  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if (block.type === "text") {
        console.log("Assistant:", block.text);
      }
    }
  }
}
