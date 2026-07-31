import type { SDKAssistantMessage, SDKResultMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";

// Shared fake SDK messages. `satisfies`-checked against the real SDK types, so a
// shape change in the SDK breaks these tests instead of only production.
export const init = {
  type: "system",
  subtype: "init",
  session_id: "s1",
  uuid: "00000000-0000-4000-8000-000000000000",
  cwd: "C:\\proj",
  apiKeySource: "oauth",
  claude_code_version: "0.0.0-test",
  tools: [],
  mcp_servers: [],
  model: "claude-test",
  permissionMode: "default",
  slash_commands: [],
  output_style: "default",
  skills: [],
  plugins: [],
} satisfies SDKSystemMessage;

export const result = {
  type: "result",
  subtype: "success",
  session_id: "s1",
  uuid: "00000000-0000-4000-8000-000000000009",
  is_error: false,
  duration_ms: 1,
  duration_api_ms: 1,
  num_turns: 1,
  result: "ok",
  stop_reason: "end_turn",
  total_cost_usd: 0.01,
  // ponytail: usage/modelUsage are unread by the adapter; cast rather than
  // hand-build every token counter the API type requires.
  usage: {} as SDKResultMessage["usage"],
  modelUsage: {},
  permission_denials: [],
} satisfies SDKResultMessage;

export const assistant = (content: SDKAssistantMessage["message"]["content"]) =>
  ({
    type: "assistant",
    session_id: "s1",
    uuid: "00000000-0000-4000-8000-000000000001",
    parent_tool_use_id: null,
    // ponytail: BetaMessage's envelope fields (usage, container, diagnostics…)
    // are never read by the adapter, so the wrapper is cast; `content` — the
    // part the adapter parses — stays type-checked through the parameter.
    message: { role: "assistant", content } as SDKAssistantMessage["message"],
  }) satisfies SDKAssistantMessage;

export const toolOpts = (requestId: string) => ({
  signal: new AbortController().signal,
  toolUseID: "tu_1",
  requestId,
});

export const tick = () => new Promise<void>((r) => setImmediate(r));
