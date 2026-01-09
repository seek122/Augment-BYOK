#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ensureDir, rmDir, readJson, writeJson } = require("../common/fs");

const UPSTREAM = {
  publisher: "augment",
  extension: "vscode-augment",
  downloadUrl:
    "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/augment/vsextensions/vscode-augment/latest/vspackage"
};

function run(cmd, args, { cwd }) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error) throw r.error;
  if (typeof r.status === "number" && r.status !== 0) throw new Error(`command failed: ${cmd} ${args.join(" ")}`);
}

async function downloadFile(url, outPath) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, buf);
  return { bytes: buf.length };
}

function unpackVsix({ repoRoot, vsixPath, unpackDir }) {
  rmDir(unpackDir);
  ensureDir(unpackDir);
  run("unzip", ["-q", vsixPath, "-d", unpackDir], { cwd: repoRoot });
  run("chmod", ["-R", "u+w", unpackDir], { cwd: repoRoot });
}

function readUpstreamVersionFromUnpackedDir({ repoRoot, unpackDir }) {
  const pkgPath = path.join(unpackDir, "extension", "package.json");
  if (!fs.existsSync(pkgPath)) throw new Error(`unpack missing: ${path.relative(repoRoot, pkgPath)}`);
  const pkg = readJson(pkgPath);
  return typeof pkg.version === "string" ? pkg.version : "unknown";
}

function writeUpstreamMeta({ repoRoot, unpackDir, meta }) {
  const outPath = path.join(unpackDir, ".upstream.json");
  writeJson(outPath, meta);
  return path.relative(repoRoot, outPath);
}

async function syncUpstreamLatest({ repoRoot, cacheDir, loggerPrefix, unpackDir: unpackDirOverride, writeMeta = true }) {
  const prefix = typeof loggerPrefix === "string" ? loggerPrefix : "[upstream]";
  const upstreamDir = path.join(cacheDir, "upstream");
  const vsixPath = path.join(upstreamDir, `${UPSTREAM.publisher}.${UPSTREAM.extension}.latest.vsix`);
  const unpackDir = unpackDirOverride
    ? path.isAbsolute(unpackDirOverride)
      ? unpackDirOverride
      : path.join(repoRoot, unpackDirOverride)
    : path.join(cacheDir, "work", "upstream-latest");

  ensureDir(upstreamDir);

  const forceDownload = process.env.AUGMENT_BYOK_FORCE_UPSTREAM_DOWNLOAD === "1";
  if (!forceDownload && fs.existsSync(vsixPath)) {
    const bytes = fs.statSync(vsixPath).size;
    console.log(`${prefix} using cached VSIX -> ${path.relative(repoRoot, vsixPath)} (${bytes} bytes)`);
  } else {
    console.log(`${prefix} downloading VSIX -> ${path.relative(repoRoot, vsixPath)}`);
    const dl = await downloadFile(UPSTREAM.downloadUrl, vsixPath);
    console.log(`${prefix} downloaded ${dl.bytes} bytes`);
  }

  console.log(`${prefix} unpacking -> ${path.relative(repoRoot, unpackDir)}`);
  unpackVsix({ repoRoot, vsixPath, unpackDir });

  const version = readUpstreamVersionFromUnpackedDir({ repoRoot, unpackDir });
  const meta = {
    publisher: UPSTREAM.publisher,
    extension: UPSTREAM.extension,
    version,
    downloadedAtMs: Date.now(),
    vsixPath: path.relative(repoRoot, vsixPath),
    unpackDir: path.relative(repoRoot, unpackDir)
  };

  console.log(`${prefix} ready: ${UPSTREAM.publisher}.${UPSTREAM.extension}@${version}`);
  const metaRelPath = writeMeta ? writeUpstreamMeta({ repoRoot, unpackDir, meta }) : "";
  if (metaRelPath) console.log(`${prefix} meta: ${metaRelPath}`);
  console.log(`${prefix} path: ${path.relative(repoRoot, unpackDir)}`);

  return { vsixPath, unpackDir, version, meta };
}

module.exports = {
  UPSTREAM,
  ensureDir,
  rmDir,
  run,
  readJson,
  downloadFile,
  unpackVsix,
  readUpstreamVersionFromUnpackedDir,
  writeUpstreamMeta,
  syncUpstreamLatest
};
