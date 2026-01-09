#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const MARKER = "__augment_byok_main_panel_error_overlay_patched";

function patchMainPanelErrorOverlay(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const anchor = "Monaco bootstrap script";
  const anchorIndex = original.indexOf(anchor);
  if (anchorIndex < 0) throw new Error(`main-panel.html patch: anchor not found (${anchor})`);

  const closeScriptIndex = original.indexOf("</script>", anchorIndex);
  if (closeScriptIndex < 0) throw new Error("main-panel.html patch: closing </script> not found after anchor");

  const injection =
    `\n\n;(()=>{try{if(window.__augment_byok_error_overlay_installed)return;window.__augment_byok_error_overlay_installed=true;` +
    `const show=(title,msg)=>{try{const id=\"__augment_byok_error_overlay\";let el=document.getElementById(id);if(!el){el=document.createElement(\"div\");el.id=id;` +
    `el.style.position=\"fixed\";el.style.inset=\"0\";el.style.zIndex=\"2147483647\";el.style.background=\"var(--vscode-editor-background,#111)\";` +
    `el.style.color=\"var(--vscode-editor-foreground,#eee)\";el.style.padding=\"12px\";el.style.overflow=\"auto\";el.style.whiteSpace=\"pre-wrap\";` +
    `el.style.fontFamily=\"var(--vscode-editor-font-family,ui-monospace,monospace)\";el.style.fontSize=\"12px\";document.body.appendChild(el);}el.textContent=` +
    `\"[Augment BYOK] Webview crashed\\n\\n\"+String(title||\"Error\")+\"\\n\\n\"+String(msg||\"\");}catch{}};` +
    `window.addEventListener(\"error\",(e)=>{try{const err=e&&e.error?e.error:null;const stack=err&&err.stack?err.stack:\"\";const msg=stack||((e&&e.message)?e.message:String(e));const m=String((e&&e.message)?e.message:(err&&err.message)?err.message:msg||\"\");const all=String(m||\"\")+\"\\n\"+String(msg||\"\");if(all&&/ResizeObserver loop/i.test(all)){console.warn(\"[Augment BYOK] ignored ResizeObserver loop\",m||msg);return;}if(all&&/MessageTimeout/i.test(all)){console.warn(\"[Augment BYOK] ignored MessageTimeout\",m||msg);return;}` +
    `console.error(\"[Augment BYOK] webview error\",e);show(\"window.error\",msg);}catch{}});` +
    `window.addEventListener(\"unhandledrejection\",(e)=>{try{const r=e&&e.reason!==void 0?e.reason:e;const msg=r&&r.stack?r.stack:typeof r==\"string\"?r:JSON.stringify(r,null,2);const m=String(r&&r.message?r.message:msg||\"\");const all=String(m||\"\")+\"\\n\"+String(msg||\"\");if(all&&/ResizeObserver loop/i.test(all)){console.warn(\"[Augment BYOK] ignored ResizeObserver loop\",m||msg);return;}if(all&&/MessageTimeout/i.test(all)){console.warn(\"[Augment BYOK] ignored MessageTimeout\",m||msg);return;}` +
    `console.error(\"[Augment BYOK] unhandledrejection\",e);show(\"unhandledrejection\",msg);}catch{}});` +
    `}catch{}})();/*${MARKER}*/\n`;

  const next = original.slice(0, closeScriptIndex) + injection + original.slice(closeScriptIndex);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched" };
}

module.exports = { patchMainPanelErrorOverlay };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/common-webviews/main-panel.html>`);
    process.exit(2);
  }
  patchMainPanelErrorOverlay(p);
}
