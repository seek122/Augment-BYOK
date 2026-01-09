#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_tooling_exposed";

function patchExposeTooling(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const needle = "this._toolsModel=";
  let idx = original.indexOf(needle);
  while (idx !== -1) {
    const pre = original.slice(Math.max(0, idx - 1200), idx);
    if (pre.includes("constructor(") && pre.includes("this._chatModel=")) break;
    idx = original.indexOf(needle, idx + needle.length);
  }
  if (idx === -1) throw new Error("failed to locate chat tooling assignment (needle this._toolsModel= with this._chatModel= nearby)");

  const semi = original.indexOf(";", idx);
  if (semi === -1) throw new Error("failed to locate semicolon after this._toolsModel assignment");

  const injection = `try{globalThis.__augment_byok_tooling??={};globalThis.__augment_byok_tooling.chatModel=this._chatModel;globalThis.__augment_byok_tooling.toolsModel=this._toolsModel}catch{};`;
  const patched = original.slice(0, semi + 1) + injection + original.slice(semi + 1);
  const next = ensureMarker(patched, MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched", index: idx };
}

module.exports = { patchExposeTooling };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchExposeTooling(p);
}
