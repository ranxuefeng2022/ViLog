# log-parsers 子系统开发指南

本文件为 Claude Code 在 `log-parsers/` 子系统内工作时提供指引。

## 基本信息

- **类型：** 自包含子系统（主进程解析引擎 + 独立渲染进程报告 UI）
- **用途：** 内核日志解析 → 分析报告（表格/搜索/统计/趋势图/关联比对/CSV导出）
- **入口：** `index.js` → 注册 parser、按关键词匹配派发、生成完整 HTML 报告
- **调用方：** `src/main/log-csv-exporter.js` → `require('./log-parsers')`
- **总规模：** ~5,100 行（主进程 775 + 渲染 4,180 + CSS 1,017 + 配置 157）
- **技术债务等级：** 中等（全局变量模式 + IIFE 混合，无构建工具/类型系统）

## 目录结构

```
log-parsers/
├── index.js                # 编排器：parser 注册表、HTML 生成、文件加载
├── generic-parser.js       # 通用解析引擎：printf 格式编译、kv 提取、类型转换
├── config.json             # 解析器配置（7 个 parser，qcom/mtk 双平台）
├── CLAUDE.md               # 本文件
└── renderer/
    ├── css/                # 5 个 CSS 文件（base, table, dialogs, chart, link-panel）
    └── js/                 # 15 个 JS 文件（按 index.js::JS_FILES 顺序加载）
        ├── state.js        # [1] 全局状态 & DOM 引用（所有文件共享）
        ├── utils.js        # [2] esc, fmtN, truncateText, makeDraggable
        ├── data-access.js  # [3] 统一数据访问层（IPC/嵌入式双模式）★
        ├── tabs.js         # [4] 标签页切换、按需分块加载、LRU淘汰、列宽自适应
        ├── canvas-renderer.js  # [5] Canvas 表格绘制、虚拟滚动、Alt+滚轮横滚
        ├── selection.js    # [6] 单元格选区、Ctrl+C复制、hover 追踪
        ├── search.js       # [7] 搜索覆盖层、Ctrl+F
        ├── goto.js         # [8] 行号跳转、快捷键帮助
        ├── stats.js        # [9] 区间统计（min/max/avg/stddev/percentile/trend）
        ├── chart-renderer.js   # [10] 趋势图（IIFE 封装）★
        ├── export.js       # [11] CSV 导出
        ├── iface-dialog.js # [12] 打印格式查看
        ├── col-dialog.js   # [13] 列显示选择
        ├── link-panel.js   # [14] 关联对比面板（IIFE 封装）★
        └── app.js          # [15] 入口：数据加载、窗口控制
```

## 架构

### 主进程：解析器注册表

```
config.json → generic-parser.js (createParser) → index.js (register)
                 ↑ 编译 printf 格式→正则          ↑ parser registry
              parseLine(line, file, platform) → {matched, keyword, data}
```

**解析流程：**
1. `parseLine()` 遍历注册表中所有 parser
2. 检查日志行是否包含 parser 的 `keyword`
3. 若匹配 → parser.parse() 提取字段
4. parse() 内部采用双策略：Strategy 1 快速正则精确匹配 → Strategy 2 智能 kv 回退

**新增日志格式的方法：** 在 `config.json` 的 `parsers` 数组中添加配置条目，参数：
- `tag`: tab 显示名称
- `keyword`: 日志行匹配关键词
- `platform`: 平台标识（qcom/mtk，可选）
- `format`: printf 风格格式串（字符串或字符串数组）
- `labels`: 中文列标签数组
- `fieldAliases`: 字段名映射（可选）
- `marker`: 手动指定标记前缀（可选，默认自动提取 `[XX]`）

### 渲染进程：全局变量 + DataAccess

**加载顺序：** `index.js` 的 `JS_FILES` 数组硬编码了 15 个文件的顺序。**禁止修改此顺序**，除非同时调整文件间依赖。

**共享状态：** `state.js` 声明了所有全局变量。每个变量都有注释标明哪些文件使用它。修改 `state.js` 中的变量时务必检查注释。

**DataAccess 模块：** ★ 核心改进。统一了 IPC 模式和嵌入式模式的差异。所有数据获取（搜索、统计、图表数据、行加载）必须通过 `DA.*` 方法调用，**禁止**在业务逻辑中直接判断 `DA.isEmbedded`。

```js
// ✅ 正确：通过 DA 获取
DA.searchRows(tabIdx, term).then(function(res) { ... });

// ❌ 错误：直接判断模式
if (DA.isEmbedded) { ... } else { window.logAnalysis.searchRows(...) }
```

DA 提供的方法：
| 方法 | 返回值 | 用途 |
|------|--------|------|
| `DA.isEmbedded` | bool | 是否为嵌入式模式 |
| `DA.getTabs()` | Promise | 获取所有标签页元数据 |
| `DA.getRows(tabIdx, from, count)` | Promise | 按需加载行数据 |
| `DA.getRowsRange(tabIdx, from, to)` | Promise | 加载行范围 |
| `DA.getRow(tabIdx, rowIdx)` | Promise | 加载单行 |
| `DA.searchRows(tabIdx, term)` | Promise | 全文搜索 |
| `DA.getStatsMeta(tabIdx, visCols)` | Promise | 检测数值列 |
| `DA.calcStats(tabIdx, visCols, cols, from, to)` | Promise | 区间统计计算 |
| `DA.getTimeIndex(tabIdx)` | Promise | 获取时间索引 |
| `DA.importDatabase()` | Promise | 导入数据库 |

### 数据流

```
app.js (DA.getTabs → 初始化)
   ↓
tabs.js (tabLocal 管理 chunks/rows)
   ↓
canvas-renderer.js (读取 tabLocal[activeTab].rows → Canvas 绑制)
   ↓
selection.js (hoverR → canvas-renderer 高亮行)
   ↓
link-panel.js (hoverR → DA 获取关联表数据 → Canvas 绑制)
```

## 代码规范

### 文件组织
- 渲染 JS 文件：扁平结构 `renderer/js/{name}.js`（历史原因，非 `services/{name}/index.js`）
- chart-renderer.js 和 link-panel.js 已经是 IIFE 封装，通过 `window.App.Chart`/`window.App.LinkPanel` 暴露 API
- 其他文件仍为全局变量模式（通过 `state.js` 共享状态）
- **未来迁移方向：** 逐步将其他文件也改为 IIFE 封装，遵循主项目的 services 模式

### 命名规范
- 全局变量：camelCase（如 `activeTab`, `tabLocal`, `curColWidths`）
- 全局函数：camelCase（如 `drawCanvas`, `switchTab`, `doSearch`）
- IIFE 封装的模块：PascalCase（`App.LinkPanel`, `App.LogParser.DataAccess`）
- CSS 类名：BEM-like（如 `lp-panel`, `chart-dialog`, `stats-col-tag`）
- 私有变量/函数：`_` 前缀（如 `_embedded`, `_scrollLoadTimer`）

### 必须遵守的规则

1. **⛔ 禁止修改 JS_FILES 加载顺序**，除非完全理解文件间依赖
2. **所有数据获取必须通过 DA**，禁止直接调 `window.logAnalysis.*` 或判断 `__isEmbedded`
3. **修改 state.js 前先检查 "Used by" 注释**，评估影响范围
4. **新增 parser 只在 config.json 中添加配置**，不碰 generic-parser.js
5. **修改 chart-renderer.js 或 link-panel.js 时注意 IIFE 封装边界**，内部变量不与外部冲突
6. **console.log 带模块标签**：`[chunk-load]`, `[LogParser]`, `[Chart]`, `[LinkPanel]`

### 禁止修改
- IPC 通道名称（此子系统通过 `window.logAnalysis.*` 调用，通道定义在主项目中）
- `config.json` 中已有 parser 的 keyword 和 tag（被外部引用）
- `generateStaticHTML()` 中的 HTML 结构和按钮 ID（被渲染 JS 引用）

## 已知问题与陷阱

### 1. 全局变量依赖（最严重）
`state.js` 声明了 30+ 个全局变量，15 个 JS 文件通过全局命名空间隐式共享状态。**没有模块边界**，任何文件都可以修改任何变量。

**影响：**
- 新增/修改变量时必须检查所有文件的引用
- IDE 无法准确跳转和重构
- 测试困难，无法 mock

**应对策略：**
- 修改 `state.js` 前，用 `grep` 搜索变量名，确认所有使用位置
- 新增状态优先放在 IIFE 模块内部，不要加入 `state.js`
- 如果必须新增全局变量，在 `state.js` 中声明并标注 `"Used by: xxx.js"`

### 2. 重复代码（三处统计逻辑）
区间统计计算分散在三处，修改时必须同步：
- `data-access.js` — `calcStats()`（嵌入式模式）
- `chart-renderer.js` — `finishRangeSelect()`（框选统计）
- `stats.js` — `renderStatsResult()` 的数据准备

**应对策略：**
- 如需修改统计指标，必须检查上述三处
- 优先修改 `data-access.js`（数据源），再同步到渲染层的展示逻辑

### 3. 魔法数字分散
性能调优参数硬编码在各文件中：

| 参数 | 位置 | 值 |
|------|------|-----|
| `MAX_LOADED_CHUNKS` | `tabs.js` | 20 |
| `CHUNK_SIZE` | `state.js` | 3000 |
| `BUFFER` | `state.js` | 30 |
| `MAX_VISIBLE` | `chart-renderer.js` | 3000 |
| `DEFAULT_VISIBLE` | `chart-renderer.js` | 2000 |
| `MAX_POINTS` | `chart-renderer.js` | 5000 |
| `SCROLL_DEBOUNCE_MS` | `link-panel.js` | 100 |

**应对策略：**
- 修改前先评估对其他模块的影响
- 不要假设这些值可以任意调整（如 `CHUNK_SIZE` 影响内存和 IPC 频率）

### 4. 异步错误静默吞没
大量 `.catch(function(){ ... })` 仅恢复状态，无日志无反馈：

```js
// tabs.js
catch(function(){
  delete loc.chunks[chunkIdx];  // 静默失败
})
```

**应对策略：**
- 新增异步代码时至少保留 `console.error('[Module]', err.message)`
- 不要学习现有代码的静默 catch 模式

### 5. CSS 遗留样式
`link-panel.css` 中存在未使用的 legacy 样式（`.lp-cols-row`, `.lp-table-col`, `.lp-drag-handle` 等），实际使用 Canvas 渲染的 `.lp-split` 布局。

**应对策略：**
- 不要基于这些 legacy 类名开发新功能
- 新增样式使用 `.lp-` 前缀，遵循 BEM-like 命名

### 6. 类型安全缺失
无 TypeScript / JSDoc，函数返回类型不确定。例如 `convertValue()` 返回 `number | string`，调用方需自行处理。

**应对策略：**
- 新增函数时添加 JSDoc 注释（见下方示例）
- 对参数做防御性检查，不要假设类型

```js
/**
 * @param {string} raw - 原始字符串值
 * @param {string} specType - 格式说明符（d/i/u/x/f 等）
 * @returns {number|string} - 转换后的值
 */
function convertValue(raw, specType) {
  // ...
}
```

## 各文件详细速查

### 主进程文件

| 文件 | 核心导出 | 修改风险 |
|------|---------|---------|
| `index.js` | `register`, `parseLine`, `generateStaticHTML`, `generateReportHTML` | ⛔ 高：HTML 结构和按钮 ID 被渲染 JS 硬依赖 |
| `generic-parser.js` | `createParser`, `compileFormat`, `convertValue`, `loadConfigParsers` | 中：新增 format 类型需同步测试 |
| `config.json` | parser 配置数组 | ⛔ 高：已有 keyword/tag 被外部引用 |

### 渲染进程文件（按加载顺序）

| # | 文件 | 职责 | 依赖 | 封装方式 |
|---|------|------|------|---------|
| 1 | `state.js` | 全局状态声明 | 无 | 全局变量 |
| 2 | `utils.js` | 工具函数 | 无 | 全局函数 |
| 3 | `data-access.js` | 数据访问层 | `state.js` | IIFE → `window.App.LogParser.DataAccess` |
| 4 | `tabs.js` | 标签页/分块加载/LRU | `state.js`, `DA` | 全局函数 |
| 5 | `canvas-renderer.js` | Canvas 表格绘制 | `state.js`, `tabs.js` | 全局函数 |
| 6 | `selection.js` | 选区/复制/hover | `state.js`, `canvas-renderer.js` | 全局函数 |
| 7 | `search.js` | 搜索 | `state.js`, `DA`, `canvas-renderer.js` | 全局函数 |
| 8 | `goto.js` | 行号跳转/快捷键帮助 | `state.js`, `canvas-renderer.js` | 全局函数 |
| 9 | `stats.js` | 区间统计对话框 | `state.js`, `DA` | 全局函数 |
| 10 | `chart-renderer.js` | 趋势图 | `state.js`, `DA` | IIFE → `window.showChart` |
| 11 | `export.js` | CSV 导出 | `state.js`, `DA` | 全局函数 |
| 12 | `iface-dialog.js` | 打印格式查看 | `state.js` | 全局函数 |
| 13 | `col-dialog.js` | 列选择/工具栏分发 | `state.js`, `tabs.js` | 全局函数 |
| 14 | `link-panel.js` | 关联对比面板 | `state.js`, `DA`, `canvas-renderer.js` | IIFE → `window.App.LinkPanel` |
| 15 | `app.js` | 入口初始化 | `state.js`, `DA`, `tabs.js` | 全局代码 |

### CSS 文件

| 文件 | 范围 | 注意 |
|------|------|------|
| `base.css` | 布局、工具栏、标签下拉、窗口控制 | 不改 |
| `table.css` | Canvas 容器、表头、滚动条 | 不改 |
| `dialogs.css` | 所有弹窗（搜索/跳转/统计/列选择/打印格式/阈值） | 新增弹窗在此追加 |
| `chart.css` | 趋势图全屏覆盖层、右侧面板 | 不改 |
| `link-panel.css` | 关联面板（含遗留未用样式） | 新增样式用 `.lp-` 前缀，避开 legacy 类名 |

## 常见修改场景指南

### 场景 A：新增日志解析格式

1. 在 `config.json` 的 `parsers` 数组末尾添加新条目
2. 确保 `labels` 数量与 `format` 中 `%` 说明符数量一致
3. 如有字段名大小写不一致，添加 `fieldAliases`
4. 运行 `node --test test/log-parsers.test.js`
5. 在 `generic-parser.js` 中添加 `compileFormat` 或 `createParser` 测试

### 场景 B：修改表格渲染逻辑

1. 修改 `canvas-renderer.js` 前，确认依赖的全局变量在 `state.js` 中的 `"Used by"` 注释
2. 虚拟滚动逻辑涉及 `container.scrollTop`、`scrollScale`、`ROW_H`，修改时保持公式一致：
   ```js
   var fv = Math.floor(st / scrollScale);        // 首行索引
   var subOff = Math.round((st / scrollScale - fv) * ROW_H);  // 子像素偏移
   ```
3. 绘制后调用 `drawCanvas()` 刷新，不要直接操作 DOM

### 场景 C：新增对话框/覆盖层

1. 在 `index.js` 的 `generateStaticHTML()` 中添加 HTML 结构（⛔ 注意：这会改变所有生成报告的 DOM）
2. 在 `dialogs.css` 中添加样式（遵循现有命名：`xxx-overlay`, `xxx-dialog`, `xxx-title`, `xxx-close`）
3. 如需拖拽，复用 `utils.js` 的 `makeDraggable(overlayId, dialogSelector, titleSelector)`
4. 在 `state.js` 中声明 DOM 引用（如果需要在多个文件访问）

### 场景 D：修改关联对比面板

1. `link-panel.js` 是 IIFE 封装，内部变量与外部隔离
2. 对外暴露的 API 只有：`toggle()`, `onHoverRow(rowIdx)`, `onScroll()`, `isOpen()`
3. 如需新增对外接口，在 IIFE 末尾的 `window.App.LinkPanel = {...}` 中添加
4. 时间对齐依赖 `timestamp`/`ts_raw` 字段，修改时间字段优先级需同步更新 `TIME_FIELDS` 数组

### 场景 E：修改趋势图

1. `chart-renderer.js` 是 IIFE 封装，全局入口只有 `window.showChart()`
2. 内部状态集中在 `S` 对象，不要从外部直接修改
3. 数据加载通过 `dataSource` 适配器，支持 IPC/嵌入式双模式
4. 新增绘图功能时，在 `drawChart()` 管线中添加步骤（参考 `drawGrid`, `drawYAxes` 等）

## 测试

```
node --test test/log-parsers.test.js
```

测试覆盖：
- `convertValue()` — 类型转换（8 个测试）
- `compileFormat()` — 格式编译（13 个测试）
- `createParser()` — 完整 parser 生命周期（10 个测试）
- `loadConfigParsers()` — config.json 集成（3 个测试）

**测试缺口（重要）：**
- 渲染进程 15 个 JS 文件（4,180 行）**零单元测试**
- Canvas 渲染、交互逻辑、关联面板依赖手工验证
- 新增渲染层功能时，需补充 Puppeteer/Playwright 集成测试或至少提供测试步骤说明

新增解析功能时必须补充对应的 `compileFormat` 或 `createParser` 测试。

## 提交清单

- [ ] `node -c renderer/js/*.js` 所有文件语法检查通过
- [ ] `node --test test/log-parsers.test.js` 通过
- [ ] 新 parser 在 config.json 中且 labels 数量与 format 字段数一致
- [ ] 未修改 JS_FILES 数组顺序（除非新增文件）
- [ ] 未使用 `__isEmbedded` 或直接 `window.logAnalysis` 调用（改用 DA）
- [ ] 新增文件已注册到 `JS_FILES` 数组
- [ ] 新增全局变量已在 `state.js` 声明并标注 `"Used by"`
- [ ] 未引入静默 catch（至少保留 `console.error`）
- [ ] 新增 JSDoc 注释（函数参数和返回值）
