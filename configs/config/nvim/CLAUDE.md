# Neovim Configuration

Personal Neovim config optimized for C/C++ embedded/Linux kernel development in a Chinese locale.

## Directory Structure

```
init.lua                  # Entry point: require order, colorscheme, WinSeparator
lua/config/
  options.lua             # All vim.opt/vim.g (tabs, encoding, globals, env vars)
  lazy.lua                # lazy.nvim bootstrap + import('plugins')
  commands.lua            # User commands, helper functions (tags, grep, function tracking)
  keymaps.lua             # All custom keymaps
  autocmds.lua            # Autocommands (auto-save, CursorHold, highlights)
  statusline.lua          # Custom statusline with async git branch
  theme-picker.lua        # Interactive theme selector with live preview
  neovide.lua             # Neovide GUI config (gated on vim.g.neovide)
lua/plugins/
  ai.lua                  # Claude Code, minuet-ai (DeepSeek), llm.nvim
  editing.lua             # vim-visual-multi, vim-move, vim-expand-region, vim-oscyank
  editor.lua              # mini.animate, tiny-glimmer, indent-blankline, flash.nvim
  fun.lua                 # drop.nvim (screensaver)
  fzf.lua                 # fzf + fzf-lua (fuzzy finder)
  git.lua                 # gitsigns, neogit, diffview, vim-fugitive, gv.vim
  lsp.lua                 # nvim-lspconfig (clangd, bashls), nvim-cmp, LuaSnip
  nav.lua                 # tagbar, vim-signature
  terminal.lua            # toggleterm, yazi.nvim
  themes.lua              # tokyonight, catppuccin, kanagawa
  treesitter.lua          # nvim-treesitter, render-markdown, vim-markdown
  ui.lua                  # noice, notify, dressing, nui, web-devicons
  util.lua                # plenary, asyncrun, bclose
after/
  syntax/c.vim            # Custom C/C++ syntax highlighting (function names, ANSI funcs)
  syntax/cpp.vim          # Sources after/syntax/c.vim
  ftplugin/cpp.vim        # C++ ftplugin (sources both after/syntax/ and after/ftplugin/ c.vim)
```

## Key Conventions

- **Leader**: `<Space>`, loaded from `vim.g.mapleader` in options.lua
- **Tab style**: tabstop=4, noexpandtab (kernel/Linux C convention)
- **Plugin manager**: lazy.nvim with `concurrency=2`, timeout 600s
- **Completion**: nvim-cmp with LuaSnip, DeepSeek AI via minuet-ai
- **LSP**: clangd (compile_commands_dir=build), bashls
- **Search**: fzf-lua + fd + ripgrep (8 threads)
- **Git**: gitsigns + neogit + diffview + fugitive
- **Terminal**: toggleterm (floating, 40%), yazi file manager
- **Encodings**: UTF-8 + Chinese (gbk, gb18030, gb2312, cp936)
- **Clipboard**: OSC52 in terminal, system clipboard in Neovide

## Load Order

`init.lua` requires modules in this order:
1. `config.options` — must be first (globals, env vars)
2. `config.lazy` — plugin setup
3. `config.theme-picker` — theme selection UI
4. `config.statusline` — custom statusline
5. `config.commands` — user commands and utilities
6. `config.keymaps` — keymaps (depends on commands for some functions)
7. `config.autocmds` — autocommands (depends on commands for c/cpp tracking)
8. `config.neovide` — gated on `vim.g.neovide`

## C/C++ Specific

- `commands.update_current_func()` tracks the nearest function name (scans up to 1500 lines)
- Updated on `CursorHold` (300ms debounce per `updatetime`)
- Custom syntax in `after/syntax/c.vim`: function names, ANSI C functions, POSIX, booleans
- Tree-sitter enabled with `additional_vim_regex_highlighting` for c/cpp (both engines coexist)
- Tags auto-loaded via `fd` search on BufRead
- compile_commands.json expected in `build/` subdirectory

## Editing Philosophy

- Heavy single-key mappings (t, q, f, a, c, s, e, R, W — all remapped)
- `c` prefix = coding tools, `ce`/`cw` = fzf-lua grep/buffer search
- `cc` = Tagbar, `ca` = Yazi, `ct` = generate tags, `cl` = yank function name
- `cmp`/`cmh` = Markdown to PDF/HTML (pandoc + xelatex + CJK font)
- Delete goes to black hole register (`"_`)
- Visual line move with Shift+j/k
- Auto-save on InsertLeave
