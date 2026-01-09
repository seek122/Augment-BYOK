#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_api_token_preserve_case_patched";

function patchApiTokenPreserveCase(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const needle = 'apiToken:(t?.advanced?.apiToken??t.apiToken??"").trim().toUpperCase()';
  if (!original.includes(needle)) {
    throw new Error(`failed to locate apiToken normalization needle (upstream may have changed): ${needle}`);
  }

  const next = ensureMarker(original.replace(needle, 'apiToken:(t?.advanced?.apiToken??t.apiToken??"").trim()'), MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched" };
}

module.exports = { patchApiTokenPreserveCase };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchApiTokenPreserveCase(p);
}
