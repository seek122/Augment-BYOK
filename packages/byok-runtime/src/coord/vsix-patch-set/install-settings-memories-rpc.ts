import fs from "fs";
import os from "os";
import path from "path";
import { AUGMENT_BYOK } from "../../constants";

function isAugmentSettingsPanel(viewType: unknown, title: unknown): boolean {
  const vt = typeof viewType === "string" ? viewType : "";
  const t = typeof title === "string" ? title : "";
  if (vt === "augmentSettingsPanel") return true;
  if (vt && /augment.*settings/i.test(vt)) return true;
  if (t === "Augment Settings") return true;
  if (t && /^augment\s+settings/i.test(t)) return true;
  return false;
}

export function installSettingsMemoriesRpc({ vscode, context, logger = console }: { vscode: any; context: any; logger?: Console }): void {
  try {
    if ((globalThis as any)[AUGMENT_BYOK.settingsMemoriesRpcPatchedGlobalKey]) return;
    (globalThis as any)[AUGMENT_BYOK.settingsMemoriesRpcPatchedGlobalKey] = true;

    const window = vscode?.window;
    if (!window || typeof window.createWebviewPanel !== "function") return;

    const createWebviewPanelOriginal = window.createWebviewPanel.bind(window);
    const registerWebviewPanelSerializerOriginal =
      typeof window.registerWebviewPanelSerializer === "function" ? window.registerWebviewPanelSerializer.bind(window) : null;

    window.createWebviewPanel = function patchedCreateWebviewPanel(viewType: unknown, title: unknown, showOptions: unknown, options: unknown) {
      const panel = createWebviewPanelOriginal(viewType, title, showOptions, options);
      try {
        if (isAugmentSettingsPanel(viewType, title)) attachSettingsMemoriesHandlers({ vscode, context, panel, logger });
      } catch (e: any) {
        try {
          logger.warn?.(`settings memories handler attach failed: ${String(e?.message || e)}`);
        } catch {
          // ignore
        }
      }
      return panel;
    };

    if (registerWebviewPanelSerializerOriginal) {
      window.registerWebviewPanelSerializer = function patchedRegisterWebviewPanelSerializer(viewType: unknown, serializer: any) {
        try {
          if (isAugmentSettingsPanel(viewType, "") && serializer && typeof serializer.deserializeWebviewPanel === "function") {
            const serializerKey = "__augment_byok_settings_memories_serializer_patched";
            let alreadyPatched = false;
            try {
              alreadyPatched = Boolean(serializer[serializerKey]);
            } catch {
              alreadyPatched = false;
            }
            if (alreadyPatched) return registerWebviewPanelSerializerOriginal(viewType, serializer);

            try {
              if (!serializer[serializerKey]) Object.defineProperty(serializer, serializerKey, { value: true, enumerable: false, configurable: true });
            } catch {
              try {
                if (!serializer[serializerKey]) serializer[serializerKey] = true;
              } catch {
                // ignore
              }
            }

            try {
              const deserializeOriginal = serializer.deserializeWebviewPanel.bind(serializer);
              serializer.deserializeWebviewPanel = async (panel: any, state: any) => {
                try {
                  attachSettingsMemoriesHandlers({ vscode, context, panel, logger });
                } catch (e: any) {
                  try {
                    logger.warn?.(`settings memories handler attach failed (deserialize): ${String(e?.message || e)}`);
                  } catch {
                    // ignore
                  }
                }
                return await deserializeOriginal(panel, state);
              };
            } catch (e: any) {
              try {
                logger.warn?.(`settings memories serializer patch failed: ${String(e?.message || e)}`);
              } catch {
                // ignore
              }
            }
          }
        } catch {
          // ignore
        }
        return registerWebviewPanelSerializerOriginal(viewType, serializer);
      };
    }

    try {
      logger.info?.("[BYOK] Settings Memories file RPC installed");
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

function attachSettingsMemoriesHandlers({ vscode, context, panel, logger }: { vscode: any; context: any; panel: any; logger: any }): void {
  const webview = panel?.webview;
  if (!webview || typeof webview.onDidReceiveMessage !== "function" || typeof webview.postMessage !== "function") return;

  const attachedKey = "__augment_byok_settings_memories_rpc_attached";
  try {
    if (panel[attachedKey]) return;
    Object.defineProperty(panel, attachedKey, { value: true, enumerable: false, configurable: true });
  } catch {
    try {
      if (panel[attachedKey]) return;
      panel[attachedKey] = true;
    } catch {
      // ignore
    }
  }

  try {
    logger.info?.("[BYOK] Settings Memories webview handler attached");
  } catch {
    // ignore
  }

  const memoriesFilePath = resolveMemoriesFilePath({ vscode, context });

  let opChain: Promise<void> = Promise.resolve();
  const runExclusive = async (fn: () => Promise<void>) => {
    const next = opChain.then(fn, fn);
    opChain = next.then(
      () => void 0,
      () => void 0
    );
    return await next;
  };

  const onMessage = async (msg: any) => {
    if (!msg || typeof msg !== "object") return;
    const isAsyncWrapper = msg.type === "async-wrapper" && msg.baseMsg && typeof msg.baseMsg === "object";
    const requestId = isAsyncWrapper && typeof msg.requestId === "string" ? msg.requestId : "";
    const baseMsg = isAsyncWrapper ? msg.baseMsg : msg;
    const baseType = baseMsg?.type;
    if (baseType !== "load-memories-file-request" && baseType !== "save-memories-file-request") return;

    const postResponse = async (type: string, data: any) => {
      if (isAsyncWrapper) {
        if (!requestId) return;
        return await webview.postMessage({ type: "async-wrapper", requestId, error: null, baseMsg: { type, data } });
      }
      return await webview.postMessage({ type, data });
    };

    if (baseType === "load-memories-file-request") {
      await runExclusive(async () => {
        try {
          if (!memoriesFilePath) throw new Error("Memories file path not available");
          const payload = await readMemoriesFile(memoriesFilePath);
          await postResponse("load-memories-file-response", payload);
        } catch (e: any) {
          const error = String(e?.message || e);
          await postResponse("load-memories-file-response", { path: "", content: "", error });
          try {
            logger.warn?.(`[BYOK] load-memories-file failed: ${memoriesFilePath || "(no-path)"}: ${error}`);
          } catch {
            // ignore
          }
        }
      });
    }

    if (baseType === "save-memories-file-request") {
      await runExclusive(async () => {
        const content = typeof baseMsg?.data?.content === "string" ? baseMsg.data.content : "";
        try {
          if (!memoriesFilePath) throw new Error("Memories file path not available");
          await writeMemoriesFile(memoriesFilePath, content);
          await postResponse("save-memories-file-response", { ok: true, path: memoriesFilePath });
        } catch (e: any) {
          const error = String(e?.message || e);
          await postResponse("save-memories-file-response", { ok: false, path: memoriesFilePath || "", error });
          try {
            logger.warn?.(`[BYOK] save-memories-file failed: ${memoriesFilePath || "(no-path)"}: ${error}`);
          } catch {
            // ignore
          }
        }
      });
    }
  };

  const sub = webview.onDidReceiveMessage(onMessage);
  try {
    panel.onDidDispose(() => sub.dispose());
  } catch {
    // ignore
  }
}

function resolveMemoriesFilePath({ vscode, context }: { vscode: any; context: any }): string | null {
  const storageDir = typeof context?.storageUri?.fsPath === "string" ? context.storageUri.fsPath.trim() : "";
  const globalStorageDir = typeof context?.globalStorageUri?.fsPath === "string" ? context.globalStorageUri.fsPath.trim() : "";
  const workspaceRoot = typeof vscode?.workspace?.workspaceFolders?.[0]?.uri?.fsPath === "string" ? vscode.workspace.workspaceFolders[0].uri.fsPath.trim() : "";
  const homeRoot = typeof os?.homedir === "function" ? String(os.homedir() || "").trim() : "";

  const baseDir = globalStorageDir || (workspaceRoot ? path.join(workspaceRoot, ".augment") : "") || storageDir || (homeRoot ? path.join(homeRoot, ".augment") : "");
  if (!baseDir) return null;

  const fileName = typeof AUGMENT_BYOK.memoriesFileName === "string" && AUGMENT_BYOK.memoriesFileName.trim() ? AUGMENT_BYOK.memoriesFileName.trim() : "Augment-Memories";
  return path.join(baseDir, fileName);
}

async function ensureMemoriesFile(filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
  } catch {
    await fs.promises.writeFile(filePath, "", "utf8");
  }
}

async function readMemoriesFile(filePath: string): Promise<{ path: string; content: string }> {
  await ensureMemoriesFile(filePath);
  const content = await fs.promises.readFile(filePath, "utf8");
  return { path: filePath, content };
}

async function writeMemoriesFile(filePath: string, content: string): Promise<void> {
  await ensureMemoriesFile(filePath);
  await fs.promises.writeFile(filePath, content, "utf8");
}
