#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_api_endpoint_strip_leading_slash_patched";

function patchApiEndpointStripLeadingSlash(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const needle = "new URL(n,s)";
  const replacement = 'new URL(n=typeof n=="string"?n.replace(/^\\/+/,\"\"):n,s)';
  const count = original.split(needle).length - 1;
  if (count <= 0) throw new Error(`failed to locate API URL join needle (upstream may have changed): ${needle}`);

  const next = ensureMarker(original.split(needle).join(replacement), MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched", replaced: count };
}

module.exports = { patchApiEndpointStripLeadingSlash };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchApiEndpointStripLeadingSlash(p);
}
