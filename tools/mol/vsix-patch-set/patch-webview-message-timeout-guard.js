#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker, replaceOnceLiteral, replaceOnceRegExp } = require("../../atom/common/patch");

const MARKER = "__augment_byok_webview_message_timeout_guard_patched";

function patchWebviewMessageTimeoutGuard(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  let next = original;
  next = replaceOnceRegExp(
    next,
    /case"track-analytics-event":\{let n=t;n\.data\.properties&&([A-Za-z0-9_$]+)\(n\.data\.eventName,n\.data\.properties\),r\(\{type:"empty"\}\);break\}/g,
    'case"track-analytics-event":{let n=t;try{n.data.properties&&$1(n.data.eventName,n.data.properties)}catch{}r({type:"empty"});break}',
    "analytics.track-analytics-event"
  );
  next = replaceOnceRegExp(
    next,
    /case"track-experiment-viewed-event":\{let n=t;([A-Za-z0-9_$]+)\(n\.data\.experimentName,n\.data\.treatment,n\.data\.properties\),r\(\{type:"empty"\}\);break\}/g,
    'case"track-experiment-viewed-event":{let n=t;try{$1(n.data.experimentName,n.data.treatment,n.data.properties)}catch{}r({type:"empty"});break}',
    "analytics.track-experiment-viewed-event"
  );
  next = replaceOnceLiteral(
    next,
    "let s=await this._rulesService.loadRules({includeGuidelines:r,query:n,maxResults:i,contextRules:o});",
    "let s=await Promise.race([this._rulesService.loadRules({includeGuidelines:r,query:n,maxResults:i,contextRules:o}),new Promise((a=>setTimeout((()=>a([])),800)))]);",
    "rules.get-rules-list-request.timeout"
  );
  next = replaceOnceLiteral(
    next,
    "let n=await this._apiServer.getSubscriptionBanner();",
    "let n=await Promise.race([this._apiServer.getSubscriptionBanner(),new Promise((a=>setTimeout((()=>a({banner:void 0})),800)))]);",
    "subscription-banner.timeout"
  );
  next = replaceOnceLiteral(
    next,
    "catch(r){throw this._logger.error(`Failed to get rules list: ${String(r)}`),r}}",
    'catch(r){return this._logger.error(`Failed to get rules list: ${String(r)}`),{type:"get-rules-list-response",data:{rules:[]}}}}',
    "rules.get-rules-list-request.catch"
  );

  next = ensureMarker(next, MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched" };
}

module.exports = { patchWebviewMessageTimeoutGuard };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchWebviewMessageTimeoutGuard(p);
}
