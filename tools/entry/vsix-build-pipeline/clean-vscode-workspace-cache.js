#!/usr/bin/env node
"use strict";

const path = require("path");
const { parseArgs, cleanVscodeWorkspaceStorage } = require("../../mol/vsix-build-pipeline/vscode-cache");

async function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: clean-vscode-workspace-cache.js [--apply] [--dry-run] [--channel stable|insiders|oss|codium] [--user-dir <.../User>] [--workspace <path>] [--concurrency N]

默认 dry-run；加 --apply 才会删除 workspaceStorage/<hash>。`);
    return;
  }
  await cleanVscodeWorkspaceStorage({ repoRoot, args });
}

main().catch((err) => {
  console.error(`[vscode-cache] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
