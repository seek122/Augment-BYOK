#!/usr/bin/env node
"use strict";

function normalizeString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function buildBearerAuth(token) {
  const raw = normalizeString(token);
  if (!raw) return "";
  if (/\s/.test(raw)) throw new Error("Token 格式错误：请填写 raw token（不包含 Bearer 前缀/空白）");
  return `Bearer ${raw}`;
}

module.exports = { buildBearerAuth };
