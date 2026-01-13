import { buildAbortSignal, buildBearerAuthHeader, joinBaseUrl, safeFetch } from "../common/http";
import type { ByokStreamEvent } from "./stream-events";
import { parseChatCompletionsSseByokEvents } from "./chat-completions-sse";

export type OpenAiChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type OpenAiTool = { type: "function"; function: { name: string; description?: string; parameters: any } };
export type OpenAiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type OpenAiChatCompleteWithToolsResult =
  | { kind: "final"; text: string }
  | { kind: "tool_calls"; toolCalls: OpenAiToolCall[]; assistantText: string };

function normalizeStop(v: unknown): string | string[] | undefined {
  if (typeof v === "string") return v.trim() ? v : undefined;
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  return out.length ? out : undefined;
}

export async function openAiChatComplete({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  topP,
  presencePenalty,
  frequencyPenalty,
  stop,
  seed,
  extraHeaders,
  extraBody,
  timeoutMs,
  abortSignal
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: OpenAiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string | string[];
  seed?: number;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, any>;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const url = joinBaseUrl(baseUrl, "chat/completions");
  if (!url) throw new Error("OpenAI baseUrl 无效");
  const auth = buildBearerAuthHeader(apiKey);
  if (!auth) throw new Error("OpenAI apiKey 未配置");

  const body: any = { ...(extraBody && typeof extraBody === "object" ? extraBody : null), model, messages, stream: false };
  if (typeof temperature === "number") body.temperature = temperature;
  if (typeof maxTokens === "number") body.max_tokens = maxTokens;
  if (typeof topP === "number") body.top_p = topP;
  if (typeof presencePenalty === "number") body.presence_penalty = presencePenalty;
  if (typeof frequencyPenalty === "number") body.frequency_penalty = frequencyPenalty;
  if (typeof seed === "number") body.seed = seed;
  const stopNorm = normalizeStop(stop);
  if (stopNorm) body.stop = stopNorm;

  const resp = await safeFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(extraHeaders || {}), authorization: auth },
      body: JSON.stringify(body),
      signal: buildAbortSignal(timeoutMs, abortSignal)
    },
    "OpenAI"
  );

  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`OpenAI 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  const json = text ? JSON.parse(text) : null;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI 响应缺少 choices[0].message.content");
  return content;
}

export async function openAiChatCompleteWithTools({
  baseUrl,
  apiKey,
  model,
  messages,
  tools,
  temperature,
  maxTokens,
  topP,
  presencePenalty,
  frequencyPenalty,
  stop,
  seed,
  extraHeaders,
  extraBody,
  timeoutMs,
  abortSignal
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: any[];
  tools: OpenAiTool[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string | string[];
  seed?: number;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, any>;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<OpenAiChatCompleteWithToolsResult> {
  const url = joinBaseUrl(baseUrl, "chat/completions");
  if (!url) throw new Error("OpenAI baseUrl 无效");
  const auth = buildBearerAuthHeader(apiKey);
  if (!auth) throw new Error("OpenAI apiKey 未配置");

  const body: any = { ...(extraBody && typeof extraBody === "object" ? extraBody : null), model, messages, tools, tool_choice: "auto", stream: false };
  if (typeof temperature === "number") body.temperature = temperature;
  if (typeof maxTokens === "number") body.max_tokens = maxTokens;
  if (typeof topP === "number") body.top_p = topP;
  if (typeof presencePenalty === "number") body.presence_penalty = presencePenalty;
  if (typeof frequencyPenalty === "number") body.frequency_penalty = frequencyPenalty;
  if (typeof seed === "number") body.seed = seed;
  const stopNorm = normalizeStop(stop);
  if (stopNorm) body.stop = stopNorm;

  const resp = await safeFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(extraHeaders || {}), authorization: auth },
      body: JSON.stringify(body),
      signal: buildAbortSignal(timeoutMs, abortSignal)
    },
    "OpenAI"
  );

  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`OpenAI 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  const json = text ? JSON.parse(text) : null;
  const msg = json?.choices?.[0]?.message;
  const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls.filter((c: any) => c && typeof c.id === "string" && c.function && typeof c.function.name === "string") : [];
  if (toolCalls.length) return { kind: "tool_calls", toolCalls, assistantText: typeof msg?.content === "string" ? msg.content : "" };
  const content = msg?.content;
  if (typeof content !== "string") throw new Error("OpenAI 响应缺少 choices[0].message.content/tool_calls");
  return { kind: "final", text: content };
}

export async function* openAiChatStreamEvents({
  baseUrl,
  apiKey,
  model,
  messages,
  tools,
  temperature,
  maxTokens,
  topP,
  presencePenalty,
  frequencyPenalty,
  stop,
  seed,
  extraHeaders,
  extraBody,
  timeoutMs,
  abortSignal
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: any[];
  tools?: OpenAiTool[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string | string[];
  seed?: number;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, any>;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): AsyncGenerator<ByokStreamEvent> {
  const url = joinBaseUrl(baseUrl, "chat/completions");
  if (!url) throw new Error("OpenAI baseUrl 无效");
  const auth = buildBearerAuthHeader(apiKey);
  if (!auth) throw new Error("OpenAI apiKey 未配置");

  const body: any = { ...(extraBody && typeof extraBody === "object" ? extraBody : null), model, messages, stream: true };
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  if (typeof temperature === "number") body.temperature = temperature;
  if (typeof maxTokens === "number") body.max_tokens = maxTokens;
  if (typeof topP === "number") body.top_p = topP;
  if (typeof presencePenalty === "number") body.presence_penalty = presencePenalty;
  if (typeof frequencyPenalty === "number") body.frequency_penalty = frequencyPenalty;
  if (typeof seed === "number") body.seed = seed;
  const stopNorm = normalizeStop(stop);
  if (stopNorm) body.stop = stopNorm;

  const resp = await safeFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(extraHeaders || {}), authorization: auth },
      body: JSON.stringify(body),
      signal: buildAbortSignal(timeoutMs, abortSignal)
    },
    "OpenAI"
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI stream 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  }
  yield* parseChatCompletionsSseByokEvents(resp);
}

export async function* openAiChatStream(args: Parameters<typeof openAiChatStreamEvents>[0]): AsyncGenerator<string> {
  for await (const ev of openAiChatStreamEvents(args)) if (ev.kind === "text") yield ev.text;
}

export async function openAiListModels({
  baseUrl,
  apiKey,
  timeoutMs,
  abortSignal
}: {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<string[]> {
  const url = joinBaseUrl(baseUrl, "models");
  if (!url) throw new Error("OpenAI baseUrl 无效");
  const auth = buildBearerAuthHeader(apiKey);
  if (!auth) throw new Error("OpenAI apiKey 未配置");

  const resp = await safeFetch(url, { method: "GET", headers: { authorization: auth }, signal: buildAbortSignal(timeoutMs, abortSignal) }, "OpenAI");
  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`OpenAI models 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  const json = text ? JSON.parse(text) : null;
  const data = Array.isArray(json?.data) ? json.data : null;
  if (!data) throw new Error("OpenAI models 响应缺少 data[]");
  const models = data.map((m: any) => (m && typeof m.id === "string" ? m.id : "")).filter(Boolean);
  models.sort();
  return models;
}
