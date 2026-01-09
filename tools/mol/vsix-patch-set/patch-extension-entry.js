#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { insertBeforeSourceMappingURL } = require("../../atom/common/patch");

const MARKER = "__augment_byok_bootstrap_injected";

function findActivateVar(src) {
  const m = src.match(/activate\s*:\s*\(\)\s*=>\s*([A-Za-z0-9_$]+)/);
  if (!m) throw new Error("failed to locate exported activate var (pattern: activate:()=>VAR)");
  return m[1];
}

function patchExtensionEntry(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const activateVar = findActivateVar(original);

  const injection = `\n;require(\"./byok/entry/bootstrap-install\").install({vscode:require(\"vscode\"),getActivate:()=>${activateVar},setActivate:e=>{${activateVar}=e}})\n;/*${MARKER}*/\n`;
  const next = insertBeforeSourceMappingURL(original, injection);

  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched", activateVar };
}

module.exports = { patchExtensionEntry };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchExtensionEntry(p);
}
