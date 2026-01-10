#!/usr/bin/env node
"use strict";

const path = require("path");
const { parseArgs, cleanVscodeWorkspaceStorage, cleanVscodeGlobalStorage } = require("../../mol/vsix-build-pipeline/vscode-cache");

async function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: clean-vscode-reset.js [--apply] [--dry-run] [--channel stable|insiders|oss|codium] [--user-dir <.../User>] [--workspace <path>] [--extension-id <publisher.name>]

组合执行：
- clean-vscode-workspace-cache.js（workspaceStorage/<hash>）
- clean-vscode-augment-cache.js（globalStorage/<extension-id>）

默认 dry-run；加 --apply 才会执行删除。`);
    return;
  }

  await cleanVscodeWorkspaceStorage({ repoRoot, args });
  await cleanVscodeGlobalStorage({ args });
}

main().catch((err) => {
  console.error(`[vscode-reset] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
