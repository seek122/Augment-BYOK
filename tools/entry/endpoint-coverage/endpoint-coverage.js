#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const {
  extractContextKeysFromExtensionJs,
  extractContextToFlagsFromExtensionJs,
  extractFeatureFlagKeysFromExtensionJs,
  extractUpstreamApiCallsFromExtensionJs,
  groupBySegment,
  normalizePath,
  topSegment
} = require("../../atom/upstream-analysis");

const { ensureDir, rmDir, readJson, writeJson, writeText } = require("../../atom/common/fs");
const { syncUpstreamLatest } = require("../../atom/vsix-upstream-sync");

function toSupportedSet(profile) {
  const allowed = Array.isArray(profile?.allowedPaths) ? profile.allowedPaths : [];
  const sse = Array.isArray(profile?.ssePaths) ? profile.ssePaths : [];
  const all = [...allowed, ...sse].map(normalizePath).filter(Boolean);
  return new Set(all);
}

function parseArgs(argv) {
  const args = { profile: "", llm: "", analysis: "", unpackDir: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile") args.profile = argv[++i] || "";
    else if (a === "--llm") args.llm = argv[++i] || "";
    else if (a === "--analysis") args.analysis = argv[++i] || "";
    else if (a === "--unpack-dir") args.unpackDir = argv[++i] || "";
  }
  return args;
}

const LOCAL_HANDLED_ENDPOINTS = [
  "/user-secrets/delete",
  "/user-secrets/list",
  "/user-secrets/upsert"
].map(normalizePath).filter(Boolean);

function loadUpstreamFromAnalysisOrUnpack({ repoRoot, analysisPath, unpackDir }) {
  if (analysisPath && fs.existsSync(analysisPath)) {
    const report = readJson(analysisPath);
    const endpoints = Array.isArray(report?.endpoints) ? report.endpoints.map(normalizePath).filter(Boolean) : [];
    const endpointDetails = report?.endpointDetails && typeof report.endpointDetails === "object" ? report.endpointDetails : {};
    const contextKeys = Array.isArray(report?.contextKeys) ? report.contextKeys : [];
    const featureFlags = report?.featureFlags && typeof report.featureFlags === "object" ? report.featureFlags : { v1: [], v2: [] };
    const contextKeyToFeatureFlags = report?.contextKeyToFeatureFlags && typeof report.contextKeyToFeatureFlags === "object" ? report.contextKeyToFeatureFlags : {};
    const version = typeof report?.upstream?.version === "string" ? report.upstream.version : "unknown";
    return {
      source: { kind: "analysis", path: path.relative(repoRoot, analysisPath) },
      version,
      endpoints,
      endpointDetails,
      contextKeys,
      featureFlags,
      contextKeyToFeatureFlags
    };
  }

  const extensionJsPath = path.join(unpackDir, "extension", "out", "extension.js");
  const extensionPkgPath = path.join(unpackDir, "extension", "package.json");

  if (!fs.existsSync(extensionJsPath)) throw new Error(`upstream unpack missing: ${path.relative(repoRoot, extensionJsPath)}`);

  const src = fs.readFileSync(extensionJsPath, "utf8");
  const { endpoints, endpointDetails } = extractUpstreamApiCallsFromExtensionJs(src);
  const contextKeys = extractContextKeysFromExtensionJs(src);
  const featureFlags = extractFeatureFlagKeysFromExtensionJs(src);
  const contextKeyToFeatureFlags = extractContextToFlagsFromExtensionJs(src);
  const version = fs.existsSync(extensionPkgPath) ? String(readJson(extensionPkgPath)?.version || "unknown") : "unknown";
  return {
    source: { kind: "unpack", unpackDir: path.relative(repoRoot, unpackDir), extensionJsPath: path.relative(repoRoot, extensionJsPath) },
    version,
    endpoints,
    endpointDetails,
    contextKeys,
    featureFlags,
    contextKeyToFeatureFlags
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const cacheDir = path.join(repoRoot, ".cache");
  const keepWorkDir = process.env.AUGMENT_BYOK_KEEP_WORKDIR === "1";
  const args = parseArgs(process.argv.slice(2));
  const profilePath = args.profile ? path.resolve(repoRoot, args.profile) : path.join(repoRoot, "config", "relay-profiles", "acemcp-heroman-relay.json");
  const llmPath = args.llm ? path.resolve(repoRoot, args.llm) : path.join(repoRoot, "config", "byok-routing", "llm-endpoints.json");
  const analysisPath = args.analysis ? path.resolve(repoRoot, args.analysis) : path.join(repoRoot, ".cache", "reports", "upstream-analysis.json");
  const usingProvidedUnpackDir = Boolean(args.unpackDir);
  const unpackDir = usingProvidedUnpackDir ? path.resolve(repoRoot, args.unpackDir) : path.join(cacheDir, "work", "endpoint-coverage");

  if (!fs.existsSync(profilePath)) throw new Error(`missing profile: ${path.relative(repoRoot, profilePath)}`);
  if (!fs.existsSync(llmPath)) throw new Error(`missing llm endpoints: ${path.relative(repoRoot, llmPath)}`);

  const usingAnalysis = Boolean(analysisPath && fs.existsSync(analysisPath));
  if (!usingAnalysis && !usingProvidedUnpackDir) await syncUpstreamLatest({ repoRoot, cacheDir, loggerPrefix: "[check]", unpackDir, writeMeta: false });

  const profile = readJson(profilePath);
  const supported = toSupportedSet(profile);

  const llmCfg = readJson(llmPath);
  const llmEndpointsRaw = Array.isArray(llmCfg?.endpoints) ? llmCfg.endpoints : [];
  const llmEndpoints = llmEndpointsRaw.map(normalizePath).filter(Boolean);
  const llmSet = new Set(llmEndpoints);

  const localHandled = new Set([...LOCAL_HANDLED_ENDPOINTS, ...llmEndpoints]);
  const localHandledList = Array.from(localHandled).sort();

  const upstream = loadUpstreamFromAnalysisOrUnpack({ repoRoot, analysisPath, unpackDir });
  const upstreamEndpoints = upstream.endpoints;

  const missingFromProfile = upstreamEndpoints.filter((ep) => !supported.has(ep) && !localHandled.has(ep)).sort();
  const missingFromProfileLlm = missingFromProfile.filter((ep) => llmSet.has(ep)).sort();
  const missingFromProfileNotLlm = missingFromProfile.filter((ep) => !llmSet.has(ep)).sort();

  const supportedButNotReferenced = Array.from(supported).filter((ep) => !upstream.endpointDetails[ep]).sort();
  const llmButNotReferenced = llmEndpoints.filter((ep) => !upstream.endpointDetails[ep]).sort();

  console.log(`[check] upstream: augment.vscode-augment@${upstream.version}`);
  console.log(`[check] upstream source: ${upstream.source.kind === "analysis" ? upstream.source.path : upstream.source.extensionJsPath}`);
  console.log(`[check] profile: ${path.relative(repoRoot, profilePath)} (supported=${supported.size})`);
  console.log(`[check] llm endpoints: ${path.relative(repoRoot, llmPath)} (count=${llmSet.size})`);
  console.log(`[check] local-handled endpoints: ${localHandled.size}`);
  console.log(`[check] upstream referenced endpoints: ${upstreamEndpoints.length}`);
  console.log(`[check] upstream NOT supported by profile (excluding local-handled): ${missingFromProfile.length}`);
  console.log(`[check] missing but in llm list: ${missingFromProfileLlm.length}`);
  console.log(`[check] missing and NOT in llm list: ${missingFromProfileNotLlm.length}`);
  console.log(`[check] profile supported but NOT referenced by upstream: ${supportedButNotReferenced.length}`);

  const reportPath = path.join(repoRoot, ".cache", "reports", "endpoint-coverage.report.json");
  const reportMdPath = path.join(repoRoot, ".cache", "reports", "endpoint-coverage.report.md");
  ensureDir(path.dirname(reportPath));

  const missingFromProfileDetails = missingFromProfile.map((ep) => {
    const d = upstream.endpointDetails[ep] || { callApi: { count: 0, samples: [] }, callApiStream: { count: 0, samples: [] } };
    return { endpoint: ep, segment: topSegment(ep), callApiCount: d.callApi.count, callApiStreamCount: d.callApiStream.count, samples: d };
  });

  const reportJson = {
    generatedAtMs: Date.now(),
    profile: { path: path.relative(repoRoot, profilePath), id: profile?.id || "", baseUrlDefault: profile?.baseUrlDefault || "", supportedCount: supported.size },
    upstream: {
      version: upstream.version,
      source: upstream.source,
      referencedEndpointCount: upstreamEndpoints.length,
      unpackDir: upstream.source.kind === "analysis" ? "" : path.relative(repoRoot, unpackDir)
    },
    llm: { path: path.relative(repoRoot, llmPath), endpointCount: llmEndpoints.length, endpoints: llmEndpoints },
    localHandled: { endpointCount: localHandledList.length, endpoints: localHandledList },
    referencedEndpoints: upstreamEndpoints,
    missingFromProfile,
    missingFromProfileLlm,
    missingFromProfileNotLlm,
    missingFromProfileDetails,
    missingFromProfileBySegment: groupBySegment(missingFromProfile),
    missingFromProfileLlmBySegment: groupBySegment(missingFromProfileLlm),
    missingFromProfileNotLlmBySegment: groupBySegment(missingFromProfileNotLlm),
    supportedButNotReferenced,
    llmButNotReferenced,
    contextKeys: upstream.contextKeys,
    featureFlags: upstream.featureFlags,
    contextKeyToFeatureFlags: upstream.contextKeyToFeatureFlags
  };

  writeJson(reportPath, reportJson);
  console.log(`[check] report: ${path.relative(repoRoot, reportPath)}`);

  const md = [
    `# Endpoint Coverage Report`,
    ``,
    `- generatedAtMs: ${reportJson.generatedAtMs}`,
    `- upstream: augment.vscode-augment@${upstream.version}`,
    `- upstream source: ${upstream.source.kind === "analysis" ? upstream.source.path : upstream.source.extensionJsPath}`,
    `- profile: ${reportJson.profile.path} (supported=${supported.size})`,
    `- llm endpoints: ${reportJson.llm.path} (count=${llmSet.size})`,
    `- local-handled endpoints: ${localHandled.size}`,
    `- upstream referenced endpoints: ${upstreamEndpoints.length}`,
    `- missing from profile (excluding local-handled): ${missingFromProfile.length}`,
    `- missing but in llm list: ${missingFromProfileLlm.length}`,
    `- missing and NOT in llm list: ${missingFromProfileNotLlm.length}`,
    `- supported but not referenced: ${supportedButNotReferenced.length}`,
    ``,
    `## Missing From Profile (Grouped)`,
    ...Object.entries(reportJson.missingFromProfileBySegment).flatMap(([seg, items]) => [``, `### ${seg} (${items.length})`, ...items.map((p) => `- ${p}`)]),
    ``,
    `## Missing But In LLM List (Grouped)`,
    ...Object.entries(reportJson.missingFromProfileLlmBySegment).flatMap(([seg, items]) => [``, `### ${seg} (${items.length})`, ...items.map((p) => `- ${p}`)]),
    ``,
    `## Missing And Not In LLM List (Grouped)`,
    ...Object.entries(reportJson.missingFromProfileNotLlmBySegment).flatMap(([seg, items]) => [``, `### ${seg} (${items.length})`, ...items.map((p) => `- ${p}`)]),
    ``,
    `## Notes`,
    `- Strict: 不做 /api 补/抽，不做 candidate 探测，不做 stub/no-op。`,
    `- upstream 端点来源优先使用 ${path.relative(repoRoot, analysisPath)}（若存在），否则从解包的 extension/out/extension.js 抽取（不猜测字符串拼接）。`,
    `- local-handled endpoints 表示已通过补丁在本地实现，不要求 relay 支持。`
  ].join("\n");
  writeText(reportMdPath, md + "\n");
  console.log(`[check] report: ${path.relative(repoRoot, reportMdPath)}`);

  if (!usingAnalysis && !usingProvidedUnpackDir && !keepWorkDir) rmDir(unpackDir);
}

main().catch((err) => {
  console.error(`[check] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
