# CLAUDE.md — VivoLog 完整开发指南

> 本文件为 AI Agent 在本仓库中工作时提供完整指引。快速参考见 `AGENTS.md`。

## 基本信息

- **类型：** Electron 桌面应用（Windows）
- **用途：** 专业日志查看器 — 查看/搜索/过滤/分析大日志文件（百万级行数）
- **入口：** `main.js` → `src/main/index.js`（编排器）
- **Node：** v24 | **Electron：** 33 | **数据库：** better-sqlite3（关键词持久化）
- **外部工具：** ripgrep (rg.exe)、Everything (es.exe)、fzf (fzf.exe)、7-Zip (7za.exe)
- **详细规范：** `.claude/rules/` 目录（按领域拆分，所有新代码必须遵循）

## 架构概览

```
main.js → src/main/index.js（编排器）→ 16 个功能模块 + log-parsers/
  preload.js → contextBridge → window.electronAPI

index.html 按依赖顺序加载 45 个脚本（分 8 层，顺序不可变）：
  Layer 1: core/ + utils/（EventBus、State、DOM、常量、工具函数、IDB、Worker管理器）
  Layer 2: Worker 管理器（parallel-filter、shared-filter、highlight-worker）
  Layer 3: 独立服务（log-interceptor、csv-table、virtual-scroll、chunk-cache 等）
  Layer 4: 依赖服务（search、filter、log-renderer、file-tree、bookmarks 等）
  Layer 5: legacy/ + services 交错加载
  Layer 6: 遗留补丁
  Layer 7: bridge.js（window ↔ App.State 状态同步）
  Layer 8: app.js（初始化编排器）
```

完整模块对照表见 `docs/module-map.md`，内核日志分析子系统见 `docs/log-analysis-system.md`。

## 关键设计模式

### IPC 通信流程：渲染进程 ↔ 主进程

```
渲染进程: electronAPI.someAction()        [preload.js 暴露 API]
  → ipcRenderer.invoke('channel-name')    [发送到主进程]
  → ipcMain.handle('channel-name', ...)   [在 src/main/ 模块中注册]
  → 返回结果                               [回到渲染进程]
```

共 94 个 IPC 通道，分布在 12 个模块中。每个模块导出 `registerIpcHandlers()`。
`preload.js` 中的 `INVOKE_CHANNELS` 对象将 API 方法名映射到通道名。
8 个 `VALID_RECEIVE_CHANNELS` 用于主进程向渲染进程推送消息。

> 新增 IPC 的完整工作流见 `.claude/skills/add-ipc-handler/SKILL.md`

### 状态管理（渲染进程）

```
旧方式: window.originalLines = [...]           （遗留代码直接写全局变量）
新方式: App.State.set('originalLines', [...])  （触发 EventBus + 监听器）
桥接: bridge.js 双向同步                       （临时的，将来会移除）
```

> 详细规范见 `.claude/rules/renderer-service.md`

### 模块模式

**渲染进程服务**：
```
services/filter/index.js  — IIFE，赋值给 window.App.Filter
  导出: { init, 数据方法, UI 方法 }
  调用方: app.js 初始化（第8层）、遗留补丁（第6层）
```

**主进程模块**：
```
src/main/file-operations.js  — CommonJS 模块
  require() 其他模块
  模块加载时注册 ipcMain.handle()
  导出: { registerIpcHandlers, 工具函数 }
```

### 通用配置持久化（Config Store）

**所有需要持久化的用户配置必须使用 Config Store，禁止用 localStorage 存配置。**

- 配置文件：`app.getPath('userData')/config.json`（主进程读写，JSON 格式）
- 主进程模块：`src/main/config-store.js`（4 个 IPC 通道）
- 渲染进程 API：`window.electronAPI.configGet(keyPath)` / `configSet(keyPath, value)` / `configDelete(keyPath)` / `configGetAll()`
- 写入有 300ms 防抖，`before-quit` 时强制刷盘

**命名空间规范**：用点分路径按模块隔离，避免冲突：

| keyPath | 用途 | 数据类型 |
|---------|------|---------|
| `fileTree.starredDirs` | 文件树星标目录 | `Array<{path, name, starredAt}>` |
| `fileTree.frequentDirs` | 文件树常用目录 | `Array<{path, name, count, lastAccess}>` |

**新增配置项规范**：
1. 在 `renderer/js/utils/constants.js` 的 `CONFIG_KEYS` 中声明 keyPath 常量
2. 渲染进程维护内存缓存（同步读 + 异步写），不要每次读都调 IPC
3. 首次使用前调用 `initXxxCache()` 从主进程加载缓存
4. 写入时同时更新缓存和调 `configSet`（fire-and-forget）
5. 命名空间格式：`{模块名}.{配置名}`，如 `filter.recentKeywords`、`window.bounds`

## 文件命名规范

| 类别 | 格式 | 示例 |
|------|------|------|
| 遗留文件 | `renderer/js/legacy/{编号-描述}.js` | `06-main-ui.js` |
| 服务模块 | `renderer/js/services/{名称}/index.js` | `filter-keyword-history/index.js` |
| 主进程模块 | `src/main/{功能}.js` | `file-operations.js` |
| CSS 组件 | `renderer/css/components/{功能}.css` | `secondary-filter.css` |

## 常见任务

### 新增 IPC 处理器

> 完整端到端示例见 `.claude/skills/add-ipc-handler/SKILL.md`

1. 在对应的 `src/main/{模块}.js` 中添加处理器
2. 如果是新通道，在 `preload.js` 的 `INVOKE_CHANNELS` 对象中添加以暴露给渲染进程
3. 渲染进程通过 `window.electronAPI.yourMethod()` 调用

### 新增渲染进程服务

> 完整端到端示例见 `.claude/skills/add-renderer-service/SKILL.md`

1. 创建 `renderer/js/services/{名称}/index.js`
2. 遵循 IIFE 模式，赋值给 `window.App.YourService`
3. 在 `index.html` 的正确依赖组中添加 `<script src="...">`
4. 如需要，在 `app.js` 中调用 `App.YourService.init()`

### 新增 CSS 组件

1. 创建 `renderer/css/components/{名称}.css`
2. 在 `index.html` 的 `<head>` 中添加 `<link rel="stylesheet">`
3. 使用 BEM 命名，不要修改 `base.css`

> 详细规范见 `.claude/rules/css-rules.md`

### 新增配置项（持久化）

1. 在 `constants.js` 的 `CONFIG_KEYS` 中声明 keyPath 常量
2. 渲染进程：维护内存缓存 + `initXxxCache()` 异步初始化 + 写时同步更新缓存并 fire-and-forget `configSet`
3. 参考实现：`core-init/index.js` 中的 `initDirectoryConfigCache` / `loadStarredDirectories` / `saveStarredDirectories`

## 遗留代码（稳定 — 修改时再迁移）

6 个活跃文件（约 25K 行）。稳定可用。仅在实际需要修改时才迁移：

| 文件 | 行数 | 迁移触发条件 |
|------|------|-------------|
| `06-main-ui.js` | 3,949 | 修改面板布局、跳转到行或事件绑定时 |
| `08-file-tree.js` | 4,735 | 修改文件树行为时 |
| `09-archive-jump.js` | 11,425 | 修改过滤、行渲染或归档浏览时 |
| `10-scroll-tools.js` | 2,594 | 修改滚动条、进度、导出或调试功能时 |
| `filter-worker-patch.js` | 2,249 | 修改过滤执行路径时 |
| `virtual-scroll-patch.js` | 514 | 修改虚拟滚动渲染时 |

> 详细规范见 `.claude/rules/legacy-rules.md`

## 日志分析子系统

`src/main/log-parsers/` 是一个自包含的子系统，用于内核日志解析和分析：

- `index.js`（222 行）— 解析器编排
- `generic-parser.js`（432 行）— 通用日志格式解析器
- `config.json` — 解析器配置
- `renderer/` — 完整的分析报告 UI（12 个 JS 文件 + 4 个 CSS）
- 由 `log-csv-exporter.js` 调用（14 个 IPC 通道，用于 CSV 导出、图表数据、统计）

> 完整文档见 `docs/log-analysis-system.md`

## ESLint 配置

- 扁平化配置（`eslint.config.js`）：`no-unused-vars` 和 `no-undef` 为错误，`no-var`/`prefer-const` 为警告，`eqeqeq` 排除 null 比较
- 全局只读变量：`electronAPI`、`JSZip`、`Papa`、`CanvasLogRenderer`
- 遗留代码（`renderer/js/legacy/**`）不参与 lint 检查

## 禁止修改

- IPC 通道名称
- `index.html` 脚本加载顺序
- `legacy/` 中的函数签名（补丁依赖精确名称）
- `preload.js` 暴露的 API 方法名

## 规范文档索引

| 文档 | 内容 |
|------|------|
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
