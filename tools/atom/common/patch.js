#!/usr/bin/env node
"use strict";

function insertBeforeSourceMappingURL(src, snippet) {
  const s = typeof src === "string" ? src : "";
  const add = typeof snippet === "string" ? snippet : "";
  const sm = s.lastIndexOf("//# sourceMappingURL=");
  if (sm >= 0) return s.slice(0, sm) + add + s.slice(sm);
  return s + add;
}

function replaceOnceLiteral(src, from, to, label) {
  const s = typeof src === "string" ? src : "";
  const needle = typeof from === "string" ? from : "";
  const replacement = typeof to === "string" ? to : "";
  const count = needle ? s.split(needle).length - 1 : 0;
  if (count !== 1) throw new Error(`failed to locate needle (${label}) exactly once; matched=${count}`);
  return s.split(needle).join(replacement);
}

function replaceOnceRegExp(src, re, to, label) {
  const s = typeof src === "string" ? src : "";
  const replacement = typeof to === "string" ? to : "";
  const matches = Array.from(s.matchAll(re));
  if (matches.length !== 1) throw new Error(`failed to locate needle (${label}) exactly once; matched=${matches.length}`);
  return s.replace(re, replacement);
}

function ensureMarker(src, marker) {
  const m = typeof marker === "string" ? marker : "";
  if (!m) throw new Error("ensureMarker: marker is required");
  const s = typeof src === "string" ? src : "";
  if (s.includes(m)) return s;
  return insertBeforeSourceMappingURL(s, `;/*${m}*/\n`);
}

module.exports = { insertBeforeSourceMappingURL, replaceOnceLiteral, replaceOnceRegExp, ensureMarker };
