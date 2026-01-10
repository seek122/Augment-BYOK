#!/usr/bin/env node
"use strict";

const { parseArgs, cleanVscodeGlobalStorage } = require("../../mol/vsix-build-pipeline/vscode-cache");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: clean-vscode-augment-cache.js [--apply] [--dry-run] [--channel stable|insiders|oss|codium] [--user-dir <.../User>] [--extension-id <publisher.name>]

默认 dry-run；加 --apply 才会删除 globalStorage/<extension-id>。`);
    return;
  }
  await cleanVscodeGlobalStorage({ args });
}

main().catch((err) => {
  console.error(`[vscode-cache] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
