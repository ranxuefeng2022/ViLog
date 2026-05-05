# VivoLog — Project Guide for AI Assistants

## Quick Facts
- **Type:** Electron desktop app (Windows)
- **Purpose:** Professional log viewer — view/search/filter/analyze large log files (millions of lines)
- **Entry:** `main.js` → `src/main/index.js` (orchestrator)
- **Start:** `npm start` | **Test:** `npm test`
- **Node:** v24 | **Electron:** 33 | **DB:** better-sqlite3 (keyword persistence)
- **External tools:** ripgrep (rg.exe), Everything (es.exe), fzf (fzf.exe), 7-Zip (7za.exe)

## Architecture Overview

```
main.js → src/main/index.js (orchestrator) → 16 feature modules
  preload.js → contextBridge → window.electronAPI

index.html loads 8 layers:
  Layer 1: core/ (EventBus, State, DOM)
  Layer 2: worker managers
  Layer 3: services/ (self-contained services)
  Layer 4: services/ (dependent services)
  Layer 5: legacy/ (4 remaining files + services wrappers)
  Layer 6: 3 legacy patches
  Layer 7: bridge.js (window ↔ App.State sync)
  Layer 8: app.js (init orchestrator)
```

## Module Map
See @docs/module-map.md for complete tables (17 main process + 18 renderer services + legacy + workers + CSS)

## Key Design Patterns

### IPC flow: renderer ↔ main
```
renderer: electronAPI.someAction()        [preload.js exposes API]
  → ipcRenderer.invoke('channel-name')    [send to main]
  → ipcMain.handle('channel-name', ...)   [registered in src/main/ modules]
  → return result                          [back to renderer]
```
All 82 IPC channels are registered in `src/main/` modules. Each module exports `registerIpcHandlers()`.

### State management (renderer)
```
Old: window.originalLines = [...]           (legacy code writes global vars directly)
New: App.State.set('originalLines', [...])  (triggers EventBus + watchers)
Bridge: bridge.js syncs both directions     (temporary, will be removed)
```

### Module pattern (renderer services)
```
services/filter/index.js  — IIFE, assigns to window.App.Filter
  exports: { init, data methods, UI methods }
  called by: app.js init (layer 8), legacy patches (layer 6)
```

### Module pattern (main process)
```
src/main/file-operations.js  — CommonJS module
  require() other modules
  ipcMain.handle() at module load time
  exports: { registerIpcHandlers, utility functions }
```

## File Naming Conventions
- `renderer/js/{layer}/{nn-description}.js` — numbered legacy files (01-10)
- `renderer/js/services/{name}/index.js` — service modules
- `src/main/{feature}.js` — main process modules
- `renderer/css/components/{feature}.css` — CSS components

## Common Tasks

### Adding a new IPC handler
1. Add handler in the appropriate `src/main/{module}.js`
2. If new channel, add to `preload.js` to expose to renderer
3. Call from renderer via `window.electronAPI.yourMethod()`

### Adding a new renderer service
1. Create `renderer/js/services/{name}/index.js`
2. Follow IIFE pattern, assign to `window.App.YourService`
3. Add `<script src="...">` to `index.html` in correct layer
4. Call `App.YourService.init()` from `app.js` if needed

### Adding a CSS component
1. Create `renderer/css/components/{name}.css`
2. Add `<link rel="stylesheet">` to `index.html` `<head>`

## Remaining Legacy Code (stable — migrate on touch)

These 4 files (~24K lines) + 2 patches + `bridge.js` are the last remnants of the pre-modular architecture. They are **stable and working**. Migrate only when you need to modify them:

| File | Lines | Migration trigger |
|------|-------|-------------------|
| `06-main-ui.js` | 3,749 | When changing panel layout, jump-to-line, or event bindings |
| `08-file-tree.js` | 4,524 | When changing file tree behavior |
| `09-archive-jump.js` | 10,936 | When changing filtering, line rendering, or archive browsing |
| `10-scroll-tools.js` | 2,576 | When changing scrollbar, progress, export, or debug functions |
| `filter-worker-patch.js` | 2,090 | When changing the filter execution path (ripgrep/Worker routing) |
| `bridge.js` | 260 | Auto-removed when last legacy file stops writing `window.xxx` |

**Migration pattern** (proven on 6 files already):
1. Copy code → `services/{name}/index.js`
2. Add `window.App.Xxx` API export
3. Update `index.html` Layer 5 path
4. Delete original legacy file

## Project Status (2026-05-04)

```
✅ Main process modularized (17 files, 82 IPC)
✅ Dead code removed (~35,000 lines)
✅ services/ directory unified (18 modules, name/index.js)
✅ 6 of 10 legacy files migrated to services/
✅ 3 pre-existing bugs fixed
✅ ESLint tightened (no-unused-vars, no-undef → error)
✅ Tests (19 cases, npm test)
✅ AI context: CLAUDE.md, .claude/rules/, docs/module-map.md
✅ CSS/HTML: inline extracted, vlog-chart separated
✅ .vscode/settings.json
🟡 4 legacy files + 2 patches remaining (stable, migrate on touch)
```

## Bug Fixes Applied During Refactoring
1. `appIsQuiting` typo — fixed to `appIsQuitting` (window-manager.js)
2. `mainWindowMap` undefined — replaced with `getWindows()` (keyword-db.js)
3. `allWindows` undefined — replaced with `BrowserWindow.getAllWindows()` (index.js)

## Do NOT Change
- IPC channel names
- `index.html` script loading order
- `legacy/` function signatures (patches depend on exact names)
- `preload.js` exposed API method names
