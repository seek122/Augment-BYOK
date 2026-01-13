#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { readJson, writeText } = require("../../atom/common/fs");

function parseArgs(argv) {
  const out = { manifestPath: "", outPath: "", tagName: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") out.manifestPath = argv[++i] || "";
    else if (a === "--out") out.outPath = argv[++i] || "";
    else if (a === "--tag") out.tagName = argv[++i] || "";
  }
  return out;
}

function normalizeString(v) {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim();
}

function asInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mdCode(s) {
  const v = normalizeString(s);
  return v ? `\`${v}\`` : "`(empty)`";
}

function buildLines(manifest, { tagNameOverride } = {}) {
  const upstream = manifest?.upstream || {};
  const upstreamVersion = normalizeString(upstream.version) || "unknown";
  const tagName = normalizeString(tagNameOverride) || `upstream-${upstreamVersion}`;

  const vsix = manifest?.artifacts?.vsix || {};
  const vsixFileName = normalizeString(vsix.fileName);
  const sha256 = normalizeString(vsix.sha256);

  const patch = manifest?.patch || {};
  const markerCount = asInt(patch.markerCount);
  const markers = Array.isArray(patch.markers) ? patch.markers.map((x) => normalizeString(x)).filter(Boolean) : [];

  const coverage = manifest?.reports?.endpointCoverage || null;
  const referencedEndpointCount = coverage ? asInt(coverage.referencedEndpointCount) : 0;
  const missingFromProfileNotLlm = coverage ? asInt(coverage.missingFromProfileNotLlm) : 0;
  const missingFromProfileLlm = coverage ? asInt(coverage.missingFromProfileLlm) : 0;

  const ci = manifest?.ci?.github || {};
  const repo = normalizeString(ci.repository);
  const sha = normalizeString(ci.sha);
  const runNumber = normalizeString(ci.runNumber);
  const runId = normalizeString(ci.runId);

  const lines = [];
  lines.push(`# augment.vscode-augment@${upstreamVersion} byok-internal`);
  lines.push("");
  lines.push(`- tag: ${mdCode(tagName)}`);
  lines.push(`- upstream: ${mdCode(`augment.vscode-augment@${upstreamVersion}`)}`);
  if (vsixFileName) lines.push(`- vsix: ${mdCode(vsixFileName)}`);
  if (sha256) lines.push(`- sha256: ${mdCode(sha256)}`);
  lines.push(`- patch markers: ${markerCount}`);
  if (coverage) {
    lines.push(
      `- endpoint coverage: referenced=${referencedEndpointCount} missing(not-llm)=${missingFromProfileNotLlm} missing(llm)=${missingFromProfileLlm}`
    );
  }
  if (repo || sha || runNumber || runId) {
    const meta = [
      repo ? `repo=${repo}` : "",
      sha ? `sha=${sha.slice(0, 12)}` : "",
      runNumber ? `run=${runNumber}` : "",
      runId ? `id=${runId}` : ""
    ]
      .filter(Boolean)
      .join(" ");
    if (meta) lines.push(`- ci: ${mdCode(meta)}`);
  }

  lines.push("");
  lines.push("## Attachments");
  if (vsixFileName) lines.push(`- ${mdCode(vsixFileName)}`);
  if (vsixFileName) lines.push(`- ${mdCode(`${vsixFileName}.sha256`)}`);
  lines.push(`- ${mdCode("manifest.json")}`);
  lines.push(`- ${mdCode("upstream-analysis.json")}（如存在）`);
  lines.push(`- ${mdCode("endpoint-coverage.report.md")} / ${mdCode("endpoint-coverage.report.json")}（如存在）`);

  if (markers.length) {
    lines.push("");
    lines.push("## Patch Markers");
    for (const m of markers) lines.push(`- ${mdCode(m)}`);
  }

  return lines.join("\n") + "\n";
}

function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const args = parseArgs(process.argv.slice(2));

  const manifestPath = normalizeString(args.manifestPath);
  if (!manifestPath) throw new Error("missing --manifest <path>");
  const resolvedManifestPath = path.isAbsolute(manifestPath) ? manifestPath : path.join(repoRoot, manifestPath);
  if (!fs.existsSync(resolvedManifestPath)) throw new Error(`manifest not found: ${path.relative(repoRoot, resolvedManifestPath)}`);

  const manifest = readJson(resolvedManifestPath);
  const md = buildLines(manifest, { tagNameOverride: args.tagName });

  const outPath = normalizeString(args.outPath);
  if (outPath) {
    const resolvedOutPath = path.isAbsolute(outPath) ? outPath : path.join(repoRoot, outPath);
    writeText(resolvedOutPath, md);
    console.log(`[release-notes] wrote: ${path.relative(repoRoot, resolvedOutPath)}`);
    return;
  }

  process.stdout.write(md);
}

try {
  main();
} catch (err) {
  console.error(`[release-notes] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
}
