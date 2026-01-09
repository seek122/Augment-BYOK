#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureDir, rmDir } = require("../../atom/common/fs");
const { run } = require("../../atom/vsix-upstream-sync");

function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const outExtensionDir = path.join(repoRoot, ".cache", "payload", "extension");
  const outByokDir = path.join(outExtensionDir, "out", "byok");
  const outMediaDir = path.join(outExtensionDir, "media");
  const outPanelHtml = path.join(outMediaDir, "byok-panel.html");
  const outPanelJs = path.join(outMediaDir, "byok-panel.js");
  const legacyOutPanelHtml = path.join(outExtensionDir, "out", "byok-panel.html");
  const legacyOutPanelJs = path.join(outExtensionDir, "out", "byok-panel.js");
  const outConfigDir = path.join(outExtensionDir, "config", "byok-routing");
  const outLlmEndpoints = path.join(outConfigDir, "llm-endpoints.json");

  rmDir(outByokDir);
  rmDir(path.join(outExtensionDir, "config"));
  ensureDir(outByokDir);
  if (fs.existsSync(legacyOutPanelHtml)) fs.rmSync(legacyOutPanelHtml, { force: true });
  if (fs.existsSync(legacyOutPanelJs)) fs.rmSync(legacyOutPanelJs, { force: true });

  const tscBin = path.join(repoRoot, "node_modules", ".bin", "tsc");
  if (!fs.existsSync(tscBin)) throw new Error("missing typescript; run: pnpm install");

  run(tscBin, ["-p", path.join(repoRoot, "packages", "byok-runtime", "tsconfig.json")], { cwd: repoRoot });

  ensureDir(outMediaDir);
  const panelHtmlSrc = path.join(repoRoot, "packages", "byok-runtime", "media", "byok-panel.html");
  const panelJsSrc = path.join(repoRoot, "packages", "byok-runtime", "media", "byok-panel.js");
  if (!fs.existsSync(panelHtmlSrc)) throw new Error(`missing panel html: ${path.relative(repoRoot, panelHtmlSrc)}`);
  if (!fs.existsSync(panelJsSrc)) throw new Error(`missing panel js: ${path.relative(repoRoot, panelJsSrc)}`);
  fs.copyFileSync(panelHtmlSrc, outPanelHtml);
  fs.copyFileSync(panelJsSrc, outPanelJs);

  ensureDir(outConfigDir);
  const llmEndpointsSrc = path.join(repoRoot, "config", "byok-routing", "llm-endpoints.json");
  if (!fs.existsSync(llmEndpointsSrc)) throw new Error(`missing llm-endpoints: ${path.relative(repoRoot, llmEndpointsSrc)}`);
  fs.copyFileSync(llmEndpointsSrc, outLlmEndpoints);

  console.log(`[payload] built -> ${path.relative(repoRoot, outByokDir)}`);
}

main();
