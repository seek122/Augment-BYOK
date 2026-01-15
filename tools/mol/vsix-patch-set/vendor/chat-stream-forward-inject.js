// === Chat-Stream Forward Interceptor（VS Code Settings）===
// 仅拦截 Augment 的 /chat-stream 并转发到你配置的代理（上游域名以 completionURL/实际请求为准，避免写死官方域名列表）。
// 配置来源：VS Code Settings（augment.advanced.chatStreamForward）
// - 仅当 `globalThis.__augment_byok_upstream_config_override.enabled === true` 且配置存在且合法时启用；否则 passthrough（不影响原生请求）
// - api_url：支持 baseUrl（如 http://127.0.0.1:8317 或 http://127.0.0.1:8317/v1）或完整 chat-stream URL（如 http://127.0.0.1:8317/chat-stream）
// - debug：默认固定开启（不读配置项）

(function () {
    "use strict";

    const CHAT_STREAM_PATH = "/chat-stream";
    const CONFIG_CACHE_TTL_MS = 5000;
    const AUGMENT_UA_HINT = "augment.vscode-augment/";

    let _configCache = null;
    let _configLoadTime = 0;

    function isByokEnabled() {
        try { return !!(globalThis && globalThis.__augment_byok_upstream_config_override && globalThis.__augment_byok_upstream_config_override.enabled === true); } catch (_) { return false; }
    }

    function tryLoadConfigFromVscode() {
        try {
            const vscode = require("vscode");
            const augmentCfg = vscode && vscode.workspace && vscode.workspace.getConfiguration ? vscode.workspace.getConfiguration("augment") : null;
            const advancedDot = augmentCfg && augmentCfg.get ? augmentCfg.get("advanced.chatStreamForward") : null;
            if (advancedDot && typeof advancedDot === "object") return { ...advancedDot, __source: "vscode:augment.advanced.chatStreamForward" };

            const advanced = augmentCfg && augmentCfg.get ? augmentCfg.get("advanced") : null;
            if (advanced && typeof advanced === "object" && advanced.chatStreamForward && typeof advanced.chatStreamForward === "object") return { ...advanced.chatStreamForward, __source: "vscode:augment.advanced.chatStreamForward" };
        } catch (_) { }
        return null;
    }

    function getConfigSync() {
        if (_configCache && (Date.now() - _configLoadTime < CONFIG_CACHE_TTL_MS)) return _configCache;
        const cfg = tryLoadConfigFromVscode();
        if (!cfg) return null;
        _configCache = cfg;
        _configLoadTime = Date.now();
        return cfg;
    }

    function log(level, ...args) {
        console[level]("[ChatStreamForward]", ...args);
    }

    function validateConfig(cfg) {
        if (!cfg || typeof cfg !== "object") throw new Error("配置为空或不是 object");
        return normalizeApiUrlToChatStream(cfg.api_url);
    }

    function normalizeApiUrlToChatStream(apiUrl) {
        if (!apiUrl || !String(apiUrl).trim()) throw new Error("配置缺少 api_url");
        const raw = String(apiUrl).trim();
        let u;
        try { u = new URL(raw); } catch (e) { throw new Error(`api_url 不是合法 URL: ${e && e.message ? e.message : String(e)}`); }
        if (!/^https?:$/i.test(u.protocol)) throw new Error("api_url 必须是 http/https");
        if (u.search) throw new Error("api_url 不要包含 query 参数");
        if (u.hash) throw new Error("api_url 不要包含 hash");
        const p0 = normalizePathname(u.pathname);
        if (!p0) return new URL("chat-stream", new URL(u.origin + "/")).toString();
        if (p0.endsWith(CHAT_STREAM_PATH)) return new URL(u.origin + p0).toString();
        return new URL("chat-stream", new URL(u.origin + p0 + "/")).toString();
    }

    function tryLoadCompletionUrlFromVscode() {
        try {
            const vscode = require("vscode");
            const augmentCfg = vscode && vscode.workspace && vscode.workspace.getConfiguration ? vscode.workspace.getConfiguration("augment") : null;
            const direct = augmentCfg && augmentCfg.get ? augmentCfg.get("advanced.completionURL") : null;
            if (typeof direct === "string" && direct.trim()) return direct.trim();
            const advanced = augmentCfg && augmentCfg.get ? augmentCfg.get("advanced") : null;
            const nested = advanced && typeof advanced === "object" && typeof advanced.completionURL === "string" ? advanced.completionURL : "";
            if (typeof nested === "string" && nested.trim()) return nested.trim();
        } catch (_) { }
        return "";
    }

    function getHeaderCaseInsensitive(headersObj, name) {
        if (!headersObj || typeof headersObj !== "object") return "";
        const target = String(name || "").toLowerCase();
        for (const k of Object.keys(headersObj)) {
            if (String(k).toLowerCase() === target) return headersObj[k];
        }
        return "";
    }

    function normalizePathname(p) {
        return String(p || "").replace(/\/+$/, "");
    }

    function normalizeFetchUrlToString(input) {
        if (typeof input === "string") return input;
        try { if (typeof URL !== "undefined" && input instanceof URL) return input.toString(); } catch (_) { }
        try { if (input && typeof input === "object" && typeof input.url === "string") return input.url; } catch (_) { }
        return "";
    }

    function isSameUrlLoose(a, b) {
        try {
            const ua = new URL(String(a));
            const ub = new URL(String(b));
            if (ua.origin !== ub.origin) return false;
            if (normalizePathname(ua.pathname) !== normalizePathname(ub.pathname)) return false;
            return ua.search === ub.search;
        } catch (_) {
            return false;
        }
    }

    function getMethodFromFetchArgs(url, options) {
        const opt = options && typeof options === "object" ? options : null;
        const m1 = opt && typeof opt.method === "string" ? opt.method : "";
        if (m1) return String(m1).toUpperCase();
        try { if (url && typeof url === "object" && typeof url.method === "string") return String(url.method).toUpperCase(); } catch (_) { }
        return "GET";
    }

    function getHeadersFromFetchArgs(url, options) {
        const opt = options && typeof options === "object" ? options : null;
        if (opt && opt.headers) return normalizeHeadersToObject(opt.headers);
        try { if (url && typeof url === "object" && url.headers) return normalizeHeadersToObject(url.headers); } catch (_) { }
        return {};
    }

    function isChatStreamFetchToCurrentCompletionUrl(url, options) {
        const urlStr = normalizeFetchUrlToString(url);
        if (!urlStr) return false;
        try {
            const u = new URL(urlStr);
            const path = normalizePathname(u.pathname);
            if (!path.endsWith(CHAT_STREAM_PATH)) return false;

            const method = getMethodFromFetchArgs(url, options);
            if (method !== "POST") return false;

            const completionUrl = tryLoadCompletionUrlFromVscode();
            if (completionUrl) {
                const expected = new URL("chat-stream", completionUrl);
                return u.origin === expected.origin && normalizePathname(u.pathname) === normalizePathname(expected.pathname);
            }

            const headersObj = getHeadersFromFetchArgs(url, options);
            const ua = String(getHeaderCaseInsensitive(headersObj, "user-agent") || "");
            if (ua && ua.includes(AUGMENT_UA_HINT)) return true;
            return true;
        } catch (_) {
            return false;
        }
    }

    function normalizeHeadersToObject(headers) {
        if (!headers) return {};
        if (typeof headers === "object" && !Array.isArray(headers) && typeof headers.forEach !== "function") return { ...headers };
        try {
            const out = {};
            if (typeof headers.forEach === "function") {
                headers.forEach((value, key) => { out[key] = value; });
                return out;
            }
        } catch (_) { }
        try {
            if (Array.isArray(headers)) {
                const out = {};
                for (const pair of headers) {
                    if (!pair || pair.length < 2) continue;
                    out[pair[0]] = pair[1];
                }
                return out;
            }
        } catch (_) { }
        return {};
    }

    function stripForwardedHeaders(headersObj) {
        const headers = { ...headersObj };
        delete headers["authorization"]; delete headers["Authorization"];
        for (const k of Object.keys(headers)) {
            const lk = String(k).toLowerCase();
            if (lk.startsWith("x-signature-")) delete headers[k];
        }
        delete headers["x-signature-failure-reason"];
        return headers;
    }

    function createNdjsonErrorLine(message) {
        const errorChunk = { text: `❌ [ChatStreamForward Error] ${message}`, nodes: [], stop_reason: 1 };
        return JSON.stringify(errorChunk) + "\n";
    }

    function createOkResponseFromText(text) {
        const ResponseCtor = typeof globalThis !== "undefined" ? globalThis.Response : undefined;
        if (typeof ResponseCtor !== "function") throw new Error("Response 在当前运行时不可用");
        return new ResponseCtor(text, { status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
    }

    async function maybeNormalizeInitFromRequest(fetchInput, fetchInit) {
        if (fetchInit && typeof fetchInit === "object") return fetchInit;
        if (!fetchInput || typeof fetchInput !== "object") return fetchInit;
        if (typeof fetchInput.url !== "string" || typeof fetchInput.method !== "string" || !fetchInput.headers) return fetchInit;
        try {
            const req = typeof fetchInput.clone === "function" ? fetchInput.clone() : fetchInput;
            const body = typeof req.text === "function" ? await req.text() : undefined;
            return { method: fetchInput.method, headers: fetchInput.headers, body, signal: fetchInput.signal };
        } catch (e) {
            throw new Error(`无法读取 fetch(Request) 的 body：${e && e.message ? e.message : String(e)}`);
        }
    }

    function buildForwardedFetchInit(originalInit, cfg) {
        const init = originalInit && typeof originalInit === "object" ? originalInit : {};
        const headers0 = normalizeHeadersToObject(init.headers);
        const headers = stripForwardedHeaders(headers0);
        delete headers["content-type"]; delete headers["Content-Type"];
        headers["Content-Type"] = "application/json";
        return { ...init, headers, body: init.body, signal: init.signal };
    }

    if (typeof globalThis === "undefined" || typeof globalThis.fetch !== "function") return;
    if (globalThis._chatStreamFetchIntercepted) return;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async function (url, options) {
        if (!isByokEnabled()) return originalFetch.apply(this, arguments);
        if (!isChatStreamFetchToCurrentCompletionUrl(url, options)) return originalFetch.apply(this, arguments);

        const cfg = getConfigSync();
        if (!cfg) return originalFetch.apply(this, arguments);

        let forwardUrl;
        try { forwardUrl = validateConfig(cfg); } catch (e) { log("warn", "配置缺失/非法，chat-stream-forward passthrough:", e && e.message ? e.message : String(e)); return originalFetch.apply(this, arguments); }

        try {
            const urlStr = normalizeFetchUrlToString(url) || String(url || "");
            if (isSameUrlLoose(urlStr, forwardUrl)) throw new Error("转发目标 api_url 与当前请求 URL 相同，拒绝转发（避免递归）");

            log("info", "=== Fetch 拦截到 chat-stream 请求 ===");
            log("debug", "原始URL:", urlStr);
            if (cfg.__source) log("debug", "配置来源:", cfg.__source);
            log("info", "转发到:", forwardUrl);

            const normalizedInit = await maybeNormalizeInitFromRequest(url, options);
            const forwardedInit = buildForwardedFetchInit(normalizedInit, cfg);
            return await originalFetch.call(this, String(forwardUrl), forwardedInit);
        } catch (error) {
            const msg0 = error && error.message ? error.message : String(error);
            const cause0 = error && error.cause ? (error.cause.message ? error.cause.message : String(error.cause)) : "";
            const msg = cause0 ? `${msg0} (cause: ${cause0})` : msg0;
            log("error", "Fetch 转发失败:", msg);
            return createOkResponseFromText(createNdjsonErrorLine(msg));
        }
    };

    globalThis._chatStreamFetchIntercepted = true;
    console.log("[ChatStreamForward] ✅ Fetch 拦截器已安装（BYOK enabled + 配置门控）");

    const cfg0 = getConfigSync();
    if (cfg0) {
        try {
            const forwardUrl0 = validateConfig(cfg0);
            console.log("[ChatStreamForward] ✅ 配置已加载（仅 BYOK enabled 时生效）");
            if (cfg0.__source) console.log("[ChatStreamForward] 配置来源:", cfg0.__source);
            console.log("[ChatStreamForward] 转发地址:", forwardUrl0);
        } catch (e) {
            console.warn("[ChatStreamForward] ⚠️ 配置非法，将 passthrough:", e && e.message ? e.message : String(e));
        }
    } else {
        console.log("[ChatStreamForward] ℹ️ 未找到转发配置，将 passthrough（不影响原生请求）");
    }

    console.log("[ChatStreamForward] ✅ 初始化完成 - chat-stream forward 已就绪（以 completionURL 同源 + 实际 chat-stream 路径为准）");
})();
// === Chat-Stream Forward Interceptor End ===
