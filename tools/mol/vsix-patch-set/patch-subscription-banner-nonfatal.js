#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker, replaceOnceRegExp } = require("../../atom/common/patch");

const MARKER = "__augment_byok_subscription_banner_nonfatal_patched";

function patchSubscriptionBannerNonfatal(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const alreadyNonfatal = original.includes("Failed to get subscription banner") && original.includes('return{type:"get-subscription-banner-response",data:{banner:void 0}}');
  let next = original;

  if (!alreadyNonfatal) {
    next = replaceOnceRegExp(
      next,
      /catch\(([A-Za-z0-9_$]+)\)\{throw this\._logger\.error\(`Failed to get subscription banner: \$\{String\(\1\)\}`\),\1\}/g,
      'catch($1){this._logger.error(`Failed to get subscription banner: ${String($1)}`);return{type:"get-subscription-banner-response",data:{banner:void 0}}}',
      "subscription-banner.catch"
    );
  }

  next = ensureMarker(next, MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: alreadyNonfatal ? "marker_added" : "patched" };
}

module.exports = { patchSubscriptionBannerNonfatal };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchSubscriptionBannerNonfatal(p);
}
