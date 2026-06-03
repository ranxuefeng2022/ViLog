-- 基础选项 + 全局变量

-- 确保 filetype plugin 加载 after/ftplugin/ 下的文件
vim.cmd('filetype plugin on')

-- vim-markdown
vim.g.vim_markdown_folding_disabled = 1
vim.g.vim_markdown_conceal = 0
vim.g.vim_markdown_conceal_code_blocks = 0
vim.g.vim_markdown_frontmatter = 1
vim.g.vim_markdown_toc_autofit = 1

-- Neovim 专属
vim.o.cmdheight = 0

-- 编辑行为
vim.o.tabstop = 4
vim.o.shiftwidth = 4
vim.o.expandtab = false
vim.o.smarttab = true
vim.o.copyindent = true
vim.o.cindent = true
vim.o.autoindent = true
vim.o.smartindent = true
vim.o.backspace = 'eol,start,indent'
vim.o.textwidth = 500
vim.o.wrap = false
vim.o.linebreak = true
vim.opt.whichwrap:append('<,>,[,],h,l')
vim.o.virtualedit = 'onemore'

-- 搜索
vim.o.hlsearch = true
vim.o.incsearch = true
vim.o.ignorecase = true
vim.o.smartcase = true
vim.o.wrapscan = false

-- UI
vim.o.number = false
vim.o.relativenumber = true
vim.o.cursorline = true
vim.o.cursorlineopt = 'number'
vim.o.numberwidth = 2
vim.o.signcolumn = 'auto'
vim.o.showcmd = true
vim.o.ruler = false
vim.o.updatetime = 300
vim.o.showtabline = 0
vim.o.timeoutlen = 300
vim.o.splitbelow = true
vim.o.splitright = true
vim.o.showmatch = true
vim.o.matchtime = 10
vim.o.foldenable = true
vim.o.foldmethod = 'manual'
vim.o.foldcolumn = '0'
vim.o.laststatus = 3
vim.o.synmaxcol = 500

-- Tags 性能优化
vim.o.tagbsearch = true   -- 二分查找（默认开启，显式确保）
vim.o.tagrelative = true  -- tags 文件中的路径相对于文件本身
vim.o.tagcase = 'followscs' -- 搜索跟随 smartcase
vim.opt.fillchars = { vert = '│', horiz = '─' }

-- 补全
vim.o.completeopt = 'menu,menuone,noselect'
vim.opt.shortmess:append('cS')
vim.opt.complete:append('k')
vim.o.wildmenu = true
vim.o.wildmode = 'longest:full,full'
vim.opt.wildignore:append({ '.*', '*.o', '*.obj', '*.so', '*.a', '*.pyc', '*.class' })

-- 文件
vim.o.fileencodings = 'utf-8,ucs-bom,gb18030,latin1'
vim.opt.fileencoding = 'utf-8'
vim.o.swapfile = false
vim.o.writebackup = false
vim.o.backup = false
vim.o.autoread = true
vim.o.autowrite = false
vim.o.hidden = true

-- 杂项
vim.o.history = 500
vim.o.mouse = 'a'
vim.o.mousemodel = 'extend'
vim.o.report = 0
vim.opt.sessionoptions:remove('options')
vim.opt.switchbuf:append('useopen,usetab')

-- 字典
vim.opt.dictionary:append({ '~/.vim/words', '~/.vim/dict/my_dict.txt' })

-- tagbar
vim.g.tagbar_position = 'right'
vim.g.tagbar_singleclick = 1
vim.g.tagbar_autoclose = 0
vim.g.tagbar_width = 70

-- vim-move
vim.g.move_key_modifier_visualmode = 'S'

-- 括号匹配
vim.g.matchparen_timeout = 300
vim.g.matchparen_insert_timeout = 300

-- c.vim (禁用 Ctrl-J 切换 .c/.h)
vim.g.C_Ctrl_j = 'off'

-- oscyank
vim.g.osc52_trim_newline = 1
vim.g.oscyank_term = 'tmux'

-- python
vim.g.python3_host_prog = '/usr/bin/python3'

-- 内部状态
vim.g.param1 = 0
vim.g.initial_directory_set = 0

-- fzf 环境变量 + fzf.vim 预览窗口
vim.env.FZF_DEFAULT_OPTS = '--height 100% --layout=default'
vim.env.FZF_DEFAULT_COMMAND = 'fd --type f --type l --hidden --follow --exclude .git'
vim.g.fzf_layout = { window = { width = 1.0, height = 1.0 } }
vim.g.fzf_preview_window = { 'right:50%', 'ctrl-/' }

-- leader 键
vim.g.mapleader = ' '

-- 禁用默认 matchparen（使用自定义的 match-hl.lua 替代）
vim.g.loaded_matchparen = 1
