#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker, replaceOnceLiteral } = require("../../atom/common/patch");

const MARKER = "__augment_byok_upstream_config_override_patched";
const OVERRIDE_KEY = "__augment_byok_upstream_config_override";

function patchUpstreamConfigOverride(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const applyOverride =
    `const __byokApply=(x)=>{try{const o=globalThis&&globalThis.${OVERRIDE_KEY}?globalThis.${OVERRIDE_KEY}:null;if(!o||!o.enabled)return x;x=x&&typeof x==\"object\"?x:{};const a=x.advanced&&typeof x.advanced==\"object\"?x.advanced:{};x.advanced=a;typeof o.completionURL==\"string\"&&(a.completionURL=o.completionURL);typeof o.apiToken==\"string\"&&(a.apiToken=o.apiToken);return x}catch{return x}};`;

  const startRe = /static parseSettings\(t\)\{let r=_e\("AugmentConfigListener"\),n=[A-Za-z0-9_$]+\.safeParse\(t\);/g;
  const startMatches = Array.from(original.matchAll(startRe)).map((m) => m[0]);
  if (startMatches.length !== 1) {
    throw new Error(`failed to locate parseSettings needle (upstream may have changed): matched=${startMatches.length}`);
  }
  const startNeedle = startMatches[0];
  const startReplacement = startNeedle.replace("static parseSettings(t){", `static parseSettings(t){${applyOverride}`);
  let next = replaceOnceLiteral(original, startNeedle, startReplacement, "parseSettings.start");

  const cleanReturnNeedle = 'r.info("settings parsed successfully after cleaning"),a.data';
  next = replaceOnceLiteral(next, cleanReturnNeedle, 'r.info("settings parsed successfully after cleaning"),__byokApply(a.data)', "parseSettings.cleanReturn");

  const okReturnNeedle = 'r.info("settings parsed successfully"),n.data';
  next = replaceOnceLiteral(next, okReturnNeedle, 'r.info("settings parsed successfully"),__byokApply(n.data)', "parseSettings.okReturn");

  const out = ensureMarker(next, MARKER);
  fs.writeFileSync(filePath, out, "utf8");
  if (!out.includes(MARKER) || !out.includes("__byokApply(") || !out.includes(OVERRIDE_KEY)) throw new Error("upstream config override patch failed");
  return { changed: true, reason: "patched" };
}

module.exports = { patchUpstreamConfigOverride };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchUpstreamConfigOverride(p);
}
