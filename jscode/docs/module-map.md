# Module Map — VivoLog

## src/main/ (17 modules — Electron main process)

| Module | Lines | Purpose | IPC | Dependencies |
|--------|-------|---------|-----|-------------|
| `index.js` | 254 | App lifecycle orchestrator, module wiring | 1 | all 16 modules |
| `constants.js` | 39 | Global constants | 0 | none |
| `utils.js` | 356 | extractTextFromBuffer, find7z, parseZipCentralDir, extractZipEntryNative | 0 | constants |
| `logging.js` | 201 | Console→file logging, log rotation | 2 | constants |
| `engine.js` | 110 | Python detection, vivo_log_engine.exe start/stop | 0 | constants |
| `tool-finder.js` | 110 | Find es.exe, rg.exe, fzf.exe, 7z.exe on disk | 0 | utils |
| `keyword-db.js` | 433 | SQLite CRUD for filter keywords + Markov transitions | 12 | tool-finder, window-manager |
| `remote-share-server.js` | 260 | HTTP server sharing directories to remote clients | 0 | utils |
| `remote-client.js` | 93 | HTTP client connecting to remote shared dirs | 0 | none |
| `directory-watcher.js` | 105 | fs.watch directory change notifications | 2 | none |
| `archive-handler.js` | 1513 | List/extract/stream ZIP, 7z, tar, tar.gz | 7 | utils, tool-finder |
| `temp-dir-manager.js` | 226 | Temp dirs for archive extraction in file tree | 5 | archive-handler |
| `file-operations.js` | 1983 | File read/write/search/dialog/open-with | 24 | utils, tool-finder, window-manager |
| `search-tools.js` | 455 | Everything es.exe + ripgrep rg.exe search | 4 | tool-finder |
| `remote-share-ipc.js` | 209 | IPC wrappers for remote share start/stop/connect | 7 | remote-share-server, remote-client |
| `auto-update.js` | 197 | Download ZIP from server, extract to app dir | 2 | utils |
| `window-manager.js` | 601 | BrowserWindow create/control, tray, shortcuts | 12 | utils, engine, temp-dir-manager |

### Cross-Module Dependencies (Main Process)

```
index.js orchestrates:
  window-manager ← temp-dir-manager (getter injection)
  keyword-db     ← window-manager    (getter injection for broadcast)
  file-operations ← window-manager  (getWindows for preview)
  file-operations → setupIPC(mainWindow) called after window creation
```

---

## renderer/js/services/ (18 modules — Electron renderer process)

| Module | Lines | Purpose | window.App API |
|--------|-------|---------|----------------|
| `log-interceptor/` | 179 | Intercept console.* → save to main process log | LogInterceptor |
| `core-init/` | 759 | Global vars, font scaling, DOMPool, memory stats | CoreInit |
| `bookmarks/` | 1751 | Bookmark CRUD, context menu, line selection, scroll tools | Bookmarks |
| `csv-table-renderer/` | 2688 | CSV table rendering with column resize/sort | (legacy) |
| `vlog-parser/` | 204 | Parse VLog battery data files | (legacy) |
| `filter-keyword-history/` | 1813 | Keyword data layer + dialog UI + fzf/SQL/Worker search | FilterKeywordHistory |
| `secondary-filter-canvas/` | 606 | Canvas-based secondary filter panel rendering | (legacy) |
| `virtual-scroll/` | 660 | Virtual scroll with DOM pool + highlight cache system | VirtualScroll |
| `context-menu/` | 27 | Right-click context menu API | ContextMenu |
| `search/` | 1599 | Search system + search history | Search, SearchHistory |
| `filter/` | 200 | Index-based filtering API | Filter |
| `log-renderer/` | 33 | Log rendering API | LogRenderer |
| `file-tree/` | 27 | File tree API | FileTree |
| `log-loader/` | 23 | Log file loading API | LogLoader |
| `ui/` | 42 | UI state management API | UI |
| `quick-links/` | 21 | Quick links panel API | QuickLinks |
| `remote-share/` | 1640 | Remote share connect + IPC | RemoteShare, RemoteConnect |
| `secondary-filter/` | 756 | Secondary filter panel UI | SecondaryFilter |

---

## renderer/js/legacy/ (7 files remaining — being migrated)

| File | Lines | Risk | Target Service |
|------|-------|------|---------------|
| `06-main-ui.js` | 3749 | High | services/ui/ + services/log-renderer/ |
| `08-file-tree.js` | 4524 | High | services/file-tree/ |
| `09-archive-jump.js` | 10936 | Extreme | split across multiple services |
| `10-scroll-tools.js` | 2576 | High | services/virtual-scroll/ + services/ui/ |
| `filter-keyword-history-patch.js` | 9 | Done | (thin shell) |
| `filter-worker-patch.js` | 2090 | Deferred | services/filter/ |
| `virtual-scroll-patch.js` | 822 | Partial | services/virtual-scroll/ |

---

## renderer/js/core/ (3 modules)

| Module | Lines | Purpose |
|--------|-------|---------|
| `event-bus.js` | 81 | Pub/sub: on/off/emit/once between modules |
| `state.js` | 216 | Centralized state with getter/setter + change notification |
| `dom-elements.js` | 78 | DOM element cache (getElementById memoization) |

---

## renderer/workers/ (9 Web Workers)

| Worker | Purpose |
|--------|---------|
| `aho-corasick.js` | Multi-pattern matching |
| `csv-parser-worker.js` | CSV file parsing |
| `filter-worker.js` | Log line filtering |
| `fuzzy-match-worker.js` | Fuzzy keyword matching |
| `highlight-worker.js` | Search result highlighting |
| `index-builder-worker.js` | Search index construction |
| `parallel-filter-worker.js` | Parallel filtering |
| `shared-filter-worker.js` | Shared filter worker |
| `stats-calculator-worker.js` | Statistics calculation |

---

## renderer/css/components/ (8 CSS files)

| File | Styles |
|------|--------|
| `base.css` | Reset, layout, toolbar, dialog, scrollbar, themes |
| `csv-table.css` | CSV table rendering |
| `csv-chart.css` | CSV chart dialog |
| `progress-bar.css` | Progress bar |
| `goto-line.css` | Go-to-line dialog |
| `virtual-scroll.css` | Virtual scroll container |
| `secondary-filter.css` | Secondary filter panel |
| `vlog-chart.css` | Chart page styles |
