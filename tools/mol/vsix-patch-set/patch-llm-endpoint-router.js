#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_llm_endpoint_router_patched";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeEndpoint(ep) {
  const s = typeof ep === "string" ? ep.trim() : "";
  return s.replace(/^\/+/, "");
}

function findMatchIndexes(src, re, label) {
  const matches = Array.from(src.matchAll(re));
  if (matches.length === 0) throw new Error(`${label} needle not found (upstream may have changed): matched=0`);
  const indexes = matches.map((m) => m.index).filter((i) => typeof i === "number" && i >= 0);
  if (indexes.length !== matches.length) throw new Error(`${label} needle match missing index`);
  return indexes.sort((a, b) => a - b);
}

function injectIntoAsyncMethods(src, methodName, injection) {
  const indexes = findMatchIndexes(src, new RegExp(`async\\s+${methodName}\\s*\\(`, "g"), methodName);
  let out = src;
  for (let i = indexes.length - 1; i >= 0; i--) {
    const idx = indexes[i];
    const openBrace = out.indexOf("{", idx);
    if (openBrace < 0) throw new Error(`${methodName} patch: failed to locate method body opening brace`);
    out = out.slice(0, openBrace + 1) + injection + out.slice(openBrace + 1);
  }
  return { out, count: indexes.length };
}

function patchLlmEndpointRouter(filePath, { llmEndpoints }) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const endpoints = Array.isArray(llmEndpoints) ? llmEndpoints.map(normalizeEndpoint).filter(Boolean) : [];
  if (endpoints.length === 0) throw new Error("llmEndpoints empty");

  const endpointsLiteral = JSON.stringify(endpoints);

  const streamInjection =
    `const __byok_cfg=arguments[1]||{};const __byok_ep=typeof arguments[2]==\"string\"?arguments[2].replace(/^\\/+/,\"\"):\"\";` +
    `const __byok_set=(globalThis.__augment_byok_llm_endpoints_set??=new Set(${endpointsLiteral}));` +
    `if(__byok_set.has(__byok_ep)){const __byok_res=await require(\"./byok/coord/byok-routing/llm-router\").maybeHandleCallApiStream({requestId:arguments[0],endpoint:__byok_ep,body:arguments[3],transform:arguments[4],timeoutMs:arguments[6],abortSignal:arguments[8],upstreamBaseUrl:arguments[5],upstreamApiToken:__byok_cfg.apiToken});if(__byok_res!==void 0)return __byok_res;}`;

  const apiInjection =
    `const __byok_cfg=arguments[1]||{};const __byok_ep=typeof arguments[2]==\"string\"?arguments[2].replace(/^\\/+/,\"\"):\"\";` +
    `const __byok_set=(globalThis.__augment_byok_llm_endpoints_set??=new Set(${endpointsLiteral}));` +
    `if(__byok_set.has(__byok_ep)){const __byok_res=await require(\"./byok/coord/byok-routing/llm-router\").maybeHandleCallApi({requestId:arguments[0],endpoint:__byok_ep,body:arguments[3],transform:arguments[4],timeoutMs:arguments[6],abortSignal:arguments[8],upstreamBaseUrl:arguments[5],upstreamApiToken:(arguments[10]??__byok_cfg.apiToken)});if(__byok_res!==void 0)return __byok_res;}`;

  let next = original;
  const streamRes = injectIntoAsyncMethods(next, "callApiStream", streamInjection);
  next = streamRes.out;
  const apiRes = injectIntoAsyncMethods(next, "callApi", apiInjection);
  next = apiRes.out;

  next = ensureMarker(next, MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched", endpoints: endpoints.length, callApiStreamPatched: streamRes.count, callApiPatched: apiRes.count };
}

module.exports = { patchLlmEndpointRouter };

if (require.main === module) {
  const repoRoot = path.resolve(__dirname, "../../..");
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  const llm = readJson(path.join(repoRoot, "config", "byok-routing", "llm-endpoints.json"));
  patchLlmEndpointRouter(p, { llmEndpoints: llm?.endpoints });
}
