# Log Analysis System — Architecture & Development Guide

## Overview

The log analysis system extracts structured data from kernel log files inside ZIP archives, using configurable printf-style format definitions. It parses millions of log lines across multiple worker threads, then presents results in a self-contained HTML report window with virtual-scroll tables, canvas trend charts, statistics, and CSV export.

## Architecture Diagram

```
User selects ZIP + platform + keywords (renderer: 08-file-tree.js)
  │
  ▼ IPC: export-csv-analysis
log-csv-exporter.js (main process)
  ├── listZipEntries() — parse ZIP central directory
  ├── filter kernel_log files by config.filePatterns
  ├── runWorkers() — dispatch to N worker threads
  │     │
  │     ▼ (each worker)
  │   analysis-worker.js
  │     ├── buildZipIndex() — parse ZIP CD once
  │     ├── for each log file entry:
  │     │     ├── extractByIndex() — decompress entry
  │     │     ├── collect android_time anchors
  │     │     └── for each parser × line:
  │     │           └── parser.parse(line, fileName)
  │     │                 ├── Strategy 1: compiled regex (fast path)
  │     │                 └── Strategy 2: smart kv fallback
  │     └── parentPort.postMessage(results)
  │
  ├── merge worker results by keyword_platform key
  ├── buildStore() — build tab structures, auto-hide empty columns
  ├── generateStaticHTML() — full self-contained HTML page
  └── open in frameless BrowserWindow
        │
        ▼ (report window)
      analysis-report-preload.js — exposes logAnalysis API
      Inline JS: virtual-scroll table, chart, stats, CSV export, search
```

## File Inventory

### Core Pipeline (main process)

| File | Lines | Purpose |
|------|-------|---------|
| `src/main/log-parsers/config.json` | 111 | Declarative parser definitions: keyword, platform, printf format, labels, field aliases |
| `src/main/log-parsers/generic-parser.js` | 414 | Compiles printf format strings to regex + smart kv extractors |
| `src/main/log-parsers/index.js` | 1830 | Parser registry (`Map<keyword_platform, parser>`), `generateStaticHTML()` template |
| `src/main/analysis-worker.js` | 169 | Worker thread: ZIP extraction, line-by-line parsing, timestamp resolution |
| `src/main/analysis-report-preload.js` | 20 | Preload for report window: exposes `logAnalysis` API via contextBridge |
| `src/main/log-csv-exporter.js` | 444 | Orchestrator: ZIP listing, worker pool, result merge, report window creation, all IPC handlers |
| `src/main/utils.js` | 458 | `buildZipIndex()`, `extractByIndex()`, `parseZipCentralDir()` — low-level ZIP parsing |
| `src/main/log-parsers/parsers/` | (empty) | Drop-in directory for legacy JS-based parsers (all active parsers now use config.json) |

### Integration Points

| File | Purpose |
|------|---------|
| `src/main/index.js` | Imports `log-csv-exporter` and calls `registerIpcHandlers()` |
| `renderer/js/legacy/08-file-tree.js` | Analysis trigger UI: platform selector, keyword checkboxes, progress listener |
| `preload.js` | Exposes analysis IPC bridges (`export-csv-analysis`, `get-analysis-keywords`, etc.) |

## Config Format (`config.json`)

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
    }
  ]
}
```

### Field Definitions

| Field | Required | Description |
|-------|----------|-------------|
| `tag` | yes | Display tab name (e.g. `"电池基本信息"`) |
| `keyword` | yes | String to locate in log lines (e.g. `"vfcs_get_ap_state_info"`) |
| `platform` | no | `"qcom"` or `"mtk"` — parsers are matched per platform |
| `format` | yes | Array of printf-style format strings (multi-line C printf), or single string |
| `labels` | yes | Chinese labels for each `%d`/`%s`/etc. specifier, in order |
| `fieldAliases` | no | Map of `fieldName → outputKey` to rename fields (e.g. for case normalization) |

### Format String Features

- **Multi-line**: `format` as array is auto-joined. Trailing `\\n` is stripped.
- **Auto marker extraction**: `[AP]`, `[CP]` etc. at the start are auto-detected as markers.
- **Specifier types**: `%d` `%i` `%u` `%x` `%X` `%o` `%s` `%c` `%f` `%F` `%e` `%E` `%g` `%G` `%a` `%A` `%p` — all normalized and compiled to regex capture groups.
- **Compound fields**: `key=%d(%d)` produces two fields: `key` and `key_2`.
- **Tuple fields**: `key=(%d,%d)` produces `key_1` and `key_2`.
- **Hex prefix**: `key=0x%x` auto-handles the `0x` literal prefix.
- **Field separator**: Both `=` and `:` are supported (e.g. `key:%d` or `key=%d`).

### `filePatterns`

Array of filename prefixes for source file matching within the ZIP. The system filters ZIP entries where the basename starts with any of these patterns (case-insensitive). Defaults to `["kernel_log"]`.

## Parsing Pipeline (generic-parser.js)

### Compilation Phase

1. **`preprocessFormat(format)`**: Join multi-line array → strip `\\n` → auto-extract `[xxx]` marker.
2. **`compileFormat(fmt, labels)`**: Split format by top-level commas (respecting parentheses) → for each segment, detect `fieldName=fmtPart` or `fieldName:fmtPart` → compile `%d`/`%s` etc. into regex capture groups via `SPEC_PATTERNS`.
3. **Result**: `{ fields: [{name, key, label, specType}], payloadRegex: RegExp, labelCount }`.

### Runtime Parse Strategy (two-layer)

**Strategy 1 — Compiled regex (fast path)**:
- Locates payload in line (after marker or first field name).
- Matches against `compiled.payloadRegex`.
- If match succeeds, all fields are extracted and type-converted in one pass.

**Strategy 2 — Smart kv fallback** (when format changed in firmware):
- Extracts key-value pairs from payload using regex.
- For each key, looks up field definitions in `fieldDefsMap` (built by field name).
- Handles tuples (`key=(v1,v2)`), compounds (`key=v(sub)`), and simple values.
- Unknown fields (not in config) are silently skipped.
- Type conversion uses the spec type from config (`%d` → int, `%x` → hex, `%f` → float, `%s` → string).

### Standard Prefix Fields

Every parsed row includes these fields extracted from the log line prefix:

| Key | Label | Source |
|-----|-------|--------|
| `source_file` | 源文件 | Filename passed to `parse()` |
| `android_time` | Android时间 | Resolved via binary search against anchor timestamps |
| `timestamp` | 时间戳(s) | Second field in comma-separated prefix (ts_raw / 1e6) |
| `ts_raw` | 原始时间戳(μs) | Third field in comma-separated prefix |
| `caller` | 调用线程 | `caller=Txxx` extracted from line |

### Parser Module Interface

Each compiled parser exposes:

```js
{
  keyword: "vfcs_get_ap_state_info",
  platform: "qcom",        // or undefined for universal
  parser: {
    parse(line, sourceFile),     // → {source_file, android_time, timestamp, ts_raw, caller, ...fields} | null
    getHeaders(),                // → ["source_file", "android_time", ..., "chg_status", "vbus_mv", ...]
    getHeaderLabels(),           // → {source_file: "源文件", chg_status: "充电状态", ...}
    getTabName(),                // → "电池基本信息"
    getFieldMapping(),           // → [{raw: "chg_status=%d", keys: ["chg_status"]}, ...]
    getPrintInterface()          // → "[AP] chg_status=%d,vbus_mv=%d,..."
  }
}
```

## Analysis Worker (analysis-worker.js)

### Worker Data Input

```js
{ archivePath, entries: [fileNames], keywords: [keyword_platform strings], platform: "mtk"|"qcom" }
```

### Processing Steps

1. **Load parsers**: Config parsers first via `loadConfigParsers()`, then legacy parsers from `parsers/` dir (skipping those already covered by config). Filter by requested keywords and platform.
2. **Build ZIP index**: `buildZipIndex(archivePath)` — parse Central Directory once.
3. **For each log file entry**:
   - `extractByIndex()` — decompress entry content.
   - Single-pass through all lines:
     - Collect android_time anchors (lines matching `/android time \d{4}-\d{2}-.../`).
     - Run each parser on each line, collect matched data.
   - Sort anchors, resolve `android_time` for each data row via binary search.
4. **Post results**: `{ "keyword_platform": [{matched, keyword, data}, ...] }`.

### Timestamp Resolution

- **ts_raw format**: `240564883` → `240.564883` seconds (last 6 digits = microseconds).
- **android_time anchors**: Lines containing `android time YYYY-MM-DD HH:MM:SS.ffffff`.
- **Binary search**: For each data row's `ts_raw`, find nearest anchor, compute offset → format as CST (UTC+8).

## Report Window (generateStaticHTML)

### Window Configuration

- Frameless `BrowserWindow` (1400×900, maximized on open).
- Uses `analysis-report-preload.js` for IPC.
- Static HTML written to temp file, loaded via `loadFile()`.

### Embedded Features (inline JS in HTML template)

| Feature | Description |
|---------|-------------|
| **Virtual-scroll table** | DOM pool rendering for millions of rows, row height 32px |
| **Tab switching** | Dropdown menu with tab name + row count badge |
| **Canvas trend chart** | Multi-series line chart with zoom/pan, threshold lines, range selection stats |
| **Statistics** | Min/max/avg/delta over selected row range |
| **Column picker** | Toggle column visibility with checkbox list |
| **Search** | Find text across all visible cells, navigate prev/next |
| **Go-to line** | Jump to specific row number |
| **Cell selection** | Click/drag to select cells, copy to clipboard |
| **CSV export** | Export current tab data as CSV file |
| **Print format dialog** | Shows original printf format, field mapping (format key → label), unmatched fields |
| **Save report** | Export self-contained HTML file with embedded data |
| **Keyboard shortcuts** | Ctrl+F (search), Ctrl+G (goto), Ctrl+S (save), Ctrl+C (copy), Ctrl+A (select all) |

### Data Flow in Report Window

```
Window loads → check __EMBEDDED_TABS/__EMBEDDED_DATA (exported report)
                or call logAnalysis.getTabs() + logAnalysis.getFullData(tabIdx) (live window)
              → buildTabButtons(), loadTabData()
              → renderVisibleRows() on scroll
              → drawChart() on demand
```

### Color Picker (chart panel)

- Each series has a circular color dot (18px, border-radius 50%).
- Styled `<input type="color">` with `-webkit-appearance: none`.
- Hover effect: scale(1.2) + shadow.
- Default palette: Apple system colors `['#007AFF','#FF9500','#34C759','#5856D6','#FF2D55','#5AC8FA','#FFCC00','#8E8E93']`.

## IPC Channels

| Channel | Direction | Handler | Purpose |
|---------|-----------|---------|---------|
| `get-analysis-keywords` | render→main | `log-csv-exporter.js` | Return available keywords for platform |
| `export-csv-analysis` | render→main | `log-csv-exporter.js` | Full analysis: ZIP → parse → open report |
| `csv-export-progress` | main→render | (sender.send) | Progress updates during analysis |
| `analysis-get-tabs` | report→main | `log-csv-exporter.js` | Get tab metadata (headers, widths, field mapping) |
| `analysis-get-full-data` | report→main | `log-csv-exporter.js` | Get all row data for a tab |
| `save-analysis-report` | report→main | `log-csv-exporter.js` | Save self-contained HTML report |
| `analysis-window-minimize` | report→main | `log-csv-exporter.js` | Minimize report window |
| `analysis-window-maximize` | report→main | `log-csv-exporter.js` | Toggle maximize/restore |
| `analysis-window-close` | report→main | `log-csv-exporter.js` | Close report window |

## Parser Registry (index.js)

### Internal Structure

```js
parsers = Map<string, {keyword, platform, parser}>
// key format: "keyword_platform" (e.g. "vfcs_get_ap_state_info_qcom")
```

### Loading Order

1. Config parsers from `config.json` via `generic-parser.loadConfigParsers()`.
2. Legacy JS parsers from `parsers/` directory — skipped if `keyword_platform` already registered.

### Key Functions

| Function | Description |
|----------|-------------|
| `register(keyword, parser, platform)` | Add parser to registry |
| `getKeywords()` | Get all registered keys |
| `getParser(keyword)` | Get parser by key (without platform suffix) |
| `getKeywordsWithInfo(platform)` | Get keywords filtered by platform, with tab names |
| `generateStaticHTML(embeddedTabs, embeddedData)` | Generate full self-contained HTML report page |
| `generateReportHTML(storeTabs, storeData)` | Generate report HTML for save-to-file export |

## Result Store (log-csv-exporter.js)

```js
analysisStore = {
  tabs: [{
    name, count, headerLabels, colWidths, keyword,
    printInterface, fieldMapping, keyLabels, keys, unmatchedFields
  }],
  data: [rows[]],      // rows[i] = array of cell strings for tab i
  reportWindow: BrowserWindow | null
}
```

### Auto-hide Empty Columns

In `buildStore()`, columns where every row has empty value are hidden from display. Standard prefix fields (`source_file`, `android_time`, `timestamp`, `ts_raw`, `caller`) are always kept.

### Unmatched Fields

Fields defined in config but not present in actual log data are tracked as `unmatchedFields: [{key, label}]` and shown in the print format dialog with an orange "未匹配" badge.

## Common Development Tasks

### Add a New Parser

1. Edit `src/main/log-parsers/config.json`, add entry to `parsers` array:
```json
{
  "tag": "显示标签",
  "keyword": "unique_log_keyword",
  "platform": "mtk",
  "format": ["[AP] field1=%d,field2=%d,field3=%s\\n"],
  "labels": ["字段1", "字段2", "字段3"]
}
```
2. No code changes needed — `generic-parser.js` compiles it automatically.

### Add a New Printf Specifier Type

1. Add regex pattern to `SPEC_PATTERNS` in `generic-parser.js`.
2. Add conversion logic to `convertValue()`.

### Modify the Report Window UI

1. Edit `generateStaticHTML()` in `src/main/log-parsers/index.js`.
2. CSS is inline in the `<style>` block (starts at line ~57).
3. JS is inline in the `<script>` block (starts at line ~350).
4. HTML structure is in the `<body>` section.

### Modify Chart Behavior

- Chart rendering: `drawChart()` function in the inline JS.
- Chart colors: `CHART_COLORS` array.
- Chart config panel HTML: generated in `showChart()`.
- Chart CSS: `.chart-*` classes in the inline `<style>`.

### Add a Legacy JS Parser (rare — prefer config.json)

1. Create `src/main/log-parsers/parsers/your-parser.js`.
2. Export: `{ keyword, platform?, parser: { parse, getHeaders, getHeaderLabels, getTabName } }`.
3. Will be auto-loaded and deduplicated against config parsers.

## Important Notes

- **Template literal escaping**: The report HTML is a JS template literal. `\n` and `\t` in inline JS must be written as `\\n` and `\\t` to avoid becoming literal newline/tab characters.
- **Worker thread isolation**: `analysis-worker.js` runs in a separate Node.js thread. It cannot access Electron APIs. It requires modules via absolute paths built from `__dirname`.
- **ZIP handling**: Central directory is parsed manually (no external ZIP library). Supports ZIP64 for large archives.
- **Self-contained reports**: Exported HTML files embed all data inline via `__EMBEDDED_TABS`/`__EMBEDDED_DATA` script tags. No external dependencies.
