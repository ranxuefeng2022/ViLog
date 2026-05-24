<div align="center">

# ViLog

### Professional High-Performance Log Viewer

**A desktop log viewer built with Electron, engineered for speed. Handle million-line log files with ease.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-green.svg)]()
[![Electron](https://img.shields.io/badge/Electron-28%2B-blue.svg)](https://www.electronjs.org/)

---

**Language / 语言 / 언어 / 言語 / Язык / Idioma / Langue / Sprache / Língua / لغة**

[![English](https://img.shields.io/badge/English-✓-blue.svg)](README.md)
[![中文](https://img.shields.io/badge/中文-✓-red.svg)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/日本語-✓-white.svg)](README.ja.md)
[![한국어](https://img.shields.io/badge/한국어-✓-blue.svg)](README.ko.md)
[![Русский](https://img.shields.io/badge/Русский-✓-orange.svg)](README.ru.md)
[![Español](https://img.shields.io/badge/Español-✓-yellow.svg)](README.es.md)
[![Français](https://img.shields.io/badge/Français-✓-purple.svg)](README.fr.md)
[![Deutsch](https://img.shields.io/badge/Deutsch-✓-darkgreen.svg)](README.de.md)
[![Português](https://img.shields.io/badge/Português-✓-brightgreen.svg)](README.pt-BR.md)
[![العربية](https://img.shields.io/badge/العربية-✓-teal.svg)](README.ar.md)

</div>

---

## Why ViLog?

If you've ever opened a 500MB log file in a text editor and watched it freeze, ViLog is for you. Built from the ground up for **log analysis at scale**, it combines GPU-accelerated Canvas rendering, multi-threaded Web Workers, and algorithm-level optimizations (Aho-Corasick, WASM) to deliver instant filtering and smooth scrolling on million-line files.

## Features

### Blazing Fast Performance

| Feature | Detail |
|---------|--------|
| **Canvas Rendering** | GPU-accelerated log display instead of DOM nodes — handles millions of lines without breaking a sweat |
| **Virtual Scrolling** | Only visible lines are rendered. Scroll through 10M+ lines with zero lag |
| **Multi-threaded Filtering** | Parallel Web Workers distribute filtering across CPU cores |
| **Aho-Corasick Algorithm** | Multi-pattern matching in O(n+z) time — filter 10+ keywords simultaneously at no extra cost |
| **WebAssembly Search** | Near-native string matching performance via WASM modules |
| **Hybrid Smart Filter** | Automatically selects between ripgrep (for large files) and JS Workers (for small files) |
| **Line Data Caching** | Repeated filters on the same file skip data transfer — only keywords are sent to Workers |

### Powerful Filtering & Search

- **Multi-keyword filtering** — Separate keywords with `|`, escape literal pipes with `\|`
- **Regex support** — Full JavaScript regex in both filter and search
- **Two-level filtering** — Primary filter + secondary filter within results
- **Filter history** — Persistent keyword history with fuzzy matching (IndexedDB-backed)
- **Keyword highlighting** — 10 preset colors + custom color picker
- **Exclude lines** — Right-click to exclude matching lines from results
- **Search navigation** — Enter/Shift+Enter to jump between matches

### File Management

- **File tree sidebar** — Drag & drop files, folders, or archives directly
- **Archive browsing** — ZIP, 7z, RAR, tar.gz — browse contents without extracting
- **Remote file server** — Connect to remote machines via built-in C HTTP server (thread-pool, high concurrency)
- **Local share** — Share local directories with teammates over LAN
- **Clipboard paste** — Paste files directly with Ctrl+V
- **CSV/TSV table view** — Parse and display structured data in sortable tables
- **Everything integration** — Instant file search on Windows via Everything HTTP API
- **Ripgrep integration** — 20-100x faster text search for large files

### Data Visualization

- **CSV chart plotting** — Interactive line charts with zoom, pan, and column selection
- **Vlog parser** — Specialized parser for battery/device diagnostic logs (21 fields) with visualization
- **Column selector** — Keep or remove specific columns in table view
- **Export** — Copy filtered results or export as HTML

### Workspace & Productivity

- **Multi-window** — Open multiple log files in separate windows, switch with Alt+1~9
- **Bookmarks** — Mark important lines and jump between them
- **Go to line** — Instantly jump to any line number
- **Quick links** — Bookmark frequently used websites (built-in web panel)
- **AI assistant** — Embedded AI chat panel for log analysis assistance
- **UART serial log** — Serial port log monitoring window
- **Font scaling** — Ctrl+Scroll to zoom, Alt+Scroll for horizontal pan
- **System monitoring** — Real-time CPU, memory, and app memory display
- **Built-in terminal** — Open terminal directly from the app

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `F` | Focus toolbar filter box |
| `f` | Open filter dialog |
| `Ctrl+F` | Focus search box |
| `Ctrl+H` | Toggle filter results panel |
| `Ctrl+G` | Toggle floating file tree |
| `Shift+W` | Toggle filter panel maximize |
| `Alt+X` | Toggle fullscreen |
| `Alt+1~9` | Switch to window N |
| `Ctrl+Tab` | Cycle through windows |
| `Ctrl+Shift+T` | New window |
| `Ctrl+Scroll` | Font zoom |
| `Alt+Scroll` | Horizontal scroll |

## Architecture

```
ViLog/
├── jscode/                          # Electron application
│   ├── main.js                      # Main process (window management, file I/O, IPC)
│   ├── preload.js                   # Preload script (secure API bridge)
│   ├── index.html                   # Main window UI
│   ├── renderer/
│   │   ├── css/style.css            # Application styles
│   │   └── js/
│   │       ├── core/                # Event bus, state management, DOM helpers
│   │       ├── features/            # Feature modules (filter, search, bookmarks, etc.)
│   │       ├── workers/             # In-renderer workers (CSV parser, stats, index builder)
│   │       └── utils/               # Constants, helpers, worker manager
│   ├── workers/                     # Standalone workers (WASM timestamp, directory scanner)
│   ├── icons/                       # Application icons
│   └── package.json                 # Node.js package manifest
├── server/
│   └── log_server.c                 # High-performance C HTTP server (thread pool, epoll)
├── docs/                            # Documentation and assets
└── LICENSE                          # MIT License
```

### Technology Stack

| Component | Technology |
|-----------|-----------|
| Framework | Electron 28+ |
| Rendering | Canvas API (GPU-accelerated) |
| Multithreading | Web Workers (parallel filtering) |
| Native search | WebAssembly (C-compiled) |
| Multi-pattern matching | Aho-Corasick algorithm |
| External search | ripgrep, Everything SDK |
| Remote server | C with pthread thread pool (32 threads, 4096 connections) |
| Data parsing | PapaParse (CSV), custom Vlog parser |
| Visualization | Chart.js with zoom plugin |
| Storage | IndexedDB (filter history, bookmarks) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Electron](https://www.electronjs.org/) 28+
- (Optional) [7-Zip](https://www.7-zip.org/) for archive browsing
- (Optional) [ripgrep](https://github.com/BurntSushi/ripgrep) for accelerated search
- (Optional) [Everything](https://www.voidtools.com/) for instant file search on Windows

### Install & Run

```bash
# Clone the repository
git clone https://github.com/ranxuefeng2022/ViLog.git
cd ViLog

# Install dependencies
cd jscode
npm install

# Launch the application
npm start
```

### Build the C Server (Optional — for remote file browsing)

```bash
cd server
gcc -o log_server log_server.c -lpthread -O2 -D_GNU_SOURCE

# Run on port 8082
./log_server 8082 /path/to/logs
```

## Performance Benchmarks

| Scenario | Lines | File Size | Filter Time | Scroll FPS |
|----------|-------|-----------|-------------|------------|
| Single file | 1M | 200MB | ~0.3s | 60 |
| Multi-keyword filter (5 keywords) | 1M | 200MB | ~0.5s | 60 |
| 10 files merged | 5M | 1GB | ~1.2s | 60 |
| Ripgrep hybrid mode | 5M | 1GB | ~0.2s | 60 |

*Tested on Intel i7-12700, 32GB RAM, NVMe SSD. Results may vary.*

## Use Cases

- **Embedded/IoT development** — Analyze device logs, battery diagnostics (vlog format)
- **Server administration** — Browse remote logs via the built-in HTTP server
- **QA/Testing** — Multi-file log comparison with side-by-side windows
- **Mobile development** — Android logcat, kernel logs, dmesg analysis
- **Data analysis** — CSV/TSV parsing with interactive chart visualization

## Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests — every contribution helps.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Support the Project

If ViLog helps your workflow, consider supporting the project:

<div align="center">

<img src="docs/buy_me_a_coffee.jpg" width="200" alt="Buy Me a Coffee" />

</div>

If you find ViLog useful, please consider giving it a star ⭐ — it helps others discover the project!

---

<div align="center">

**ViLog — Fast. Powerful. Professional.**

</div>
