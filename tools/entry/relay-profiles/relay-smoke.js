#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { buildBearerAuth } = require("../../atom/common/auth");
const { readJson } = require("../../atom/common/fs");
const { buildUrl, normalizeBaseUrl, normalizePath } = require("../../atom/common/url");

function parseArgs(argv) {
  const out = { profile: "", baseUrl: "", token: "", tokenEnv: "", timeoutMs: 4000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile") out.profile = argv[++i] || "";
    else if (a === "--base-url") out.baseUrl = argv[++i] || "";
    else if (a === "--token") out.token = argv[++i] || "";
    else if (a === "--token-env") out.tokenEnv = argv[++i] || "";
    else if (a === "--timeout-ms") {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) out.timeoutMs = v;
    }
  }
  return out;
}

async function postJson({ url, auth, timeoutMs }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: "{}",
      signal: ac.signal
    });
    const text = await resp.text().catch(() => "");
    return { status: resp.status, body: text.slice(0, 200), resp };
  } finally {
    clearTimeout(timer);
  }
}

async function postSse({ url, auth, timeoutMs }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: "{}",
      signal: ac.signal
    });
    try {
      await resp.body?.cancel?.();
    } catch {
    }
    return { status: resp.status, body: "", resp };
  } finally {
    clearTimeout(timer);
  }
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return { ok: false, level: "FAIL", reason: "unauthorized" };
  if (status === 404) return { ok: false, level: "FAIL", reason: "not_found" };
  if (status === 429) return { ok: false, level: "FAIL", reason: "rate_limited" };
  if (status >= 500) return { ok: false, level: "FAIL", reason: "server_error" };
  if (status >= 200 && status < 400) return { ok: true, level: "PASS", reason: "ok" };
  if (status >= 400 && status < 500) return { ok: true, level: "WARN", reason: "client_error" };
  return { ok: false, level: "FAIL", reason: "unknown_status" };
}

async function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const args = parseArgs(process.argv.slice(2));
  const profilePath = args.profile ? path.resolve(repoRoot, args.profile) : path.join(repoRoot, "config", "relay-profiles", "acemcp-heroman-relay.json");
  if (!fs.existsSync(profilePath)) throw new Error(`missing profile: ${path.relative(repoRoot, profilePath)}`);

  const profile = readJson(profilePath);
  const baseUrl = normalizeBaseUrl(args.baseUrl || profile?.baseUrlDefault || "");
  if (!baseUrl) throw new Error("invalid --base-url（必须是 http(s) 服务基地址；不猜测/补全 /api，尾随 / 会自动补齐）");

  const token = args.token || (args.tokenEnv ? process.env[String(args.tokenEnv || "").trim()] || "" : "");
  const auth = buildBearerAuth(token);
  if (!auth) throw new Error(args.tokenEnv ? `missing token (env ${String(args.tokenEnv || "").trim()})` : "missing --token");

  const allowed = Array.isArray(profile?.allowedPaths) ? profile.allowedPaths : [];
  const sse = Array.isArray(profile?.ssePaths) ? profile.ssePaths : [];
  const all = [...allowed, ...sse].map(normalizePath).filter(Boolean);
  const sseSet = new Set(sse.map(normalizePath).filter(Boolean));

  console.log(`[relay] baseUrl=${baseUrl} endpoints=${all.length} timeoutMs=${args.timeoutMs}`);

  const results = [];
  for (const p of all) {
    const url = buildUrl(baseUrl, p);
    if (!url) throw new Error(`failed to build url for ${p}`);
    const timeoutMs = p === "/prompt-enhancer" ? Math.max(args.timeoutMs, 12000) : args.timeoutMs;
    const r = sseSet.has(p) ? await postSse({ url, auth, timeoutMs }) : await postJson({ url, auth, timeoutMs });
    const cls = classifyStatus(r.status);
    results.push({ path: p, status: r.status, ok: cls.ok, level: cls.level, reason: cls.reason, body: r.body });
    console.log(`[relay] ${cls.level} ${r.status} ${p}`);
  }

  const failed = results.filter((r) => r.level === "FAIL");
  const warned = results.filter((r) => r.level === "WARN");
  if (failed.length > 0) {
    console.log(`[relay] FAIL: ${failed.length}/${results.length}`);
    for (const f of failed) console.log(`- ${f.path}: ${f.status} ${f.reason} ${f.body ? `(${f.body})` : ""}`.trim());
    process.exit(1);
  }

  if (warned.length > 0) {
    console.log(`[relay] WARN: ${warned.length}/${results.length} endpoints returned 4xx (but not 401/403/404/429)`);
    for (const w of warned) console.log(`- ${w.path}: ${w.status} ${w.body ? `(${w.body})` : ""}`.trim());
  }

  console.log(`[relay] PASS: ${results.length}/${results.length}${warned.length > 0 ? ` (warnings=${warned.length})` : ""}`);
}

main().catch((err) => {
  console.error(`[relay] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
