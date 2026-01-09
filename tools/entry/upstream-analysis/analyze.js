#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { rmDir, readJson, writeJson } = require("../../atom/common/fs");
const { syncUpstreamLatest } = require("../../atom/vsix-upstream-sync");

const {
  extractContextKeysFromExtensionJs,
  extractContextToFlagsFromExtensionJs,
  extractFeatureFlagKeysFromExtensionJs,
  extractUpstreamApiCallsFromExtensionJs
} = require("../../atom/upstream-analysis");

function parseArgs(argv) {
  const args = { unpackDir: "", out: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--unpack-dir") args.unpackDir = argv[++i] || "";
    else if (a === "--out") args.out = argv[++i] || "";
  }
  return args;
}

function cleanupOldUpstreamEndpointReports({ reportsDir, keepFileName }) {
  if (!fs.existsSync(reportsDir)) return;
  for (const name of fs.readdirSync(reportsDir)) {
    if (!name.startsWith("upstream-endpoints.") || !name.endsWith(".json")) continue;
    if (name === keepFileName) continue;
    try {
      fs.rmSync(path.join(reportsDir, name), { force: true });
    } catch {
    }
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const args = parseArgs(process.argv.slice(2));

  const cacheDir = path.join(repoRoot, ".cache");
  const usingProvidedUnpackDir = Boolean(args.unpackDir);
  const unpackDir = usingProvidedUnpackDir ? path.resolve(repoRoot, args.unpackDir) : path.join(cacheDir, "work", "upstream-analysis");
  const keepWorkDir = process.env.AUGMENT_BYOK_KEEP_WORKDIR === "1";

  if (!usingProvidedUnpackDir) await syncUpstreamLatest({ repoRoot, cacheDir, loggerPrefix: "[analyze]", unpackDir, writeMeta: false });

  const extensionDir = path.join(unpackDir, "extension");
  const pkgPath = path.join(extensionDir, "package.json");
  const extensionJsPath = path.join(extensionDir, "out", "extension.js");

  if (!fs.existsSync(pkgPath) || !fs.existsSync(extensionJsPath)) {
    console.error(`[analyze] upstream unpack missing: ${path.relative(repoRoot, unpackDir)}`);
    process.exit(1);
  }

  const pkg = readJson(pkgPath);
  const version = typeof pkg.version === "string" ? pkg.version : "unknown";

  const src = fs.readFileSync(extensionJsPath, "utf8");
  const { endpoints, endpointDetails } = extractUpstreamApiCallsFromExtensionJs(src);
  const contextKeys = extractContextKeysFromExtensionJs(src);
  const featureFlags = extractFeatureFlagKeysFromExtensionJs(src);
  const contextKeyToFeatureFlags = extractContextToFlagsFromExtensionJs(src);

  const report = {
    generatedAtMs: Date.now(),
    upstream: {
      publisher: "augment",
      extension: "vscode-augment",
      version,
      unpackDir: path.relative(repoRoot, unpackDir)
    },
    endpoints,
    endpointDetails,
    contextKeys,
    featureFlags,
    contextKeyToFeatureFlags,
    stats: { endpointCount: endpoints.length, contextKeyCount: contextKeys.length, featureFlagKeyCount: { v1: featureFlags.v1.length, v2: featureFlags.v2.length } }
  };

  const latestPath = path.join(repoRoot, ".cache", "reports", "upstream-analysis.json");
  const outPath = args.out ? path.resolve(repoRoot, args.out) : latestPath;
  writeJson(outPath, report);
  if (!args.out) cleanupOldUpstreamEndpointReports({ reportsDir: path.dirname(latestPath), keepFileName: "" });

  console.log(`[analyze] upstream: augment.vscode-augment@${version}`);
  console.log(`[analyze] endpoints: ${endpoints.length}`);
  console.log(`[analyze] context keys: ${contextKeys.length}`);
  console.log(`[analyze] feature flags: v1=${featureFlags.v1.length} v2=${featureFlags.v2.length}`);
  console.log(`[analyze] report: ${path.relative(repoRoot, outPath)}`);

  if (!usingProvidedUnpackDir && !keepWorkDir) rmDir(unpackDir);
}

main().catch((err) => {
  console.error(`[analyze] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
