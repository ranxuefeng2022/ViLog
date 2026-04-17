if !has('ttyin')
  finish
endif
set runtimepath^=~/.vim
call plug#begin('~/.vim/plugged')
if has('nvim')
Plug 'stevearc/dressing.nvim'           " UI 增强：美化 input/select 弹窗
Plug 'rcarriga/nvim-notify'             " 通知弹窗：替代默认 message 显示
Plug 'folke/noice.nvim'                 " 消息/UI 框架：美化命令行、弹窗、搜索
Plug 'MunifTanjim/nui.nvim'             " UI 组件库：noice 的依赖

Plug 'phaazon/hop.nvim'                 " 快速跳转：跳到任意可见字符位置

Plug 'lukas-reineke/indent-blankline.nvim' " 缩进线：显示缩进对齐竖线
Plug 'NeogitOrg/neogit'                 " Git 界面：交互式 Git 操作面板
Plug 'echasnovski/mini.animate'         " 动画效果：光标移动、窗口开关动画
Plug 'sphamba/smear-cursor.nvim'        " 光标拖尾：光标移动时的涂抹效果
Plug 'nyngwang/NeoNoName.lua'           " 缓冲区淡入淡出：切换缓冲区时的过渡动画
Plug 'andymass/vim-matchup'            " 增强 % 匹配：支持 if/end、html 标签等
Plug 'adelarsq/neovim-luxmotion'        " 流畅光标动画：60fps 光标移动效果
Plug 'shellRaining/hlchunk.nvim'        " 代码块高亮：当前代码块缩进范围可视化
Plug 'DreamMaoMao/yazi.nvim'            " 文件管理：集成 Yazi 终端文件浏览器
Plug 'greggh/claude-code.nvim'          " AI 助手：集成 Claude Code
Plug 'kdheepak/lazygit.nvim'            " Git UI：集成 LazyGit 终端界面
Plug 'stevearc/aerial.nvim'             " 代码大纲：显示函数/变量结构树
endif
"Plug 'yetone/avante.nvim', { 'branch': 'main', 'do': 'make' }

Plug 'rbgrouleff/bclose.vim'            " 关闭缓冲区：不关闭窗口
Plug 'skywind3000/asyncrun.vim'         " 异步执行：后台运行命令并显示结果
Plug 'Yggdroot/LeaderF', { 'do': ':LeaderfInstallCExtension' } " 模糊查找：文件/Buffer/标签搜索

Plug 'folke/tokyonight.nvim'            " 主题：TokyoNight 配色方案
Plug 'tanvirtin/monokai.nvim'           " 主题：经典 Sublime Monokai
Plug 'rebelot/kanagawa.nvim'            " 主题：日式浮世绘风格
Plug 'catppuccin/nvim'                  " 主题：柔和马卡龙配色
Plug 'ellisonleao/gruvbox.nvim'         " 主题：复古暖色
Plug 'rose-pine/neovim'                 " 主题：松木玫瑰色
Plug 'sainnhe/sonokai'                  " 主题：绿色高对比度
Plug 'AlexvZyl/nordic.nvim'             " 主题：北极蓝灰
Plug 'sainnhe/everforest'               " 主题：绿色森林护眼
Plug 'olimorris/onedarkpro.nvim'        " 主题：One Dark VSCode 风格
Plug 'Mofiqul/dracula.nvim'             " 主题：紫色调高对比度
Plug 'sainnhe/edge'                     " 主题：蓝紫渐变清爽
Plug 'fcpg/vim-farout'                  " 主题：暖橘色调
Plug 'cpea2506/one_monokai.nvim'        " 主题：One+Monokai 混合

Plug 'haya14busa/incsearch.vim'         " 增量搜索：高亮所有匹配项
Plug 'haya14busa/incsearch-easymotion.vim' " 搜索增强：incsearch + easymotion 联合
Plug 'haya14busa/incsearch-fuzzy.vim'   " 模糊搜索：模糊匹配搜索
Plug 'ojroques/vim-oscyank', {'branch': 'main'} " 系统剪贴板：通过 OSC52 远程复制
Plug 'ibhagwan/fzf-lua'                 " 模糊搜索：Lua 版 fzf 集成
Plug 'nvim-tree/nvim-web-devicons'      " 图标：文件类型图标显示

Plug 'nvim-lua/plenary.nvim'            " Lua 工具库：多种插件的公共依赖
Plug 'neoclide/coc.nvim', {'branch': 'release'}

Plug 'neoclide/coc-snippets'            " 片段引擎：代码片段扩展
Plug 'honza/vim-snippets'               " 通用片段库：多语言代码片段集合
Plug 'SirVer/ultisnips'                 " 片段引擎：UltiSnips 片段系统

Plug 'junegunn/fzf', { 'do': { -> fzf#install() } } " 模糊查找器：fzf 二进制核心
Plug 'junegunn/fzf.vim'                 " fzf 集成：Vim 版 fzf 命令封装

Plug 'easymotion/vim-easymotion'        " 快速跳转：行间/屏幕内快速移动

Plug 'vim-scripts/c.vim'                " C 语言增强：C/C++ 语法和缩进


Plug 'folke/snacks.nvim'                " QoL 工具集：大文件、缩进、滚动等
Plug 'folke/drop.nvim'                  " 屏保动画：节日主题下落动画
Plug 'akinsho/toggleterm.nvim'          " 浮动终端：多终端管理，支持多种布局
Plug 'francoiscabrol/ranger.vim'        " 文件管理：集成 Ranger 文件浏览器

Plug 'matze/vim-move'                   " 行移动：Alt+j/k 上下移动行

Plug 'tpope/vim-fugitive'               " Git 集成：在 Vim 中操作 Git 命令
Plug 'airblade/vim-gitgutter'           " Git 标记：侧边栏显示文件修改状态
Plug 'junegunn/gv.vim'                  " Git 历史：可视化 commit 历史

Plug 'terryma/vim-multiple-cursors'     " 多光标：多位置同时编辑
Plug 'mg979/vim-visual-multi'           " 多光标：高级多位置选中编辑

Plug 'preservim/tagbar'                 " 标签栏：显示文件函数/变量大纲
Plug 'kshenoy/vim-signature'            " 标记管理：增强 mark 功能和显示
Plug 'terryma/vim-expand-region'        " 选区扩展：逐步扩大选中范围
call plug#end()

syntax on
if has('nvim')
colorscheme tokyonight-night
set shada+=!
set cmdheight=0
else
colorscheme default
endif
set nowrapscan
set history=500
set mouse=a
set hlsearch
set cindent
set linebreak
set nocompatible
set signcolumn=yes
set encoding=utf-8
set fileencoding=utf-8
set showcmd
set noruler
set updatetime=300
set showtabline=0
set splitbelow
set splitright
set nomore
set incsearch
set showmatch
set matchtime=10
set helplang=cn
set langmenu=zh_CN.UTF-8
set noswapfile
set nowb
set sm
set mousemodel=extend
set smartcase
set smarttab
set notitle
set tabstop=4
set shiftwidth=4
set noexpandtab
set nowritebackup
set nobackup
set foldcolumn=0
set noautowrite
set copyindent
set report=0
set synmaxcol=500
set regexpengine=0
set autoread
"set lazyredraw
set tw=500
set ai "Auto indent
set nu
"set relativenumber
set si "Smart indent
set nowrap "Wrap lines
set switchbuf+=useopen
set switchbuf+=usetab
set wildmenu
set wildmode=longest:full,full
set wildignore+=.*
set wildignore+=*.o,*.obj,*.so,*.a,*.pyc,*.class
set foldenable
set sessionoptions-=options
set completeopt=longest,menu
set shortmess+=c
set nolist
set listchars=tab:>\ ,trail:·,nbsp:␣
set fileencodings=utf-8,gbk,gb18030,gb2312,ucs-bom,cp936,latin1
set hid
set backspace=eol,start,indent
set whichwrap+=<,>,[,],h,l
set virtualedit=onemore
set foldmethod=manual
set laststatus=2
set complete+=k
inoremap <silent> <C-i> <C-x><C-k>
set dictionary+=~/.vim/words
set dictionary+=~/.vim/dict/my_dict.txt
set rtp+=~/.user/bin/fzf
"""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""

" ===============================
" 全局颜色宏定义
" ===============================
let g:Color_BG          = '#1f1f29'  " 背景深色
let g:Color_Text        = '#e6c384'  " 默认文字
let g:Color_Git         = '#ffd866'  " Git 分支高亮
let g:Color_Normal      = '#98bb6c'  " Normal模式文字
let g:Color_Insert      = '#8B0000'  " Insert模式背景
let g:Color_Visual      = '#006400'  " Visual模式背景
let g:Color_Command     = '#e46876'  " Command模式背景
let g:Color_Other       = '#c8c093'  " 其他模式文字
let g:Color_Text_Alt    = '#FFFFFF'  " 模式背景色上的文字
let g:Color_File        = '#7aa2f7'  " 文件名颜色
let g:Color_Sep         = '#565f89'  " 分隔符颜色
let g:Color_Info        = '#a9b1d6'  " 右侧信息颜色

" ===============================
" 初始化高亮组
" ===============================
execute 'hi ColorT guifg=' . g:Color_Text . ' guibg=' . g:Color_BG
execute 'hi ColorGit guifg=' . g:Color_Git . ' guibg=' . g:Color_BG
execute 'hi ColorFile guifg=' . g:Color_File . ' guibg=' . g:Color_BG
execute 'hi ColorSep guifg=' . g:Color_Sep . ' guibg=' . g:Color_BG
execute 'hi ColorInfo guifg=' . g:Color_Info . ' guibg=' . g:Color_BG
execute 'hi StatusLine guibg=' . g:Color_BG . ' gui=none cterm=none'
execute 'hi StatusLineNC guibg=' . g:Color_BG . ' gui=none cterm=none'

" ===============================
" Git 分支缓存（事件驱动更新，不在每次重绘时调用 system）
" ===============================
function! UpdateGitBranch()
    let b:git_branch = ''
    let dir = expand('%:p:h')
    if dir ==# '' | return | endif
    let branch = system('cd ' . shellescape(dir) . ' 2>/dev/null && git rev-parse --abbrev-ref HEAD 2>/dev/null')
    let branch = trim(branch)
    if branch !=# '' && branch !=# 'HEAD'
        let b:git_branch = branch
    endif
endfunction
augroup GitBranch | autocmd!
    autocmd BufEnter,FocusGained,BufReadPost * call UpdateGitBranch()
augroup END

function! StGit()
    return exists('b:git_branch') && b:git_branch !=# '' ? ' ' . b:git_branch . ' ' : ''
endfunction

" ===============================
" 更新状态栏函数
" ===============================
function! StatusLineUpdate()
    let l:sl = "%#ColorT# %{Mode()} "
    let l:sl .= "%#ColorSep#│ "
    let l:sl .= "%#ColorT# %{get(b:,'current_func','')} "
    let l:sl .= "%#ColorSep#│ "
    let l:sl .= "%#ColorFile# %t%{&modified?' [+]':''} "
    " 右侧：Git │ 文件类型 │ 行:列 │ 百分比
    let l:sl .= "%="
    let l:sl .= "%#ColorGit#%{StGit()}"
    let l:sl .= "%#ColorSep#│ "
    let l:sl .= "%#ColorInfo# %{&ft!=#''?&ft:'-'} "
    let l:sl .= "%#ColorSep#│ "
    let l:sl .= "%#ColorInfo# %l:%c "
    let l:sl .= "%#ColorSep#│ "
    let l:sl .= "%#ColorT# %p%% "
    " 用 set 命令强制覆盖全局 statusline，防止 Neovim 默认值拼接
    execute 'set statusline=' . escape(l:sl, ' %')
endfunction

call StatusLineUpdate()

" ===============================
" 动态模式函数（根据模式切换整个状态栏配色）
" ===============================
function! s:SetModeColors(fg, bg)
  call nvim_set_hl(0, 'ColorT',    {'fg': a:fg, 'bg': a:bg})
  call nvim_set_hl(0, 'ColorGit',  {'fg': a:fg, 'bg': a:bg})
  call nvim_set_hl(0, 'ColorFile', {'fg': a:fg, 'bg': a:bg})
  call nvim_set_hl(0, 'ColorSep',  {'fg': a:fg, 'bg': a:bg})
  call nvim_set_hl(0, 'ColorInfo', {'fg': a:fg, 'bg': a:bg})
endfunction

function! Mode()
  let l:mode = mode()

  if l:mode ==# 'n'
    call s:SetModeColors(g:Color_Normal, g:Color_BG)
    call nvim_set_hl(0, 'ColorGit',  {'fg': g:Color_Git,   'bg': g:Color_BG})
    call nvim_set_hl(0, 'ColorFile', {'fg': g:Color_File,  'bg': g:Color_BG})
    call nvim_set_hl(0, 'ColorSep',  {'fg': g:Color_Sep,   'bg': g:Color_BG})
    call nvim_set_hl(0, 'ColorInfo', {'fg': g:Color_Info,  'bg': g:Color_BG})
    return 'N'

  elseif l:mode ==# 'i'
    call s:SetModeColors(g:Color_Text_Alt, g:Color_Insert)
    return 'I'

  elseif l:mode ==# 'v' || l:mode ==# 'V' || l:mode ==# '' || l:mode ==# 's'
    call s:SetModeColors(g:Color_Text_Alt, g:Color_Visual)
    return 'V'

  elseif l:mode ==# 'c'
    call s:SetModeColors(g:Color_Text_Alt, g:Color_Command)
    return 'C'

  else
    call s:SetModeColors(g:Color_Other, g:Color_BG)
    call nvim_set_hl(0, 'ColorGit',  {'fg': g:Color_Git,   'bg': g:Color_BG})
    call nvim_set_hl(0, 'ColorFile', {'fg': g:Color_File,  'bg': g:Color_BG})
    call nvim_set_hl(0, 'ColorSep',  {'fg': g:Color_Sep,   'bg': g:Color_BG})
    call nvim_set_hl(0, 'ColorInfo', {'fg': g:Color_Info,  'bg': g:Color_BG})
    return l:mode
  endif
endfunction
autocmd ModeChanged * call Mode() | call StatusLineUpdate()
autocmd BufEnter,FileType * call StatusLineUpdate()

"=====================================================begin func====================================

function! UpdateCurrentFunc()
    let lnum = line('.')
    " 只在函数名变化时更新，避免无谓的状态栏刷新
    if exists('b:current_func_lnum') && b:current_func_lnum == lnum
        return
    endif
    let start = max([1, lnum - 200])
    let fname = ''
    let reserved = ['if', 'else', 'elseif', 'return', 'for', 'while', 'switch']
    for i in range(lnum, start, -1)
        let line_text = getline(i)
        if line_text =~# '^\s*\(if\|else\>\)'
            continue
        endif
        if line_text =~ '^\s*\%(\w\+\s\+\)\+\w\+\s*('
            let fname = matchstr(line_text, '\v\w+\ze\s*\(')
            if index(reserved, fname) != -1
                continue
            endif
            break
        endif
    endfor
    if !exists('b:current_func') || b:current_func !=# fname
        let b:current_func = fname
    endif
    let b:current_func_lnum = lnum
endfunction
augroup CFileAutocmds
    autocmd!
    autocmd FileType c,cpp autocmd CursorMoved,CursorMovedI <buffer> call UpdateCurrentFunc()
augroup END
"=====================================================end func====================================


"=====================================================begin func====================================
function! DeleteVisualMatch()
    " 获取可视模式下选中的内容
    let [line_start, col_start] = getpos("'<")[1:2]
    let [line_end, col_end] = getpos("'>")[1:2]
    let lines = getline(line_start, line_end)
    if len(lines) == 0
        return
    endif
    let lines[-1] = lines[-1][: col_end - 1]
    let lines[0] = lines[0][col_start - 1:]
    let selected_text = join(lines, "\n")

    " 查找匹配 ID 并删除
    for match in getmatches()
        if match['pattern'] == selected_text
            call matchdelete(match['id'])
            echo "Deleted match ID: " . match['id']
            return
        endif
    endfor
    echo "No match found for selected text."
endfunction
"=====================================================end func====================================

"=====================================================begin func====================================
" 预定义 XTerm 256 色表（全局变量，避免重复初始化）
let g:xterm_256_colors = [
\ "#000000","#800000","#008000","#808000","#000080","#800080","#008080","#c0c0c0", "#808080","#ff0000","#00ff00","#ffff00","#0000ff","#ff00ff","#00ffff","#ffffff",
\ "#000000","#00005f","#000087","#0000af","#0000d7","#0000ff","#005f00","#005f5f", "#005f87","#005faf","#005fd7","#005fff","#008700","#00875f","#008787","#0087af",
\ "#0087d7","#0087ff","#00af00","#00af5f","#00af87","#00afaf","#00afd7","#00afff", "#00d700","#00d75f","#00d787","#00d7af","#00d7d7","#00d7ff","#00ff00","#00ff5f",
\ "#00ff87","#00ffaf","#00ffd7","#00ffff","#5f0000","#5f005f","#5f0087","#5f00af", "#5f00d7","#5f00ff","#5f5f00","#5f5f5f","#5f5f87","#5f5faf","#5f5fd7","#5f5fff",
\ "#5f8700","#5f875f","#5f8787","#5f87af","#5f87d7","#5f87ff","#5faf00","#5faf5f", "#5faf87","#5fafaf","#5fafd7","#5fafff","#5fd700","#5fd75f","#5fd787","#5fd7af",
\ "#5fd7d7","#5fd7ff","#5fff00","#5fff5f","#5fff87","#5fffaf","#5fffd7","#5fffff", "#870000","#87005f","#870087","#8700af","#8700d7","#8700ff","#875f00","#875f5f",
\ "#875f87","#875faf","#875fd7","#875fff","#878700","#87875f","#878787","#8787af", "#8787d7","#8787ff","#87af00","#87af5f","#87af87","#87afaf","#87afd7","#87afff",
\ "#87d700","#87d75f","#87d787","#87d7af","#87d7d7","#87d7ff","#87ff00","#87ff5f", "#87ff87","#87ffaf","#87ffd7","#87ffff","#af0000","#af005f","#af0087","#af00af",
\ "#af00d7","#af00ff","#af5f00","#af5f5f","#af5f87","#af5faf","#af5fd7","#af5fff", "#af8700","#af875f","#af8787","#af87af","#af87d7","#af87ff","#afaf00","#afaf5f",
\ "#afaf87","#afafaf","#afafd7","#afafff","#afd700","#afd75f","#afd787","#afd7af", "#afd7d7","#afd7ff","#afff00","#afff5f","#afff87","#afffaf","#afffd7","#afffff",
\ "#d70000","#d7005f","#d70087","#d700af","#d700d7","#d700ff","#d75f00","#d75f5f", "#d75f87","#d75faf","#d75fd7","#d75fff","#d78700","#d7875f","#d78787","#d787af",
\ "#d787d7","#d787ff","#d7af00","#d7af5f","#d7af87","#d7afaf","#d7afd7","#d7afff", "#d7d700","#d7d75f","#d7d787","#d7d7af","#d7d7d7","#d7d7ff","#d7ff00","#d7ff5f",
\ "#d7ff87","#d7ffaf","#d7ffd7","#d7ffff","#ff0000","#ff005f","#ff0087","#ff00af", "#ff00d7","#ff00ff","#ff5f00","#ff5f5f","#ff5f87","#ff5faf","#ff5fd7","#ff5fff",
\ "#ff8700","#ff875f","#ff8787","#ff87af","#ff87d7","#ff87ff","#ffaf00","#ffaf5f", "#ffaf87","#ffafaf","#ffafd7","#ffafff","#ffd700","#ffd75f","#ffd787","#ffd7af",
\ "#ffd7d7","#ffd7ff","#ffff00","#ffff5f","#ffff87","#ffffaf","#ffffd7","#ffffff", "#080808","#121212","#1c1c1c","#262626","#303030","#3a3a3a","#444444","#4e4e4e",
\ "#585858","#626262","#6c6c6c","#767676","#808080","#8a8a8a","#949494","#9e9e9e", "#a8a8a8","#b2b2b2","#bcbcbc","#c6c6c6","#d0d0d0","#dadada","#e4e4e4","#eeeeee"
\ ]
function! HighlightWithColorCode(color_code) range
    " 检查颜色代码是否有效
    if a:color_code < 0 || a:color_code >= len(g:xterm_256_colors)
        echoerr "Invalid color code:" a:color_code
        return
    endif

    " 获取选中文本
    let start_line = a:firstline
    let end_line = a:lastline
    let start_col = col("'<") - 1  " 转换为 0-based
    let end_col = col("'>") - 1
    let selected_text = getline(start_line)[start_col : end_col]

    " 定义高亮组
    let hl_group = 'MyColor' . a:color_code

    try
		if has('termguicolors') && &termguicolors
			execute 'highlight ' . hl_group . ' guibg=' . g:xterm_256_colors[a:color_code]
		else
			execute 'highlight ' . hl_group . ' ctermbg=' . a:color_code
		endif
        call matchadd(hl_group, selected_text)
    catch /E254/
        echo "Highlight group already exists:" hl_group
    endtry
endfunction

command! -range -nargs=1 HighlightWithColorCode call HighlightWithColorCode(<f-args>)
"=====================================================end func====================================

"=====================================================begin func====================================
function! LoadTags()
	call system("mv tags/* .")
	let g:tags_list = split(glob("tag*"), "\n")
	for tag_file in g:tags_list
		execute "set tags+=" . tag_file
	endfor

	execute "set tags+=linux-master-tags"
endfunction
"=====================================================end func====================================

"=====================================================begin func====================================
function! GenerateTags()
if exists("g:neovide")
	execute 'AsyncRun ctags -R --exclude="linux-master*"'
else
	call system('rm -rf *2025_Will_Rich* tags files \n')
	call system("mkdir tags \n")
	execute 'silent AsyncRun -mode=0 bash ~/.vim/tags.sh'
endif
	call LoadTags()
endfunction
"=====================================================end func====================================

"=====================================================begin func====================================
function! Togglefunc2()
  execute g:param1 ? "set laststatus=2" : "set laststatus=0"
  let g:param1 = !g:param1
endfunction
"=====================================================end func====================================

"=====================================================begin func====================================
function! s:config_easyfuzzymotion(...) abort
  return extend(copy({
  \   'converters': [incsearch#config#fuzzyword#converter()],
  \   'modules': [incsearch#config#easymotion#module({'overwin': 1})],
  \   'keymap': {"\<CR>": '<Over>(easymotion)'},
  \   'is_expr': 0,
  \   'is_stay': 1
  \ }), get(a:, 1, {}))
endfunction
"=====================================================end func====================================

"=====================================================begin func====================================
function! s:execute_selected_command(command)
  execute a:command
endfunction
"=====================================================end func====================================

"=====================================================begin func====================================
function! s:execute_command_cd()
 let g:command_list = [
  \ ':cd ~/de/pri-charge/',
  \ ':cd ~/codecenter/vimcode/dx5/kernel/',
  \ ':cd ~/codecenter/vimcode/dx5/lk/',
  \ ':cd ~/codecenter/vimcode/dx5/pl/',
  \ ':cd ~/codecenter/vimcode/2362/kernel/',
  \ ':cd ~/codecenter/vimcode/2362/lk/',
  \ ':cd ~/codecenter/vimcode/2362/pl/',
  \ ':cd ~/codecenter/vimcode/2406/kernel/',
  \ ':cd ~/codecenter/vimcode/2406/lk/',
  \ ':cd ~/codecenter/vimcode/2406/pl/',
  \ ':cd ~/codecenter/vimcode/2417/kernel/',
  \ ':cd ~/codecenter/vimcode/2417/lk/',
  \ ':cd ~/codecenter/vimcode/2417/pl/',
  \ ':cd ~/codecenter/vimcode/2415/kernel/',
  \ ':cd ~/codecenter/vimcode/2415/lk/',
  \ ':cd ~/codecenter/vimcode/2415/pl/',
  \ ':cd ~/codecenter/vimcode/2437/kernel/',
  \ ':cd ~/codecenter/vimcode/2437/lk/',
  \ ':cd ~/codecenter/vimcode/2437/pl/',
  \ ':cd ~/codecenter/vimcode/pri-charge_vivo_mtk_1.0/',
  \ ':cd ~/codecenter/gaotog/pri-charge',
  \ ':cd ~/codecenter/vimcode/ard16s/healthd',
  \ ':cd ~/codecenter/vimcode/ard16s/minui',
  \ ':cd ~/codecenter/fold5/ap_vendor/vim',
  \ ]
 call fzf#run(fzf#wrap({
  \ 'source': g:command_list,
  \ 'sink': function('s:execute_selected_command')
  \ }))
endfunction

function! s:execute_command()
 let g:command_list = [
  \ ':BLines',
  \ ':FzfLua blines',
  \ ':Git blame',
  \ ':Lines',
  \ ':BCommits',
  \ ':Commits',
  \ ':%s/\s\+$//',
  \ ':%s/    /\t/g',
  \ ':set scrollbind',
  \ ':call clearmatches()',
  \ ':Git reset --hard HEAD^^^^ | Git pull | Git status',
  \ ':AsyncRun ctags -R *',
  \ ':colorscheme molokai | set notermguicolors',
  \ ':colorscheme kanagawa | set termguicolors',
  \ ':colorscheme tokyonight-night | set termguicolors',
  \ ':%s/\[[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\} [0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}\] //g',
  \ ]
 call fzf#run(fzf#wrap({
  \ 'source': g:command_list,
  \ 'sink': function('s:execute_selected_command')
  \ }))
endfunction
"=====================================================end func====================================

command! -bang -nargs=* Rg
  \ call fzf#vim#grep(
  \   'rg --threads 79 -L  --column --line-number --no-heading --color=always --smart-case  '.shellescape(<q-args>), 1,
  \   fzf#vim#with_preview(), <bang>0)

let g:fzf_preview_window = ['up:65%', 'ctrl-f']
let g:fzf_vim = {}
let g:fzf_follow_links = 1
let g:fzf_vim_dir = expand('%:p:h')
let $FZF_DEFAULT_OPTS='--height 100% --layout=reverse'
let $FZF_DEFAULT_COMMAND = 'fd --type f --type l --hidden --follow --exclude .git'
let g:fzf_buffers_jump = 1
let g:fzf_action = {
  \ 'ctrl-x': 'split',
  \ 'ctrl-v': 'vsplit',
  \ 'ctrl-t': 'tabnew' }
let g:fzf_layout = {
  \ 'window': {
    \ 'width': 1,
    \ 'height': 1,
    \ 'border': 'rounded'
  \ },
\ }

let mapleader = " "
let g:Lf_FollowLinks = 1  " 启用跟随符号链接
let g:Lf_ScanSymLink = 1  " 扫描符号链接目录
" 设置搜索深度（包含符号链接）
let g:Lf_MaxDepth = 30  " 最大搜索深度
let g:Lf_UseCache = 1   " 使用缓存提高性能
let g:Lf_UseMemoryCache = 1  " 使用内存缓存
" 自定义 rg 命令包含符号链接
let g:Lf_DefaultExternalTool = "rg"

let g:param1= 0
let g:initial_directory_set = 0

let g:tagbar_position = 'right'
let g:tagbar_singleclick = 1
let g:tagbar_autoclose = 0
let g:tagbar_width = 70

let g:EasyMotion_do_mapping = 0
let g:EasyMotion_smartcase = 1
let g:EasyMotion_use_smartsign_us = 1 " US layout
let g:move_key_modifier_visualmode = 'S'
let g:matchparen_timeout = 300
let g:matchparen_insert_timeout = 300
let g:ranger_map_keys = 0

let current_file_dir = expand('%:p:h')
let current_working_dir = getcwd()
let g:ranger_replace_netrw = 0
let g:osc52_trim_newline = 1
let g:oscyank_term = 'tmux'

let g:python3_host_prog = '/usr/bin/python3'
let g:UltiSnipsExpandTrigger="<c-e>"
let g:UltiSnipsJumpForwardTrigger="<c-j>"

cabbrev rg Rg

nnoremap <leader>f :Files<CR>
nnoremap <leader><leader> :BTags<CR>
nnoremap <leader>r :LeaderfBuffer<CR>

" 普通模式
nnoremap d "_d
nnoremap D "_D
nnoremap x "_x
" 可视模式
vnoremap d "_d
vnoremap x "_x

inoremap <A-h> <left>
inoremap <A-j> <down>
inoremap <A-k> <up>
inoremap <A-l> <right>

map u <Nop>
nnoremap u :u<cr>:w<cr>

vnoremap < <gv
vnoremap > >gv
vnoremap $ $h

nnoremap Z ZZ
inoremap jj <Esc>

if exists("g:neovide")
vnoremap r "+y
cnoremap <S-Space> <C-r>+
inoremap <S-Space> <C-r>+
map <S-Leftmouse> <Nop>
endif

" Bash like keys for the command line
cnoremap <C-A>      <Home>
cnoremap <C-E>      <End>
cnoremap <C-K>      <C-U>

map <Rightmouse>  <Leftmouse>E#
nnoremap # #N

nnoremap <C-Space> :
nnoremap ; :
vnoremap ; :
inoremap <C-Space> <C-n>

nnoremap <S-h> :vertical resize -3<CR>
nnoremap <S-l> :vertical resize +3<CR>
nnoremap <S-j> :resize +3<CR>
nnoremap <S-k> :resize -3<CR>

nnoremap <silent> <leader>e :call Togglefunc2()<CR>

if exists("g:neovide")
vnoremap<C-c> :w! ~/c/.vim/cvbuf.c<CR>
nnoremap<C-v> :r ~/c/.vim/cvbuf.c<CR>
else
vnoremap<C-c> :w! ~/.vim/cvbuf.c<CR>
nnoremap<C-v> :r ~/.vim/cvbuf.c<CR>
endif

" Close all the buffers
map <leader>ba :bufdo bd<cr>

nnoremap <silent><expr> <Space>/ incsearch#go(<SID>config_easyfuzzymotion())

map s <Nop>
map S <Nop>
nnoremap s :HopChar2<cr>
nnoremap S :HopLineStart<cr>

nnoremap <Leader>l <Plug>(easymotion-lineforward)
nnoremap <Leader>j <Plug>(easymotion-j)
nnoremap <Leader>k <Plug>(easymotion-k)
nnoremap <Leader>i <Plug>(easymotion-linebackward)

let g:EasyMotion_startofline = 0 " keep cursor column when JK motion

" ToggleTerm 由 init.lua 中的 open_mapping 处理
vnoremap <S-j> :m '>+1<CR>gv=gv
vnoremap <S-k> :m '<-2<CR>gv=gv

map f <Nop>
nnoremap f <C-o>zz
nnoremap W <C-i>zz
nnoremap F [[k2wzz

nnoremap a <Nop>
vnoremap a <Nop>
nnoremap a <C-]>zz
nnoremap <S-u> <C-]>zz

nnoremap <leader>s :Rg <C-r><C-w> = <CR>
vnoremap <leader>s y:Rg <C-r>" = <CR>
vnoremap R y:Rg <C-r>"<CR>
nnoremap R :Rg <C-r><C-w><CR>

vnoremap , :<C-u>call HighlightWithColorCode(input('Enter color code (0-255): '))<CR>
vnoremap <silent> # y/<C-r>"<CR>N

map <F1> <Nop>
map <F2> <Nop>
nnoremap <F1> 15zh
nnoremap <F2> 15zl

nnoremap z z
vnoremap z z
vnoremap zf zfzf

nnoremap n nzzzv
nnoremap N Nzzzv

nnoremap <C-j> 6<C-e>
nnoremap <C-k> 6<C-y>
nnoremap <C-e> 6<C-e>

vnoremap <Leader>dm :call DeleteVisualMatch()<CR>

inoremap El ->
inoremap E1 ()<esc>i
inoremap E2 []<esc>i
inoremap E3 {}<esc>i
inoremap E4 {<esc>o}<esc>O

vnoremap E1 <esc>`>a)<esc>`<i(<esc>
vnoremap E2 <esc>`>a]<esc>`<i[<esc>
vnoremap E3 <esc>`>a}<esc>`<i{<esc>
vnoremap E4 <esc>`>a"<esc>`<i"<esc>
vnoremap E5 <esc>`>a'<esc>`<i'<esc>

nnoremap t :call <SID>execute_command_cd()<CR>
nnoremap q :call <SID>execute_command()<CR>

nnoremap c <Nop>
vnoremap c <Nop>
vnoremap C <Nop>

nnoremap p "bp
nnoremap P "bP
vnoremap p "bp
vnoremap C "bp
if !exists("g:neovide")
vnoremap y "bygv<Plug>OSCYankVisual
vnoremap c "bygv<Plug>OSCYankVisual
else
vnoremap y "by
endif
nnoremap Y ve<Plug>OSCYankVisual
nnoremap e :e<cr>

nnoremap ce :Rg<cr>
nnoremap cf :Yazi<cr>
nnoremap cc :TagbarToggle<cr>
nnoremap cs :sp<cr>
nnoremap cv :vsp<cr>
"nnoremap ca :Ranger<cr>
nnoremap ca :Yazi<cr>
nnoremap cq :copen 20<cr>
nnoremap ct :call GenerateTags()<cr>
nnoremap cl :call system('rm -rf *2025_Will_Rich* tags \n')<cr>
nnoremap E <Plug>(expand_region_expand)
nnoremap 0 ^
nnoremap <leader>cd :cd %:p:h<cr>:pwd<cr>

" 快捷键列表：用 FzfLua 列出所有快捷键及说明
nnoremap <silent> <leader>hk :FzfLua keymaps<CR>

" LazyGit
nnoremap <silent> <leader>lg :LazyGit<CR>
nnoremap <silent> <leader>lf :LazyGitFilter<CR>

" Aerial
nnoremap <silent> <leader>ao :AerialToggle!<CR>


" Neogit
nnoremap <leader>ng :lua require('neogit').open({cwd = vim.fn.expand('%:p:h')})<CR>

" =============================== 主题切换 ===============================
let g:my_colorschemes = [
\ 'tokyonight-night',
\ 'tokyonight-storm',
\ 'tokyonight-moon',
\ 'tokyonight-day',
\ 'monokai',
\ 'kanagawa',
\ 'kanagawa-dragon',
\ 'kanagawa-lotus',
\ 'catppuccin-mocha',
\ 'catppuccin-macchiato',
\ 'catppuccin-frappe',
\ 'gruvbox',
\ 'rose-pine',
\ 'rose-pine-moon',
\ 'rose-pine-dawn',
\ 'sonokai',
\ 'nordic',
\ 'everforest',
\ 'onedarkpro',
\ 'onedark_dark',
\ 'onedark_vivid',
\ 'dracula',
\ 'edge',
\ 'farout',
\ 'one_monokai',
\ ]

function! s:colorscheme_sink(line)
  let l:scheme = split(a:line)[0]
  execute 'colorscheme ' . l:scheme
  let g:my_last_colorscheme = l:scheme
endfunction

function! s:SelectColorscheme()
  let l:preview = []
  call fzf#run(fzf#wrap({
  \ 'source': g:my_colorschemes,
  \ 'sink': function('s:colorscheme_sink'),
  \ 'options': '--prompt="Colorscheme> " --no-multi --reverse',
  \ }))
endfunction

nnoremap <leader>cs :call <SID>SelectColorscheme()<CR>

autocmd InsertLeave * silent! write
autocmd FocusGained,BufEnter * silent! checktime
autocmd BufRead,BufNewFile * source ~/.vim/plugged/c.vim/ftplugin/c.vim
autocmd BufRead,BufNewFile * source ~/.vim/plugged/c.vim/ftplugin/make.vim
autocmd BufReadPost * if line("'\"") > 1 && line("'\"") <= line("$") | exe "normal! g'\"" | endif
autocmd InsertLeave * if pumvisible() == 0|pclose|endif
autocmd VimLeave * call system("mv *2025_Will_Rich* tags/")
autocmd BufRead * silent! call LoadTags()
autocmd Syntax * source ~/.vim/plugged/c.vim/ftplugin/c.vim
autocmd BufRead,BufNewFile * call <SID>SetHighlights()
autocmd BufEnter * if !g:initial_directory_set | silent! lcd %:p:h | let g:initial_directory_set = 1 | endif
autocmd FileType python setlocal makeprg=python3\ %

function! s:SetHighlights()
  hi clear SignColumn
  hi clear LineNr
  highlight LineNr ctermfg=darkgrey guifg=#555555
  hi Search ctermfg=0 ctermbg=11 guifg=Black guibg=Yellow
  highlight! Whitespace guifg=#2a2a3a ctermfg=darkgrey
  highlight! NonText guifg=#2a2a3a ctermfg=darkgrey
  highlight CursorLineNr ctermfg=yellow guifg=#FFFF00
  highlight CursorLine ctermbg=NONE guibg=NONE
endfunction

nnoremap <leader>pp :setlocal paste!<cr>
nnoremap <leader>L :call LoadTags()<cr>
" ======================= NEVIDIA 专属配置 =======================
if exists("g:neovide")
set linespace=8
let g:neovide_floating_blur = 1                " 浮动窗口模糊效果
let g:neovide_multigrid = v:true               " 启用多网格渲染（提升性能）
let g:neovide_underline_automatic_scaling = v:true  " 下划线自动缩放
let g:neovide_fullscreen = v:true

let g:neovide_cursor_animation_length = 0.1  "-- 动画时长
let g:neovide_cursor_trail_size = 0.5         "-- 轨迹大小
let g:neovide_cursor_antialiasing = v:true      "-- 抗锯齿

let g:neovide_cursor_vfx_particle_lifetime = 0.3        "-- 粒子存活时间
let g:neovide_cursor_vfx_particle_density = 5.0       "-- 粒子密度
let g:neovide_cursor_vfx_particle_speed = 10.0        "-- 粒子速度
let g:neovide_cursor_vfx_particle_phase = 1.5         "-- 粒子相位
let g:neovide_cursor_vfx_particle_curl = 1.0          "-- 粒子旋转
"let g:neovide_cursor_vfx_mode = "railgun"
let g:neovide_cursor_vfx_opacity = 100.0

let g:neovide_font_face = "FiraCode Nerd Font"
let g:neovide_font_size = 10
let g:neovide_padding_top = 1                 " 窗口顶部留白
let g:neovide_remember_window_size = v:true    " 记忆窗口尺寸
let g:neovide_power_save_mode = v:true
let g:neovide_scale_factor = 0.84
let g:neovide_opacity = 1
let g:neovide_scroll_animation_length = 0.6

let g:neovide_cursor_trail_length= 0.2
let g:fzf_colors = {
	\ 'fg':      ['fg', 'Normal'],
	\ 'bg':      ['bg', 'Normal'],
	\ 'hl':      ['fg', 'Comment'],
	\ 'fg+':     ['fg', 'CursorLine', 'CursorColumn', 'Normal'],
	\ 'bg+':     ['bg', 'CursorLine', 'CursorColumn'],
	\ 'hl+':     ['fg', 'Statement'],
	\ 'info':    ['fg', 'PreProc'],
	\ 'border':  ['fg', 'Ignore'],
	\ 'prompt':  ['fg', 'Conditional'],
	\ 'pointer': ['fg', 'Exception'],
	\ 'marker':  ['fg', 'Keyword'],
	\ 'spinner': ['fg', 'Label'],
	\ 'header':  ['fg', 'Comment'] }

endif "neovide config
" ======================= NEVIDIA 专属配置 =======================

"""""""""""""""""""""""""""""""COC.NVIM"""""""""""""""""""""""""""""""""""
if !exists("g:neovide")
let g:coc_node_path='~/.user/node-v24.0.1-linux-x64/bin/node'
endif
inoremap <silent><expr> <C-@> coc#refresh()
inoremap <silent><expr> <S-Tab> coc#pum#visible() ? coc#pum#prev(1) : "\<S-Tab>"
inoremap <silent><expr> <Tab> coc#pum#visible() ? coc#pum#confirm() : "\<Tab>"
inoremap <silent><expr> <C-j> coc#pum#visible() ? coc#pum#next(1) : "\<C-j>"
inoremap <silent><expr> <C-k> coc#pum#visible() ? coc#pum#prev(1) : "\<C-k>"
inoremap <silent><expr> <CR> coc#pum#visible() ? coc#pum#confirm() : "\<CR>"

" 跳转片段占位符
let g:coc_snippet_next = '<C-j>'
let g:coc_snippet_prev = '<C-k>'
let g:coc_disable_startup_warning = 1

" 非代码文件类型列表（这些文件类型不启用 coc）
let g:coc_non_code_filetypes = [
    \ 'text', 'markdown', 'txt', 'log', 'gitcommit', 'gitrebase',
    \ 'help', 'man', 'qf', 'fugitive', 'diff', 'mail',
    \ 'json', 'yaml', 'toml', 'xml', 'csv',
    \ 'vim', 'dockerfile', 'ini', 'conf', 'cfg',
    \ 'bash', 'sh', 'zsh', 'fish',
    \ 'html', 'css', 'scss', 'sass', 'less',
    \ ]

" 非 coc 文件类型的 buffer 里禁用 coc 服务
function! s:DisableCocForNonCode()
    if index(g:coc_non_code_filetypes, &filetype) >= 0
        call coc#config('suggest.enable', v:false)
        " 断开当前 buffer 的 coc 附加
        silent! call coc#rpc#notify('detached', [bufnr('%')])
    endif
endfunction
augroup CocNonCodeDisable
    autocmd!
    autocmd FileType * call s:DisableCocForNonCode()
augroup END
"""""""""""""""""""""""""""""""COC.NVIM"""""""""""""""""""""""""""""""""""
" 智能搜索函数：支持普通模式和可视模式
function! GrepCurrentFileOrWord()
    if mode() =~# 'v'
        normal! "vy
        let l:keyword = substitute(getreg('v'), '\n', '', 'g')
    else
        let l:keyword = expand('<cword>')
    endif
    let l:keyword = input('Search: ', l:keyword)
    let l:escaped = escape(l:keyword, '\.^$~[]*\/')
    execute 'vimgrep /'.l:escaped.'/ % | copen'
endfunction
nnoremap <leader>g :call GrepCurrentFileOrWord()<CR>
xnoremap <leader>g :<C-u>call GrepCurrentFileOrWord()<CR>

" ------------------------------------------------------------
" 功能：删除所有包含指定关键字的行（默认使用光标所在单词）
" ------------------------------------------------------------

function! DeleteLinesWithKeyword()
    " 默认关键字为光标下的单词
    let l:default_kw = expand('<cword>')
    " 提示输入，可修改默认值
    let l:keyword = input('请输入要删除的关键字: ', l:default_kw)
    if empty(l:keyword)
        echo "已取消删除操作"
        return
    endif
    " 保存撤销点
    normal! m`
    " 删除包含关键字的所有行
    execute 'g/' . escape(l:keyword, '/\') . '/d'
    echo "已删除包含关键字 '" . l:keyword . "' 的所有行"
endfunction

" 绑定快捷键，例如 <leader>d
nnoremap <leader>d :call DeleteLinesWithKeyword()<CR>

" Alt+鼠标滚轮实现左右滚动
if has('mouse')
    nmap <M-ScrollWheelUp> 5zh
    nmap <M-ScrollWheelDown> 5zl
    imap <M-ScrollWheelUp> <Esc>5zh
    imap <M-ScrollWheelDown> <Esc>5zl
    vmap <M-ScrollWheelUp> 5zh
    vmap <M-ScrollWheelDown> 5zl
endif
