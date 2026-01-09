#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureMarker } = require("../../atom/common/patch");

const MARKER = "__augment_byok_secrets_local_store_patched";

function patchBetween(src, startNeedle, endNeedle, replacement, { label }) {
  const start = src.indexOf(startNeedle);
  if (start < 0) throw new Error(`${label}: start needle not found: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start);
  if (end < 0) throw new Error(`${label}: end needle not found: ${endNeedle}`);
  const before = src.slice(0, start);
  const after = src.slice(end);
  return { next: before + replacement + after, matched: src.slice(start, end) };
}

function patchSecretsLocalStore(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  let src = original;

  const t6Start = "async _handleListSecretsRequest(r){";
  const t6End = "async _handleLoadMemoriesFile(r){";
  const t6Replacement =
    `async _handleListSecretsRequest(r){try{const __byokIndexKey=\"__augment_byok_user_secrets_index_v1\",__byokIdxRaw=this._globalState.get(__byokIndexKey,{}),__byokIdx=__byokIdxRaw&&typeof __byokIdxRaw==\"object\"?__byokIdxRaw:{},__byokSecrets=Object.values(__byokIdx).filter(s=>s&&typeof s==\"object\"&&typeof s.name==\"string\"&&s.name);await this._postMessage({type:\"list-secrets-response\",data:{secrets:__byokSecrets,next_page_token:\"\",total_count:__byokSecrets.length,success:!0}})}catch(n){this._settingsLogger.error(\"Failed to list secrets: \"+Je(n)),await this._postMessage({type:\"list-secrets-response\",data:{secrets:[],next_page_token:\"\",total_count:0,success:!1,error:n instanceof Error?n.message:\"Unknown error\"}})}}` +
    `async _handleCreateSecretRequest(r){try{const __byokIndexKey=\"__augment_byok_user_secrets_index_v1\",__byokValueKey=\"__augment_byok_user_secret_value_v1:\",n=r.data||{},name=typeof n.name==\"string\"?n.name:\"\";if(!name)throw new Error(\"name is required\");const idxRaw=this._globalState.get(__byokIndexKey,{}),idx=idxRaw&&typeof idxRaw==\"object\"?idxRaw:{};if(idx[name])throw new Error(\"Secret already exists\");if(!this._extensionContext||!this._extensionContext.secrets||typeof this._extensionContext.secrets.store!=\"function\")throw new Error(\"Secret storage not available\");const value=typeof n.value==\"string\"?n.value:\"\",tags=n.tags&&typeof n.tags==\"object\"?n.tags:{},description=typeof n.description==\"string\"?n.description:\"\",ms=Date.now(),now={seconds:String(Math.floor(ms/1000)),nanos:ms%1000*1e6},storageKey=__byokValueKey+encodeURIComponent(name);await this._extensionContext.secrets.store(storageKey,value);const meta={name,tags,description,created_at:now,updated_at:now,version:\"1\",value_size_bytes:Buffer.byteLength(value,\"utf8\")};idx[name]=meta,await this._globalState.update(__byokIndexKey,idx),await this._postMessage({type:\"create-secret-response\",data:{success:!0,version:meta.version,updatedAt:meta.updated_at}})}catch(n){this._settingsLogger.error(\"Failed to create secret: \"+Je(n)),await this._postMessage({type:\"create-secret-response\",data:{success:!1,error:n instanceof Error?n.message:\"Unknown error\"}})}}` +
    `async _handleUpdateSecretRequest(r){try{const __byokIndexKey=\"__augment_byok_user_secrets_index_v1\",__byokValueKey=\"__augment_byok_user_secret_value_v1:\",n=r.data||{},name=typeof n.name==\"string\"?n.name:\"\";if(!name)throw new Error(\"name is required\");const idxRaw=this._globalState.get(__byokIndexKey,{}),idx=idxRaw&&typeof idxRaw==\"object\"?idxRaw:{},prev=idx[name]&&typeof idx[name]==\"object\"?idx[name]:null,expected=typeof n.expectedVersion==\"string\"?n.expectedVersion:\"\";if(prev&&expected&&String(prev.version||\"\")!==expected)throw new Error(\"Version mismatch\");if(!prev&&expected&&expected!==\"0\")throw new Error(\"Version mismatch\");if(!this._extensionContext||!this._extensionContext.secrets||typeof this._extensionContext.secrets.store!=\"function\")throw new Error(\"Secret storage not available\");const value=typeof n.value==\"string\"?n.value:\"\",tags=n.tags&&typeof n.tags==\"object\"?n.tags:{},description=typeof n.description==\"string\"?n.description:\"\",ms=Date.now(),now={seconds:String(Math.floor(ms/1000)),nanos:ms%1000*1e6},storageKey=__byokValueKey+encodeURIComponent(name);await this._extensionContext.secrets.store(storageKey,value);const curVer=prev&&typeof prev.version==\"string\"?prev.version:\"0\",nextVer=String(((Number(curVer)||0)+1)||1),createdAt=prev&&prev.created_at?prev.created_at:now,meta={name,tags,description,created_at:createdAt,updated_at:now,version:nextVer,value_size_bytes:Buffer.byteLength(value,\"utf8\")};idx[name]=meta,await this._globalState.update(__byokIndexKey,idx),await this._postMessage({type:\"update-secret-response\",data:{success:!0,version:meta.version,updatedAt:meta.updated_at}})}catch(n){this._settingsLogger.error(\"Failed to update secret: \"+Je(n)),await this._postMessage({type:\"update-secret-response\",data:{success:!1,error:n instanceof Error?n.message:\"Unknown error\"}})}}` +
    `async _handleDeleteSecretRequest(r){try{const __byokIndexKey=\"__augment_byok_user_secrets_index_v1\",__byokValueKey=\"__augment_byok_user_secret_value_v1:\",n=r.data||{},name=typeof n.name==\"string\"?n.name:\"\";if(!name)throw new Error(\"name is required\");const idxRaw=this._globalState.get(__byokIndexKey,{}),idx=idxRaw&&typeof idxRaw==\"object\"?idxRaw:{};if(!idx[name])throw new Error(\"Secret not found\");if(!this._extensionContext||!this._extensionContext.secrets||typeof this._extensionContext.secrets.delete!=\"function\")throw new Error(\"Secret storage not available\");const storageKey=__byokValueKey+encodeURIComponent(name);await this._extensionContext.secrets.delete(storageKey);delete idx[name],await this._globalState.update(__byokIndexKey,idx),await this._postMessage({type:\"delete-secret-response\",data:{success:!0}})}catch(n){this._settingsLogger.error(\"Failed to delete secret: \"+Je(n)),await this._postMessage({type:\"delete-secret-response\",data:{success:!1,error:n instanceof Error?n.message:\"Unknown error\"}})}}`;

  const t6Res = patchBetween(src, t6Start, t6End, t6Replacement, { label: "settings panel secrets handlers" });
  if (!t6Res.matched.includes("this._apiServer.listUserSecrets") || !t6Res.matched.includes("this._apiServer.upsertUserSecret") || !t6Res.matched.includes("this._apiServer.deleteUserSecret")) {
    throw new Error(`settings panel secrets handlers: unexpected block (upstream changed?)`);
  }
  src = t6Res.next;

  const messengerStart = "async handleListSecretsRequest(t,r){";
  const messengerStartIndex = src.indexOf(messengerStart);
  if (messengerStartIndex < 0) throw new Error(`secrets messenger handlers: start needle not found: ${messengerStart}`);
  const messengerEndRe = /dispose\(\)\{[A-Za-z0-9_$]+\.getInstance\(\)\.unregisterMessageHandler\(e\.messengerId\)\}\}/g;
  const messengerEndMatches = Array.from(src.slice(messengerStartIndex).matchAll(messengerEndRe)).map((m) => m[0]);
  if (messengerEndMatches.length !== 1) throw new Error(`secrets messenger handlers: end needle not found or not unique: matched=${messengerEndMatches.length}`);
  const messengerEnd = messengerEndMatches[0];
  const messengerReplacement =
    `async handleListSecretsRequest(t,r){try{const __byokIndexKey=\"__augment_byok_user_secrets_index_v1\",__byokIdxRaw=this._globalState.get(__byokIndexKey,{}),__byokIdx=__byokIdxRaw&&typeof __byokIdxRaw==\"object\"?__byokIdxRaw:{},__byokSecrets=Object.values(__byokIdx).filter(s=>s&&typeof s==\"object\"&&typeof s.name==\"string\"&&s.name);return{type:\"list-secrets-response\",data:{secrets:__byokSecrets,next_page_token:\"\",total_count:__byokSecrets.length,success:!0}}}catch(n){return vU.error(\"Failed to list secrets:\",n),{type:\"list-secrets-response\",data:{secrets:[],next_page_token:\"\",total_count:0,success:!1,error:n instanceof Error?n.message:\"Unknown error\"}}}}` +
    `async handleUpdateSecretRequest(t){try{const __byokIndexKey=\"__augment_byok_user_secrets_index_v1\",__byokValueKey=\"__augment_byok_user_secret_value_v1:\",name=typeof t?.name==\"string\"?t.name:\"\";if(!name)throw new Error(\"name is required\");const idxRaw=this._globalState.get(__byokIndexKey,{}),idx=idxRaw&&typeof idxRaw==\"object\"?idxRaw:{},prev=idx[name]&&typeof idx[name]==\"object\"?idx[name]:null,expected=typeof t?.expectedVersion==\"string\"?t.expectedVersion:\"\";if(prev&&expected&&String(prev.version||\"\")!==expected)throw new Error(\"Version mismatch\");if(!prev&&expected&&expected!==\"0\")throw new Error(\"Version mismatch\");if(!this._extensionContext||!this._extensionContext.secrets||typeof this._extensionContext.secrets.store!=\"function\")throw new Error(\"Secret storage not available\");const value=typeof t?.value==\"string\"?t.value:\"\",tags=t?.tags&&typeof t.tags==\"object\"?t.tags:{},description=typeof t?.description==\"string\"?t.description:\"\",ms=Date.now(),now={seconds:String(Math.floor(ms/1000)),nanos:ms%1000*1e6},storageKey=__byokValueKey+encodeURIComponent(name);await this._extensionContext.secrets.store(storageKey,value);const curVer=prev&&typeof prev.version==\"string\"?prev.version:\"0\",nextVer=String(((Number(curVer)||0)+1)||1),createdAt=prev&&prev.created_at?prev.created_at:now,meta={name,tags,description,created_at:createdAt,updated_at:now,version:nextVer,value_size_bytes:Buffer.byteLength(value,\"utf8\")};idx[name]=meta,await this._globalState.update(__byokIndexKey,idx);return{type:\"update-secret-response\",data:{success:!0,version:meta.version,updatedAt:meta.updated_at}}}catch(r){return vU.error(\"Failed to update secret:\",r),{type:\"update-secret-response\",data:{success:!1,error:r instanceof Error?r.message:\"Unknown error\"}}}}` +
    `async handleDeleteSecretRequest(t){try{const __byokIndexKey=\"__augment_byok_user_secrets_index_v1\",__byokValueKey=\"__augment_byok_user_secret_value_v1:\",name=typeof t?.name==\"string\"?t.name:\"\";if(!name)throw new Error(\"name is required\");const idxRaw=this._globalState.get(__byokIndexKey,{}),idx=idxRaw&&typeof idxRaw==\"object\"?idxRaw:{};if(!idx[name])throw new Error(\"Secret not found\");if(!this._extensionContext||!this._extensionContext.secrets||typeof this._extensionContext.secrets.delete!=\"function\")throw new Error(\"Secret storage not available\");const storageKey=__byokValueKey+encodeURIComponent(name);await this._extensionContext.secrets.delete(storageKey);delete idx[name],await this._globalState.update(__byokIndexKey,idx);return{type:\"delete-secret-response\",data:{success:!0}}}catch(r){return vU.error(\"Failed to delete secret:\",r),{type:\"delete-secret-response\",data:{success:!1,error:r instanceof Error?r.message:\"Unknown error\"}}}}` +
    `async handleCreateSecretRequest(t){try{const __byokIndexKey=\"__augment_byok_user_secrets_index_v1\",__byokValueKey=\"__augment_byok_user_secret_value_v1:\",name=typeof t?.name==\"string\"?t.name:\"\";if(!name)throw new Error(\"name is required\");const idxRaw=this._globalState.get(__byokIndexKey,{}),idx=idxRaw&&typeof idxRaw==\"object\"?idxRaw:{};if(idx[name])throw new Error(\"Secret already exists\");if(!this._extensionContext||!this._extensionContext.secrets||typeof this._extensionContext.secrets.store!=\"function\")throw new Error(\"Secret storage not available\");const value=typeof t?.value==\"string\"?t.value:\"\",tags=t?.tags&&typeof t.tags==\"object\"?t.tags:{},description=typeof t?.description==\"string\"?t.description:\"\",ms=Date.now(),now={seconds:String(Math.floor(ms/1000)),nanos:ms%1000*1e6},storageKey=__byokValueKey+encodeURIComponent(name);await this._extensionContext.secrets.store(storageKey,value);const meta={name,tags,description,created_at:now,updated_at:now,version:\"1\",value_size_bytes:Buffer.byteLength(value,\"utf8\")};idx[name]=meta,await this._globalState.update(__byokIndexKey,idx);return{type:\"create-secret-response\",data:{success:!0,version:meta.version,updatedAt:meta.updated_at}}}catch(r){return vU.error(\"Failed to create secret:\",r),{type:\"create-secret-response\",data:{success:!1,error:r instanceof Error?r.message:\"Unknown error\"}}}}`;

  const msgRes = patchBetween(src, messengerStart, messengerEnd, messengerReplacement, { label: "secrets messenger handlers" });
  if (!msgRes.matched.includes("this._api.listUserSecrets") || !msgRes.matched.includes("this._api.upsertUserSecret") || !msgRes.matched.includes("this._api.deleteUserSecret")) {
    throw new Error(`secrets messenger handlers: unexpected block (upstream changed?)`);
  }
  src = msgRes.next;

  src = ensureMarker(src, MARKER);
  fs.writeFileSync(filePath, src, "utf8");
  return { changed: true, reason: "patched" };
}

module.exports = { patchSecretsLocalStore };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchSecretsLocalStore(p);
}
