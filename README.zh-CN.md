<div align="center">

# ViLog

### 专业高性能日志查看器

**基于 Electron 构建的桌面日志查看工具，为速度而生。轻松处理百万行级日志文件。**

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

## 为什么选择 ViLog？

如果你曾经用文本编辑器打开一个 500MB 的日志文件然后看着它卡死，ViLog 就是为您而生的。ViLog 从底层开始为**大规模日志分析**而构建，融合了 GPU 加速的 Canvas 渲染、多线程 Web Worker 和算法级优化（Aho-Corasick、WASM），在百万行文件上实现即时过滤和流畅滚动。

## 功能特性

### 极速性能

| 特性 | 说明 |
|------|------|
| **Canvas 渲染** | GPU 加速的日志显示，替代 DOM 节点渲染 — 轻松处理数百万行日志 |
| **虚拟滚动** | 只渲染可见行，10M+ 行日志零延迟滚动 |
| **多线程过滤** | 并行 Web Worker 将过滤任务分配到多个 CPU 核心 |
| **Aho-Corasick 算法** | O(n+z) 时间复杂度的多模式匹配 — 同时过滤 10+ 关键词无额外开销 |
| **WebAssembly 搜索** | 通过 WASM 模块实现接近原生的字符串匹配性能 |
| **混合智能过滤** | 根据文件大小自动选择 ripgrep（大文件）或 JS Worker（小文件） |
| **行数据缓存** | 同一文件重复过滤时跳过数据传输 — 只向 Worker 发送关键词 |

### 强大的过滤与搜索

- **多关键词过滤** — 使用 `|` 分隔多个关键词，`\|` 表示字面量 `|`
- **正则表达式支持** — 过滤和搜索均支持完整的 JavaScript 正则
- **二级过滤** — 在过滤结果中再次过滤
- **过滤历史** — 基于模糊匹配的持久化关键词历史（IndexedDB 存储）
- **关键词高亮** — 10 种预设颜色 + 自定义颜色选择器
- **排除行** — 右键从结果中排除匹配的行
- **搜索导航** — Enter/Shift+Enter 在匹配项之间跳转

### 文件管理

- **文件树侧边栏** — 直接拖放文件、文件夹或压缩包
- **压缩包浏览** — ZIP、7z、RAR、tar.gz — 无需解压直接浏览内容
- **远程文件服务器** — 通过内置 C 语言 HTTP 服务器连接远程机器（线程池，高并发）
- **本地共享** — 通过局域网与团队成员共享本地目录
- **剪贴板粘贴** — 使用 Ctrl+V 直接粘贴文件
- **CSV/TSV 表格视图** — 以可排序的表格形式解析和展示结构化数据
- **Everything 集成** — 通过 Everything HTTP API 在 Windows 上实现即时文件搜索
- **Ripgrep 集成** — 大文件文本搜索速度提升 20-100 倍

### 数据可视化

- **CSV 图表绘制** — 带缩放、平移和列选择的交互式折线图
- **Vlog 解析器** — 专用的电池/设备诊断日志解析器（21 个字段）及可视化
- **列选择器** — 在表格视图中保留或删除特定列
- **导出功能** — 复制过滤结果或导出为 HTML

### 工作空间与效率

- **多窗口** — 在独立窗口中打开多个日志文件，使用 Alt+1~9 切换
- **书签** — 标记重要行并在其间跳转
- **跳转到行** — 即时跳转到任意行号
- **快捷链接** — 收藏常用网站（内置网页面板）
- **AI 助手** — 嵌入式 AI 聊天面板，辅助日志分析
- **串口日志** — 串口日志监控窗口
- **字体缩放** — Ctrl+滚轮缩放，Alt+滚轮水平平移
- **系统监控** — 实时 CPU、内存和应用内存显示
- **内置终端** — 直接从应用中打开终端

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `F` | 聚焦工具栏过滤框 |
| `f` | 打开过滤对话框 |
| `Ctrl+F` | 聚焦搜索框 |
| `Ctrl+H` | 显示/隐藏过滤结果面板 |
| `Ctrl+G` | 弹出/隐藏悬浮文件树 |
| `Shift+W` | 切换过滤面板最大化 |
| `Alt+X` | 全屏切换 |
| `Alt+1~9` | 切换到第 N 个窗口 |
| `Ctrl+Tab` | 循环切换窗口 |
| `Ctrl+Shift+T` | 新建窗口 |
| `Ctrl+滚轮` | 字体缩放 |
| `Alt+滚轮` | 水平滚动 |

## 架构

```
ViLog/
├── jscode/                          # Electron 应用
│   ├── main.js                      # 主进程（窗口管理、文件I/O、IPC）
│   ├── preload.js                   # 预加载脚本（安全API桥接）
│   ├── index.html                   # 主窗口UI
│   ├── renderer/
│   │   ├── css/style.css            # 应用样式
│   │   └── js/
│   │       ├── core/                # 事件总线、状态管理、DOM辅助
│   │       ├── features/            # 功能模块（过滤、搜索、书签等）
│   │       ├── workers/             # 渲染器内Worker（CSV解析、统计、索引构建）
│   │       └── utils/               # 常量、辅助函数、Worker管理器
│   ├── workers/                     # 独立Worker（WASM时间戳、目录扫描）
│   ├── icons/                       # 应用图标
│   └── package.json                 # Node.js 包清单
├── server/
│   └── log_server.c                 # 高性能C语言HTTP服务器（线程池、epoll）
├── docs/                            # 文档和资源
└── LICENSE                          # MIT 许可证
```

### 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Electron 28+ |
| 渲染引擎 | Canvas API（GPU 加速） |
| 多线程 | Web Workers（并行过滤） |
| 原生搜索 | WebAssembly（C 编译） |
| 多模式匹配 | Aho-Corasick 算法 |
| 外部搜索 | ripgrep、Everything SDK |
| 远程服务器 | C + pthread 线程池（32线程，4096连接） |
| 数据解析 | PapaParse（CSV）、自定义 Vlog 解析器 |
| 可视化 | Chart.js + 缩放插件 |
| 存储 | IndexedDB（过滤历史、书签） |

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) 18+
- [Electron](https://www.electronjs.org/) 28+
- （可选）[7-Zip](https://www.7-zip.org/) 用于压缩包浏览
- （可选）[ripgrep](https://github.com/BurntSushi/ripgrep) 用于加速搜索
- （可选）[Everything](https://www.voidtools.com/) 用于 Windows 上的即时文件搜索

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/ranxuefeng2022/ViLog.git
cd ViLog

# 安装依赖
cd jscode
npm install

# 启动应用
npm start
```

### 编译 C 服务器（可选 — 用于远程文件浏览）

```bash
cd server
gcc -o log_server log_server.c -lpthread -O2 -D_GNU_SOURCE

# 在 8082 端口运行
./log_server 8082 /path/to/logs
```

## 性能基准

| 场景 | 行数 | 文件大小 | 过滤耗时 | 滚动 FPS |
|------|------|----------|----------|----------|
| 单文件 | 100万 | 200MB | ~0.3秒 | 60 |
| 多关键词过滤（5个关键词） | 100万 | 200MB | ~0.5秒 | 60 |
| 10个文件合并 | 500万 | 1GB | ~1.2秒 | 60 |
| Ripgrep 混合模式 | 500万 | 1GB | ~0.2秒 | 60 |

*测试环境：Intel i7-12700, 32GB RAM, NVMe SSD。实际结果可能有所不同。*

## 应用场景

- **嵌入式/IoT 开发** — 分析设备日志、电池诊断（vlog 格式）
- **服务器运维** — 通过内置 HTTP 服务器浏览远程日志
- **QA/测试** — 多文件日志对比，并排窗口查看
- **移动开发** — Android logcat、内核日志、dmesg 分析
- **数据分析** — CSV/TSV 解析配合交互式图表可视化

## 贡献

欢迎贡献！无论是 Bug 报告、功能请求还是 Pull Request — 每一份贡献都有价值。

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 发起 Pull Request

## 许可证

本项目基于 MIT 许可证授权 — 详见 [LICENSE](LICENSE) 文件。

## 支持项目

如果 ViLog 对您有帮助，欢迎赞助支持：

<div align="center">

<img src="docs/buy_me_a_coffee.jpg" width="200" alt="请我喝杯咖啡" />

</div>

如果觉得 ViLog 好用，请给个 Star ⭐ — 帮助更多人发现这个项目！

---

<div align="center">

**ViLog — 快速、强大、专业**

</div>
