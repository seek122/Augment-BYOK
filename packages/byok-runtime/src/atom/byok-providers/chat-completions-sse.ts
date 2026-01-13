import { parseSse } from "../common/sse";
import type { ByokStreamEvent } from "./stream-events";

export async function* parseChatCompletionsSseByokEvents(resp: Response): AsyncGenerator<ByokStreamEvent> {
  let reasoning = "";
  let usageInputTokens: number | undefined;
  let usageOutputTokens: number | undefined;
  let usageCacheReadInputTokens: number | undefined;
  let usageCacheCreationInputTokens: number | undefined;
  const toolCallsByIndex: Array<{ id: string; name: string; args: string }> = [];
  const flushReasoning = function* (): Generator<ByokStreamEvent> {
    const r = reasoning.trim();
    if (!r) return;
    reasoning = "";
    yield { kind: "thinking", summary: r };
  };
  const flushTokenUsage = function* (): Generator<ByokStreamEvent> {
    if (![usageInputTokens, usageOutputTokens, usageCacheReadInputTokens, usageCacheCreationInputTokens].some((x) => typeof x === "number")) return;
    yield {
      kind: "token_usage",
      inputTokens: usageInputTokens,
      outputTokens: usageOutputTokens,
      cacheReadInputTokens: usageCacheReadInputTokens,
      cacheCreationInputTokens: usageCacheCreationInputTokens
    };
  };
  const flushToolCalls = function* (): Generator<ByokStreamEvent> {
    if (!toolCallsByIndex.length) return;
    const now = Date.now();
    for (let i = 0; i < toolCallsByIndex.length; i++) {
      const tc = toolCallsByIndex[i];
      if (!tc) continue;
      const toolName = typeof tc.name === "string" ? tc.name.trim() : "";
      if (!toolName) continue;
      const toolUseId = typeof tc.id === "string" && tc.id.trim() ? tc.id.trim() : `byok-tool-${now}-${i}`;
      const inputJson = typeof tc.args === "string" && tc.args.trim() ? tc.args : "{}";
      try {
        JSON.parse(inputJson);
      } catch {
        throw new Error(`Tool(${toolName}) arguments 不是合法 JSON: ${inputJson.slice(0, 200)}`);
      }
      yield { kind: "tool_use", toolUseId, toolName, inputJson };
    }
    toolCallsByIndex.length = 0;
  };

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

    const usage = json?.usage;
    if (usage && typeof usage === "object") {
      const inputTokens = Number((usage as any).prompt_tokens ?? (usage as any).promptTokens ?? (usage as any).input_tokens ?? (usage as any).inputTokens);
      const outputTokens = Number((usage as any).completion_tokens ?? (usage as any).completionTokens ?? (usage as any).output_tokens ?? (usage as any).outputTokens);
      const cacheReadInputTokens = Number(
        (usage as any).cache_read_input_tokens ??
          (usage as any).cacheReadInputTokens ??
          (usage as any).prompt_tokens_details?.cached_tokens ??
          (usage as any).promptTokensDetails?.cachedTokens
      );
      const cacheCreationInputTokens = Number((usage as any).cache_creation_input_tokens ?? (usage as any).cacheCreationInputTokens);
      if (Number.isFinite(inputTokens)) usageInputTokens = inputTokens;
      if (Number.isFinite(outputTokens)) usageOutputTokens = outputTokens;
      if (Number.isFinite(cacheReadInputTokens)) usageCacheReadInputTokens = cacheReadInputTokens;
      if (Number.isFinite(cacheCreationInputTokens)) usageCacheCreationInputTokens = cacheCreationInputTokens;
    }

    const choice = json?.choices?.[0];
    const delta = choice?.delta;
    const r = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : typeof delta?.reasoning === "string" ? delta.reasoning : "";
    if (r) reasoning += r;
    const toolCallsDelta = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
    for (const tc of toolCallsDelta) {
      const idxRaw = Number(tc?.index);
      const idx = Number.isFinite(idxRaw) && idxRaw >= 0 ? idxRaw : toolCallsByIndex.length;
      const cur = toolCallsByIndex[idx] || { id: "", name: "", args: "" };
      if (typeof tc?.id === "string") cur.id = tc.id;
      const fn = tc?.function;
      if (typeof fn?.name === "string") cur.name = fn.name;
      if (typeof fn?.arguments === "string") cur.args += fn.arguments;
      else if (fn?.arguments && typeof fn.arguments === "object") cur.args = JSON.stringify(fn.arguments);
      toolCallsByIndex[idx] = cur;
    }
    const chunk = typeof delta?.content === "string" ? delta.content : typeof delta?.text === "string" ? delta.text : "";
    if (chunk) yield { kind: "text", text: chunk };
    const finish = typeof choice?.finish_reason === "string" ? choice.finish_reason : typeof choice?.finishReason === "string" ? choice.finishReason : "";
    if (finish === "tool_calls") {
      yield* flushReasoning();
      yield* flushToolCalls();
      yield* flushTokenUsage();
      return;
    }
  }

  yield* flushReasoning();
  yield* flushToolCalls();
  yield* flushTokenUsage();
}
