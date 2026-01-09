#!/usr/bin/env node
"use strict";

function normalizeBaseUrl(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return "";
  return s.endsWith("/") ? s : `${s}/`;
}

function normalizePath(p) {
  const s = typeof p === "string" ? p.trim() : "";
  if (!s) return "";
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  const clean = withSlash.replace(/\/+$/, "");
  if (!clean || clean === "/") return "";
  return clean;
}

function buildUrl(baseUrl, endpointPath) {
  const base = normalizeBaseUrl(baseUrl);
  const ep = normalizePath(endpointPath).replace(/^\/+/, "");
  return base && ep ? `${base}${ep}` : "";
}

module.exports = { normalizeBaseUrl, normalizePath, buildUrl };
