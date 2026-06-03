# 日志分析系统 — 架构与开发指南

## 概述

日志分析系统从 ZIP 归档内的内核日志文件中提取结构化数据，使用可配置的 printf 风格格式定义。它在多个 Worker 线程中解析百万级日志行，将结果存储到 SQLite（零内存占用），然后在自包含的 HTML 报告窗口中展示结果，包含 Canvas 渲染的虚拟滚动表格、趋势图表、统计分析和 CSV 导出功能。

## 架构图

```
用户选择 ZIP + 平台 + 关键词（渲染进程: 08-file-tree.js）
  │
  ▼ IPC: export-csv-analysis
log-csv-exporter.js（主进程）
  ├── listZipEntries() — 解析 ZIP 中央目录
  ├── 按 config.filePatterns 过滤 kernel_log 文件
  ├── runWorkers() — 分发到 N 个 Worker 线程
  │     │
  │     ▼（每个 worker）
  │   analysis-worker.js
  │     ├── buildZipIndex() — 一次性解析 ZIP 中央目录
  │     ├── 对每个日志文件条目：
  │     │     ├── extractByIndex() — 解压条目
  │     │     ├── 收集 android_time 锚点
  │     │     └── 对每个解析器 × 每行：
  │     │           └── parser.parse(line, fileName)
  │     │                 ├── 策略1：编译正则（快速路径）
  │     │                 └── 策略2：智能键值回退
  │     └── parentPort.postMessage(results)
  │
  ├── 按 keyword_platform 键合并 Worker 结果
  ├── buildTabMetadata() — 构建 Tab 结构，自动隐藏空列
  ├── writeToDatabase() — 将所有行写入 SQLite (mem/analysis_<时间戳>.db)
  ├── generateStaticHTML() — HTML 模板（从 renderer/ 文件读取 CSS/JS）
  └── 在无边框 BrowserWindow 中打开
        │
        ▼（报告窗口）
      analysis-report-preload.js — 暴露 logAnalysis API
      渲染进程 JS 模块（拼接进 HTML）：
        state.js → utils.js → tabs.js → canvas-renderer.js → selection.js
        → search.js → goto.js → stats.js → chart-renderer.js → export.js
        → iface-dialog.js → col-dialog.js → app.js
```

## 文件清单

### 核心流水线（主进程）

| 文件 | 行数 | 用途 |
|------|------|------|
| `src/main/log-parsers/config.json` | 126 | 声明式解析器定义：关键词、平台、printf 格式、标签、字段别名 |
| `src/main/log-parsers/generic-parser.js` | 432 | 将 printf 格式字符串编译为正则 + 智能键值提取器；支持逗号和空格分隔符 |
| `src/main/log-parsers/index.js` | 220 | 解析器注册表（`Map<keyword_platform, parser>`）、`generateStaticHTML()` 模板、报告生成 |
| `src/main/analysis-worker.js` | 169 | Worker 线程：ZIP 解压、逐行解析、时间戳解析 |
| `src/main/analysis-report-preload.js` | 29 | 报告窗口预加载：通过 contextBridge 暴露 `logAnalysis` API |
| `src/main/log-csv-exporter.js` | 952 | 编排器：ZIP 列出、Worker 池、结果合并、SQLite 存储、所有 IPC 处理器 |
| `src/main/utils.js` | 458 | `parseZipCentralDir()`、`extractTextFromBuffer()`、`find7z()`、ZIP/7z 工具函数 |

### 报告渲染器（构建时拼接进 HTML）

| 文件 | 行数 | 用途 |
|------|------|------|
| `renderer/js/state.js` | 47 | 全局常量（ROW_H=32, CHUNK_SIZE=3000）、DOM 引用、状态变量 |
| `renderer/js/utils.js` | 44 | `esc()`、`truncateText()`（二分查找）、`fmtN()`、`makeDraggable()` |
| `renderer/js/tabs.js` | 231 | Tab 下拉菜单、分块加载含 LRU 淘汰、`autoFitColumns()`、`renderTab()` |
| `renderer/js/canvas-renderer.js` | 217 | Canvas 绘制、滚动处理、Alt+滚轮横向滚动、resize 监听 |
| `renderer/js/selection.js` | 118 | 单元格点击/拖拽选择、剪贴板复制（Ctrl+C） |
| `renderer/js/search.js` | 69 | 搜索对话框：IPC `searchRows` + 上一个/下一个导航 |
| `renderer/js/goto.js` | 48 | 跳转到行对话框：跳转到指定行号 |
| `renderer/js/stats.js` | 234 | 统计对话框：数值列检测、最小/最大/平均/差值/百分位数 |
| `renderer/js/chart-renderer.js` | 1,077 | 多系列折线图：缩放/平移、阈值线、范围选择统计 |
| `renderer/js/export.js` | 32 | CSV 导出：IPC 模式（实时）或 Blob 下载（嵌入） |
| `renderer/js/iface-dialog.js` | 35 | 打印格式对话框：显示 printf 格式、字段映射、未匹配字段 |
| `renderer/js/col-dialog.js` | 47 | 列可见性选择器：复选框切换 |
| `renderer/js/app.js` | 58 | 初始化：窗口控制、嵌入 vs 实时模式分支 |
| `renderer/css/base.css` | 143 | 重置、布局、工具栏、滚动条、主题 |
| `renderer/css/table.css` | 65 | 表格容器、表头行、加载遮罩 |
| `renderer/css/dialogs.css` | 448 | 所有对话框覆盖层：搜索、跳转、统计、图表、列、格式、键、阈值 |
| `renderer/css/chart.css` | 95 | 图表对话框、Canvas 容器、面板、提示框 |

### 集成点

| 文件 | 用途 |
|------|------|
| `src/main/index.js` | 导入 `log-csv-exporter` 并调用 `registerIpcHandlers()` |
| `renderer/js/legacy/08-file-tree.js` | 分析触发 UI：平台选择器、关键词复选框、进度监听 |
| `preload.js` | 暴露分析 IPC 桥接（`export-csv-analysis`、`get-analysis-keywords`） |

## 配置格式（`config.json`）

```json
{
  "filePatterns": ["kernel_log"],
  "parsers": [
    {
      "tag": "ap_info_vfcs",
      "keyword": "vfcs_get_ap_state_info",
      "platform": "qcom",
      "format": [
        "[AP] chg_status=%d,vbus_mv=%d,ibus_ma=%d,...",
        "vbat_mv=%d,ibat_ma=%d,...",
        "...\\n"
      ],
      "labels": ["充电状态", "VBUS电压(mV)", "IBUS电流(mA)", ...],
      "fieldAliases": { "FG_ENCRYPTION_VERIFY_RESULT": "fg_encryption_verify_result" }
    },
    {
      "tag": "healthd_info",
      "keyword": "healthd: battery l",
      "platform": "mtk",
      "format": ["l=%d v=%d t=%.1f h=%d st=%d c=%d fc=%d cc=%d eng=%d sd=%d cs=%d bts=%d bes=%d bwtcs=%d bwttts=%d p=%d wts=%d md=%d otg=%d chg=%c\\n"],
      "labels": ["电池电量(%)", "电池电压(mV)", ...]
    }
  ]
}
```

### 字段定义

| 字段 | 必填 | 说明 |
|------|------|------|
| `tag` | 是 | 显示的 Tab 名称（如 `"healthd_info"`） |
| `keyword` | 是 | 在日志行中定位的字符串（如 `"healthd: battery l"`） |
| `platform` | 否 | `"qcom"` 或 `"mtk"` — 解析器按平台匹配 |
| `format` | 是 | printf 风格格式字符串数组（多行 C printf），或单个字符串 |
| `labels` | 是 | 每个 `%d`/`%s` 等占位符对应的中文标签，按顺序对应 |
| `fieldAliases` | 否 | `字段名 → 输出键名` 的映射，用于重命名字段（如大小写规范化） |

### 格式字符串特性

- **多行**：`format` 为数组时自动拼接。末尾的 `\\n` 会被去除。
- **自动标记提取**：行首的 `[AP]`、`[CP]` 等会自动识别为标记。
- **占位符类型**：`%d` `%i` `%u` `%x` `%X` `%o` `%s` `%c` `%f` `%F` `%e` `%E` `%g` `%G` `%a` `%A` `%p` — 全部规范化并编译为正则捕获组。
- **复合字段**：`key=%d(%d)` 产生两个字段：`key` 和 `key_2`。
- **元组字段**：`key=(%d,%d)` 产生 `key_1` 和 `key_2`。
- **十六进制前缀**：`key=0x%x` 自动处理 `0x` 字面前缀。
- **字段分隔符**：同时支持 `=` 和 `:`（如 `key:%d` 或 `key=%d`）。
- **逗号分隔格式**：`field1=%d,field2=%d,field3=%d` — 标准逗号分隔的 key=value 对。
- **空格分隔格式**：`field1=%d field2=%d field3=%d` — 空格分隔的 key=value 对（如 Android healthd 电池日志）。`splitTopLevel()` 自动检测分隔符类型。

### `filePatterns`

ZIP 内源文件匹配的文件名前缀数组。系统过滤基本名以这些前缀开头（不区分大小写）的 ZIP 条目。默认为 `["kernel_log"]`。

## 解析流水线（generic-parser.js）

### 编译阶段

1. **`preprocessFormat(format)`**：拼接多行数组 → 去除 `\\n` → 自动提取 `[xxx]` 标记。
2. **`compileFormat(fmt, labels)`**：通过 `splitTopLevel()` 按顶层逗号和空格分割格式（考虑括号嵌套）。对于空格分隔格式，检测空格后的 `key=` 模式。对每个片段，检测 `fieldName=fmtPart` 或 `fieldName:fmtPart` → 通过 `SPEC_PATTERNS` 将 `%d`/`%s` 等编译为正则捕获组。
3. **结果**：`{ fields: [{name, key, label, specType}], payloadRegex: RegExp, labelCount }`。

### 运行时解析策略（双层）

**策略1 — 编译正则（快速路径）**：
- 在行中定位载荷（标记或第一个字段名之后）。
- 与 `compiled.payloadRegex` 匹配。
- 正则在逗号分隔片段间使用 `,`，在空格分隔片段间使用 `\s+`。
- 匹配成功后，一次遍历提取所有字段并类型转换。

**策略2 — 智能键值回退**（固件格式变更时）：
- 使用正则从载荷中提取键值对（在逗号和空白处停止：`[^,\s]*`）。
- 对每个键，在 `fieldDefsMap`（按字段名构建）中查找字段定义。
- 处理元组（`key=(v1,v2)`）、复合（`key=v(sub)`）和简单值。
- 未知字段（不在配置中）静默跳过。
- 类型转换使用配置中的 spec 类型（`%d` → 整数，`%x` → 十六进制，`%f` → 浮点，`%s` → 字符串）。

### 标准前缀字段

每条解析结果包含从日志行前缀提取的这些字段：

| 键 | 标签 | 来源 |
|----|------|------|
| `source_file` | 源文件 | 传入 `parse()` 的文件名 |
| `level` | （不显示） | 行前缀的第一个逗号分隔字段 |
| `timestamp` | 时间戳(s) | 逗号分隔前缀的第二个字段 |
| `ts_raw` | 原始时间戳(μs) | 逗号分隔前缀的第三个字段 |
| `caller` | 调用线程 | 从行中提取的 `caller=Txxx` |

### 解析器模块接口

每个编译后的解析器暴露：

```js
{
  keyword: "vfcs_get_ap_state_info",
  platform: "qcom",        // 或 undefined 表示通用
  parser: {
    parse(line, sourceFile),     // → {source_file, timestamp, ts_raw, caller, ...fields} | null
    getHeaders(),                // → ["source_file", "android_time", ..., "chg_status", "vbus_mv", ...]
    getHeaderLabels(),           // → {source_file: "源文件", chg_status: "充电状态", ...}
    getTabName(),                // → "ap_info_vfcs"
    getFieldMapping(),           // → [{raw: "chg_status=%d", keys: ["chg_status"]}, ...]
    getPrintInterface()          // → "[AP] chg_status=%d,vbus_mv=%d,..."
  }
}
```

## 分析 Worker（analysis-worker.js）

### Worker 数据输入

```js
{ archivePath, entries: [文件名], keywords: [keyword_platform 字符串], platform: "mtk"|"qcom" }
```

### 处理步骤

1. **加载解析器**：先通过 `loadConfigParsers()` 加载配置解析器，再从 `parsers/` 目录加载遗留 JS 解析器（跳过已注册的 `keyword_platform`）。按请求的关键词和平台过滤。
2. **构建 ZIP 索引**：`buildZipIndex(archivePath)` — 一次性解析中央目录。
3. **对每个日志文件条目**：
   - `extractByIndex()` — 解压条目内容。
   - 单遍扫描所有行：
     - 收集 android_time 锚点（匹配 `/android time \d{4}-\d{2}-.../` 的行）。
     - 对每行运行每个解析器，收集匹配数据。
   - 排序锚点，通过二分查找为每条数据行解析 `android_time`。
4. **发送结果**：`{ "keyword_platform": [{matched, keyword, data}, ...] }`。

### 时间戳解析

- **ts_raw 格式**：`240564883` → `240.564883` 秒（后 6 位 = 微秒）。
- **android_time 锚点**：包含 `android time YYYY-MM-DD HH:MM:SS.ffffff` 的行。
- **二分查找**：对每条数据行的 `ts_raw`，找最近的锚点，计算偏移 → 格式化为 CST（UTC+8）。

## SQLite 存储（log-csv-exporter.js）

### 数据库结构

解析完成后，所有结果写入 `mem/analysis_<时间戳>.db` 的 SQLite 数据库：

```
PRAGMA: journal_mode=WAL, synchronous=OFF, cache_size=-32000 (32MB)

tab_0 (rowid INTEGER PRIMARY KEY AUTOINCREMENT, col_0 TEXT, col_1 TEXT, ...)
tab_1 (rowid INTEGER PRIMARY KEY AUTOINCREMENT, col_0 TEXT, col_1 TEXT, ...)
...
_tab_meta (tab_idx INTEGER PRIMARY KEY, meta TEXT NOT NULL)
```

- 每个解析器关键词对应一个 `tab_N` 表。
- 所有单元格值以 TEXT 存储。
- `_tab_meta` 以 JSON 存储每个 Tab 的元数据（名称、表头、宽度、键、字段映射等），用于数据库导入恢复。

### 写入流程（`writeToDatabase`）

1. 设置 WAL 模式 + OFF 同步 + 32MB 缓存以优化批量写入性能。
2. 对每个 Tab：`CREATE TABLE tab_N`，然后单事务批量 INSERT。
3. 将所有 Tab 元数据插入 `_tab_meta`。

### 读取流程（IPC 处理器）

- **分块读取**：`analysis-get-rows` 使用 `SELECT ... WHERE rowid BETWEEN ? AND ?` 进行高效范围查询。
- **搜索**：`analysis-search-rows` 构建动态 `LIKE '%term%'` 跨所有列，返回匹配的 rowid 索引。
- **图表数据**：`analysis-get-chart-series` 使用 SQL 聚合（MIN/MAX/AVG）加采样进行降采样。
- **统计**：`analysis-stats-calc` 通过 SQL 计算百分位数、标准差、差值。
- **完整导出**：`analysis-get-full-data` 使用 `stmt.iterate()` 流式读取，不将所有行加载到内存。

### 数据存储（内存句柄）

```js
analysisStore = {
  tabs: [{
    name, count, headerLabels, colWidths, keyword,
    printInterface, fieldMapping, keyLabels, keys, unmatchedFields
  }],
  db: Database,           // better-sqlite3 连接（保持打开以供按需读取）
  dbPath: 'mem/analysis_<时间戳>.db',
  dbIsImported: false,    // 如果用户导入了外部 .db 文件则为 true
  reportWindow: BrowserWindow | null
}
```

### 自动隐藏空列

在 `buildTabMetadata()` 中，每行值都为空的列会在显示时隐藏。标准前缀字段（`source_file`、`android_time`、`timestamp`、`ts_raw`、`caller`）始终保留。

### 未匹配字段

配置中定义但实际日志数据中不存在的字段会被记录为 `unmatchedFields: [{key, label}]`，并在打印格式对话框中显示橙色"未匹配"标记。

## 报告窗口

### 窗口配置

- 无边框 `BrowserWindow`（1400×900，打开时最大化）。
- 使用 `analysis-report-preload.js` 进行 IPC。
- 静态 HTML 写入临时文件，通过 `loadFile()` 加载。
- CSS/JS 源文件位于 `renderer/css/` 和 `renderer/js/`，运行时由 `readRendererFiles()` 拼接并嵌入 HTML 模板。

### 嵌入功能（渲染进程 JS 模块）

| 功能 | 模块 | 说明 |
|------|------|------|
| **Canvas 表格渲染** | `canvas-renderer.js` | 基于 Canvas 的虚拟滚动，支持百万行，行高 32px，列裁剪，HiDPI 支持 |
| **Tab 切换** | `tabs.js` | 下拉菜单含 Tab 名称 + 行数标记，LRU 分块淘汰 |
| **分块加载** | `tabs.js` | 按需行加载（CHUNK_SIZE=3000，最多 20 个分块约 60K 行在内存中） |
| **Canvas 趋势图** | `chart-renderer.js` | 多系列折线图，支持缩放/平移、阈值线、范围选择统计 |
| **统计分析** | `stats.js` | 选定行范围的最小/最大/平均/差值/标准差/百分位数 |
| **列选择器** | `col-dialog.js` | 复选框切换列可见性 |
| **搜索** | `search.js` | 在所有可见单元格中查找文本，上一个/下一个导航 |
| **跳转到行** | `goto.js` | 跳转到指定行号 |
| **单元格选择** | `selection.js` | 点击/拖拽选择单元格，复制到剪贴板 |
| **CSV 导出** | `export.js` | 将当前 Tab 导出为 CSV（实时用 IPC，嵌入用 Blob） |
| **打印格式对话框** | `iface-dialog.js` | 显示原始 printf 格式、字段映射、未匹配字段 |
| **保存报告** | 通过 IPC | 导出自包含 HTML 文件，数据内嵌 |
| **数据库导入** | 通过 IPC | 导入外部 .db 文件替换当前分析 |
| **键盘快捷键** | `app.js` | Ctrl+F（搜索）、Ctrl+G（跳转）、Ctrl+C（复制）、Ctrl+A（全选）、Esc（取消） |

### 报告窗口数据流

```
窗口加载 → 检查 __EMBEDDED_TABS/__EMBEDDED_DATA（导出的报告）
              或调用 logAnalysis.getTabs()（实时窗口）
           → buildTabButtons()、renderTab(0)
           → ensureRows() → requestChunk() → IPC getRows(tab, from, count)
           → 滚动时：drawCanvas() + 防抖 ensureRows() 预取分块
           → LRU 淘汰：内存中最多 20 个分块，释放远处分块
```

### 分块加载详情

```
CHUNK_SIZE = 3000 行
MAX_LOADED_CHUNKS = 20（每个 Tab 渲染进程内存中最多约 60K 行）

滚动事件 → requestAnimationFrame → drawCanvas()
                                 → 100ms 防抖 → ensureRows(firstRow, lastRow)
                                                    → requestChunk() 加载缺失分块
                                                    → IPC: getRows(tabIdx, from, count)
                                                    → 写入 loc.rows[]
                                                    → evictDistantChunks() 如果超过 20 个分块

Tab 切换 → 释放旧 Tab rows[] → renderTab(newIdx) → 加载第一个分块
```

### Canvas 渲染详情

```
drawCanvas():
  1. 从 scrollTop 计算可见行范围（± BUFFER=30 行）
  2. 横向列裁剪：跳过视口外的列
  3. 绘制：行号背景 → 数据背景 → 搜索高亮
     → 选择高亮 → 单元格文本（含二分查找截断）→ 网格线 → 行号
  4. 所有渲染在单个 <canvas> 元素上，按 devicePixelRatio 缩放
```

### 颜色选择器（图表面板）

- 每个系列有一个圆形颜色点（18px，border-radius 50%）。
- 使用 `-webkit-appearance: none` 样式的 `<input type="color">`。
- 悬停效果：scale(1.2) + 阴影。
- 默认调色板：Apple 系统颜色 `['#007AFF','#FF9500','#34C759','#5856D6','#FF2D55','#5AC8FA','#FFCC00','#8E8E93']`。

## IPC 通道

### 主窗口通道

| 通道 | 方向 | 处理器 | 用途 |
|------|------|--------|------|
| `get-analysis-keywords` | 渲染→主 | `log-csv-exporter.js` | 返回指定平台的可用关键词 |
| `export-csv-analysis` | 渲染→主 | `log-csv-exporter.js` | 完整分析：ZIP → 解析 → SQLite → 打开报告 |
| `csv-export-progress` | 主→渲染 | (sender.send) | 分析过程中的进度更新 |

### 报告窗口通道

| 通道 | 方向 | 处理器 | 用途 |
|------|------|--------|------|
| `analysis-get-tabs` | 报告→主 | `log-csv-exporter.js` | 获取 Tab 元数据（表头、宽度、字段映射） |
| `analysis-get-full-data` | 报告→主 | `log-csv-exporter.js` | 获取 Tab 的所有行数据（用于嵌入报告导出） |
| `analysis-get-rows` | 报告→主 | `log-csv-exporter.js` | 分块加载的行范围查询（SELECT WHERE rowid BETWEEN） |
| `analysis-search-rows` | 报告→主 | `log-csv-exporter.js` | 搜索 Tab，返回匹配的 rowid 索引（LIKE） |
| `analysis-get-chart-meta` | 报告→主 | `log-csv-exporter.js` | 检测图表的数值列（SQL 采样） |
| `analysis-get-chart-series` | 报告→主 | `log-csv-exporter.js` | 获取降采样后的图表数据点 |
| `analysis-get-chart-tooltip` | 报告→主 | `log-csv-exporter.js` | 获取图表点的悬停提示数据 |
| `analysis-stats-meta` | 报告→主 | `log-csv-exporter.js` | 检测统计的数值列 |
| `analysis-stats-calc` | 报告→主 | `log-csv-exporter.js` | 计算统计（最小/最大/平均/百分位数） |
| `analysis-export-csv` | 报告→主 | `log-csv-exporter.js` | 将 Tab 导出为 CSV 文件（从 SQLite 流式读取） |
| `save-analysis-report` | 报告→主 | `log-csv-exporter.js` | 保存自包含 HTML 报告（含嵌入数据） |
| `analysis-import-database` | 报告→主 | `log-csv-exporter.js` | 导入外部 .db 文件替换当前分析 |
| `analysis-window-minimize` | 报告→主 | `log-csv-exporter.js` | 最小化报告窗口 |
| `analysis-window-maximize` | 报告→主 | `log-csv-exporter.js` | 切换最大化/还原 |
| `analysis-window-close` | 报告→主 | `log-csv-exporter.js` | 关闭报告窗口 |

## 解析器注册表（index.js）

### 内部结构

```js
parsers = Map<string, {keyword, platform, parser}>
// 键格式："keyword_platform"（如 "vfcs_get_ap_state_info_qcom"）
```

### 加载顺序

1. 先通过 `generic-parser.loadConfigParsers()` 从 `config.json` 加载配置解析器。
2. 再从 `parsers/` 目录加载遗留 JS 解析器 — 如果 `keyword_platform` 已注册则跳过。

### 关键函数

| 函数 | 说明 |
|------|------|
| `register(keyword, parser, platform)` | 将解析器添加到注册表 |
| `getKeywords()` | 获取所有已注册的键 |
| `getParser(keyword)` | 按键获取解析器（不含平台后缀） |
| `getKeywordsWithInfo(platform)` | 按平台过滤获取关键词，含 Tab 名称 |
| `generateStaticHTML(embeddedTabs, embeddedData)` | 生成 HTML，含拼接的渲染器 CSS/JS |
| `generateReportHTML(storeTabs, storeData)` | 生成保存到文件的报告 HTML |

## 常见开发任务

### 新增解析器

1. 编辑 `src/main/log-parsers/config.json`，在 `parsers` 数组中添加条目：
```json
{
  "tag": "显示标签",
  "keyword": "唯一日志关键词",
  "platform": "mtk",
  "format": ["[AP] field1=%d,field2=%d,field3=%s\\n"],
  "labels": ["字段1", "字段2", "字段3"]
}
```
2. 无需修改代码 — `generic-parser.js` 会自动编译。

对于空格分隔格式（如 Android healthd），在 key=value 对之间使用空格：
```json
{
  "tag": "healthd_info",
  "keyword": "healthd: battery l",
  "platform": "mtk",
  "format": ["l=%d v=%d t=%.1f h=%d st=%d\\n"],
  "labels": ["电量", "电压", "温度", "健康状态", "充电状态"]
}
```

### 新增 printf 占位符类型

1. 在 `generic-parser.js` 的 `SPEC_PATTERNS` 中添加正则模式。
2. 在 `convertValue()` 中添加转换逻辑。

### 修改报告窗口 UI

1. **CSS**：编辑 `src/main/log-parsers/renderer/css/` 中的文件。
2. **JS**：编辑 `src/main/log-parsers/renderer/js/` 中的文件。
3. **HTML 结构**：编辑 `src/main/log-parsers/index.js` 中的 `generateStaticHTML()`。
4. 文件在运行时由 `readRendererFiles()` 拼接并嵌入 HTML。加载顺序由 `index.js` 中的 `JS_FILES` 和 `CSS_FILES` 数组定义。

### 修改图表行为

- 图表渲染：`renderer/js/chart-renderer.js`。
- 图表颜色：`state.js` 中的 `CHART_COLORS` 数组。
- 图表 CSS：`renderer/css/chart.css`。

### 新增遗留 JS 解析器（少见 — 优先使用 config.json）

1. 创建 `src/main/log-parsers/parsers/your-parser.js`。
2. 导出：`{ keyword, platform?, parser: { parse, getHeaders, getHeaderLabels, getTabName } }`。
3. 将被自动加载并与配置解析器去重。

## 重要说明

- **渲染器文件拼接**：`renderer/` 中的 CSS/JS 文件在运行时读取并拼接，然后嵌入 HTML 模板。`JS_FILES`（index.js 第 47 行）中的加载顺序必须遵守 — `state.js` 在前（全局变量），`app.js` 在后（初始化）。
- **Worker 线程隔离**：`analysis-worker.js` 在独立的 Node.js 线程中运行，不能访问 Electron API，通过从 `__dirname` 构建的绝对路径 require 模块。
- **ZIP 处理**：中央目录手动解析（无外部 ZIP 库），支持 ZIP64 大归档。
- **自包含报告**：导出的 HTML 文件通过 `__EMBEDDED_TABS`/`__EMBEDDED_DATA` script 标签内嵌所有数据，无外部依赖。
- **SQLite 生命周期**：`analysis_<时间戳>.db` 文件在 `mem/` 中创建，报告窗口存活期间保持打开。新分析时会清理上次会话的 DB 文件。导入的 DB 文件不会被删除（属于用户）。
- **内存控制**：无论 ZIP 中有多少行，渲染进程每个 Tab 最多持有 20 × 3000 = 60,000 行。其他所有数据留在 SQLite 中，通过 `rowid` 范围查询按需加载。
