export type ByokStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "thinking"; summary: string }
  | { kind: "token_usage"; inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
  | { kind: "tool_use"; toolUseId: string; toolName: string; inputJson: string };
