#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_suggested_questions_content_guard_patched";
const NEEDLE = "SUGGESTED_QUESTIONS))?.content.split(";
const REPLACEMENT = "SUGGESTED_QUESTIONS))?.content?.split(";

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };
  const count = original.split(NEEDLE).length - 1;
  if (count === 0) return { changed: false, reason: "no_match" };
  const next = ensureMarker(original.split(NEEDLE).join(REPLACEMENT), MARKER);
  if (!next.includes(REPLACEMENT) || next.includes(NEEDLE) || !next.includes(MARKER)) throw new Error(`patch suggested-questions guard failed: ${path.basename(filePath)}`);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched" };
}

function patchSuggestedQuestionsContentGuard({ extensionDir }) {
  const assetsDir = path.join(extensionDir, "common-webviews", "assets");
  if (!fs.existsSync(assetsDir)) throw new Error(`missing assetsDir: ${assetsDir}`);
  const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
  let changed = 0;
  let matched = 0;
  for (const f of files) {
    const p = path.join(assetsDir, f);
    const r = patchFile(p);
    if (r.reason !== "no_match") matched += 1;
    if (r.changed) changed += 1;
  }
  if (matched === 0) throw new Error(`patch suggested-questions guard failed: needle not found in ${assetsDir}`);
  return { changed, matched, reason: "patched" };
}

module.exports = { patchSuggestedQuestionsContentGuard };

if (require.main === module) {
  const extDir = process.argv[2];
  if (!extDir) {
    console.error(`usage: ${path.basename(process.argv[1])} <extensionDir>`);
    process.exit(2);
  }
  patchSuggestedQuestionsContentGuard({ extensionDir: extDir });
}
