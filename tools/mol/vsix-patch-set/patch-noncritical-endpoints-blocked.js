#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_noncritical_endpoints_blocked_patched";

function findMatchIndexes(src, re, label) {
  const matches = Array.from(src.matchAll(re));
  if (matches.length === 0) throw new Error(`${label} needle not found (upstream may have changed): matched=0`);
  const indexes = matches.map((m) => m.index).filter((i) => typeof i === "number" && i >= 0);
  if (indexes.length !== matches.length) throw new Error(`${label} needle match missing index`);
  return indexes.sort((a, b) => a - b);
}

function injectIntoAsyncMethodBodies(src, methodName, injection) {
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

function patchNoncriticalEndpointsBlocked(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const blocked = JSON.stringify(["record-session-events", "client-metrics", "report-feature-vector", "notifications/read"]);
  const injection =
    `const __byok_ov=globalThis.__augment_byok_upstream_config_override;` +
    `if(__byok_ov&&__byok_ov.enabled===!0){` +
    `const __byok_ep2=typeof arguments[2]==\"string\"?arguments[2].replace(/^\\/+/,\"\"):\"\";` +
    `const __byok_blk=(globalThis.__augment_byok_noncritical_endpoints_set??=new Set(${blocked}));` +
    `if(__byok_blk.has(__byok_ep2)){` +
    `const __byok_payload=__byok_ep2===\"notifications/read\"?{notifications:[]}:{success:!0};` +
    `try{return typeof arguments[4]===\"function\"?arguments[4](__byok_payload):__byok_payload}catch{return __byok_payload}` +
    `}};`;

  const res = injectIntoAsyncMethodBodies(original, "callApi", injection);
  const next = ensureMarker(res.out, MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched", callApiPatched: res.count };
}

module.exports = { patchNoncriticalEndpointsBlocked };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchNoncriticalEndpointsBlocked(p);
}

