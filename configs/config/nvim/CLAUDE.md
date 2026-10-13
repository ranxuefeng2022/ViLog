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
  keyword-highlight.lua   # 256-color XTerm palette picker (10 group-rows a-j × 26 cells a-z, blank lines between rows; cells are two-letter labels fg-rendered via KwCell groups, no underline; default selection aa; selected cell is the sole bg chip + only underline via KwHLCur, gaps preserved; card styling: KwPanel bg #1a1b26 + KwBorder #565f89 via winhl, plain ' Highlight ' title, dimmed separator & preview prefix; first key a-j jumps to group's first color + live preview, Backspace undoes it (restores prior cursor), Enter applies it; second key a-z (no timeout) jumps and applies after 150ms flash; u/x commands only as first key; q closes (Esc does not); keys normalized via norm_key since getcharstr(0) returns raw K_SPECIAL bytes or numbers; getcharstr(0) poll + vim.wait pump + forced :redraw; re-color replaces; synced to all tab windows via WinNew/WinEnter replay)
lua/plugins/
  editing.lua             # vim-visual-multi, vim-move, vim-expand-region, vim-oscyank, yanky.nvim
  editor.lua              # mini.animate, flash.nvim
  fzf.lua                 # fzf + fzf-lua + fzf.vim
  git.lua                 # gitsigns, neogit, diffview, vim-fugitive, gv.vim, blame.nvim
  lsp.lua                 # coc.nvim (release)  [file named lsp.lua but uses coc, not lspconfig]
  nav.lua                 # tagbar, vim-signature
  terminal.lua            # toggleterm, yazi.nvim
  themes.lua              # tokyonight, catppuccin, kanagawa
  treesitter.lua          # nvim-treesitter, render-markdown, vim-markdown
  ui.lua                  # noice, notify, dressing, nui, web-devicons
  util.lua                # plenary, asyncrun
  snippets.lua            # LuaSnip (InsertEnter lazy) + lua/snippets/ loaders
lua/snippets/            # Lua-format snippets: c (kernel templates modinit/platdrv/fops...), cpp, lua
after/
  syntax/c.vim            # Custom C syntax: function names, ANSI C library funcs, booleans (POSIX optional)
  syntax/cpp.vim          # runtime! after/syntax/c.vim (reuses C extensions)
coc-settings.json         # coc.nvim config: coc-sh, coc-git (clangd removed)
```

## Key Conventions

- **Leader**: `<Space>`, loaded from `vim.g.mapleader` in options.lua
- **Tab style**: tabstop=4, noexpandtab (kernel/Linux C convention)
- **Line numbers**: relative only (`number=false`, `relativenumber=true`); current line shown via `CursorLineNr`
- **Plugin manager**: lazy.nvim with `concurrency=2`, timeout 600s (34 plugins in lazy-lock.json)
- **Completion**: **coc.nvim** (Tab/CR/C-j/C-k navigation); **LuaSnip** snippets (`<C-l>` expand/jump, Tab/S-Tab jump placeholders when pum not visible)
- **LSP**: **coc.nvim** with coc-sh, coc-git (clangd removed — was causing `fatal_too_many_errors`)
- **Search**: fzf-lua + fzf.vim + fd + ripgrep (8 threads)
- **Git**: gitsigns + neogit + diffview + fugitive + gv + blame
- **Terminal**: toggleterm (floating, 40%), yazi file manager
- **Encodings**: UTF-8 + Chinese (fileencodings: utf-8,ucs-bom,gb18030,latin1)
- **Clipboard**: OSC52; `copy_to_clipboard()` dual-writes (+register + OSC52)
- **matchparen**: disabled (`loaded_matchparen=1`), replaced by `match-hl.lua`; **matchit** enabled — `%`/`g%` jump `#if/#ifdef/#else/#elif/#endif` (b:match_words from built-in ftplugin/c.vim)

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

- `commands.lua` defines Vimscript `UpdateCurrentFunc()`; **block-structural analysis, not line-regex** — walks outward from the cursor via `searchpair('{','','}','bnW')` (syntax-aware: braces in comments/strings are skipped), and accepts a block as a function body when its `{` is preceded by a parameter-list `)` with only whitespace / K&R declarations / `__attr` annotations in between (`= {` initializers, `({` statement expressions, and `if/for/while/switch/do` blocks are rejected); the name is the identifier before the matching `(`. Handles pointer returns, split multi-line signatures (type on its own line), `__must_check`/`__acquires` suffixes, K&R definitions, and arbitrary body content (`return ERR_PTR(...)` can't fool it). Fallbacks: enclosing `(` when the cursor is inside the parameter list; nearest function above for file-scope dead zones (EXPORT lines, enums, initializers). `b:func_range` = [signature start (absorbed upward), closing brace line], used as a fast path and by `search_in_current_func` (panel `O`)
- Updated on `CursorHold` (300ms per `updatetime`); result in `b:current_func`, shown in statusline
- `cl` yanks current function name via OSC52
- Custom syntax in `after/syntax/c.vim`: function names (`cCustomFunc`), full ANSI C library functions (`cAnsiFunction`), `cAnsiName`, booleans; POSIX functions gated on `g:cpp_posix_standard`
- Tree-sitter started only for markdown (`FileType` autocmd calls `vim.treesitter.start`, for render-markdown); C/C++ keep regex syntax via after/syntax, no TS
- Tags: `BufRead` auto-sets the `tags` option (`load_tags` → `./tags,tags;` with upward search); generation is manual via panel `H` (`generate_tags`: fd list → chunk by `cpu_info` → parallel ctags → `sort -m` merge + awk header fix, no per-directory branching)
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
