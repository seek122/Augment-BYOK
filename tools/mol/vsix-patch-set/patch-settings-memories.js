#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_settings_memories_webview_patched";

function listSettingsAssets(assetsDir) {
  try {
    return fs
      .readdirSync(assetsDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => n.startsWith("settings-") && n.endsWith(".js"))
      .map((n) => path.join(assetsDir, n));
  } catch {
    return [];
  }
}

function findMatchingParen(src, openIndex) {
  if (src[openIndex] !== "(") return -1;
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = openIndex + 1; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingle) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\\\") {
        escaped = true;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\\\") {
        escaped = true;
        continue;
      }
      if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findMatchingBrace(src, openIndex) {
  if (src[openIndex] !== "{") return -1;
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = openIndex + 1; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingle) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\\\") {
        escaped = true;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\\\") {
        escaped = true;
        continue;
      }
      if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function stripLegacyIifePatch(src) {
  const legacyNeedle = "/*__augment_byok_settings_memories_webview_patch_iife__*/";
  const i = src.indexOf(legacyNeedle);
  if (i < 0) return src;

  const afterNeedle = i + legacyNeedle.length;
  const openParen = src.indexOf("(", afterNeedle);
  if (openParen < 0) return src;
  const closeParen = findMatchingParen(src, openParen);
  if (closeParen < 0) return src;
  const after = src.slice(closeParen + 1);
  return src.slice(0, i) + after;
}

function replaceAsyncMethod(src, methodName, replacementFactory) {
  const needle = `async ${methodName}`;
  const start = src.indexOf(needle);
  if (start < 0) return { src, changed: false, reason: "not_found" };

  const openParen = src.indexOf("(", start);
  if (openParen < 0) return { src, changed: false, reason: "paren_missing" };
  const closeParen = findMatchingParen(src, openParen);
  if (closeParen < 0) return { src, changed: false, reason: "paren_unmatched" };

  const openBrace = src.indexOf("{", closeParen);
  if (openBrace < 0) return { src, changed: false, reason: "brace_missing" };
  const closeBrace = findMatchingBrace(src, openBrace);
  if (closeBrace < 0) return { src, changed: false, reason: "brace_unmatched" };

  const params = src.slice(openParen + 1, closeParen);
  const replacement = replacementFactory(params);
  const next = src.slice(0, start) + replacement + src.slice(closeBrace + 1);
  return { src: next, changed: true, reason: "patched" };
}

function patchFile(filePath, { checkOnly }) {
  const original = fs.readFileSync(filePath, "utf8");
  let src = original;

  src = stripLegacyIifePatch(src);
  const didTouchLegacyPatch = src !== original;

  const loadRes = replaceAsyncMethod(src, "loadMemoriesFile", (params) => {
    const p = params.trim() ? params : "_";
    return `async loadMemoriesFile(${p}){try{const __byokResp=await this.inOutBroker.send({type:\"load-memories-file-request\"},\"load-memories-file-response\",3e4),__byokData=__byokResp&&typeof __byokResp==\"object\"&&\"data\"in __byokResp?__byokResp.data:__byokResp,__byokPath=typeof __byokData?.path==\"string\"?__byokData.path:\"\",__byokContent=typeof __byokData?.content==\"string\"?__byokData.content:\"\",__byokError=typeof __byokData?.error==\"string\"?__byokData.error:\"\";if(!__byokPath)throw new Error(__byokError||\"Memories file path not available\");return{path:__byokPath,content:__byokContent}}catch(__byokErr){console.error(\"Error in loadMemoriesFile:\",__byokErr);throw __byokErr}}`;
  });
  src = loadRes.src;

  const saveRes = replaceAsyncMethod(src, "saveMemoriesFile", (params) => {
    const p = params.trim() ? params : "_";
    return `async saveMemoriesFile(${p}){try{const __byokArg0=arguments[0],__byokContent=typeof __byokArg0?.content==\"string\"?__byokArg0.content:\"\",__byokResp=await this.inOutBroker.send({type:\"save-memories-file-request\",data:{content:__byokContent}},\"save-memories-file-response\",3e4),__byokData=__byokResp&&typeof __byokResp==\"object\"&&\"data\"in __byokResp?__byokResp.data:__byokResp,__byokOk=__byokData?.ok,__byokError=typeof __byokData?.error==\"string\"?__byokData.error:\"\";if(__byokOk===!1)throw new Error(__byokError||\"Failed to save memories file\")}catch(__byokErr){console.error(\"Error in saveMemoriesFile:\",__byokErr);throw __byokErr}}`;
  });
  src = saveRes.src;

  const didPatchMethods = loadRes.changed || saveRes.changed;
  const shouldHavePatched = original.includes("async loadMemoriesFile") || original.includes("async saveMemoriesFile");

  const didChange = didTouchLegacyPatch || didPatchMethods;

  const patched = src.includes("load-memories-file") && src.includes("save-memories-file");
  if (checkOnly) {
    if (shouldHavePatched && !patched) throw new Error(`Settings Memories patch missing in ${path.basename(filePath)}`);
    return { filePath, changed: false, patched };
  }

  if (!didChange) return { filePath, changed: false, patched };

  src = ensureMarker(src, MARKER);
  fs.writeFileSync(filePath, src, "utf8");

  if (shouldHavePatched && !patched) throw new Error(`Patch failed for ${path.basename(filePath)} (methods not updated)`);
  return { filePath, changed: true, patched };
}

function patchSettingsMemoriesWebview({ extensionDir, checkOnly }) {
  const assetsDir = path.join(extensionDir, "common-webviews", "assets");
  const files = listSettingsAssets(assetsDir);
  if (files.length === 0) throw new Error(`no settings assets found in ${assetsDir}`);

  const results = files.map((filePath) => patchFile(filePath, { checkOnly }));
  const patchedCount = results.filter((r) => r.patched).length;

  if (checkOnly) return { ok: true, patchedCount, total: results.length };
  return { ok: true, patchedCount, total: results.length, changedCount: results.filter((r) => r.changed).length };
}

module.exports = { patchSettingsMemoriesWebview };

if (require.main === module) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const dirFlag = args.findIndex((a) => a === "--extensionDir");
  const extensionDir = dirFlag >= 0 ? args[dirFlag + 1] : null;
  if (!extensionDir) {
    console.error(`usage: ${path.basename(process.argv[1])} --extensionDir <path-to-extension/> [--check]`);
    process.exit(2);
  }
  patchSettingsMemoriesWebview({ extensionDir, checkOnly });
}
