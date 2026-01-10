# Augment BYOK（重写版）

目标：只维护“补丁与工具链”，不再把官方 `augment.vscode-augment` 的产物源码直接嵌进仓库；构建时自动从 Marketplace 下载 VSIX → 解包 → 打补丁 → 重新打包输出内部安装用 VSIX。

## 快速开始

- 安装依赖：`pnpm install`
- 构建内部 VSIX：`pnpm build:vsix`
- 产物输出：`dist/` 下的 `*.vsix`

## 目录结构（A3P）

本项目按 “层级 > 领域 > 单元” 组织：
- `packages/byok-runtime/src/entry|coord|mol|atom/`：BYOK runtime（注入到上游 extension）
- `tools/entry/<capability>/`：可执行入口脚本（`pnpm build:*` / `pnpm upstream:*` / `pnpm check:*` / `pnpm test:*`）
- `tools/mol/vsix-patch-set/`：构建期 patch 集（最小补丁 + marker + fail-fast）
- `tools/atom/`：构建/分析工具的可复用库与脚本（如 upstream 下载/分析、打包工具）

## 上游（Marketplace）

- 默认下载：`augment.vscode-augment` 最新版 VSIX（Marketplace public gallery API）
- 下载 URL（GET）：`https://marketplace.visualstudio.com/_apis/public/gallery/publishers/augment/vsextensions/vscode-augment/latest/vspackage`

## 端点/上游 Profile（单一真相）

当前开发联调的 relay：`https://acemcp.heroman.wtf/relay/`

- Relay 端点支持集合：`config/relay-profiles/acemcp-heroman-relay.json`
- LLM 可替代端点清单：`config/byok-routing/llm-endpoints.json`

## 上游同步与分析（保持“官方最新版”可审计）

- 下载最新上游 VSIX（临时解包用于校验，默认自动清理）：`pnpm upstream:sync`
- 抽取上游引用的端点集合（含 callApi/callApiStream 次数、context keys、feature flags）：`pnpm upstream:analyze`
- 端点覆盖对照（relay profile + LLM 端点清单 + 上游端点抽取，输出 JSON + Markdown 报告）：`pnpm check:matrix`
- get-models 实测（输出 feature_flags 报告，需要 `ACEMCP_TOKEN`）：`pnpm check:get-models:acemcp`
- relay profile 冒烟测试（需要 `ACEMCP_TOKEN`）：`pnpm test:relay:acemcp`

设置环境变量（示例）：
- zsh/bash：`export ACEMCP_TOKEN="ace_xxx"`（raw token，无需 `Bearer ` 前缀）
- PowerShell：`$env:ACEMCP_TOKEN="ace_xxx"`

报告输出（不进 git）：
- `.cache/reports/upstream-analysis.json`
- `.cache/reports/endpoint-coverage.report.json`
- `.cache/reports/endpoint-coverage.report.md`

清理缓存（减少磁盘占用）：
- `pnpm clean:cache`：删除 `.cache/work/`、`.cache/tmp/`、`.cache/upstream/unpacked/`（保留下载的 VSIX）
- `pnpm clean:cache --deps`：额外删除 `.cache/pnpm-store/`、`.cache/npm/`、`.pnpm-store/`
- `pnpm clean:cache --all`：删除整个 `.cache/`
- `pnpm clean:vscode:workspace`：删除本仓库对应的 VS Code `workspaceStorage/<hash>/`（用于避免工作区缓存影响 VSIX 联调/测试）
- `pnpm clean:vscode:augment`：删除 VS Code `globalStorage/augment.vscode-augment/`（重置 Augment 扩展的缓存/文件；不触碰 secrets/globalState DB）
- `pnpm clean:vscode:reset`：一键重置（依次执行 `clean:vscode:workspace` + `clean:vscode:augment`）

可选参数（便于未来切换 relay/profile）：
- `pnpm check:matrix -- --profile config/relay-profiles/<id>.json`
- `pnpm check:matrix -- --llm config/byok-routing/llm-endpoints.json`
- `pnpm check:matrix -- --analysis .cache/reports/upstream-analysis.json`
- `pnpm check:matrix -- --unpack-dir <path-to-unpacked-vsix>`

## 配置（BYOK Panel + 安全存储）

本项目新增 BYOK Providers 面板（Webview），用于更安全地管理 BYOK 配置：
- 非敏感（enabled/proxy.baseUrl/providers/routing）存 `globalState`
- 敏感（apiKey/token）存 `context.secrets`
- 支持 `${env:VAR}`（缺失会明确报错）

`${env:VAR}` 模板：
- 参考：`.env.example`
- 面板输入框可直接填 `${env:AUGMENT_BYOK_PROXY_TOKEN}` / `${env:AUGMENT_BYOK_PROVIDER_OPENAI_KEY}` 等占位符（由 VS Code 进程环境变量提供）

打开面板：
- 命令面板运行：`BYOK: Settings...`（command id：`vscode-augment.byok.settings`）

配置要点：
- Base URL 一律视为“服务基地址”，本项目不自动补/抽/猜 `/api` 或 `/v1`；请求统一 `${baseUrl}<endpoint>`。
- Base URL 不强制要求以 `/` 结尾：内部 join 会规范化（避免 `new URL()` 丢路径段问题）。

端点行为（strict）：
- `config/byok-routing/llm-endpoints.json` 内列出的端点：客户端拦截并走本地 BYOK Provider（OpenAI-compatible / Anthropic-native）。
- 其它端点：保持上游原逻辑严格透传（不做 stub/no-op）。
