# Neovim Configuration

Personal Neovim config optimized for C/C++ embedded/Linux kernel development in a Chinese locale.

## Directory Structure

```
init.lua                  # Entry point: require order, colorscheme, WinSeparator, yank highlight
lua/config/
  options.lua             # All vim.opt/vim.g (tabs, encoding, globals, env vars)
  lazy.lua                # lazy.nvim bootstrap + import('plugins')
  commands.lua            # User commands, helper functions (tags, grep, function tracking)
  keymaps.lua             # All custom keymaps + the ',' super command panel
  autocmds.lua            # Autocommands (auto-save, CursorHold, highlight overrides)
  statusline.lua          # Custom statusline: mode color bar, breathing animation, async git branch
  theme-picker.lua        # Interactive theme selector with live preview (11 themes)
  match-hl.lua            # Bracket/quote match highlight (replaces built-in matchparen)
  indent-guide.lua        # Minimal indent viz via listchars (subtle style)
  keyword-highlight.lua   # Color-picker word highlighting (20 colors)
lua/plugins/
  editing.lua             # vim-visual-multi, vim-move, vim-expand-region, vim-oscyank, yanky.nvim
  editor.lua              # mini.animate, flash.nvim
  fzf.lua                 # fzf + fzf-lua + fzf.vim
  git.lua                 # gitsigns, neogit, diffview, vim-fugitive, gv.vim, blame.nvim
  lsp.lua                 # coc.nvim (release) + LuaSnip  [file named lsp.lua but uses coc, not lspconfig]
  nav.lua                 # tagbar, vim-signature
  terminal.lua            # toggleterm, yazi.nvim
  themes.lua              # tokyonight, catppuccin, kanagawa
  treesitter.lua          # nvim-treesitter, render-markdown, vim-markdown
  ui.lua                  # noice, notify, dressing, nui, web-devicons
  util.lua                # plenary, asyncrun
lua/snippets/             # LuaSnip snippets loaded via from_lua: c.lua (kernel-oriented), cpp.lua, lua.lua
after/
  syntax/c.vim            # Custom C syntax: function names, ANSI C library funcs, booleans (POSIX optional)
  syntax/cpp.vim          # runtime! after/syntax/c.vim (reuses C extensions)
  ftplugin/cpp.vim        # runtime! after/syntax/c.vim
coc-settings.json         # coc.nvim config: coc-sh, coc-git (clangd removed)
```

## Key Conventions

- **Leader**: `<Space>`, loaded from `vim.g.mapleader` in options.lua
- **Tab style**: tabstop=4, noexpandtab (kernel/Linux C convention)
- **Line numbers**: relative only (`number=false`, `relativenumber=true`); current line shown via `CursorLineNr`
- **Plugin manager**: lazy.nvim with `concurrency=2`, timeout 600s (34 plugins in lazy-lock.json)
- **Completion**: **coc.nvim** (Tab/CR/C-j/C-k navigation) + LuaSnip snippets
- **LSP**: **coc.nvim** with coc-sh, coc-git (clangd removed — was causing `fatal_too_many_errors`)
- **Search**: fzf-lua + fzf.vim + fd + ripgrep (8 threads)
- **Git**: gitsigns + neogit + diffview + fugitive + gv + blame
- **Terminal**: toggleterm (floating, 40%), yazi file manager
- **Encodings**: UTF-8 + Chinese (fileencodings: utf-8,ucs-bom,gb18030,latin1)
- **Clipboard**: OSC52; `copy_to_clipboard()` dual-writes (+register + OSC52)
- **matchparen**: disabled (`loaded_matchparen=1`), replaced by `match-hl.lua`

## Load Order

`init.lua` requires modules in this order:
1. `config.options` — must be first (globals, env vars)
2. `config.lazy` — plugin setup
3. `config.theme-picker` — theme selection UI
4. `config.statusline` — custom statusline
5. `config.indent-guide` — listchars indent viz
6. `config.match-hl` `.setup()` — bracket/quote match highlight
7. `config.commands` — user commands and utilities
8. `config.keymaps` — keymaps (depends on commands for some functions)
9. `config.autocmds` — autocommands (depends on commands for c/cpp tracking)

Then, after the requires: `colorscheme tokyonight-night` → `_G.apply_highlight_overrides()` → WinSeparator highlight → TextYankPost highlight autocmd.

## C/C++ Specific

- `commands.lua` defines Vimscript `UpdateCurrentFunc()` (Lua wrapper `M.update_current_func()`); tracks nearest function name (scans up to 2000 lines up, with `b:func_range` caching via `searchpairpos`)
- Updated on `CursorHold`/`CursorHoldI` (300ms debounce per `updatetime`); result in `b:current_func`, shown in statusline
- `cl` yanks current function name via OSC52
- Custom syntax in `after/syntax/c.vim`: function names (`cCustomFunc`), full ANSI C library functions (`cAnsiFunction`), `cAnsiName`, booleans; POSIX functions gated on `g:cpp_posix_standard`
- Tree-sitter enabled with `additional_vim_regex_highlighting` empty (TS only for c/cpp; regex syntax still active via after/syntax)
- LuaSnip C snippets (`lua/snippets/c.lua`): `modinit`, `platdrv`, `fops`, `ofmatch`, `mutex`, `spinlock`, `deverr`, `goterr`, `cof`, etc. (kernel/embedded oriented)
- Tags: `BufRead` auto-sets the `tags` option (`load_tags`, prefers `tags_linux` then `tags`); generation is manual via `ct`/panel `H` (`generate_tags`: fd list → chunk by nproc → parallel ctags → `sort -m` merge, with progress notifications)
- clangd/coc-clangd removed (caused `fatal_too_many_errors` on code without compile_commands.json); C/C++ navigation relies on tags + Tree-sitter + custom syntax, not an LSP

## Editing Philosophy

This is a heavily personalized config — most default letter keys are remapped for muscle memory, not Vim convention.
- Heavy single-key remappings: `a`=`<C-]>` (go-to-def), `f`=`<C-o>zz`, `W`=`<C-i>zz`, `s`/`S`=flash, `R`=rg current word, `t`=CD menu, `q`=command menu, `e`=expand-region, `0`=`^`, `Z`=`ZZ`, `u`=undo+save
- `,` opens a multi-column floating super-panel: press a letter to run, or `/`/`<Tab>` for fzf fuzzy search across all commands (fzf-lua / fzf.vim / Git / Misc sections)
- `c` prefix = coding tools, `ce`/`cw` = fzf-lua grep/buffer-line search
- `cc` = Tagbar, `ca` = Yazi, `cl` = yank function name, `cs`/`cv` = split/vsplit, `cp` = yank history
- `cmp`/`cmh` = Markdown to PDF/HTML (pandoc + xelatex + CJK font)
- Delete goes to black hole register (`"_`)
- Visual line move with Shift+j/k; `y`/`c` in visual yank to `b` register + dual-write clipboard
- Auto-save on InsertLeave
