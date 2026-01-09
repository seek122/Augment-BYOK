#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_settings_secrets_webview_patched";

function listSettingsAssets(assetsDir) {
  try {
    return fs
      .readdirSync(assetsDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => n.startsWith("settings-") && n.endsWith(".js"))
      .map((n) => path.join(assetsDir, n));
  } catch {
    return [];
  }
}

function patchFile(filePath, { checkOnly }) {
  const original = fs.readFileSync(filePath, "utf8");
  if (!original.includes("const ts=new class")) return { filePath, changed: false, patched: false, reason: "no_secrets_block" };
  if (original.includes(MARKER)) return { filePath, changed: false, patched: true, reason: "already_patched" };

  const startNeedle = "const ts=new class{";
  const start = original.indexOf(startNeedle);
  if (start < 0) throw new Error(`secrets webview patch: start needle missing in ${path.basename(filePath)}`);
  const end = original.indexOf("}};", start);
  if (end < 0) throw new Error(`secrets webview patch: end needle missing in ${path.basename(filePath)}`);

  const block = original.slice(start, end + 3);
  if (!block.includes("Pt(ka)") || !block.includes("listUserSecrets") || !block.includes("upsertUserSecret") || !block.includes("deleteUserSecret")) {
    throw new Error(`secrets webview patch: unexpected ts block in ${path.basename(filePath)} (upstream may have changed)`);
  }

  const replacement =
    `const ts=new class{async loadSecrets(){return((await(await Pt(Kt)).listSecrets({})).secrets||[]).filter((e=>e!=null)).map((e=>un(e)))}async createSecret(n){const e=await Pt(Kt),r=await e.createSecret({name:n.name,value:n.value,tags:n.tags,description:n.description});if(!r.secret)throw new Error(\"Failed to create secret: no secret returned\");return un(r.secret)}async updateSecret(n){const e=await Pt(Kt),r=await e.updateSecret({name:n.name,value:n.value,tags:n.tags,description:n.description,expectedVersion:n.expectedVersion??\"\"});return{updatedAt:ms(r.updatedAt),version:r.version||\"\",valueSizeBytes:n.value?new TextEncoder().encode(n.value).length:void 0}}async deleteSecret(n){if(!(await(await Pt(Kt)).deleteSecret({name:n})).deleted)throw new Error(\"Failed to delete secret\")}};`;

  const next = original.slice(0, start) + replacement + original.slice(end + 3);
  const patched = next.includes("Pt(Kt)") && next.includes("listSecrets") && next.includes("createSecret") && next.includes("updateSecret") && next.includes("deleteSecret");
  if (checkOnly) {
    if (!patched) throw new Error(`Settings Secrets patch missing in ${path.basename(filePath)}`);
    return { filePath, changed: false, patched: true, reason: "check_only_ok" };
  }

  const out = ensureMarker(next, MARKER);
  fs.writeFileSync(filePath, out, "utf8");
  if (!out.includes(MARKER) || !patched) throw new Error(`Settings Secrets patch failed for ${path.basename(filePath)}`);
  return { filePath, changed: true, patched: true, reason: "patched" };
}

function patchSettingsSecretsWebview({ extensionDir, checkOnly }) {
  const assetsDir = path.join(extensionDir, "common-webviews", "assets");
  const files = listSettingsAssets(assetsDir);
  if (files.length === 0) throw new Error(`no settings assets found in ${assetsDir}`);

  const results = files.map((filePath) => patchFile(filePath, { checkOnly: Boolean(checkOnly) }));
  const patchedCount = results.filter((r) => r.patched).length;
  const changedCount = results.filter((r) => r.changed).length;
  return { ok: true, patchedCount, changedCount, total: results.length };
}

module.exports = { patchSettingsSecretsWebview };

if (require.main === module) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const dirFlag = args.findIndex((a) => a === "--extensionDir");
  const extensionDir = dirFlag >= 0 ? args[dirFlag + 1] : null;
  if (!extensionDir) {
    console.error(`usage: ${path.basename(process.argv[1])} --extensionDir <path-to-extension/> [--check]`);
    process.exit(2);
  }
  patchSettingsSecretsWebview({ extensionDir, checkOnly });
}
