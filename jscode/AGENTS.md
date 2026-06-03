# AGENTS.md — AI Agent Quick Reference

> **1 页速查** — 详细规范见 `CLAUDE.md` 和 `.claude/rules/`

## Stack

Electron 33 + Node v24 | better-sqlite3 | rg.exe / es.exe / fzf.exe / 7z.exe (via `tool-finder.js`)

## Commands

```bash
npm start              # 启动应用
npm start -- --debug   # 调试模式
npm test               # 全部测试（仅 2 个文件）
npm run lint           # ESLint（不含 legacy/）
node -c <file>         # 语法检查（每次编辑后必做！）
```

## ⛔ 强制：每次编辑后 `node -c <file>`

验证顺序：`node -c` → `npm run lint` → `npm test`

## 架构速览

```
main.js → src/main/index.js（编排器，16 模块，registerIpcHandlers）
preload.js → INVOKE_CHANNELS（camelCase→kebab-case 映射）
index.html → 45 脚本 8 层加载（顺序不可变）
  Layer 1: core/ + utils/    Layer 5: legacy + services
  Layer 2: workers           Layer 6: patches
  Layer 3: 独立服务           Layer 7: bridge.js
  Layer 4: 依赖服务           Layer 8: app.js
```

## 关键规则

| 规则 | 说明 |
|------|------|
| 状态管理 | 新代码只用 `App.State.get/set()`，禁止 `window.xxx` |
| 遗留代码 | 不改签名、不删函数、不调顺序、需改才迁移 |
| IPC 三步走 | 主进程处理器 → preload 映射 → 渲染进程调用 |
| 服务模板 | IIFE + `'use strict'` + `var` + `init()` + `window.App.Xxx` |
| 日志前缀 | `console.log('[ModuleName]', ...)` |
| CSS | BEM 命名，新文件放 `renderer/css/components/`，不改 `base.css` |

## 文档索引

| 文档 | 内容 |
|------|------|
| `CLAUDE.md` | 完整架构、设计模式、常见任务、禁止修改清单 |
| `docs/module-map.md` | 模块对照表（行数、IPC 数、依赖关系） |
| `docs/log-analysis-system.md` | 日志分析子系统完整文档 |
| `.claude/rules/general.md` | 命名约定、ESLint、日志、提交清单 |
| `.claude/rules/main-process.md` | 主进程模块规范、IPC 通道注册 |
| `.claude/rules/renderer-service.md` | 渲染进程服务模板、状态管理、事件通信 |
| `.claude/rules/legacy-rules.md` | 遗留代码交互规范 |
| `.claude/rules/css-rules.md` | CSS 规范：BEM、作用域 |
| `.claude/rules/error-handling.md` | 错误处理模式 |
| `.claude/rules/performance.md` | 性能优化指南 |
| `.claude/rules/security.md` | 安全规范 |
| `.claude/rules/debugging.md` | 调试工作流 |
| `.claude/rules/testing.md` | 测试策略 |
| `.claude/skills/add-ipc-handler/` | 新增 IPC 通道工作流（含完整示例） |
| `.claude/skills/add-renderer-service/` | 新增渲染进程服务工作流（含完整示例） |
