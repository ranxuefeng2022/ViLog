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
-- 自定义高亮（statusline/gitsigns/主题覆盖）全是 #hex 真彩色；
-- 不开时 nvim 把 RGB 近似折算成 256 色，精心调的颜色有偏差
vim.o.termguicolors = true

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
vim.o.signcolumn = 'yes:1'
vim.o.showcmd = true
vim.o.ruler = false
vim.o.updatetime = 300
vim.o.showtabline = 0
vim.o.timeoutlen = 300
vim.o.splitbelow = true
vim.o.splitright = true
vim.o.showmatch = true
vim.o.matchtime = 2
vim.o.foldenable = true
vim.o.foldmethod = 'manual'
vim.o.foldcolumn = '0'
vim.o.laststatus = 3
vim.o.synmaxcol = 500

-- Tags 性能优化
vim.o.tagbsearch = true   -- 二分查找（默认开启，显式确保）
vim.o.tagrelative = true  -- tags 文件中的路径相对于文件本身
vim.o.tagcase = 'match' -- 大小写敏感匹配:tag 查找才能走二分(followscs+ignorecase 会退化为全文件线性扫描)

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

-- oscyank
vim.g.osc52_trim_newline = 1
vim.g.oscyank_term = 'tmux'

-- python3 provider:固定指向装有 pynvim 的 3.13
-- (brew 装依赖时会连带升级并把 /opt/homebrew/bin/python3 软链指到新版本,
--  新解释器没有 pynvim 就会报 "Failed to load python3 host")
vim.g.python3_host_prog = '/opt/homebrew/opt/python@3.13/bin/python3'

-- 内部状态
vim.g.param1 = 0

-- fzf 环境变量 + fzf.vim 窗口布局（预览窗口由 plugins/fzf.lua 统一设置）
vim.env.FZF_DEFAULT_OPTS = '--height 100% --layout=default'
vim.env.FZF_DEFAULT_COMMAND = 'fd --type f --type l --hidden --follow --exclude .git'
vim.g.fzf_layout = { window = { width = 1.0, height = 1.0 } }

-- leader 键
vim.g.mapleader = ' '

-- 禁用默认 matchparen（使用自定义的 match-hl.lua 替代）
vim.g.loaded_matchparen = 1
