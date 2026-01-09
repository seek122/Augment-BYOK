#!/usr/bin/env node
"use strict";

const path = require("path");
const { syncUpstreamLatest } = require("../../atom/vsix-upstream-sync");
const { rmDir } = require("../../atom/common/fs");

async function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const cacheDir = path.join(repoRoot, ".cache");
  const unpackDir = path.join(cacheDir, "work", "upstream-sync");
  const keepWorkDir = process.env.AUGMENT_BYOK_KEEP_WORKDIR === "1";
  await syncUpstreamLatest({ repoRoot, cacheDir, loggerPrefix: "[upstream]", unpackDir, writeMeta: false });
  if (!keepWorkDir) rmDir(unpackDir);
}

main().catch((err) => {
  console.error(`[upstream] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
