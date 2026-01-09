import { loadByokConfigRaw, loadByokConfigResolved } from "../../mol/byok-storage/byok-config";
import { getCachedProviderModels, saveCachedProviderModels } from "../../mol/byok-routing/provider-models-cache";
import { AUGMENT_BYOK } from "../../constants";
import type { ByokResolvedConfigV2, ByokResolvedProvider, ByokRoutingRule } from "../../types";
import { buildAbortSignal, buildBearerAuthHeader, joinBaseUrl, normalizeEndpoint, normalizeString } from "../../atom/common/http";
import { asRecord } from "../../atom/common/object";
import { anthropicComplete, anthropicCompleteWithTools, anthropicListModels, anthropicStream, type AnthropicTool } from "../../atom/byok-providers/anthropic-native";
import { openAiChatComplete, openAiChatCompleteWithTools, openAiChatStream, openAiListModels, type OpenAiTool } from "../../atom/byok-providers/openai-compatible";

const BYOK_REQUEST_TIMEOUT_MS = 120_000;
const BYOK_MODELS_TIMEOUT_MS = 12_000;

function tryParseJsonObject(v: unknown): Record<string, any> | null {
  if (!v) return null;
  if (typeof v === "object") return v as Record<string, any>;
  if (typeof v !== "string") return null;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function snakeToCamelKey(k: string): string {
  if (!k.includes("_")) return k;
  return k.replace(/_([a-z0-9])/g, (_, c) => String(c).toUpperCase());
}

function withCamelAliases(flags: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...flags };
  for (const [k, v] of Object.entries(flags)) {
    const ck = snakeToCamelKey(k);
    if (ck !== k && !Object.prototype.hasOwnProperty.call(out, ck)) out[ck] = v;
  }
  return out;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal || !signal.aborted) return;
  const reason = (signal as any).reason;
  const msg = typeof reason === "string" && reason.trim() ? reason.trim() : "Aborted";
  const DomExceptionCtor = (globalThis as any).DOMException;
  if (typeof DomExceptionCtor === "function") throw new DomExceptionCtor(msg, "AbortError");
  const err: any = new Error(msg);
  err.name = "AbortError";
  throw err;
}

async function fetchAugmentGetModels({
  baseUrl,
  token,
  timeoutMs,
  abortSignal
}: {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<any> {
  const url = joinBaseUrl(baseUrl, "get-models");
  if (!url) throw new Error("Augment baseUrl 无效");
  const auth = buildBearerAuthHeader(token);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  let resp: Response;
  try {
    resp = await fetch(url, { method: "POST", headers, body: "{}", signal: buildAbortSignal(timeoutMs, abortSignal) });
  } catch (err) {
    if (err && typeof err === "object" && (err as any).name === "AbortError") throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`get-models fetch 失败: ${msg} (url=${url})`);
  }
  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`get-models 请求失败: ${resp.status} ${text.slice(0, 200)}`.trim());
  const json = text ? JSON.parse(text) : null;
  if (!json || typeof json !== "object") throw new Error("get-models 响应不是 JSON 对象");
  return json;
}

async function listProviderModels(provider: ByokResolvedProvider, timeoutMs: number): Promise<string[]> {
  const baseUrl = normalizeString(provider.baseUrl);
  if (!baseUrl) throw new Error(`Provider(${provider.id}) 缺少 baseUrl`);
  const apiKey = normalizeString(provider.secrets.apiKey || provider.secrets.token || "");
  if (!apiKey) throw new Error(`Provider(${provider.id}) 缺少 apiKey/token`);
  if (provider.type === "openai_compatible") return await openAiListModels({ baseUrl, apiKey, timeoutMs });
  if (provider.type === "anthropic_native") return await anthropicListModels({ baseUrl, apiKey, timeoutMs });
  throw new Error(`未知 Provider type: ${String((provider as any).type)}`);
}

function isChatEndpoint(endpoint: string): boolean {
  return endpoint === "chat" || endpoint === "chat-stream";
}

function getRoutingRule(cfg: ByokResolvedConfigV2, endpoint: string): ByokRoutingRule | null {
  const rules = cfg.routing?.rules && typeof cfg.routing.rules === "object" ? cfg.routing.rules : null;
  const v = rules && typeof (rules as any)[endpoint] === "object" ? (rules as any)[endpoint] : null;
  return v ? (v as ByokRoutingRule) : null;
}

function throwIfDisabledEndpoint(cfg: ByokResolvedConfigV2, endpoint: string): void {
  const rule = getRoutingRule(cfg, endpoint);
  if (rule?.enabled === false) throw new Error(`BYOK 已禁用的 endpoint: ${endpoint}`);
}

function parseByokModelId(model: string): { providerId: string; modelId: string } | null {
  const raw = normalizeString(model);
  if (!raw.startsWith("byok:")) return null;
  const rest = raw.slice("byok:".length);
  const idx = rest.indexOf(":");
  if (idx <= 0 || idx >= rest.length - 1) throw new Error(`BYOK modelId 格式错误：${raw}`);
  const providerId = rest.slice(0, idx);
  const modelId = rest.slice(idx + 1);
  if (!providerId || !modelId) throw new Error(`BYOK modelId 格式错误：${raw}`);
  return { providerId, modelId };
}

function pickActiveProvider(cfg: ByokResolvedConfigV2): ByokResolvedProvider {
  const providerId = normalizeString(cfg.routing?.activeProviderId) || normalizeString(cfg.providers[0]?.id);
  const p = (providerId && cfg.providers.find((x) => x.id === providerId)) || cfg.providers[0];
  if (!p) throw new Error("未配置任何 Provider");
  return p;
}

function getProviderById(cfg: ByokResolvedConfigV2, providerId: string): ByokResolvedProvider {
  const pid = normalizeString(providerId);
  const p = cfg.providers.find((x) => x.id === pid);
  if (!p) throw new Error(`未找到 Provider: ${pid}`);
  return p;
}

function resolveProviderAndModel(cfg: ByokResolvedConfigV2, endpoint: string, requestModel: string): { provider: ByokResolvedProvider; model: string } {
  const rule = getRoutingRule(cfg, endpoint);

  if (isChatEndpoint(endpoint)) {
    const parsed = normalizeString(requestModel) ? parseByokModelId(requestModel) : null;
    if (parsed) return { provider: getProviderById(cfg, parsed.providerId), model: parsed.modelId };
    const provider = pickActiveProvider(cfg);
    const model = normalizeString(provider.defaultModel);
    if (!model) throw new Error(`Provider(${provider.id}) 缺少 defaultModel（chat 未选择 byok model）`);
    return { provider, model };
  }

  const routedModel = normalizeString(rule?.model);
  if (routedModel) {
    const parsed = parseByokModelId(routedModel);
    if (parsed) return { provider: getProviderById(cfg, parsed.providerId), model: parsed.modelId };
  }

  const providerId = normalizeString(rule?.providerId);
  const provider = providerId ? getProviderById(cfg, providerId) : pickActiveProvider(cfg);
  if (routedModel) return { provider, model: routedModel };

  const model = normalizeString(provider.defaultModel);
  if (!model) throw new Error(`Provider(${provider.id}) 缺少 defaultModel（routing.rules[${endpoint}].model 为空且 defaultModel 未配置）`);
  return { provider, model };
}

function buildSystemText(body: Record<string, any>): string {
  const parts: string[] = [];
  const pushLines = (label: string, v: any) => {
    if (typeof v === "string" && v.trim()) parts.push(`${label}:\n${v.trim()}`);
    else if (Array.isArray(v) && v.length) parts.push(`${label}:\n${v.map((x) => String(x)).join("\n")}`);
  };
  pushLines("User Guidelines", body.user_guidelines);
  pushLines("Workspace Guidelines", body.workspace_guidelines);
  pushLines("Rules", body.rules);
  return parts.join("\n\n").trim();
}

function buildUserText(body: Record<string, any>): string {
  const parts: string[] = [];
  const add = (label: string, v: any) => {
    const s = typeof v === "string" ? v : v == null ? "" : String(v);
    if (!s.trim()) return;
    parts.push(`${label}:\n${s.trim()}`);
  };
  add("Path", body.path);
  add("Language", body.lang);
  add("Instruction", body.instruction);
  add("Message", body.message);
  add("Prompt", body.prompt);
  add("Prefix", body.prefix);
  add("Selected Text", body.selected_text ?? body.selected_code);
  add("Suffix", body.suffix);
  add("Diff", body.diff);
  return parts.join("\n\n").trim();
}

function stripMarkdownFences(text: string): string {
  const t = normalizeString(text);
  if (!t) return "";
  const m = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return normalizeString(m ? m[1] : t);
}

function parseJsonFromModelTextOrThrow(text: string): any {
  const raw = stripMarkdownFences(text);
  if (!raw) throw new Error("模型返回空文本");
  try {
    return JSON.parse(raw);
  } catch {
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(raw.slice(s, e + 1));
      } catch {
        // fall through
      }
    }
    throw new Error(`模型返回的 JSON 无法解析: ${raw.replace(/\s+/g, " ").slice(0, 200)}`.trim());
  }
}

function truncateInlineText(v: unknown, maxLen: number): string {
  const s = normalizeString(v);
  if (!s) return "";
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen) + "…";
}

function formatNextEditEventsForPrompt(v: unknown, { maxFiles = 6, maxEditsPerFile = 6 }: { maxFiles?: number; maxEditsPerFile?: number } = {}): string {
  const events = Array.isArray(v) ? v : [];
  const lines: string[] = [];
  for (const ev of events.slice(0, maxFiles)) {
    const r = (asRecord(ev) as any) || {};
    const p = truncateInlineText(r.path, 200) || "(unknown)";
    const edits = Array.isArray(r.edits) ? r.edits : [];
    lines.push(`- file: ${p} edits=${edits.length}`);
    for (const ed of edits.slice(0, maxEditsPerFile)) {
      const e = (asRecord(ed) as any) || {};
      const afterStart = Number(e.after_start);
      const beforeStart = Number(e.before_start);
      const afterStr = Number.isFinite(afterStart) ? String(afterStart) : "?";
      const beforeStr = Number.isFinite(beforeStart) ? String(beforeStart) : "?";
      const beforeText = truncateInlineText(e.before_text, 200);
      const afterText = truncateInlineText(e.after_text, 200);
      lines.push(`  - edit: after_start=${afterStr} before_start=${beforeStr} before="${beforeText}" after="${afterText}"`);
    }
  }
  return lines.join("\n").trim();
}

function normalizeNextEditLocationCandidates(v: unknown, { fallbackPath, maxCount }: { fallbackPath: string; maxCount: number }): any[] {
  const raw = Array.isArray(v) ? v : [];
  const out: any[] = [];
  for (const c of raw) {
    const r = (asRecord(c) as any) || {};
    const item = (asRecord(r.item) as any) || {};
    const range = (asRecord(item.range) as any) || {};
    const path = normalizeString(item.path) || fallbackPath;
    const start = Number(range.start);
    const stop = Number(range.stop);
    if (!path) continue;
    if (!Number.isFinite(start) || start < 0) continue;
    if (!Number.isFinite(stop) || stop <= start) continue;
    const score = Number(r.score);
    const debug_info = truncateInlineText(r.debug_info ?? r.debugInfo, 200);
    out.push({ item: { path, range: { start, stop } }, score: Number.isFinite(score) ? score : 0, debug_info });
    if (out.length >= maxCount) break;
  }
  return out;
}

function normalizeRequestId(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function getToolingOrThrow(): { toolsModel: any; chatModel: any } {
  const tooling = (globalThis as any).__augment_byok_tooling;
  const toolsModel = tooling?.toolsModel;
  const chatModel = tooling?.chatModel;
  if (!toolsModel || !chatModel) throw new Error("BYOK 工具系统未就绪（请先打开一次 Augment 主面板以完成初始化）");
  return { toolsModel, chatModel };
}

function getChatHistory(body: Record<string, any>): any[] {
  const v = body.chat_history ?? body.chatHistory;
  return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
}

function getConversationId(body: Record<string, any>): string {
  return normalizeString(body.conversation_id ?? body.conversationId ?? "");
}

function normalizeChatHistoryPairs(history: any[]): Array<{ user: string; assistant: string }> {
  const out: Array<{ user: string; assistant: string }> = [];
  for (const ex of history) {
    const r = (asRecord(ex) as any) || {};
    const user = normalizeString(r.request_message ?? r.requestMessage ?? r.message ?? "");
    const assistant = normalizeString(r.response_text ?? r.responseText ?? r.response ?? r.text ?? "");
    if (!user && !assistant) continue;
    out.push({ user, assistant });
  }
  return out;
}

function getToolDefinitions(body: Record<string, any>): any[] {
  const defs = Array.isArray(body.tool_definitions) ? body.tool_definitions : Array.isArray(body.toolDefinitions) ? body.toolDefinitions : [];
  return defs.filter((d) => d && typeof d === "object" && typeof (d as any).name === "string");
}

function parseToolInputSchema(toolDef: any): Record<string, any> {
  const name = normalizeString(toolDef?.name);
  const raw = normalizeString(toolDef?.input_schema_json);
  if (!raw) return { type: "object", properties: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, any>;
  } catch {
    // ignore
  }
  throw new Error(`Tool(${name || "unknown"}) input_schema_json 不是合法 JSON 对象`);
}

function toOpenAiTools(toolDefs: any[]): OpenAiTool[] {
  return toolDefs.map((d) => ({
    type: "function",
    function: { name: normalizeString(d.name), description: normalizeString(d.description) || undefined, parameters: parseToolInputSchema(d) }
  }));
}

function toAnthropicTools(toolDefs: any[]): AnthropicTool[] {
  return toolDefs.map((d) => ({ name: normalizeString(d.name), description: normalizeString(d.description) || undefined, input_schema: parseToolInputSchema(d) }));
}

function toolUseNode({ id, toolUseId, toolName, inputJson }: { id: number; toolUseId: string; toolName: string; inputJson: string }): any {
  return { id, type: 5, tool_use: { tool_use_id: toolUseId, tool_name: toolName, input_json: inputJson } };
}

async function runAugmentTool({
  toolsModel,
  chatModel,
  chatRequestId,
  toolUseId,
  toolName,
  input,
  chatHistory,
  conversationId
}: {
  toolsModel: any;
  chatModel: any;
  chatRequestId: string;
  toolUseId: string;
  toolName: string;
  input: any;
  chatHistory: any[];
  conversationId?: string;
}): Promise<{ text: string; isError: boolean }> {
  if (typeof toolsModel?.findToolDefinitionByName !== "function" || typeof toolsModel?.callTool !== "function") throw new Error("BYOK 工具系统异常：toolsModel 未暴露 findToolDefinitionByName/callTool");
  if (typeof chatModel?.hydrateChatHistory !== "function" || typeof chatModel?.limitChatHistory !== "function") throw new Error("BYOK 工具系统异常：chatModel 未暴露 hydrateChatHistory/limitChatHistory");
  if (typeof chatModel?.onPreToolUse !== "function" || typeof chatModel?.onPostToolUse !== "function") throw new Error("BYOK 工具系统异常：chatModel 未暴露 onPreToolUse/onPostToolUse");

  const toolDef = (await toolsModel.findToolDefinitionByName(toolName))?.definition;
  const pre = await chatModel.onPreToolUse(toolName, input, conversationId, toolDef);
  if (!(pre?.shouldContinue ?? true)) {
    const msg = pre?.blockingMessage ? `${pre.blockingMessage}\n\nPreToolUse:${toolName} hook returned blocking error` : `Tool execution blocked by hook: ${toolName}`;
    return { text: msg, isError: true };
  }
  const hydrated = await chatModel.hydrateChatHistory(chatHistory);
  const limited = chatModel.limitChatHistory(hydrated);
  const out = await toolsModel.callTool(chatRequestId, toolUseId, toolName, input, limited, conversationId);
  const post = await chatModel.onPostToolUse(toolName, input, out?.text, out?.isError ? out?.text : undefined, conversationId, toolDef);
  if (post?.agentMessages?.length && out && typeof out.text === "string") out.text = `${out.text}\n\n[Hook Context]\n${post.agentMessages.join("\n")}`;
  const rawIsError = out?.isError;
  const isError =
    typeof rawIsError === "boolean"
      ? rawIsError
      : typeof rawIsError === "number"
        ? rawIsError !== 0
        : typeof rawIsError === "string"
          ? ["true", "1", "yes"].includes(rawIsError.trim().toLowerCase())
          : false;
  return { text: normalizeString(out?.text), isError };
}

async function completeText({
  provider,
  model,
  system,
  user,
  temperature,
  maxTokens,
  timeoutMs,
  abortSignal
}: {
  provider: ByokResolvedProvider;
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const m = normalizeString(model) || normalizeString(provider.defaultModel);
  if (!m) throw new Error(`Provider(${provider.id}) 缺少 model（defaultModel 未配置且请求未指定 model）`);
  const baseUrl = normalizeString(provider.baseUrl);
  if (!baseUrl) throw new Error(`Provider(${provider.id}) 缺少 baseUrl`);
  const apiKey = normalizeString(provider.secrets.apiKey || provider.secrets.token || "");
  if (!apiKey) throw new Error(`Provider(${provider.id}) 缺少 apiKey/token`);

  if (provider.type === "openai_compatible") {
    return await openAiChatComplete({
      baseUrl,
      apiKey,
      model: m,
      messages: system ? [{ role: "system", content: system }, { role: "user", content: user }] : [{ role: "user", content: user }],
      temperature,
      maxTokens,
      timeoutMs,
      abortSignal
    });
  }

  if (provider.type === "anthropic_native") {
    const mt = typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : 1024;
    return await anthropicComplete({
      baseUrl,
      apiKey,
      model: m,
      system: system || undefined,
      messages: [{ role: "user", content: user }],
      temperature,
      maxTokens: mt,
      timeoutMs,
      abortSignal
    });
  }

  throw new Error(`未知 Provider type: ${String((provider as any).type)}`);
}

async function* streamText({
  provider,
  model,
  system,
  user,
  temperature,
  maxTokens,
  timeoutMs,
  abortSignal
}: {
  provider: ByokResolvedProvider;
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): AsyncGenerator<string> {
  const m = normalizeString(model) || normalizeString(provider.defaultModel);
  if (!m) throw new Error(`Provider(${provider.id}) 缺少 model（defaultModel 未配置且请求未指定 model）`);
  const baseUrl = normalizeString(provider.baseUrl);
  if (!baseUrl) throw new Error(`Provider(${provider.id}) 缺少 baseUrl`);
  const apiKey = normalizeString(provider.secrets.apiKey || provider.secrets.token || "");
  if (!apiKey) throw new Error(`Provider(${provider.id}) 缺少 apiKey/token`);

  if (provider.type === "openai_compatible") {
    yield* openAiChatStream({
      baseUrl,
      apiKey,
      model: m,
      messages: system ? [{ role: "system", content: system }, { role: "user", content: user }] : [{ role: "user", content: user }],
      temperature,
      maxTokens,
      timeoutMs,
      abortSignal
    });
    return;
  }

  if (provider.type === "anthropic_native") {
    const mt = typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : 1024;
    yield* anthropicStream({
      baseUrl,
      apiKey,
      model: m,
      system: system || undefined,
      messages: [{ role: "user", content: user }],
      temperature,
      maxTokens: mt,
      timeoutMs,
      abortSignal
    });
    return;
  }

  throw new Error(`未知 Provider type: ${String((provider as any).type)}`);
}

function getContextOrThrow(): any {
  const ctx = (globalThis as any)[AUGMENT_BYOK.extensionContextGlobalKey];
  if (!ctx) throw new Error("BYOK 未初始化：缺少 extension context");
  return ctx;
}

async function getConfigIfEnabled(): Promise<ByokResolvedConfigV2 | null> {
  const context = getContextOrThrow();
  const raw = await loadByokConfigRaw({ context });
  if (raw.enabled !== true) return null;
  return await loadByokConfigResolved({ context });
}

export async function maybeHandleCallApi({
  requestId,
  endpoint,
  body,
  transform,
  timeoutMs,
  abortSignal,
  upstreamBaseUrl,
  upstreamApiToken
}: {
  requestId?: unknown;
  endpoint: unknown;
  body: unknown;
  transform: (raw: any) => any;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  upstreamBaseUrl?: unknown;
  upstreamApiToken?: unknown;
}): Promise<any | undefined> {
  const ep = normalizeEndpoint(endpoint);
  const request = (asRecord(body) as any) || {};
  const requestModel = normalizeString(request.model || request.model_id || request.modelId);

  if (ep === "get-models") {
    throwIfAborted(abortSignal);
    const ctx = getContextOrThrow();
    const raw = await loadByokConfigRaw({ context: ctx });
    if (raw.enabled !== true) return undefined;
    const cfg = await loadByokConfigResolved({ context: ctx });
    throwIfDisabledEndpoint(cfg, ep);
    const baseUrl = normalizeString(cfg.proxy.baseUrl) || normalizeString(upstreamBaseUrl);
    const token = normalizeString(cfg.proxy.token || "") || normalizeString(upstreamApiToken);
    let upstream: any = null;
    if (baseUrl && token) {
      try {
        upstream = await fetchAugmentGetModels({ baseUrl, token, timeoutMs: BYOK_MODELS_TIMEOUT_MS, abortSignal });
      } catch (err) {
        console.warn(`[BYOK] get-models 透传失败：${err instanceof Error ? err.message : String(err)}`);
        upstream = null;
      }
    }

    const upstreamFlagsRaw = tryParseJsonObject((upstream as any)?.feature_flags) || {};
    const upstreamFlags = withCamelAliases(upstreamFlagsRaw);
    if (!cfg.providers.length) throw new Error("未配置任何 Provider");

    const byokModelRegistry: Record<string, any> = {};
    const byokModelInfoRegistry: Record<string, any> = {};
    const activeProvider = pickActiveProvider(cfg);
    for (const p of [activeProvider, ...cfg.providers.filter((x) => x.id !== activeProvider.id)]) {
      let modelsRaw: string[] = [];
      try {
        const cached = await getCachedProviderModels({ context: ctx, providerId: p.id, baseUrl: p.baseUrl });
        modelsRaw = cached?.models?.length ? cached.models : await listProviderModels(p, BYOK_MODELS_TIMEOUT_MS);
        if (modelsRaw.length && !cached?.models?.length) await saveCachedProviderModels({ context: ctx, providerId: p.id, baseUrl: p.baseUrl, models: modelsRaw });
      } catch (err) {
        console.warn(`[BYOK] Provider(${p.id}) models 获取失败：${err instanceof Error ? err.message : String(err)}`);
      }
      const fallback = normalizeString(p.defaultModel);
      const models = (() => {
        const out: string[] = [];
        const seen = new Set<string>();
        const push = (v: string) => {
          const m = normalizeString(v);
          if (!m || seen.has(m)) return;
          seen.add(m);
          out.push(m);
        };
        if (fallback) push(fallback);
        for (const m of modelsRaw) push(m);
        return out;
      })();
      if (!models.length) continue;
      for (const m of models) {
        const modelId = normalizeString(m);
        if (!modelId) continue;
        const byokId = `byok:${p.id}:${modelId}`;
        const displayName = `${p.id}: ${modelId}`;
        byokModelRegistry[displayName] = byokId;
        byokModelInfoRegistry[byokId] = { description: "", disabled: false, displayName, shortName: displayName };
      }
    }
    if (!Object.keys(byokModelRegistry).length) throw new Error("BYOK models 为空：请检查 Provider models/defaultModel");

    const defaultChatModelId = normalizeString(activeProvider.defaultModel);
    if (!defaultChatModelId) throw new Error(`Provider(${activeProvider.id}) 缺少 defaultModel（无法生成 agentChatModel）`);
    const agentChatModel = `byok:${activeProvider.id}:${defaultChatModelId}`;

    const registryJson = JSON.stringify(byokModelRegistry);
    const infoRegistryJson = JSON.stringify(byokModelInfoRegistry);
    const models = Object.entries(byokModelRegistry).map(([, byokId]) => ({
      name: byokId,
      suggested_prefix_char_count: 0,
      suggested_suffix_char_count: 0
    }));
    const feature_flags = {
      ...upstreamFlags,
      additional_chat_models: registryJson,
      additionalChatModels: registryJson,
      agent_chat_model: agentChatModel,
      agentChatModel: agentChatModel,
      enable_model_registry: true,
      enableModelRegistry: true,
      model_registry: registryJson,
      modelRegistry: registryJson,
      model_info_registry: infoRegistryJson,
      modelInfoRegistry: infoRegistryJson
    };
    const base = upstream && typeof upstream === "object" ? upstream : { default_model: "", feature_flags: {}, languages: [], models: [], user: {}, user_tier: "unknown" };
    return transform({ ...base, default_model: agentChatModel, models, feature_flags });
  }
  const cfg = await getConfigIfEnabled();
  if (!cfg) return undefined;
  throwIfDisabledEndpoint(cfg, ep);
  if (ep === "next_edit_loc") {
    const instruction = normalizeString(request.instruction);
    const path = normalizeString(request.path);
    const numResultsRaw = Number(request.num_results ?? request.numResults);
    const numResults = Number.isFinite(numResultsRaw) ? Math.max(1, Math.min(10, Math.floor(numResultsRaw))) : 5;
    const baseSystem = buildSystemText(request);
    const baseUser = buildUserText(request);
    const editEvents = formatNextEditEventsForPrompt(request.edit_events ?? request.editEvents, { maxFiles: 6, maxEditsPerFile: 6 });

    const system = [
      `你必须只输出 JSON（不允许 Markdown/解释/代码块/额外文本）。`,
      `输出 schema：{candidate_locations:[{item:{path:string,range:{start:number,stop:number}},score:number,debug_info:string}],unknown_blob_names:[],checkpoint_not_found:false,critical_errors:[]}`,
      `range.start/range.stop 是 0-based 行号区间，要求 stop > start 且 start >= 0。`,
      `candidate_locations 数量 <= ${numResults}。`,
      baseSystem
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();

    const user = [
      baseUser,
      instruction ? `Instruction:\n${instruction}` : "",
      path ? `Path:\n${path}` : "",
      `num_results: ${numResults}`,
      editEvents ? `edit_events:\n${editEvents}` : ""
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();

    const resolved = resolveProviderAndModel(cfg, ep, requestModel);
    throwIfAborted(abortSignal);
    const jsonText = await completeText({ provider: resolved.provider, model: resolved.model, system, user, timeoutMs: BYOK_REQUEST_TIMEOUT_MS, abortSignal });
    const parsed = parseJsonFromModelTextOrThrow(jsonText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("next_edit_loc: 模型输出不是 JSON 对象");
    const candidatesRaw = (parsed as any).candidate_locations;
    const candidates = normalizeNextEditLocationCandidates(candidatesRaw, { fallbackPath: path, maxCount: numResults });
    if (!candidates.length) throw new Error("next_edit_loc: candidate_locations 为空或格式不合法");
    return transform({ candidate_locations: candidates, unknown_blob_names: [], checkpoint_not_found: false, critical_errors: [] });
  }

  if (ep !== "chat" && ep !== "completion" && ep !== "chat-input-completion" && ep !== "edit") throw new Error(`BYOK 未实现的 callApi endpoint: ${ep}`);

  const resolved = resolveProviderAndModel(cfg, ep, requestModel);
  throwIfAborted(abortSignal);
  const system = buildSystemText(request);
  const user = buildUserText(request);
  const text = await completeText({
    provider: resolved.provider,
    model: resolved.model,
    system,
    user,
    timeoutMs: BYOK_REQUEST_TIMEOUT_MS,
    abortSignal
  });

  if (ep === "completion" || ep === "chat-input-completion") {
    return transform({
      completion_items: [{ text, suffix_replacement_text: "", skipped_suffix: "" }],
      unknown_blob_names: [],
      checkpoint_not_found: false,
      suggested_prefix_char_count: 0,
      suggested_suffix_char_count: 0,
      completion_timeout_ms: 0
    });
  }

  if (ep === "edit") return transform({ text, unknown_blob_names: [], checkpoint_not_found: false });
  return transform({ text, unknown_blob_names: [], checkpoint_not_found: false, workspace_file_chunks: [], nodes: [] });
}

export async function maybeHandleCallApiStream({
  requestId,
  endpoint,
  body,
  transform,
  timeoutMs,
  abortSignal
}: {
  requestId?: unknown;
  endpoint: unknown;
  body: unknown;
  transform: (raw: any) => any;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}): Promise<AsyncGenerator<any> | undefined> {
  const ep = normalizeEndpoint(endpoint);
  const cfg = await getConfigIfEnabled();
  if (!cfg) return undefined;
  throwIfDisabledEndpoint(cfg, ep);
  const request = (asRecord(body) as any) || {};
  const system = buildSystemText(request);
  const user = buildUserText(request);
  const tmo = BYOK_REQUEST_TIMEOUT_MS;
  const requestModel = normalizeString(request.model || request.model_id || request.modelId);
  const resolved = resolveProviderAndModel(cfg, ep, requestModel);
  throwIfAborted(abortSignal);
  const resolvedProvider = resolved.provider;
  const resolvedModel = resolved.model;

  if (ep === "next-edit-stream") {
    const suggested = await completeText({ provider: resolvedProvider, model: resolvedModel, system, user, timeoutMs: tmo, abortSignal });
    const raw = {
      next_edit: {
        suggestion_id: `byok-${Date.now()}`,
        path: normalizeString(request.path),
        blob_name: normalizeString(request.blob_name),
        char_start: Number(request.selection_begin_char) || 0,
        char_end: Number(request.selection_end_char) || Number(request.selection_begin_char) || 0,
        existing_code: normalizeString(request.selected_text),
        suggested_code: suggested,
        truncation_char: null,
        change_description: "",
        diff_spans: [],
        editing_score: 1,
        localization_score: 1,
        editing_score_threshold: 1
      },
      unknown_blob_names: [],
      checkpoint_not_found: false
    };
    async function* once() {
      yield transform(raw);
    }
    return once();
  }

  if (ep === "chat-stream") {
    const toolDefs = getToolDefinitions(request);
    if (!toolDefs.length) {
      async function* gen() {
        for await (const chunk of streamText({ provider: resolvedProvider, model: resolvedModel, system, user, timeoutMs: tmo, abortSignal })) {
          throwIfAborted(abortSignal);
          yield transform({ text: chunk, unknown_blob_names: [], checkpoint_not_found: false, workspace_file_chunks: [], nodes: [] });
        }
      }
      return gen();
    }

    const { toolsModel, chatModel } = getToolingOrThrow();
    const chatHistory = getChatHistory(request);
    const historyPairs = normalizeChatHistoryPairs(chatHistory);
    const conversationId = getConversationId(request) || undefined;
    const chatRequestId = normalizeRequestId(requestId) || `byok-${Date.now()}`;

    const provider = resolvedProvider;
    const baseUrl = normalizeString(provider.baseUrl);
    if (!baseUrl) throw new Error(`Provider(${provider.id}) 缺少 baseUrl`);
    const apiKey = normalizeString(provider.secrets.apiKey || provider.secrets.token || "");
    if (!apiKey) throw new Error(`Provider(${provider.id}) 缺少 apiKey/token`);
    const model = resolvedModel;
    if (!model) throw new Error(`Provider(${provider.id}) 缺少 model`);

    async function* genTools() {
      let nodeId = 1;

      if (provider.type === "openai_compatible") {
        const tools = toOpenAiTools(toolDefs);
        let messages: any[] = [];
        if (system) messages.push({ role: "system", content: system });
        for (const h of historyPairs) {
          if (h.user) messages.push({ role: "user", content: h.user });
          if (h.assistant) messages.push({ role: "assistant", content: h.assistant });
        }
        messages.push({ role: "user", content: user });

        for (let turn = 0; turn < 25; turn++) {
          throwIfAborted(abortSignal);
          const res = await openAiChatCompleteWithTools({
            baseUrl,
            apiKey,
            model,
            messages,
            tools,
            timeoutMs: tmo,
            abortSignal
          });
          if (res.kind === "tool_calls") {
            if (res.assistantText) yield transform({ text: res.assistantText, unknown_blob_names: [], checkpoint_not_found: false, workspace_file_chunks: [], nodes: [] });
            messages = messages.concat([{ role: "assistant", content: res.assistantText || "", tool_calls: res.toolCalls }]);
            for (const tc of res.toolCalls) {
              throwIfAborted(abortSignal);
              const toolName = normalizeString(tc?.function?.name);
              const toolUseId = normalizeString(tc?.id) || `byok-tool-${Date.now()}-${nodeId}`;
              const argsRaw = tc?.function?.arguments;
              const inputJson = typeof argsRaw === "string" ? argsRaw : argsRaw && typeof argsRaw === "object" ? JSON.stringify(argsRaw) : "{}";
              let input: any;
              try {
                input = typeof argsRaw === "object" && argsRaw ? argsRaw : inputJson ? JSON.parse(inputJson) : {};
              } catch {
                throw new Error(`Tool(${toolName}) arguments 不是合法 JSON: ${inputJson.slice(0, 200)}`);
              }

              yield transform({
                text: "",
                unknown_blob_names: [],
                checkpoint_not_found: false,
                workspace_file_chunks: [],
                nodes: [toolUseNode({ id: nodeId++, toolUseId, toolName, inputJson })]
              });

              const out = await runAugmentTool({ toolsModel, chatModel, chatRequestId, toolUseId, toolName, input, chatHistory, conversationId });
              throwIfAborted(abortSignal);

              messages = messages.concat([{ role: "tool", tool_call_id: toolUseId, content: out.text }]);
            }
            continue;
          }
          yield transform({ text: res.text, unknown_blob_names: [], checkpoint_not_found: false, workspace_file_chunks: [], nodes: [] });
          return;
        }
        throw new Error("工具调用轮次过多，已中止");
      }

      if (provider.type === "anthropic_native") {
        const tools = toAnthropicTools(toolDefs);
        const maxTokens = 1024;
        let messages: any[] = [];
        for (const h of historyPairs) {
          if (h.user) messages.push({ role: "user", content: h.user });
          if (h.assistant) messages.push({ role: "assistant", content: h.assistant });
        }
        messages.push({ role: "user", content: user });

        for (let turn = 0; turn < 25; turn++) {
          throwIfAborted(abortSignal);
          const res = await anthropicCompleteWithTools({
            baseUrl,
            apiKey,
            model,
            system: system || undefined,
            messages,
            tools,
            maxTokens,
            timeoutMs: tmo,
            abortSignal
          });
          if (res.kind === "tool_calls") {
            if (res.assistantText) yield transform({ text: res.assistantText, unknown_blob_names: [], checkpoint_not_found: false, workspace_file_chunks: [], nodes: [] });
            messages = messages.concat([{ role: "assistant", content: res.contentBlocks }]);
            const toolResults: any[] = [];
            for (const tu of res.toolUses) {
              throwIfAborted(abortSignal);
              const toolName = normalizeString(tu.name);
              const toolUseId = normalizeString(tu.id) || `byok-tool-${Date.now()}-${nodeId}`;
              const inputJson = JSON.stringify(tu.input ?? {});

              yield transform({
                text: "",
                unknown_blob_names: [],
                checkpoint_not_found: false,
                workspace_file_chunks: [],
                nodes: [toolUseNode({ id: nodeId++, toolUseId, toolName, inputJson })]
              });

              const out = await runAugmentTool({ toolsModel, chatModel, chatRequestId, toolUseId, toolName, input: tu.input ?? {}, chatHistory, conversationId });
              throwIfAborted(abortSignal);

              toolResults.push({ type: "tool_result", tool_use_id: toolUseId, content: out.text, is_error: out.isError });
            }
            messages = messages.concat([{ role: "user", content: toolResults }]);
            continue;
          }
          yield transform({ text: res.text, unknown_blob_names: [], checkpoint_not_found: false, workspace_file_chunks: [], nodes: [] });
          return;
        }
        throw new Error("工具调用轮次过多，已中止");
      }

      throw new Error(`未知 Provider type: ${String((provider as any).type)}`);
    }
    return genTools();
  }

  if (
    ep === "prompt-enhancer" ||
    ep === "instruction-stream" ||
    ep === "smart-paste-stream" ||
    ep === "generate-commit-message-stream" ||
    ep === "generate-conversation-title"
  ) {
    async function* gen() {
      for await (const chunk of streamText({ provider: resolvedProvider, model: resolvedModel, system, user, timeoutMs: tmo, abortSignal })) {
        throwIfAborted(abortSignal);
        const raw =
          ep === "instruction-stream" || ep === "smart-paste-stream"
            ? { text: chunk }
            : { text: chunk, unknown_blob_names: [], checkpoint_not_found: false, workspace_file_chunks: [], nodes: [] };
        yield transform(raw);
      }
    }
    return gen();
  }

  throw new Error(`BYOK 未实现的 callApiStream endpoint: ${ep}`);
}
