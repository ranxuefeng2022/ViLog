# 模块地图 — VivoLog

## src/main/（21 个文件 — Electron 主进程）

### 核心模块（16 个 + 编排器）

| 模块 | 行数 | 用途 | IPC数 | 依赖 |
|------|------|------|-------|------|
| `index.js` | 273 | 应用生命周期编排器、模块连接 | 1 | 全部 16 个模块 |
| `constants.js` | 39 | 全局常量（扩展名、端口、限制） | 0 | 无 |
| `utils.js` | 458 | 共享工具：7z、二进制检测、ZIP解压 | 0 | constants |
| `logging.js` | 201 | 控制台→文件日志、日志轮转 | 2 | constants |
| `engine.js` | 111 | Python 检测、vivo_log_engine.exe 启停 | 0 | constants |
| `tool-finder.js` | 111 | 在磁盘上查找 es.exe、rg.exe、fzf.exe、7z.exe | 0 | utils |
| `keyword-db.js` | 434 | SQLite 关键词增删改查 + 马尔科夫转换 | 12 | tool-finder |
| `remote-share-server.js` | 260 | HTTP 服务器，共享目录给远程客户端 | 0 | utils |
| `remote-client.js` | 93 | HTTP 客户端，连接远程共享目录 | 0 | 无 |
| `directory-watcher.js` | 105 | fs.watch 目录变更通知 | 2 | 无 |
| `archive-handler.js` | 1,491 | 列出/解压/流式读取 ZIP、7z、tar、tar.gz | 7 | utils |
| `temp-dir-manager.js` | 227 | 文件树中归档解压的临时目录管理 | 5 | archive-handler |
| `file-operations.js` | 1,972 | 文件读写/搜索/对话框/打开方式 | 27 | constants, tool-finder, utils, window-manager |
| `search-tools.js` | 434 | Everything es.exe + ripgrep rg.exe 搜索 | 4 | tool-finder |
| `remote-share-ipc.js` | 209 | 远程共享启停/连接的 IPC 封装 | 7 | remote-share-server, remote-client, utils |
| `auto-update.js` | 198 | 从服务器下载 ZIP 并解压到应用目录 | 2 | utils |
| `window-manager.js` | 627 | BrowserWindow 创建/控制、托盘、快捷键 | 9 | chunk-file-reader, engine, utils |

### 日志分析子系统

| 模块 | 行数 | 用途 | IPC数 | 依赖 |
|------|------|------|-------|------|
| `log-csv-exporter.js` | 952 | 日志分析、CSV 导出、图表数据、统计 | 14 | log-parsers, utils |
| `chunk-file-reader.js` | 659 | 大文件按行索引读取（分块模式） | 7 | utils |
| `analysis-worker.js` | 169 | 分析处理的 Worker 线程 | 0 | 无 |
| `analysis-report-preload.js` | 29 | 分析 BrowserWindow 的预加载脚本 | 0 | 无 |

### log-parsers/ 子目录

| 模块 | 行数 | 用途 |
|------|------|------|
| `index.js` | 222 | 解析器编排 |
| `generic-parser.js` | 432 | 通用日志格式解析器 |
| `config.json` | 7 KB | 解析器配置 |
| `renderer/` | 2,258 | 完整分析报告 UI（12 个 JS + 4 个 CSS） |

**IPC 通道总数：93**（分布在 12 个含 `registerIpcHandlers` 的模块中）

### 跨模块依赖关系（主进程）

```
index.js 编排：
  window-manager ← temp-dir-manager（getter 注入）
  keyword-db     ← window-manager    （getter 注入，用于广播）
  file-operations ← window-manager  （getWindows，用于预览）
  file-operations → setupIPC(mainWindow) 在窗口创建后调用

依赖图（简化）：
  constants ← utils ← tool-finder ← { keyword-db, search-tools }
  constants ← utils ← { archive-handler, remote-share-server, auto-update, temp-dir-manager }
  utils ← window-manager ← chunk-file-reader
  remote-share-ipc ← { remote-share-server, remote-client }
  log-csv-exporter ← log-parsers
```

---

## renderer/js/services/（20 个模块 — Electron 渲染进程）

| 模块 | 行数 | 用途 | window.App API |
|------|------|------|----------------|
| `log-interceptor/` | 101 | 拦截 console.* → 保存到主进程日志 | LogInterceptor |
| `core-init/` | 768 | 全局变量、字体缩放、DOM 池、内存统计 | CoreInit |
| `bookmarks/` | 1,736 | 书签增删改查、右键菜单、行选择、滚动工具 | Bookmarks |
| `csv-table-renderer/` | 2,688 | CSV 表格渲染，支持列调整/排序 | （无 — 自初始化） |
| `vlog-parser/` | 204 | 解析 VLog 电池数据文件 | （无 — 自初始化） |
| `filter-keyword-history/` | 1,814 | 关键词数据层 + 对话框 UI + fzf/SQL/Worker 搜索 | FilterKeywordHistory |
| `secondary-filter-canvas/` | 606 | 基于 Canvas 的二级过滤面板渲染 | （无 — 自初始化） |
| `virtual-scroll/` | 667 | 虚拟滚动，含 DOM 池 + 高亮缓存系统 | VirtualScroll |
| `context-menu/` | 27 | 右键菜单 API | ContextMenu |
| `search/` | 152 | 搜索系统 | Search |
| `filter/` | 200 | 基于索引的过滤 API | Filter |
| `log-renderer/` | 33 | 日志渲染 API | LogRenderer |
| `file-tree/` | 27 | 文件树 API | FileTree |
| `log-loader/` | 23 | 日志文件加载 API | LogLoader |
| `ui/` | 42 | UI 状态管理 API | UI |
| `quick-links/` | 21 | 快捷链接面板 API | QuickLinks |
| `remote-share/` | 27 | 远程共享连接 + IPC | RemoteShare |
| `remote-share/connect.js` | — | 远程共享连接逻辑 | （内部） |
| `secondary-filter/` | 760 | 二级过滤面板 UI | SecondaryFilter |
| `chunk-cache/` | 490 | 大文件按行索引的分块缓存 | ChunkCache |
| `filtered-chunk-cache/` | 308 | 过滤结果的分块缓存 | FilteredChunkCache |
| `search/history.js` | — | 搜索历史管理 | （内部） |

---

## renderer/js/core/（4 个模块）

| 模块 | 行数 | window.App | 用途 |
|------|------|------------|------|
| `event-bus.js` | 81 | EventBus | 发布/订阅：模块间 on/off/emit/once 通信 |
| `state.js` | 227 | State | 集中式状态管理，含 getter/setter + 变更通知 |
| `dom-elements.js` | 78 | DOM | DOM 元素缓存（getElementById 备忘录） |
| `console-guard.js` | 43 | — | 控制台覆写/守卫工具 |

---

## renderer/js/utils/（6 个模块）

| 模块 | 行数 | window.App | 用途 |
|------|------|------------|------|
| `constants.js` | 118 | Constants | 虚拟滚动配置、高亮默认值、存储键名 |
| `helpers.js` | 155 | Utils | 通用辅助函数 |
| `idb-storage.js` | 265 | IDB | IndexedDB 关键词持久化（增删改查、搜索、转换） |
| `log-indexer.js` | 701 | — | Filter/Search 服务使用的全文索引引擎 |
| `server-config.js` | 64 | ServerConfig | 远程服务器地址管理 |
| `worker-manager.js` | 349 | WorkerManager | Web Worker 生命周期管理 |

---

## renderer/js/legacy/（7 个文件 — 6 个活跃 + 1 个空壳）

| 文件 | 行数 | 状态 | 迁移触发条件 |
|------|------|------|-------------|
| `06-main-ui.js` | 3,949 | 活跃 | 修改面板布局、跳转到行或事件绑定时 |
| `08-file-tree.js` | 4,735 | 活跃 | 修改文件树行为时 |
| `09-archive-jump.js` | 11,425 | 活跃 | 修改过滤、行渲染或归档浏览时 |
| `10-scroll-tools.js` | 2,594 | 活跃 | 修改滚动条、进度、导出或调试功能时 |
| `filter-worker-patch.js` | 2,249 | 活跃 | 修改过滤执行路径时 |
| `virtual-scroll-patch.js` | 514 | 活跃 | 修改虚拟滚动渲染时 |
| `filter-keyword-history-patch.js` | 9 | 空壳 | 已迁移至 services/filter-keyword-history/ |

---

## renderer/workers/（9 个 Web Worker — 共 3,031 行）

| Worker | 行数 | 用途 |
|--------|------|------|
| `aho-corasick.js` | 278 | 多模式匹配 |
| `csv-parser-worker.js` | 263 | CSV 文件解析 |
| `filter-worker.js` | 423 | 日志行过滤 |
| `fuzzy-match-worker.js` | 146 | 模糊关键词匹配 |
| `highlight-worker.js` | 325 | 搜索结果高亮 |
| `index-builder-worker.js` | 318 | 搜索索引构建 |
| `parallel-filter-worker.js` | 417 | 并行过滤 |
| `shared-filter-worker.js` | 357 | 共享过滤 Worker |
| `stats-calculator-worker.js` | 504 | 统计计算 |

---

## renderer/css/components/（13 个 CSS 文件 — 共 11,662 行）

| 文件 | 行数 | 样式说明 |
|------|------|---------|
| `base.css` | 4,991 | 重置、布局、工具栏、对话框、滚动条、主题（未被 index.html 引用 — 遗留/废弃） |
| `base-layout.css` | 1,558 | 主布局结构 |
| `panels.css` | 1,645 | 面板组件 |
| `file-tree.css` | 836 | 文件树样式 |
| `menus.css` | 577 | 菜单组件 |
| `secondary-filter.css` | 577 | 二级过滤面板 |
| `csv-chart.css` | 451 | CSV 图表对话框 |
| `csv-table.css` | 250 | CSV 表格渲染 |
| `log-content.css` | 229 | 日志内容区域 |
| `ai-panel.css` | 161 | AI 助手面板 |
| `goto-line.css` | 150 | 跳转到行对话框 |
| `progress-bar.css` | 136 | 进度条 |
| `virtual-scroll.css` | 101 | 虚拟滚动容器 |

---

## 其他关键文件

| 文件 | 行数 | 用途 |
|------|------|------|
| `main.js` | 1 | Electron 入口垫片（`require('./src/main/index.js')`） |
| `preload.js` | 189 | contextBridge → electronAPI（62 个 invoke 通道 + 8 个 receive 通道） |
| `index.html` | ~850 | 主窗口 HTML（45 个脚本、12 个 CSS 链接、2 个 CDN） |
| `renderer/js/bridge.js` | 111 | 状态同步：window.xxx ↔ App.State |
| `renderer/js/app.js` | 109 | 渲染进程初始化编排器 |
