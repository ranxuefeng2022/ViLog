# VivoLog — 专业日志查看器

基于 Electron 的 Windows 日志查看器。支持查看、搜索、过滤和分析大日志文件（百万级行数），内置 ripgrep 高速搜索和多窗口支持。

## 快速开始

```bash
# Windows
start.bat

# 或手动启动
npm install
npm start
```

## 架构

```
main.js                          Electron 主进程入口（薄垫片）
src/main/                        21 个模块（93 个 IPC 通道）
  index.js                       应用编排器 + 模块连接
  log-parsers/                   日志分析子系统（解析器 + 渲染 UI）
renderer/                        渲染进程
  js/
    core/                        基础设施（EventBus、State、DOM 缓存）
    utils/                       工具（常量、辅助函数、IDB、日志索引器、Worker 管理器）
    services/                    20 个服务模块（过滤、搜索、虚拟滚动等）
    legacy/                      4 个遗留文件 + 2 个补丁 + 1 个空壳（约 25K 行）
    bridge.js                    状态同步桥接（遗留 ↔ 新架构）
    app.js                       应用入口
  workers/                       9 个 Web Worker（过滤、高亮、模糊匹配等）
  css/components/                13 个 CSS 组件文件
index.html                       主窗口 HTML
preload.js                       Electron 预加载（暴露 62 个 API 方法）
```

## 主要依赖

- **Electron** 33 — 桌面外壳
- **better-sqlite3** — 关键词持久化
- **ripgrep** (rg.exe) — 高速文本搜索
- **Everything** (es.exe) — 文件系统搜索
- **fzf** (fzf.exe) — 模糊关键词搜索
- **7-Zip** (7za.exe) — 归档解压

## 开发

```bash
npm start              # 启动应用
npm start -- --debug   # 以调试模式启动
npm test               # 运行测试 (node --test test/*.test.js)
npm run lint           # ESLint（检查 src/、renderer/js/core/、renderer/js/services/、preload.js）
```

## 文档

- `CLAUDE.md` — AI 助手指引（架构、模式、规范）
- `docs/module-map.md` — 完整模块对照表
- `docs/log-analysis-system.md` — 内核日志分析子系统设计
