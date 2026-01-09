#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rmDir(dirPath) {
  const p = typeof dirPath === "string" ? dirPath : "";
  if (!p) return;
  const resolved = path.resolve(p);
  const root = path.parse(resolved).root;
  if (resolved === root) throw new Error(`rmDir refused to delete filesystem root: ${dirPath}`);
  if (!fs.existsSync(resolved)) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

function copyDir(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) throw new Error(`copyDir missing src: ${srcDir}`);
  if (!fs.statSync(srcDir).isDirectory()) throw new Error(`copyDir src is not a directory: ${srcDir}`);
  ensureDir(dstDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf8");
}

module.exports = { ensureDir, rmDir, copyDir, readJson, writeJson, writeText };
