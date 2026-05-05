# Legacy Code Guide

## Status
These files are the original architecture (pre-modularization). 5 of 13 files have been migrated to `services/`. The remaining 4 large files + 3 patches are being migrated incrementally.

## Files still active (DO NOT delete)

| File | Role | Migration Risk |
|------|------|---------------|
| `06-main-ui.js` | Main panel UI, jump-to-line, highlight, event binding | High — heart of the UI |
| `08-file-tree.js` | File tree DOM rendering, pool, expand/collapse | High — tight DOM coupling |
| `09-archive-jump.js` | Archive browsing, filter core, line rendering | Extreme — largest file, most logic |
| `10-scroll-tools.js` | Scrollbar, progress, export, debug functions | High — utility functions |

## Already migrated (empty shells)
- 01-log-interceptor.js → services/log-interceptor/
- 02-core-init.js → services/core-init/
- 03-bookmarks.js → services/bookmarks/
- 04-search-history.js → services/search/history.js
- 05-secondary-filter.js → services/secondary-filter/
- 07-server-connect.js → services/remote-share/connect.js

## Patches

| Patch | Status |
|-------|--------|
| `filter-keyword-history-patch.js` | ✅ Migrated (9-line shell) |
| `virtual-scroll-patch.js` | 🟡 Highlight cache migrated; render overrides must stay |
| `filter-worker-patch.js` | ⏸️ Deferred — replaces core applyFilter, too risky |

## Key conventions for legacy code

- All code uses `var` and global scope (no modules, no import/export)
- Functions defined at script level are visible to all later scripts
- Load order in index.html Layer 5 is critical — NEVER reorder
- `bridge.js` syncs `window.xxx` ↔ `App.State` for these files
- These files write to `window.xxx` directly; new code should use `App.State`

## Migration pattern

```
1. Copy legacy file → services/{name}/index.js
2. Update index.html Layer 5 to point to services/ instead of legacy/
3. Add window.App.Xxx API export at end of service file
4. Delete original legacy file
5. Run npm start to verify
```
