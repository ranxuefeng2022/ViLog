# VivoLog — Professional Log Viewer

Electron-based log viewer for Windows. View, search, filter, and analyze large log files (140万+ lines) with ripgrep-powered search and multi-window support.

## Quick Start

```bash
# Windows
start.bat

# Or manually
npm install
npm start
```

## Architecture

```
main.js                          Electron main process entry (thin shim)
src/main/                        17 feature modules
renderer/                        Renderer process
  js/
    core/                        Infrastructure (EventBus, State, DOM cache)
    services/                    14 service modules (filter, search, virtual scroll, etc.)
    utils/                       Utilities (constants, helpers, IDB storage, Worker manager)
    legacy/                      13 legacy files + 3 patches (~60K lines, being migrated)
    bridge.js                    State sync bridge (legacy ↔ new)
    app.js                       Application entry
  workers/                       9 Web Workers (filter, highlight, fuzzy match, etc.)
  css/components/                7 CSS component files
index.html                       Main window HTML
preload.js                       Electron preload (exposes electronAPI)
```

## Key Dependencies

- **Electron** 33 — Desktop shell
- **better-sqlite3** — Keyword persistence
- **ripgrep** (rg.exe) — High-speed text search
- **Everything** (es.exe) — File system search
- **fzf** (fzf.exe) — Fuzzy keyword search

## Project Status

- [x] Main process modularized (17 files, 82 IPC handlers)
- [x] Dead code removed (~35,000 lines)
- [x] Services directory unified (18 modules)
- [x] 6 of 10 legacy files migrated into services/
- [x] 3 pre-existing bugs fixed
- [x] Tests (19 cases, `npm test`)
- [x] AI context: CLAUDE.md + .claude/rules/ + docs/module-map.md
- [x] ESLint tightened, .vscode configured
- [ ] 4 legacy files + 2 patches remaining (stable, migrate on touch)

## Development

```bash
npm start              # Launch app
npm start -- --debug   # Launch with debug logging
npm test               # Run tests
```
