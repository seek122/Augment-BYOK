#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_prompt_enhancer_third_party_override_patched";

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

function splitTopLevelCommaList(list) {
  const src = typeof list === "string" ? list : "";
  const out = [];
  let buf = "";
  let depthParen = 0;
  let depthBrack = 0;
  let depthBrace = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  const flush = () => {
    const v = buf.trim();
    if (v) out.push(v);
    buf = "";
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === "*" && next === "/") {
        buf += next;
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingle) {
      buf += ch;
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
      buf += ch;
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
      buf += ch;
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
      buf += ch + next;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      buf += ch + next;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      buf += ch;
      continue;
    }

    if (ch === "(") depthParen++;
    else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    else if (ch === "[") depthBrack++;
    else if (ch === "]") depthBrack = Math.max(0, depthBrack - 1);
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);

    if (ch === "," && depthParen === 0 && depthBrack === 0 && depthBrace === 0) {
      flush();
      continue;
    }

    buf += ch;
  }

  flush();
  return out;
}

function takeParamName(fragment) {
  const s = typeof fragment === "string" ? fragment.trim() : "";
  if (!s) return "";
  const eq = s.indexOf("=");
  const raw = (eq >= 0 ? s.slice(0, eq) : s).trim();
  return raw;
}

function isIdentifier(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function patchPromptEnhancerThirdPartyOverride(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const idx = original.indexOf("async callApiStream");
  if (idx < 0) throw new Error(`failed to locate "async callApiStream"`);

  const openParen = original.indexOf("(", idx);
  if (openParen < 0) throw new Error(`failed to locate callApiStream param list`);
  const closeParen = findMatchingParen(original, openParen);
  if (closeParen < 0) throw new Error(`failed to parse callApiStream param list`);

  const paramsRaw = original.slice(openParen + 1, closeParen);
  const parts = splitTopLevelCommaList(paramsRaw).map(takeParamName).filter(Boolean);
  if (parts.length < 4) throw new Error(`unexpected callApiStream param count (${parts.length})`);

  const configVar = parts[1];
  const endpointVar = parts[2];
  const bodyVar = parts[3];
  if (!isIdentifier(configVar) || !isIdentifier(endpointVar) || !isIdentifier(bodyVar)) {
    throw new Error(`unexpected callApiStream param names: config=${configVar} endpoint=${endpointVar} body=${bodyVar}`);
  }

  const openBrace = original.indexOf("{", closeParen);
  if (openBrace < 0) throw new Error(`failed to locate callApiStream body brace`);

  const injection =
    `;if(${endpointVar}===\"prompt-enhancer\"){let __byokOv=${configVar}&&${configVar}.chat&&${configVar}.chat.override?${configVar}.chat.override:null;` +
    `if(__byokOv&&typeof __byokOv===\"object\"){let __byokTpo={};` +
    `let __byokPmn=typeof __byokOv.providerModelName===\"string\"?__byokOv.providerModelName.trim():\"\";` +
    `let __byokKey=typeof __byokOv.apiKey===\"string\"?__byokOv.apiKey.trim():\"\";` +
    `let __byokBase=typeof __byokOv.baseUrl===\"string\"?__byokOv.baseUrl.trim():\"\";` +
    `if(__byokPmn)__byokTpo.provider_model_name=__byokPmn;` +
    `if(__byokKey)__byokTpo.api_key=__byokKey;` +
    `if(__byokBase)__byokTpo.base_url=__byokBase;` +
    `if(Object.keys(__byokTpo).length){${bodyVar}=${bodyVar}&&typeof ${bodyVar}===\"object\"?{...${bodyVar},third_party_override:__byokTpo}:{third_party_override:__byokTpo};}}};`;

  const patched = original.slice(0, openBrace + 1) + injection + original.slice(openBrace + 1);
  const next = ensureMarker(patched, MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched", configVar, endpointVar, bodyVar };
}

module.exports = { patchPromptEnhancerThirdPartyOverride };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchPromptEnhancerThirdPartyOverride(p);
}
