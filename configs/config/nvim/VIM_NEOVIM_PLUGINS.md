# Vim / Neovim 插件完整分类列表

> 整理时间：2026年5月
> 涵盖当前（2025-2026年）最流行、最实用的 Vim/Neovim 插件，按功能分类，共收录 **400+** 个插件。
> 数据来源：[awesome-neovim](https://github.com/rockerBOO/awesome-neovim)、[Dotfyle](https://dotfyle.com/neovim/plugins/top)、[GitHub Trending](https://github.com/trending/vim-script)、社区推荐。

---

## 目录

1. [插件管理器](#1-插件管理器)
2. [LSP 语言服务器协议](#2-lsp-语言服务器协议)
3. [代码补全](#3-代码补全)
4. [AI / LLM 集成](#4-ai--llm-集成)
5. [模糊查找与搜索](#5-模糊查找与搜索)
6. [文件浏览器与项目管理](#6-文件浏览器与项目管理)
7. [颜色主题](#7-颜色主题)
8. [UI 增强 / 状态栏 / 标签栏](#8-ui-增强--状态栏--标签栏)
9. [光标移动与导航](#9-光标移动与导航)
10. [动画效果](#10-动画效果)
11. [Git 集成](#11-git-集成)
12. [代码编辑辅助](#12-代码编辑辅助)
13. [Tree-sitter 相关](#13-tree-sitter-相关)
14. [代码格式化](#14-代码格式化)
15. [调试与测试](#15-调试与测试)
16. [终端集成与代码运行](#16-终端集成与代码运行)
17. [Tmux 集成与会话管理](#17-tmux-集成与会话管理)
18. [Snippets 代码片段](#18-snippets-代码片段)
19. [快捷键提示与发现](#19-快捷键提示与发现)
20. [启动面板 Dashboard](#20-启动面板-dashboard)
21. [通知与消息](#21-通知与消息)
22. [撤销历史](#22-撤销历史)
23. [Markdown 与写作](#23-markdown-与写作)
24. [LaTeX](#24-latex)
25. [数据库](#25-数据库)
26. [笔记与知识管理](#26-笔记与知识管理)
27. [远程开发与协作](#27-远程开发与协作)
28. [语言特定插件](#28-语言特定插件)
29. [工具库与依赖](#29-工具库与依赖)
30. [预配置发行版](#30-预配置发行版)
31. [Vim 经典插件](#31-vim-经典插件兼容-vimneovim)

---

## 1. 插件管理器

| 插件 | 描述 |
|------|------|
| [folke/lazy.nvim](https://github.com/folke/lazy.nvim) | 现代插件管理器，带图形化 UI、异步执行、lockfile 支持。当前事实标准。 |
| [junegunn/vim-plug](https://github.com/junegunn/vim-plug) | 经典极简插件管理器，同时支持 Vim 和 Neovim。 |
| [wbthomason/packer.nvim](https://github.com/wbthomason/packer.nvim) | 曾是最流行的 Lua 插件管理器，现已不再维护，被 lazy.nvim 取代。 |
| [lumen-oss/rocks.nvim](https://github.com/lumen-oss/rocks.nvim) | 基于 LuaRocks 的插件管理，灵感来自 Cargo。 |
| [echasnovski/mini.deps](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的极简依赖管理模块，零外部依赖。 |
| [Shougo/dein.vim](https://github.com/Shougo/dein.vim) | 暗黑之力插件管理器，异步安装，支持 Vim/Neovim。 |

---

## 2. LSP（语言服务器协议）

| 插件 | 描述 |
|------|------|
| [neovim/nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) | LSP 客户端快速配置，几乎所有 Neovim LSP 配置的基础。 |
| [williamboman/mason.nvim](https://github.com/williamboman/mason.nvim) | 便携式包管理器，管理 LSP server、DAP server、linter、formatter 的安装。 |
| [williamboman/mason-lspconfig.nvim](https://github.com/williamboman/mason-lspconfig.nvim) | 桥接 mason.nvim 和 nvim-lspconfig，自动配置。 |
| [nvimdev/lspsaga.nvim](https://github.com/nvimdev/lspsaga.nvim) | 高性能、美观的 LSP UI（hover、code action、signature help 等）。 |
| [stevearc/aerial.nvim](https://github.com/stevearc/aerial.nvim) | 代码大纲/符号概览，用于快速导航。 |
| [j-hui/fidget.nvim](https://github.com/j-hui/fidget.nvim) | 独立的 LSP 进度 UI。 |
| [mfussenegger/nvim-lint](https://github.com/mfussenegger/nvim-lint) | 异步 linter 插件，补充内置 LSP。 |
| [aznhe21/actions-preview.nvim](https://github.com/aznhe21/actions-preview.nvim) | 完全可定制的 code action 预览器。 |
| [rachartier/tiny-inline-diagnostic.nvim](https://github.com/rachartier/tiny-inline-diagnostic.nvim) | 美化内联诊断信息，支持多行展示。 |
| [folke/trouble.nvim](https://github.com/folke/trouble.nvim) | 漂亮的诊断列表面板，支持 LSP 诊断、引用、TODO 等。 |
| [dnlhc/glance.nvim](https://github.com/dnlhc/glance.nvim) | 类似 VSCode 的 peek 预览窗口，用于 LSP 定义/引用。 |
| [VidocqH/lsp-lens.nvim](https://github.com/VidocqH/lsp-lens.nvim) | 在函数/引用上方显示虚拟文本（如引用计数）。 |
| [kosayoda/nvim-lightbulb](https://github.com/kosayoda/nvim-lightbulb) | 当有 code action 可用时在 sign column 显示灯泡图标。 |
| [onsails/lspkind.nvim](https://github.com/onsails/lspkind.nvim) | 为 LSP 补全项添加图标（pictograms）。 |
| [ray-x/lsp_signature.nvim](https://github.com/ray-x/lsp_signature.nvim) | 函数签名提示（signature help）浮窗。 |

---

## 3. 代码补全

| 插件 | 描述 |
|------|------|
| [hrsh7th/nvim-cmp](https://github.com/hrsh7th/nvim-cmp) | 主流补全框架，基于插件化源生态系统。 |
| [saghen/blink.cmp](https://github.com/saghen/blink.cmp) | 极速补全引擎，2025-2026 年崛起的 nvim-cmp 替代品，LSP + snippet + cmdline 补全一体。 |
| [ms-jpq/coq_nvim](https://github.com/ms-jpq/coq_nvim) | 速度优先的单体补全引擎，基于 SQLite。 |
| [lukas-reineke/cmp-under-comparator](https://github.com/lukas-reineke/cmp-under-comparator) | nvim-cmp 的更智能排序（词边界感知）。 |
| [hrsh7th/cmp-nvim-lsp](https://github.com/hrsh7th/cmp-nvim-lsp) | nvim-cmp 的 LSP 源。 |
| [hrsh7th/cmp-buffer](https://github.com/hrsh7th/cmp-buffer) | nvim-cmp 的缓冲区词源。 |
| [hrsh7th/cmp-path](https://github.com/hrsh7th/cmp-path) | nvim-cmp 的文件路径源。 |
| [saadparwaiz1/cmp_luasnip](https://github.com/saadparwaiz1/cmp_luasnip) | nvim-cmp 的 LuaSnip 源。 |
| [hrsh7th/cmp-cmdline](https://github.com/hrsh7th/cmp-cmdline) | nvim-cmp 的命令行补全。 |
| [zbirenbaum/copilot.lua](https://github.com/zbirenbaum/copilot.lua) | GitHub Copilot 的 Lua 实现，可作为 nvim-cmp 源。 |
| [neoclide/coc.nvim](https://github.com/neoclide/coc.nvim) | Node.js 驱动的全能补全框架（VSCode 扩展兼容），适合 Vim 8+ 和 Neovim。 |
| [gelguy/wilder.nvim](https://github.com/gelguy/wilder.nvim) | 更现代的命令行补全菜单（类似 zsh 的模糊匹配）。 |

---

## 4. AI / LLM 集成

> 2025-2026 年增长最快的类别

| 插件 | 描述 |
|------|------|
| [yetone/avante.nvim](https://github.com/yetone/avante.nvim) | 类 Cursor 的 AI 聊天和内联编辑体验。 |
| [olimorris/codecompanion.nvim](https://github.com/olimorris/codecompanion.nvim) | 类 Copilot Chat 体验，支持 Claude、Gemini、Ollama、OpenAI。 |
| [milanglacier/minuet-ai.nvim](https://github.com/milanglacier/minuet-ai.nvim) | LLM 代码补全，可集成 nvim-cmp / blink.cmp / virtual text。 |
| [Exafunction/windsurf.nvim](https://github.com/Exafunction/windsurf.nvim) | 免费、超快的 Copilot 替代品，带 LSP + Tree-sitter 上下文。 |
| [Robitx/gp.nvim](https://github.com/Robitx/gp.nvim) | ChatGPT 会话和可指示的代码/文本操作。 |
| [CopilotC-Nvim/CopilotChat.nvim](https://github.com/CopilotC-Nvim/CopilotChat.nvim) | GitHub Copilot 聊天界面。 |
| [David-Kunz/gen.nvim](https://github.com/David-Kunz/gen.nvim) | 通过 Ollama 使用本地 LLM 生成文本，支持自定义提示。 |
| [dlants/magenta.nvim](https://github.com/dlants/magenta.nvim) | AI agent 工具，用于探索和编辑代码（Aider/Cursor 风格）。 |
| [Flemma-Dev/flemma.nvim](https://github.com/Flemma-Dev/flemma.nvim) | 一流 AI 工作空间。 |
| [nickjvandyke/opencode.nvim](https://github.com/nickjvandyke/opencode.nvim) | OpenCode AI 助手集成。 |
| [wsdjeg/chat.nvim](https://github.com/wsdjeg/chat.nvim) | 可扩展的多提供商 AI 聊天。 |
| [0xble/dotagent.nvim](https://github.com/0xble/dotagent.nvim) | Claude Code & Codex 提示编辑器补全。 |
| [ishiooon/codex.nvim](https://github.com/ishiooon/codex.nvim) | Codex IDE 集成（无需 API key）。 |
| [taigrr/neocrush.nvim](https://github.com/taigrr/neocrush.nvim) | Crush AI 编码助手。 |
| [cursortab/cursortab.nvim](https://github.com/cursortab/cursortab.nvim) | 多提供商 AI 补全和光标预测。 |
| [github/copilot.vim](https://github.com/github/copilot.vim) | GitHub 官方 Copilot Vim/Neovim 插件。 |

---

## 5. 模糊查找与搜索

| 插件 | 描述 |
|------|------|
| [nvim-telescope/telescope.nvim](https://github.com/nvim-telescope/telescope.nvim) | 最流行的模糊查找器——文件、grep、buffer、LSP 符号等皆可搜索。 |
| [ibhagwan/fzf-lua](https://github.com/ibhagwan/fzf-lua) | 基于 fzf 的 picker，在大仓库中通常比 Telescope 更快。 |
| [folke/snacks.nvim](https://github.com/folke/snacks.nvim) | QoL 插件集合，包含超快 picker 及其他工具。 |
| [liuchengxu/vim-clap](https://github.com/liuchengxu/vim-clap) | Rust 编写的高性能模糊选择器。 |
| [Shougo/ddu.vim](https://github.com/Shougo/ddu.vim) | Deno 驱动的可扩展 UI 框架（不仅仅是 picker）。 |
| [lambdalisue/vim-fall](https://github.com/lambdalisue/vim-fall) | 基于 Denops 的新一代模糊查找器。 |
| [cloud/stuff.nvim](https://github.com/cloud/stuff.nvim) | 类似 Emacs Helm 的选择 UI。 |
| [2KAbhishek/seeker.nvim](https://github.com/2KAbhishek/seeker.nvim) | 渐进式文件搜索器，基于 snacks.nvim。 |
| [juniorsundar/refer.nvim](https://github.com/juniorsundar/refer.nvim) | 极简 picker。 |
| [dtormoen/neural-open.nvim](https://github.com/dtormoen/neural-open.nvim) | 基于神经网络的智能文件排名选择器。 |
| [echasnovski/mini.pick](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的轻量 picker 模块。 |

---

## 6. 文件浏览器与项目管理

| 插件 | 描述 |
|------|------|
| [nvim-neo-tree/neo-tree.nvim](https://github.com/nvim-neo-tree/neo-tree.nvim) | 现代文件浏览器，Git 集成、图标、浮动窗口支持。 |
| [nvim-tree/nvim-tree.lua](https://github.com/nvim-tree/nvim-tree.lua) | 快速文件树侧栏。 |
| [stevearc/oil.nvim](https://github.com/stevearc/oil.nvim) | 可编辑的目录 buffer——像编辑文本一样操作文件系统。2025 年极受欢迎。 |
| [preservim/nerdtree](https://github.com/preservim/nerdtree) | 经典 Vim 文件树浏览器，同时支持 Neovim。 |
| [mbbill/undotree](https://github.com/mbbill/undotree) | 撤销树可视化。 |
| [josephschmitt/pj.nvim](https://github.com/josephschmitt/pj.nvim) | 自动项目发现（支持 Snacks、Telescope、fzf-lua）。 |
| [ahmedkhalf/project.nvim](https://github.com/ahmedkhalf/project.nvim) | 项目管理插件，自动检测项目根目录。 |
| [echasnovski/mini.files](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的文件浏览器，类似 oil.nvim 的编辑范式。 |
| [ThePrimeagen/harpoon](https://github.com/ThePrimeagen/harpoon) | 快速文件跳转/标记系统（mark 文件快速切换）。 |
| [ThePrimeagen/harpoon2](https://github.com/ThePrimeagen/harpoon) | harpoon 的 v2 重写，更灵活的 API。 |

---

## 7. 颜色主题

| 插件 | 描述 |
|------|------|
| [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim) | 干净清爽的暗/亮主题，社区最爱。 |
| [catppuccin/nvim](https://github.com/catppuccin/nvim) | 柔和的 pastel 主题，有大量插件集成。 |
| [morhetz/gruvbox](https://github.com/morhetz/gruvbox) | 经典复古色调主题，广受喜爱。 |
| [rose-pine/neovim](https://github.com/rose-pine/neovim) | 温暖自然的松木色调主题。 |
| [EdenEast/nightfox.nvim](https://github.com/EdenEast/nightfox.nvim) | 高对比度暗色主题系列（nightfox, dayfox 等）。 |
| [navarasu/onedark.nvim](https://github.com/navarasu/onedark.nvim) | Atom 风格 One Dark 主题的 Neovim 实现。 |
| [Mofiqul/dracula.nvim](https://github.com/Mofiqul/dracula.nvim) | Dracula 主题的 Neovim 版本。 |
| [rebelot/kanagawa.nvim](https://github.com/rebelot/kanagawa.nvim) | 日式浮世绘风格暖色主题。 |
| [nyoom-engineering/oxocarbon.nvim](https://github.com/nyoom-engineering/oxocarbon.nvim) | IBM 风格深色主题。 |
| [projekt0n/github-nvim-theme](https://github.com/projekt0n/github-nvim-theme) | GitHub 配色主题。 |
| [shaunsingh/nord.nvim](https://github.com/shaunsingh/nord.nvim) | Nord 配色的 Neovim 实现。 |
| [sainnhe/sonokai](https://github.com/sainnhe/sonokai) | 基于 Monokai Pro 的高对比度主题。 |
| [sainnhe/everforest](https://github.com/sainnhe/everforest) | 护眼绿色调主题。 |
| [marko-cerovac/material.nvim](https://github.com/marko-cerovac/material.nvim) | Material Design 风格主题。 |
| [ellisonleao/gruvbox.nvim](https://github.com/ellisonleao/gruvbox.nvim) | gruvbox 的 Lua 原生实现。 |
| [AlexvZyl/nordic.nvim](https://github.com/AlexvZyl/nordic.nvim) | 更暖的 Nord 变体主题。 |
| [oskar1234/koda.nvim](https://github.com/oskarnurm/koda.nvim) | 极简主义伴生主题（2026 新星）。 |
| [hyperb1iss/silkcircuit](https://github.com/hyperb1iss/silkcircuit) | 赛博朋克配色系统，5 种变体，40+ 插件集成，WCAG AA 合规。 |
| [ThorstenRhau/token](https://github.com/ThorstenRhau/token) | 暖色调主题，完整 Tree-sitter + LSP 集成。 |
| [silentium-theme/silentium.nvim](https://github.com/silentium-theme/silentium.nvim) | 实用单色调——减少眼疲劳，只高亮需要关注的内容。 |
| [serhez/teide.nvim](https://github.com/serhez/teide.nvim) | TokyoNight fork，带有新鲜配色。 |
| [ankushbhagats/pastel.nvim](https://github.com/ankushbhagats/pastel.nvim) | 优雅的 pastel 配色方案。 |

---

## 8. UI 增强 / 状态栏 / 标签栏

| 插件 | 描述 |
|------|------|
| [nvim-lualine/lualine.nvim](https://github.com/nvim-lualine/lualine.nvim) | 快速、可配置的状态栏，Lua 编写。 |
| [romgrk/barbar.nvim](https://github.com/romgrk/barbar.nvim) | 带可排序标签、图标和 Git 指示器的 buffer 栏。 |
| [folke/noice.nvim](https://github.com/folke/noice.nvim) | 用现代浮动窗口替代 cmdline、消息和搜索 UI。 |
| [akinsho/bufferline.nvim](https://github.com/akinsho/bufferline.nvim) | 流畅的 buffer/标签行。 |
| [rcarriga/nvim-notify](https://github.com/rcarriga/nvim-notify) | 精美的浮动通知窗口。 |
| [stevearc/dressing.nvim](https://github.com/stevearc/dressing.nvim) | ⚠️ 已于 2025 年归档。改进 vim.ui.input 和 vim.ui.select。推荐用 snacks.nvim 替代。 |
| [MunifTanjim/nui.nvim](https://github.com/MunifTanjim/nui.nvim) | UI 组件库（popup, input, menu, split 等），许多插件的底层依赖。 |
| [anuvyklack/windows.nvim](https://github.com/anuvyklack/windows.nvim) | 增强的窗口管理（最大化、居中、动画等）。 |
| [xiyaowong/nvim-transparent](https://github.com/xiyaowong/nvim-transparent) | 透明背景支持。 |
| [luukvbaal/statuscol.nvim](https://github.com/luukvbaal/statuscol.nvim) | 可配置的状态列（statuscolumn），支持 fold、number、sign 等。 |
| [b0o/incline.nvim](https://github.com/b0o/incline.nvim) | 浮动状态行/窗口名，类似 i3 标题栏风格。 |
| [nvim-zh/colorful-winsep.nvim](https://github.com/nvim-zh/colorful-winsep.nvim) | 彩色窗口分隔线。 |
| [echasnovski/mini.statusline](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的极简状态栏。 |
| [echasnovski/mini.tabline](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的极简标签栏。 |
| [echasnovski/mini.indentscope](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的缩进范围可视化。 |
| [echasnovski/mini.animate](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的动画效果模块。 |

---

## 9. 光标移动与导航

| 插件 | 描述 |
|------|------|
| [folke/flash.nvim](https://github.com/folke/flash.nvim) | 带实时标签的单词/行/语法节点跳转，集成 operator-pending 模式。 |
| [ggandor/leap.nvim](https://github.com/ggandor/leap.nvim) | 双向两字符跳转动作。 |
| [phaazon/hop.nvim](https://github.com/phaazon/hop.nvim) | 类似 EasyMotion 的标注标签移动。 |
| [ggandor/leap-spooky.nvim](https://github.com/ggandor/leap-spooky.nvim) | leap.nvim 的远程操作扩展。 |
| [ggandor/flit.nvim](https://github.com/ggandor/flit.nvim) | leaper 的增强版，专注单字符 f/t 跳转。 |
| [ggandor/eyeliner.nvim](https://github.com/ggandor/eyeliner.nvim) | 高亮 f/t 移动的独特字符。 |
| [justinmk/vim-sneak](https://github.com/justinmk/vim-sneak) | 经典两字符跳转插件（兼容 Vim/Neovim）。 |
| [easymotion/vim-easymotion](https://github.com/easymotion/vim-easymotion) | Vim 经典光标跳转插件。 |
| [smoka7/multicursors.nvim](https://github.com/smoka7/multicursors.nvim) | 多光标编辑。 |
| [mg979/vim-visual-multi](https://github.com/mg979/vim-visual-multi) | 多光标编辑插件（支持 Vim/Neovim）。 |
| [kiyoon/repeatable-move.nvim](https://github.com/kiyoon/repeatable-move.nvim) | 使任意移动可用 `;` 和 `,` 重复。 |
| [cbochs/grapple.nvim](https://github.com/cbochs/grapple.nvim) | 基于标签的文件标记/导航。 |
| [chentoast/marks.nvim](https://github.com/chentoast/marks.nvim) | 更好的 mark 显示和导航。 |
| [ThePrimeagen/harpoon](https://github.com/ThePrimeagen/harpoon) | 快速文件跳转系统（参考第 6 节）。 |

---

## 10. 动画效果

| 插件 | 描述 |
|------|------|
| [sphamba/smear-cursor.nvim](https://github.com/sphamba/smear-cursor.nvim) | 带涂抹效果的动画光标——Dotfyle 动画类 #1 插件。 |
| [rachartier/tiny-glimmer.nvim](https://github.com/rachartier/tiny-glimmer.nvim) | yank、paste、search、undo/redo 的流畅动画。 |
| [LuxVim/nvim-luxmotion](https://github.com/LuxVim/nvim-luxmotion) | 60fps 平滑光标移动、单词跳转和滚动。 |
| [y3owk1n/undo-glow.nvim](https://github.com/y3owk1n/undo-glow.nvim) | undo、redo、yank、paste 上的发光动画。 |
| [echasnovski/mini.animate](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的动画模块（光标、滚动、移动等）。 |
| [xieyonn/spinner.nvim](https://github.com/xieyonn/spinner.nvim) | 动画 spinner 框架。 |

---

## 11. Git 集成

| 插件 | 描述 |
|------|------|
| [NeogitOrg/neogit](https://github.com/NeogitOrg/neogit) | 类 Magit 的 Git 界面——在 Neovim 中 stage hunk、写 commit、解决冲突。 |
| [lewis6991/gitsigns.nvim](https://github.com/lewis6991/gitsigns.nvim) | sign column 中的 Git 标记、内联 blame、hunk 暂存。 |
| [sindrets/diffview.nvim](https://github.com/sindrets/diffview.nvim) | 单标签页中的 diff 界面，支持任意 Git 版本对比。 |
| [esmuellert/codediff.nvim](https://github.com/esmuellert/codediff.nvim) | 并排 diff，使用 C 实现的 VSCode diff 算法，双层高亮（行+字符）。 |
| [tpope/vim-fugitive](https://github.com/tpope/vim-fugitive) | 经典 Git 封装（Vim/Neovim 通用），`:Git` 命令提供全面的 Git 操作。 |
| [akinsho/git-conflict.nvim](https://github.com/akinsho/git-conflict.nvim) | Git 冲突检测和解决。 |
| [rhysd/git-messenger.vim](https://github.com/rhysd/git-messenger.vim) | 弹出 window 显示光标下的 git blame 信息。 |
| [ruifm/gitlinker.nvim](https://github.com/ruifm/gitlinker.nvim) | 生成文件的 GitHub/GitLab 链接。 |
| [linrongbin16/gitlinker.nvim](https://github.com/linrongbin16/gitlinker.nvim) | gitlinker 的维护 fork。 |
| [tanvirtin/vgit.nvim](https://github.com/tanvirtin/vgit.nvim) | 可视化 Git 插件，显示行修改和 hunk。 |
| [chojs23/ec](https://github.com/chojs23/ec) | 原生 TUI Git mergetool，带 3 个面板（2026 新作）。 |
| [spacedentist/resolve.nvim](https://github.com/spacedentist/resolve.nvim) | 轻松解决合并冲突。 |
| [kokusenz/deltaview.nvim](https://github.com/kokusenz/deltaview.nvim) | Delta 风格的内联 diff 查看器。 |
| [dlyongemallo/diffview.nvim](https://github.com/dlyongemallo/diffview.nvim) | diffview.nvim 的维护 fork。 |
| [FabijanZulj/blame.nvim](https://github.com/FabijanZulj/blame.nvim) | 内联 git blame 的 Neovim 实现。 |

---

## 12. 代码编辑辅助

| 插件 | 描述 |
|------|------|
| [numToStr/Comment.nvim](https://github.com/numToStr/Comment.nvim) | 智能代码注释，支持 operator 模式。 |
| [kylechui/nvim-surround](https://github.com/kylechui/nvim-surround) | 环绕操作（添加/修改/删除括号、引号、标签）。Lua 版事实标准。 |
| [tpope/vim-surround](https://github.com/tpope/vim-surround) | 经典 Vim 环绕操作插件。 |
| [echasnovski/mini.surround](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的环绕操作模块。 |
| [tpope/vim-repeat](https://github.com/tpope/vim-repeat) | 使插件操作支持 `.` 重复。 |
| [Wansmer/treesj](https://github.com/Wansmer/treesj) | 通过 Tree-sitter 拆分/合并代码块（数组、参数等）。 |
| [nemanjamalesija/smart-paste.nvim](https://github.com/nemanjamalesija/smart-paste.nvim) | 粘贴时通过 Tree-sitter 启发式规则自动缩进。 |
| [windwp/nvim-autopairs](https://github.com/windwp/nvim-autopairs) | 自动配对括号、引号等，基于 Tree-sitter。 |
| [windwp/nvim-ts-autotag](https://github.com/windwp/nvim-ts-autotag) | 自动关闭和重命名 HTML/JSX 标签。 |
| [altermo/ultimate-autopair.nvim](https://github.com/altermo/ultimate-autopair.nvim) | 新一代 autopair 插件，支持扩展。 |
| [andymass/vim-matchup](https://github.com/andymass/vim-matchup) | 增强的 `%` 匹配，支持更多语言。 |
| [junegunn/vim-easy-align](https://github.com/junegunn/vim-easy-align) | 简单的代码对齐插件。 |
| [godlygeek/tabular](https://github.com/godlygeek/tabular) | 强大的文本对齐插件。 |
| [michaeljsmith/vim-indent-object](https://github.com/michaeljsmith/vim-indent-object) | 基于缩进级别的文本对象。 |
| [folke/todo-comments.nvim](https://github.com/folke/todo-comments.nvim) | 高亮和搜索 TODO、FIXME、HACK 等注释，集成 Telescope/Trouble。 |
| [chrisgrieser/nvim-various-textobjs](https://github.com/chrisgrieser/nvim-various-textobjs) | 各种文本对象（近行、子词、列等）。 |
| [gbprod/substitute.nvim](https://github.com/gbprod/substitute.nvim) | 增强的替换操作符。 |
| [gbprod/yanky.nvim](https://github.com/gbprod/yanky.nvim) | 改进的 yank/paste，带高亮和历史记录。 |
| [nacro90/numb.nvim](https://github.com/nacro90/numb.nvim) | 在 peek 模式下显示行号，减少 UI 杂乱。 |

---

## 13. Tree-sitter 相关

| 插件 | 描述 |
|------|------|
| [nvim-treesitter/nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter) | **基础插件**——提供 parser 管理、语法高亮、缩进、代码折叠、语言注入。 |
| [nvim-treesitter/nvim-treesitter-context](https://github.com/nvim-treesitter/nvim-treesitter-context) | 在窗口顶部显示当前作用域（函数/类名）。 |
| [nvim-treesitter/nvim-treesitter-textobjects](https://github.com/nvim-treesitter/nvim-treesitter-textobjects) | 基于语法感知的文本对象（函数、类、参数等）。 |
| [nvim-treesitter/playground](https://github.com/nvim-treesitter/playground) | Tree-sitter AST 交互式调试/预览。 |
| [HiPhish/rainbow-delimiters.nvim](https://github.com/HiPhish/rainbow-delimiters.nvim) | 彩虹括号/分隔符，Tree-sitter 驱动。当前标准。 |
| [lukas-reineke/indent-blankline.nvim](https://github.com/lukas-reineke/indent-blankline.nvim) | 上下文感知缩进引导线，Tree-sitter 驱动。 |
| [saghen/blink.indent](https://github.com/saghen/blink.indent) | 2025 年新的高性能缩进引导线，每次按键评估。 |
| [wurli/contextindent.nvim](https://github.com/wurli/contextindent.nvim) | 嵌入式语言的上下文感知缩进。 |
| [romus204/tree-sitter-manager.nvim](https://github.com/romus204/tree-sitter-manager.nvim) | Tree-sitter parser 管理器（nvim-treesitter 的轻量替代）。 |
| [mfussenegger/nvim-treehopper](https://github.com/mfussenegger/nvim-treehopper) | 基于 Tree-sitter 的精细光标移动。 |
| [ziontee113/syntax-tree-surfer](https://github.com/ziontee113/syntax-tree-surfer) | 基于 AST 的导航和选择。 |
| [drybalka/tree-climber.nvim](https://github.com/drybalka/tree-climber.nvim) | Tree-sitter 节点级别的快速跳转。 |

---

## 14. 代码格式化

| 插件 | 描述 |
|------|------|
| [stevearc/conform.nvim](https://github.com/stevearc/conform.nvim) | 轻量格式化器——最小 diff、保留 mark/fold/光标。 |
| [mhartington/formatter.nvim](https://github.com/mhartington/formatter.nvim) | 另一个格式化插件，灵活配置。 |
| [lukas-reineke/lsp-format.nvim](https://github.com/lukas-reineke/lsp-format.nvim) | 基于 LSP 的格式化封装。 |
| [echasnovski/mini.align](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的对齐模块。 |

---

## 15. 调试与测试

| 插件 | 描述 |
|------|------|
| [mfussenegger/nvim-dap](https://github.com/mfussenegger/nvim-dap) | 调试适配器协议（DAP）客户端。 |
| [rcarriga/nvim-dap-ui](https://github.com/rcarriga/nvim-dap-ui) | nvim-dap 的现代 UI。 |
| [theHamsta/nvim-dap-virtual-text](https://github.com/theHamsta/nvim-dap-virtual-text) | nvim-dap 的虚拟文本变量显示。 |
| [Weissle/persistent-breakpoints.nvim](https://github.com/Weissle/persistent-breakpoints.nvim) | 持久化断点（跨会话保存）。 |
| [nvim-neotest/neotest](https://github.com/nvim-neotest/neotest) | 可扩展的测试运行框架。 |
| [andythigpen/nvim-coverage](https://github.com/andythigpen/nvim-coverage) | 代码覆盖率显示。 |
| [vim-test/vim-test](https://github.com/vim-test/vim-test) | 经典 Vim 测试运行插件（兼容 Neovim）。 |

---

## 16. 终端集成与代码运行

| 插件 | 描述 |
|------|------|
| [akinsho/toggleterm.nvim](https://github.com/akinsho/toggleterm.nvim) | 可持久化的多终端切换。 |
| [voldikss/vim-floaterm](https://github.com/voldikss/vim-floaterm) | 浮动终端窗口。 |
| [numToStr/FTerm.nvim](https://github.com/numToStr/FTerm.nvim) | 浮动终端（无依赖）。 |
| [rafcamlet/nvim-luapad](https://github.com/rafcamlet/nvim-luapad) | 交互式 Lua scratchpad。 |
| [CRAG666/code_runner.nvim](https://github.com/CRAG666/code_runner.nvim) | 代码运行器，支持多语言。 |
| [stevearc/overseer.nvim](https://github.com/stevearc/overseer.nvim) | 任务运行器和作业管理，类似 VSCode 的 task runner。 |
| [hkupty/iron.nvim](https://github.com/hkupty/iron.nvim) | 交互式 REPL，支持多种语言。 |
| [michaelb/sniprun](https://github.com/michaelb/sniprun) | 代码片段运行器，独立进程执行。 |
| [is0n/fm-nvim](https://github.com/is0n/fm-nvim) | Neovim 的 file manager（如 ranger/lf）插件。 |

---

## 17. Tmux 集成与会话管理

| 插件 | 描述 |
|------|------|
| [christoomey/vim-tmux-navigator](https://github.com/christoomey/vim-tmux-navigator) | Neovim 分屏和 tmux pane 之间的无缝导航（Ctrl-h/j/k/l）。必备。 |
| [syntaxpresso/bufstate.nvim](https://github.com/syntaxpresso/bufstate.nvim) | tmux 风格的 Neovim 内工作区管理。 |
| [EvWilson/slimux.nvim](https://github.com/EvWilson/slimux.nvim) | 发送高亮文本到 tmux pane（REPL 工作流）。 |
| [samharju/yeet.nvim](https://github.com/samharju/yeet.nvim) | 在终端 buffer 或 tmux pane 中运行 shell 命令。 |
| [karshPrime/tmux-compile.nvim](https://github.com/karshPrime/tmux-compile.nvim) | 在 tmux pane 中编译和运行程序。 |
| [rmagatti/auto-session](https://github.com/rmagatti/auto-session.nvim) | 自动保存和恢复会话（按工作目录）。 |
| [olimorris/persisted.nvim](https://github.com/olimorris/persisted.nvim) | 简单轻量的会话管理，集成 Telescope。 |
| [Shatur/neovim-session-manager](https://github.com/Shatur/neovim-session-manager) | 会话管理器，集成 Telescope。 |
| [natecraddock/sessions.nvim](https://github.com/natecraddock/sessions.nvim) | 极简会话管理。 |
| [aserowy/tmux.nvim](https://github.com/aserowy/tmux.nvim) | Neovim 的 tmux 集成（导航、resize 等）。 |

---

## 18. Snippets 代码片段

| 插件 | 描述 |
|------|------|
| [L3MON4D3/LuaSnip](https://github.com/L3MON4D3/LuaSnip) | Lua 驱动的 snippet 引擎，支持动态节点、选择节点和正则触发器。 |
| [rafamadriz/friendly-snippets](https://github.com/rafamadriz/friendly-snippets) | 预制的多语言 snippet 集合（兼容 LuaSnip）。 |
| [dcampos/nvim-snippy](https://github.com/dcampos/nvim-snippy) | 极简 snippet 插件。 |
| [honza/vim-snippets](https://github.com/honza/vim-snippets) | 经典 snippet 集合（兼容 UltiSnips/snipmate）。 |
| [SirVer/ultisnips](https://github.com/SirVer/ultisnips) | 经典 snippet 引擎（Python 驱动）。 |
| [garymjr/nvim-snippets](https://github.com/garymjr/nvim-snippets) | 轻量 VsCode 风格 snippet 插件。 |

---

## 19. 快捷键提示与发现

| 插件 | 描述 |
|------|------|
| [folke/which-key.nvim](https://github.com/folke/which-key.nvim) | 按键绑定弹出提示——再也不会忘记映射。v3 新增 Hydra 模式。 |
| [liuchengxu/vim-which-key](https://github.com/liuchengxu/vim-which-key) | which-key 的 Vim 兼容版本。 |
| [echasnovski/mini.clue](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的 which-key 替代模块。 |

---

## 20. 启动面板 Dashboard

| 插件 | 描述 |
|------|------|
| [goolord/alpha-nvim](https://github.com/goolord/alpha-nvim) | 最流行的 Lua 启动面板——最近文件、项目链接、自定义按钮、ASCII 艺术。 |
| [nvimdev/dashboard-nvim](https://github.com/nvimdev/dashboard-nvim) | 经典 vim-startify 风格面板，会话管理、MRU 文件、书签。 |
| [mhinz/vim-startify](https://github.com/mhinz/vim-startify) | 经典 Vim 启动面板。 |
| [katawful/nvim-startify](https://github.com/katawful/nvim-startify) | vim-startify 的 Fennel/Lua 重写版。 |

---

## 21. 通知与消息

| 插件 | 描述 |
|------|------|
| [rcarriga/nvim-notify](https://github.com/rcarriga/nvim-notify) | 精美的浮动通知窗口（当前标准）。 |
| [folke/snacks.nvim](https://github.com/folke/snacks.nvim) | 包含 `snacks.notifier` 替代 nvim-notify。 |
| [j-hui/fidget.nvim](https://github.com/j-hui/fidget.nvim) | LSP 进度通知。 |
| [echasnovski/mini.notify](https://github.com/echasnovski/mini.nvim) | mini.nvim 中的通知模块。 |

---

## 22. 撤销历史

| 插件 | 描述 |
|------|------|
| [XXiaoA/atone.nvim](https://github.com/XXiaoA/atone.nvim) | 撤销树可视化器——探索替代历史并恢复任何过去状态。 |
| [mbbill/undotree](https://github.com/mbbill/undotree) | 经典撤销树可视化器（Vim/Neovim 兼容）。 |
| [jiaoshijie/undotree](https://github.com/jiaoshijie/undotree) | Lua 编写的 undotree，更现代化的界面。 |
| [debugloop/telescope-undo.nvim](https://github.com/debugloop/telescope-undo.nvim) | 在 Telescope 中浏览和恢复撤销历史。 |

---

## 23. Markdown 与写作

| 插件 | 描述 |
|------|------|
| [iamcco/markdown-preview.nvim](https://github.com/iamcco/markdown-preview.nvim) | 浏览器实时 Markdown 预览，支持 KaTeX 数学公式、Mermaid 图表。 |
| [OXY2DEV/markview.nvim](https://github.com/OXY2DEV/markview.nvim) | 编辑器内预览（无需浏览器），支持 Markdown、Typst、LaTeX、AsciiDoc。 |
| [MeanderingProgrammer/render-markdown.nvim](https://github.com/MeanderingProgrammer/render-markdown.nvim) | 编辑器内 Markdown 渲染，直接显示格式化效果。 |
| [ellisonleao/glow.nvim](https://github.com/ellisonleao/glow.nvim) | 使用 Glow CLI 渲染 Markdown 预览。 |
| [toppair/peek.nvim](https://github.com/toppair/peek.nvim) | 使用 Deno 的 Markdown 实时预览。 |
| [plasticboy/vim-markdown](https://github.com/plasticboy/vim-markdown) | Vim 的 Markdown 语法/折叠/缩进增强。 |
| [sbdchd/neoformat](https://github.com/sbdchd/neoformat) | 多语言代码格式化（含 Markdown 的 prettier 支持）。 |

---

## 24. LaTeX

| 插件 | 描述 |
|------|------|
| [lervag/vimtex](https://github.com/lervag/vimtex) | **LaTeX 黄金标准**——PDF 实时预览、智能补全（引用/标签/命令）、编译管理、折叠/缩进、多文件项目。 |
| [robbielyman/latex.nvim](https://github.com/robbielyman/latex.nvim) | 极简、风格明确的 vimtex 替代品，Tree-sitter 驱动，上下文感知映射。 |
| [f3fora/nvim-texlabconfig](https://github.com/f3fora/nvim-texlabconfig) | texlab LSP 的 Neovim 配置。 |
| [jbyuki/nabla.nvim](https://github.com/jbyuki/nabla.nvim) | 在 Neovim 中渲染 LaTeX 数学公式为 ASCII 艺术。 |

---

## 25. 数据库

| 插件 | 描述 |
|------|------|
| [tpope/vim-dadbod](https://github.com/tpope/vim-dadbod) | Vim/Neovim 数据库交互工具包。 |
| [kristijanhusak/vim-dadbod-ui](https://github.com/kristijanhusak/vim-dadbod-ui) | vim-dadbod 的用户界面。 |
| [kristijanhusak/vim-dadbod-completion](https://github.com/kristijanhusak/vim-dadbod-completion) | vim-dadbod 的 SQL 补全。 |
| [joryeugene/dadbod-grip.nvim](https://github.com/joryeugene/dadbod-grip.nvim) | 现代数据库编辑器，内联单元格编辑、AI SQL 生成、DuckDB/Parquet 支持（2026 新作）。 |
| [zerochae/dbab.nvim](https://github.com/zerochae/dbab.nvim) | 轻量异步数据库客户端。 |

---

## 26. 笔记与知识管理

| 插件 | 描述 |
|------|------|
| [epwalsh/obsidian.nvim](https://github.com/epwalsh/obsidian.nvim) | 在 Neovim 中进行 Obsidian 兼容的笔记管理。 |
| [nvim-orgmode/orgmode](https://github.com/nvim-orgmode/orgmode) | Neovim 的 Org-mode 实现。 |
| [iwe-org/iwe.nvim](https://github.com/iwe-org/iwe.nvim) | LSP 驱动的 Markdown 知识管理（2026 新作）。 |
| [jmbuhr/otter.nvim](https://github.com/jmbuhr/otter.nvim) | 嵌入式语言的 LSP/diagnostic 支持（如 Markdown 中的代码块）。 |
| [vhyrro/luarocks.nvim](https://github.com/vhyrro/luarocks.nvim) | LuaRocks 的 Neovim 集成。 |
| [ymic9963/mdnotes.nvim](https://github.com/ymic9963/mdnotes.nvim) | 可扩展的 Markdown 笔记。 |
| [gmcusaro/ma.nvim](https://github.com/gmcusaro/ma.nvim) | 极简关系笔记导航。 |

---

## 27. 远程开发与协作

| 插件 | 描述 |
|------|------|
| [chipsenkbeil/distant.nvim](https://github.com/chipsenkbeil/distant.nvim) | 远程服务器文件编辑。 |
| [miversen33/netman.nvim](https://github.com/miversen33/netman.nvim) | Neovim 的远程文件管理。 |
| [esensar/nvim-dev-container](https://github.com/esensar/nvim-dev-container) | Dev container 集成。 |
| [jamestthompson3/nvim-remote-containers](https://github.com/jamestthompson3/nvim-remote-containers) | 在容器内开发。 |
| [junnplus/live-share.nvim](https://github.com/junnplus/live-share.nvim) | 协作编辑支持。 |

---

## 28. 语言特定插件

### Go

| 插件 | 描述 |
|------|------|
| [ray-x/go.nvim](https://github.com/ray-x/go.nvim) | 现代 Go 开发插件（LSP、调试、测试等）。 |
| [olexsmir/gopher.nvim](https://github.com/olexsmir/gopher.nvim) | Go 开发工具（标签生成、if err 处理等）。 |
| [crusj/structrue-go.nvim](https://github.com/crusj/structrue-go.nvim) | Go struct 标签操作。 |
| [edolphin-ydf/goimpl.nvim](https://github.com/edolphin-ydf/goimpl.nvim) | Go 接口实现生成。 |

### Rust

| 插件 | 描述 |
|------|------|
| [mrcjkb/rustaceanvim](https://github.com/mrcjkb/rustaceanvim) | 超级 Rust 工具集（LSP、调试、cargo、rust-analyzer 等）。 |
| [Saecki/crates.nvim](https://github.com/Saecki/crates.nvim) | Cargo.toml 的 crate 管理。 |
| [simrat39/rust-tools.nvim](https://github.com/simrat39/rust-tools.nvim) | ⚠️ 不再维护，被 rustaceanvim 取代。 |

### Python

| 插件 | 描述 |
|------|------|
| [Vimjas/vim-python-pep8-indent](https://github.com/Vimjas/vim-python-pep8-indent) | PEP 8 兼容的缩进。 |
| [heavenshell/vim-pydocstring](https://github.com/heavenshell/vim-pydocstring) | Python docstring 生成。 |
| [linux-cultist/venv-selector.nvim](https://github.com/linux-cultist/venv-selector.nvim) | Python 虚拟环境选择器。 |

### JavaScript / TypeScript / Web

| 插件 | 描述 |
|------|------|
| [windwp/nvim-ts-autotag](https://github.com/windwp/nvim-ts-autotag) | 自动关闭/重命名 HTML/JSX 标签。 |
| [jose-elias-alvarez/typescript.nvim](https://github.com/jose-elias-alvarez/typescript.nvim) | TypeScript 工具（已归档，被 LSP 取代）。 |
| [mxsdev/nvim-dap-vscode-js](https://github.com/mxsdev/nvim-dap-vscode-js) | 使用 vscode-js-debug 的 JavaScript 调试。 |
| [dmmulroy/tsc.nvim](https://github.com/dmmulroy/tsc.nvim) | TypeScript 编译器诊断集成。 |
| [barrett-ruth/live-server.nvim](https://github.com/barrett-ruth/live-server.nvim) | 实时 Web 开发服务器。 |

### Java

| 插件 | 描述 |
|------|------|
| [mfussenegger/nvim-jdtls](https://github.com/mfussenegger/nvim-jdtls) | Eclipse JDT Language Server 集成。 |
| [java-debug](https://github.com/microsoft/java-debug) | Java 调试支持。 |

### C/C++

| 插件 | 描述 |
|------|------|
| [p00f/clangd_extensions.nvim](https://github.com/p00f/clangd_extensions.nvim) | clangd LSP 增强（内存使用、AST 等）。 |
| [Civitasv/cmake-tools.nvim](https://github.com/Civitasv/cmake-tools.nvim) | CMake 集成和构建工具。 |

---

## 29. 工具库与依赖

| 插件 | 描述 |
|------|------|
| [nvim-lua/plenary.nvim](https://github.com/nvim-lua/plenary.nvim) | ⚠️ 将于 2026 年 6 月归档。许多插件的 Lua 函数库（async、path、test 等）。 |
| [MunifTanjim/nui.nvim](https://github.com/MunifTanjim/nui.nvim) | UI 组件库——popup、input、menu、split 等 UI 原语。 |
| [nvim-neorocks/luarocks-tag-release](https://github.com/nvim-neorocks/luarocks-tag-release) | GitHub Actions 自动发布 LuaRocks 包。 |
| [folke/lazydev.nvim](https://github.com/folke/lazydev.nvim) | 更快的 Lua/LSP 开发（用于 Neovim 配置）。 |
| [stevearc/stickybuf.nvim](https://github.com/stevearc/stickybuf.nvim) | 锁定 buffer 不被意外修改。 |
| [zeybek/camouflage.nvim](https://github.com/zeybek/camouflage.nvim) | 屏幕共享时隐藏敏感值（.env 文件等）。 |
| [glyccogen/imprint.nvim](https://github.com/glyccogen/imprint.nvim) | 所见即所得代码截图（Playwright + Chromium）。 |
| [aikhe/wrapped.nvim](https://github.com/aikhe/wrapped.nvim) | 配置活动可视化器和热力图。 |
| [Rtarun3606k/takatime](https://github.com/Rtarun3606k/takatime) | 隐私优先的 WakaTime 替代品。 |
| [romus204/tree-sitter-manager.nvim](https://github.com/romus204/tree-sitter-manager.nvim) | Tree-sitter parser 管理器。 |
| [jrop/tuis.nvim](https://github.com/jrop/tuis.nvim) | 交互式 TUI 集合。 |
| [jrop/morph.nvim](https://github.com/jrop/morph.nvim) | 类 React 的渲染器，用于构建 TUI。 |
| [echasnovski/mini.nvim](https://github.com/echasnovski/mini.nvim) | 40+ 个独立模块的库，覆盖几乎所有 Neovim 需求（极简、零外部依赖）。 |
| [folke/snacks.nvim](https://github.com/folke/snacks.nvim) | QoL 插件集合（picker、notifier、indent、dashboard、terminal 等），正在整合多个独立插件的功能。 |

---

## 30. 预配置发行版

| 发行版 | 描述 |
|--------|------|
| [LazyVim/LazyVim](https://github.com/LazyVim/LazyVim) | 基于 lazy.nvim 的精选 Neovim 配置，开箱即用。 |
| [AstroNvim/AstroNvim](https://github.com/AstroNvim/AstroNvim) | 美观、功能丰富、可扩展的 Neovim 配置。 |
| [NvChad/NvChad](https://github.com/NvChad/NvChad) | 极速、美观的 Neovim 基础配置。 |
| [LunarVim/LunarVim](https://github.com/LunarVim/LunarVim) | 成熟的 IDE 层，但已转向维护模式。 |
| [SpaceVim/SpaceVim](https://github.com/SpaceVim/SpaceVim) | 社区驱动的模块化 Vim/Neovim 发行版，受 Spacemacs 启发。 |
| [nvim-lua/kickstart.nvim](https://github.com/nvim-lua/kickstart.nvim) | 极简 Neovim 配置起点，不是发行版而是教学模板。 |
| [CosmicNvim/CosmicNvim](https://github.com/CosmicNvim/CosmicNvim) | 轻量、美观的 Neovim 配置。 |

---

## 31. Vim 经典插件（兼容 Vim/Neovim）

> 以下插件是 Vim 生态的经典之作，在 Neovim 中仍然可用，但有 Lua 替代品时优先推荐 Lua 版。

| 插件 | 描述 |
|------|------|
| [tpope/vim-fugitive](https://github.com/tpope/vim-fugitive) | Git 封装，`:Git` 命令提供所有 Git 操作。 |
| [tpope/vim-surround](https://github.com/tpope/vim-surround) | 环绕操作（括号、引号、标签等）。 |
| [tpope/vim-commentary](https://github.com/tpope/vim-commentary) | 代码注释（`gc` 操作符）。 |
| [tpope/vim-repeat](https://github.com/tpope/vim-repeat) | 增强 `.` 重复命令。 |
| [tpope/vim-dispatch](https://github.com/tpope/vim-dispatch) | 异步任务执行。 |
| [tpope/vim-unimpaired](https://github.com/tpope/vim-unimpaired) | 成对映射操作（如 `[b` `]b` 切换 buffer）。 |
| [tpope/vim-sleuth](https://github.com/tpope/vim-sleuth) | 自动检测和设置缩进。 |
| [tpope/vim-obsession](https://github.com/tpope/vim-obsession) | 连续会话录制。 |
| [tpope/vim-dadbod](https://github.com/tpope/vim-dadbod) | 数据库交互。 |
| [junegunn/vim-easy-align](https://github.com/junegunn/vim-easy-align) | 代码对齐。 |
| [junegunn/fzf.vim](https://github.com/junegunn/fzf.vim) | fzf 的 Vim 集成（文件、buffer、tag、搜索等）。 |
| [junegunn/goyo.vim](https://github.com/junegunn/goyo.vim) | 专注模式（无干扰写作）。 |
| [junegunn/limelight.vim](https://github.com/junegunn/limelight.vim) | 段落高亮（配合 Goyo 使用）。 |
| [junegunn/vim-peekaboo](https://github.com/junegunn/vim-peekaboo) | 预览寄存器内容。 |
| [easymotion/vim-easymotion](https://github.com/easymotion/vim-easymotion) | 快速光标跳转。 |
| [justinmk/vim-sneak](https://github.com/justinmk/vim-sneak) | 两字符跳转。 |
| [wellle/targets.vim](https://github.com/wellle/targets.vim) | 丰富的文本对象选择。 |
| [AndrewRadev/splitjoin.vim](https://github.com/AndrewRadev/splitjoin.vim) | 单行/多行代码切换。 |
| [christoomey/vim-tmux-navigator](https://github.com/christoomey/vim-tmux-navigator) | Tmux 导航集成。 |
| [editorconfig/editorconfig-vim](https://github.com/editorconfig/editorconfig-vim) | EditorConfig 支持。 |
| [mhinz/vim-signify](https://github.com/mhinz/vim-signify) | sign column 中的版本控制差异标记。 |
| [liuchengxu/vista.vim](https://github.com/liuchengxu/vista.vim) | 标签/符号查看器。 |
| [majutsushi/tagbar](https://github.com/majutsushi/tagbar) | 源代码结构浏览器。 |
| [yegappan/mru](https://github.com/yegappan/mru) | 最近使用文件列表。 |
| [airblade/vim-gitgutter](https://github.com/airblade/vim-gitgutter) | Git 行修改标记（gitsigns.nvim 的前身）。 |
| [scrooloose/syntastic](https://github.com/scrooloose/syntastic) | ⚠️ 不再维护。经典语法检查器。 |
| [dense-analysis/ale](https://github.com/dense-analysis/ale) | 异步 lint 引擎。 |
| [chrisbra/csv.vim](https://github.com/chrisbra/csv.vim) | CSV 文件编辑支持。 |
| [dkarter/bullets.vim](https://github.com/dkarter/bullets.vim) | 自动 Markdown 列表符号。 |
| [Yggdroot/indentLine](https://github.com/Yggdroot/indentLine) | 缩进线显示。 |

---

## 总结

### 2025-2026 年核心趋势

1. **AI 无处不在** — AI 助手插件是增长最快的类别（codecompanion、avante、copilot-chat 等）
2. **Lua 一统天下** — VimScript 已边缘化，一切皆为 Lua
3. **snacks.nvim 和 mini.nvim 两强争霸** — 两者都在整合大量独立插件的功能
4. **blink.cmp 挑战 nvim-cmp** — 以性能为核心的下一代补全引擎正在崛起
5. **Neovim >= 0.11 成为基线** — 新插件普遍要求 0.11+ 的 API
6. **部分经典插件归档** — dressing.nvim、plenary.nvim、packer.nvim 等正在被淘汰

### 推荐起点配置

对于新手，推荐从以下核心组合开始：

- **插件管理器**: [lazy.nvim](https://github.com/folke/lazy.nvim)
- **LSP 基础**: [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) + [mason.nvim](https://github.com/williamboman/mason.nvim)
- **补全**: [nvim-cmp](https://github.com/hrsh7th/nvim-cmp) 或 [blink.cmp](https://github.com/saghen/blink.cmp)
- **模糊查找**: [telescope.nvim](https://github.com/nvim-telescope/telescope.nvim) 或 [fzf-lua](https://github.com/ibhagwan/fzf-lua)
- **文件浏览**: [oil.nvim](https://github.com/stevearc/oil.nvim) 或 [neo-tree.nvim](https://github.com/nvim-neo-tree/neo-tree.nvim)
- **Git**: [gitsigns.nvim](https://github.com/lewis6991/gitsigns.nvim) + [neogit](https://github.com/NeogitOrg/neogit)
- **Tree-sitter**: [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter)
- **主题**: [tokyonight.nvim](https://github.com/folke/tokyonight.nvim) 或 [catppuccin](https://github.com/catppuccin/nvim)

或者直接使用预配置发行版 **LazyVim** 获得开箱即用的完整 IDE 体验。

---

> **数据来源**:
> - [rockerBOO/awesome-neovim](https://github.com/rockerBOO/awesome-neovim) (⭐21K, 每周更新)
> - [Dotfyle Neovim Plugins Top](https://dotfyle.com/neovim/plugins/top)
> - [GitHub Topics: neovim-plugins](https://github.com/topics/neovim-plugins)
> - [trackawesomelist.com/awesome-neovim](https://www.trackawesomelist.com/rockerBOO/awesome-neovim/)
> - 社区推荐和开发者博客 (2025-2026)




