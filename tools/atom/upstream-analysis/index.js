#!/usr/bin/env node
"use strict";

const { normalizePath } = require("../common/url");

function buildSnippet(src, index, radius) {
  const i = typeof index === "number" && Number.isFinite(index) ? index : 0;
  const r = typeof radius === "number" && Number.isFinite(radius) ? Math.max(24, Math.min(600, radius)) : 160;
  const start = Math.max(0, i - r);
  const end = Math.min(src.length, i + r);
  return src
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function extractUpstreamApiCallsFromExtensionJs(src) {
  const endpointDetails = {};
  const patterns = [
    { kind: "callApiStream", re: /\bcallApiStream\(\s*[^,]+,\s*[^,]+,\s*["']([^"']+)["']/g },
    { kind: "callApi", re: /\bcallApi\(\s*[^,]+,\s*[^,]+,\s*["']([^"']+)["']/g }
  ];
  for (const { kind, re } of patterns) {
    for (const m of src.matchAll(re)) {
      const ep = normalizePath(m[1]);
      if (!ep) continue;
      const cur =
        endpointDetails[ep] ||
        (endpointDetails[ep] = {
          callApi: { count: 0, samples: [] },
          callApiStream: { count: 0, samples: [] }
        });
      cur[kind].count++;
      if (cur[kind].samples.length < 2) cur[kind].samples.push(buildSnippet(src, m.index || 0, 180));
    }
  }
  const endpoints = Object.keys(endpointDetails).sort();
  return { endpoints, endpointDetails };
}

function extractContextKeysFromExtensionJs(src) {
  const out = new Set();
  const re = /["'](vscode-augment(?:\.[A-Za-z0-9_-]+)+)["']/g;
  for (const m of src.matchAll(re)) out.add(m[1]);
  return Array.from(out).sort();
}

function extractFeatureFlagKeysFromExtensionJs(src) {
  const v1 = new Set();
  const v2 = new Set();
  for (const m of src.matchAll(/\bcurrentFlags\.(\w+)\b/g)) v1.add(m[1]);
  for (const m of src.matchAll(/\bcurrentFlagsV2\.(\w+)\b/g)) v2.add(m[1]);
  return { v1: Array.from(v1).sort(), v2: Array.from(v2).sort() };
}

function extractContextToFlagsFromExtensionJs(src) {
  const out = {};
  const add = (contextKey, kind, flagKey) => {
    const ck = typeof contextKey === "string" ? contextKey : "";
    const fk = typeof flagKey === "string" ? flagKey : "";
    if (!ck || !fk) return;
    const row = out[ck] || (out[ck] = { currentFlags: [], currentFlagsV2: [] });
    const arr = kind === "currentFlagsV2" ? row.currentFlagsV2 : row.currentFlags;
    if (!arr.includes(fk)) arr.push(fk);
  };

  for (const m of src.matchAll(/["'](vscode-augment(?:\.[A-Za-z0-9_-]+)+)["']\s*:\s*[^,}]*\bcurrentFlags\.(\w+)\b/g)) add(m[1], "currentFlags", m[2]);
  for (const m of src.matchAll(/["'](vscode-augment(?:\.[A-Za-z0-9_-]+)+)["']\s*:\s*[^,}]*\bcurrentFlagsV2\.(\w+)\b/g)) add(m[1], "currentFlagsV2", m[2]);

  for (const k of Object.keys(out)) {
    out[k].currentFlags.sort();
    out[k].currentFlagsV2.sort();
  }
  return out;
}

function topSegment(endpointPath) {
  const p = normalizePath(endpointPath);
  if (!p) return "";
  const seg = p.replace(/^\/+/, "").split("/")[0] || "";
  return seg || "";
}

function groupBySegment(paths) {
  const out = {};
  for (const p of paths) {
    const seg = topSegment(p) || "(none)";
    (out[seg] || (out[seg] = [])).push(p);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])));
}

module.exports = {
  normalizePath,
  buildSnippet,
  extractUpstreamApiCallsFromExtensionJs,
  extractContextKeysFromExtensionJs,
  extractFeatureFlagKeysFromExtensionJs,
  extractContextToFlagsFromExtensionJs,
  topSegment,
  groupBySegment
};
