#!/usr/bin/env node
"use strict";

const path = require("path");
const { rmDir } = require("../../atom/common/fs");

function parseArgs(argv) {
  const out = { all: false, deps: false, reports: false };
  for (const a of argv) {
    if (a === "--all") out.all = true;
    else if (a === "--deps") out.deps = true;
    else if (a === "--reports") out.reports = true;
  }
  return out;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const cacheDir = path.join(repoRoot, ".cache");
  const args = parseArgs(process.argv.slice(2));

  if (args.all) {
    console.log(`[clean] rm -rf ${path.relative(repoRoot, cacheDir)}`);
    rmDir(cacheDir);
    return;
  }

  const targets = [
    path.join(cacheDir, "work"),
    path.join(cacheDir, "tmp"),
    path.join(cacheDir, "upstream", "unpacked"),
    args.reports ? path.join(cacheDir, "reports") : "",
    args.deps ? path.join(cacheDir, "pnpm-store") : "",
    args.deps ? path.join(cacheDir, "npm") : "",
    args.deps ? path.join(repoRoot, ".pnpm-store") : ""
  ].filter(Boolean);

  for (const p of targets) {
    console.log(`[clean] rm -rf ${path.relative(repoRoot, p)}`);
    rmDir(p);
  }
}

main().catch((err) => {
  console.error(`[clean] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
