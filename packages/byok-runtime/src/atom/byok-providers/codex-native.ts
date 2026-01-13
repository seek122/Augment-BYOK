import { parseSse } from "../common/sse";
import { buildAbortSignal, buildBearerAuthHeader, joinBaseUrl, safeFetch } from "../common/http";
import type { ByokStreamEvent } from "./stream-events";
import type { OpenAiChatCompleteWithToolsResult, OpenAiTool } from "./openai-compatible";
import { parseChatCompletionsSseByokEvents } from "./chat-completions-sse";

function readTextDeltaFromAny(json: any): string {
  const direct = typeof json?.delta === "string" ? json.delta : typeof json?.text === "string" ? json.text : "";
  if (direct) return direct;
  const choice = json?.choices?.[0];
  const delta = choice?.delta;
  return typeof delta?.content === "string" ? delta.content : typeof delta?.text === "string" ? delta.text : "";
}

function getEventType(ev: { event?: string; data?: string }, json: any): string {
  const a = typeof ev.event === "string" ? ev.event.trim() : "";
  const b = typeof json?.type === "string" ? json.type.trim() : "";
  const c = typeof json?.event === "string" ? json.event.trim() : "";
  return a || b || c;
}

function extractResponsesText(json: any): string {
  const out: string[] = [];
  const push = (v: any) => {
    if (typeof v === "string" && v) out.push(v);
  };
  push(json?.output_text);
  const output = Array.isArray(json?.output) ? json.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (typeof (item as any).text === "string") push((item as any).text);
    const content = Array.isArray((item as any).content) ? (item as any).content : [];
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      const t = typeof (c as any).type === "string" ? (c as any).type : "";
      if (t === "output_text" || t === "text") push((c as any).text);
    }
  }
  return out.join("");
}

export async function codexResponsesCompleteText({
  baseUrl,
  apiKey,
  model,
  prompt,
  timeoutMs,
  abortSignal,
  extraHeaders,
  extraBody
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, any>;
}): Promise<string> {
  const url = joinBaseUrl(baseUrl, "responses");
  if (!url) throw new Error("Codex baseUrl 无效");
  const auth = buildBearerAuthHeader(apiKey);
  if (!auth) throw new Error("Codex apiKey 未配置");

  const body: any = { ...(extraBody && typeof extraBody === "object" ? extraBody : null), model, input: prompt, stream: false };
  const resp = await safeFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(extraHeaders || {}), authorization: auth },
      body: JSON.stringify(body),
      signal: buildAbortSignal(timeoutMs, abortSignal)
    },
    "Codex"
  );

  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`Codex responses 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  const json = text ? JSON.parse(text) : null;
  const out = extractResponsesText(json);
  if (!out) throw new Error("Codex responses 响应缺少 output_text/output[].content[].text");
  return out;
}

export async function* codexResponsesStreamEvents({
  baseUrl,
  apiKey,
  model,
  prompt,
  timeoutMs,
  abortSignal,
  extraHeaders,
  extraBody
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, any>;
}): AsyncGenerator<ByokStreamEvent> {
  const url = joinBaseUrl(baseUrl, "responses");
  if (!url) throw new Error("Codex baseUrl 无效");
  const auth = buildBearerAuthHeader(apiKey);
  if (!auth) throw new Error("Codex apiKey 未配置");

  const body: any = { ...(extraBody && typeof extraBody === "object" ? extraBody : null), model, input: prompt, stream: true };
  const resp = await safeFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(extraHeaders || {}), authorization: auth },
      body: JSON.stringify(body),
      signal: buildAbortSignal(timeoutMs, abortSignal)
    },
    "Codex"
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Codex responses stream 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  }

  let reasoning = "";
  let usageInputTokens: number | undefined;
  let usageOutputTokens: number | undefined;
  let usageCacheReadInputTokens: number | undefined;
  let usageCacheCreationInputTokens: number | undefined;
  for await (const ev of parseSse(resp)) {
    const data = ev.data;
    if (!data) continue;
    if (data === "[DONE]") break;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const usage = json?.response?.usage ?? json?.usage;
    if (usage && typeof usage === "object") {
      const inputTokens = Number((usage as any).input_tokens ?? (usage as any).inputTokens ?? (usage as any).prompt_tokens ?? (usage as any).promptTokens);
      const outputTokens = Number((usage as any).output_tokens ?? (usage as any).outputTokens ?? (usage as any).completion_tokens ?? (usage as any).completionTokens);
      const cacheReadInputTokens = Number((usage as any).cache_read_input_tokens ?? (usage as any).cacheReadInputTokens);
      const cacheCreationInputTokens = Number((usage as any).cache_creation_input_tokens ?? (usage as any).cacheCreationInputTokens);
      if (Number.isFinite(inputTokens)) usageInputTokens = inputTokens;
      if (Number.isFinite(outputTokens)) usageOutputTokens = outputTokens;
      if (Number.isFinite(cacheReadInputTokens)) usageCacheReadInputTokens = cacheReadInputTokens;
      if (Number.isFinite(cacheCreationInputTokens)) usageCacheCreationInputTokens = cacheCreationInputTokens;
    }
    const t = getEventType(ev, json);
    if (!t) continue;
    if (t === "response.reasoning_summary.delta" || t === "response.reasoning.delta") {
      const delta = readTextDeltaFromAny(json);
      if (delta) reasoning += delta;
      continue;
    }
    if (t === "response.output_text.delta" || t === "response.output_text" || t === "response.output_text.done") {
      const delta = readTextDeltaFromAny(json);
      if (delta) yield { kind: "text", text: delta };
      continue;
    }
    if (t === "response.completed") break;
    if (t === "response.output_item.done" || t === "response.output_item.added") continue;
    if (t === "response.error") {
      const msg = typeof json?.error?.message === "string" ? json.error.message : typeof json?.message === "string" ? json.message : "";
      throw new Error(`Codex responses stream 错误: ${msg || "unknown"}`.trim());
    }
  }
  if (reasoning.trim()) yield { kind: "thinking", summary: reasoning };
  if ([usageInputTokens, usageOutputTokens, usageCacheReadInputTokens, usageCacheCreationInputTokens].some((x) => typeof x === "number")) {
    yield { kind: "token_usage", inputTokens: usageInputTokens, outputTokens: usageOutputTokens, cacheReadInputTokens: usageCacheReadInputTokens, cacheCreationInputTokens: usageCacheCreationInputTokens };
  }
}

export async function codexListModels({
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
  if (!url) throw new Error("Codex baseUrl 无效");
  const auth = buildBearerAuthHeader(apiKey);
  if (!auth) throw new Error("Codex apiKey 未配置");

  const resp = await safeFetch(url, { method: "GET", headers: { authorization: auth }, signal: buildAbortSignal(timeoutMs, abortSignal) }, "Codex");
  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`Codex models 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  const json = text ? JSON.parse(text) : null;
  const data = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : null;
  if (!data) throw new Error("Codex models 响应缺少 data[]/models[]");
  const models = data.map((m: any) => (m && typeof m.id === "string" ? m.id : typeof m.name === "string" ? m.name : "")).filter(Boolean);
  models.sort();
  return models;
}

export async function codexChatCompleteWithTools({
  baseUrl,
  apiKey,
  model,
  messages,
  tools,
  timeoutMs,
  abortSignal,
  extraHeaders,
  extraBody
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: any[];
  tools: OpenAiTool[];
  timeoutMs: number;
  abortSignal?: AbortSignal;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, any>;
}): Promise<OpenAiChatCompleteWithToolsResult> {
  const url = joinBaseUrl(baseUrl, "chat/completions");
  if (!url) throw new Error("Codex baseUrl 无效");
  const auth = buildBearerAuthHeader(apiKey);
  if (!auth) throw new Error("Codex apiKey 未配置");

  const body: any = { ...(extraBody && typeof extraBody === "object" ? extraBody : null), model, messages, tools, tool_choice: "auto", stream: false };
  const resp = await safeFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(extraHeaders || {}), authorization: auth },
      body: JSON.stringify(body),
      signal: buildAbortSignal(timeoutMs, abortSignal)
    },
    "Codex"
  );

  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`Codex chat/completions 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  const json = text ? JSON.parse(text) : null;
  const msg = json?.choices?.[0]?.message;
  const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls.filter((c: any) => c && typeof c.id === "string" && c.function && typeof c.function.name === "string") : [];
  if (toolCalls.length) return { kind: "tool_calls", toolCalls, assistantText: typeof msg?.content === "string" ? msg.content : "" };
  const content = msg?.content;
  if (typeof content !== "string") throw new Error("Codex chat/completions 响应缺少 choices[0].message.content/tool_calls");
  return { kind: "final", text: content };
}

export async function* codexChatStreamEventsWithTools({
  baseUrl,
  apiKey,
  model,
  messages,
  tools,
  timeoutMs,
  abortSignal,
  extraHeaders,
  extraBody
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: any[];
  tools?: OpenAiTool[];
  timeoutMs: number;
  abortSignal?: AbortSignal;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, any>;
}): AsyncGenerator<ByokStreamEvent> {
  const url = joinBaseUrl(baseUrl, "chat/completions");
  if (!url) throw new Error("Codex baseUrl 无效");
  const auth = buildBearerAuthHeader(apiKey);
  if (!auth) throw new Error("Codex apiKey 未配置");

  const body: any = { ...(extraBody && typeof extraBody === "object" ? extraBody : null), model, messages, stream: true };
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const resp = await safeFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(extraHeaders || {}), authorization: auth },
      body: JSON.stringify(body),
      signal: buildAbortSignal(timeoutMs, abortSignal)
    },
    "Codex"
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Codex chat/completions stream 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  }
  yield* parseChatCompletionsSseByokEvents(resp);
}
