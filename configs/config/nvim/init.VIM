set runtimepath^=~/.vim
call plug#begin('~/.vim/plugged')
if has('nvim')
Plug 'stevearc/dressing.nvim'
Plug 'rcarriga/nvim-notify'
Plug 'folke/noice.nvim'
Plug 'MunifTanjim/nui.nvim'
Plug 'petertriho/nvim-scrollbar'

Plug 'yuttie/comfortable-motion.vim'
Plug 'psliwka/vim-smoothie'

Plug 'phaazon/hop.nvim'
Plug 'rebelot/kanagawa.nvim'
endif
"Plug 'yetone/avante.nvim', { 'branch': 'main', 'do': 'make' }

Plug 'rbgrouleff/bclose.vim'
Plug 'skywind3000/asyncrun.vim'
Plug 'Yggdroot/LeaderF', { 'do': ':LeaderfInstallCExtension' }

Plug 'rose-pine/neovim'
Plug 'folke/tokyonight.nvim'
Plug 'tomasr/molokai'

Plug 'haya14busa/incsearch.vim'
Plug 'haya14busa/incsearch-easymotion.vim'
Plug 'haya14busa/incsearch-fuzzy.vim'
Plug 'ojroques/vim-oscyank', {'branch': 'main'}
Plug 'catppuccin/nvim', { 'branch': 'vim', 'as': 'catppuccin' }
Plug 'ibhagwan/fzf-lua'
Plug 'nvim-tree/nvim-web-devicons'

Plug 'nvim-lua/plenary.nvim'
Plug 'neoclide/coc.nvim', {'branch': 'release'}  " LSP框架 [citation](1)

Plug 'neoclide/coc-snippets'                    " 片段引擎
Plug 'honza/vim-snippets'                       " 通用片段库
Plug 'SirVer/ultisnips'         " 片段引擎


Plug 'Shougo/deoplete.nvim', { 'do': ':UpdateRemotePlugins' }
Plug 'nvim-treesitter/nvim-treesitter', { 'do': ':TSInstallSync all' }
Plug 'nvim-treesitter/nvim-treesitter-context'

Plug 'vim-scripts/taglist.vim'

Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'

Plug 'easymotion/vim-easymotion'
Plug 'haya14busa/incsearch-easymotion.vim'

Plug 'git@github.com:vim-scripts/c.vim.git'
Plug 'vim-scripts/c.vim'

Plug 'voldikss/vim-floaterm'
Plug 'francoiscabrol/ranger.vim'

Plug 'matze/vim-move'

Plug 'tpope/vim-fugitive'
Plug 'airblade/vim-gitgutter'
Plug 'junegunn/gv.vim'

Plug 'terryma/vim-multiple-cursors'
Plug 'mg979/vim-visual-multi'

Plug 'preservim/tagbar'
Plug 'kshenoy/vim-signature'
Plug 'terryma/vim-expand-region'
call plug#end()

filetype indent off
syntax on
if has('nvim')
"colorscheme kanagawa
colorscheme tokyonight-night
set shada+=!
set cmdheight=0
else
colorscheme default
endif
set foldcolumn=0
set nowrapscan
set history=500
set t_Co=256
set mouse=a
set hlsearch
set cindent
set linebreak
set nocompatible
set signcolumn=yes
set encoding=utf-8
set smoothscroll
set updatetime=300
set timeoutlen=500
set ttimeoutlen=50
set completeopt=menu,menuone,noselect
set pumheight=10
set shortmess+=c
set fileencoding=utf-8
set showcmd
set ruler
set nocursorline
set showtabline=0
set nomore
set incsearch
set showmatch
set matchtime=50
set helplang=cn
set langmenu=zh_CN.UTF-8
set noswapfile
set nowb
set sm
set mousemodel=extend
set smartcase
set smarttab
set title
set tabstop=4
set shiftwidth=4
set nowritebackup
set nobackup
set foldcolumn=0
set noautowrite
set copyindent
set ttyfast
set report=0
set synmaxcol=1000
set autoread
"set lazyredraw
set lbr
set tw=500
set ai "Auto indent
set nu
"set relativenumber
set si "Smart indent
set nowrap "Wrap lines
set switchbuf+=useopen
set switchbuf+=usetab
set wildmenu
set wildignore+=.*
set foldenable
set sessionoptions-=options
set completeopt=longest,menu
set list
set listchars=tab:›\ ,trail:.,extends:#,nbsp:.
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
let g:Color_Text_Alt    = '#FFFFFF'  " 用于模式文字的前景深色

" ===============================
" 更新状态栏函数
" ===============================
function! StatusLineUpdate()
    " 函数名、文件名、Git分支、模式、百分比
    set statusline=%#ColorT#[%{get(b:,'current_func','')}][%t]
    set statusline+=%#ColorGit#%{fugitive#statusline()}
    set statusline+=%#ColorT#[%{Mode()}][%p%%]
endfunction

call StatusLineUpdate()

" ===============================
" 初始化高亮组
" ===============================
execute 'hi ColorT guifg=' . g:Color_Text . ' guibg=' . g:Color_BG
execute 'hi ColorGit guifg=' . g:Color_Git . ' guibg=' . g:Color_BG

" ===============================
" 动态模式函数
" ===============================
function! Mode()
  let l:mode = mode()

  if l:mode ==# 'n'
    execute 'hi ColorT guifg=' . g:Color_Normal . ' guibg=' . g:Color_BG
    execute 'hi ColorGit guifg=' . g:Color_Git . ' guibg=' . g:Color_BG
    return 'N'

  elseif l:mode ==# 'i'
    execute 'hi ColorT guifg=' . g:Color_Text_Alt . ' guibg=' . g:Color_Insert
    execute 'hi ColorGit guifg=' . g:Color_Text_Alt . ' guibg=' . g:Color_Insert
    return 'I'

  elseif l:mode ==# 'v' || l:mode ==# 'V' || l:mode ==# '' || l:mode ==# 's'
    execute 'hi ColorT guifg=' . g:Color_Text_Alt . ' guibg=' . g:Color_Visual
    execute 'hi ColorGit guifg=' . g:Color_Text_Alt . ' guibg=' . g:Color_Visual
    return 'V'

  elseif l:mode ==# 'c'
    execute 'hi ColorT guifg=' . g:Color_Text_Alt . ' guibg=' . g:Color_Command
    execute 'hi ColorGit guifg=' . g:Color_Text_Alt . ' guibg=' . g:Color_Command
    return 'C'

  else
    execute 'hi ColorT guifg=' . g:Color_Other . ' guibg=' . g:Color_BG
    execute 'hi ColorGit guifg=' . g:Color_Git . ' guibg=' . g:Color_BG
    return l:mode
  endif
endfunction
autocmd ModeChanged * call Mode()

"=====================================================begin func====================================

function! UpdateCurrentFunc()
    let lnum = line('.')
    let fname = ''
    let reserved = ['if', 'else', 'elseif', 'return']
    for i in reverse(range(1, lnum))
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
    let b:current_func = fname

	if winnr('$') > 1
	else
	execute "resize +3"
	endif
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
let loaded_matchparen=1
let g:ranger_map_keys = 0

let g:floaterm_width = 900  " 宽度为屏幕的 80%
let g:floaterm_height = 35 " 高度为屏幕的 60%
"let g:floaterm_height = 40 " 高度为屏幕的 60%
let g:floaterm_autoinsert = 1
let g:floaterm_autohide = 1
let g:floaterm_autoclose = 2
let current_file_dir = expand('%:p:h')
let current_working_dir = getcwd()
let g:ranger_replace_netrw = 0
let g:osc52_trim_newline = 1
let g:oscyank_term = 'tmux'

let g:python3_host_prog = '/opt/homebrew/bin/python3'
let g:UltiSnipsExpandTrigger="<tab>"
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

nnoremap<leader>t :FloatermToggle<CR>
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

nnoremap n nzz
nnoremap N Nzz

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
nnoremap cf :NERDTreeFind<cr>
nnoremap cc :TagbarToggle<cr>
nnoremap cs :sp<cr>
nnoremap cv :vsp<cr>
nnoremap ca :Ranger<cr>
nnoremap cq :copen 20<cr>
nnoremap ct :call GenerateTags()<cr>
nnoremap cl :call system('rm -rf *2025_Will_Rich* tags \n')<cr>
nnoremap E <Plug>(expand_region_expand)
nnoremap 0 ^
nnoremap <leader>cd :cd %:p:h<cr>:pwd<cr>

set cursorline
autocmd BufWritePost * GitGutter
autocmd InsertLeave * silent! write
autocmd FocusGained,BufEnter * silent! checktime
autocmd BufRead,BufNewFile * source ~/.vim/plugged/c.vim/ftplugin/c.vim
autocmd BufRead,BufNewFile * source ~/.vim/plugged/c.vim/ftplugin/make.vim
autocmd BufReadPost * if line("'\"") > 1 && line("'\"") <= line("$") | exe "normal! g'\"" | endif
autocmd InsertLeave * if pumvisible() == 0|pclose|endif
autocmd VimLeave * call system("mv *2025_Will_Rich* tags/")
autocmd BufRead * silent! call LoadTags()
autocmd Syntax * source ~/.vim/plugged/c.vim/ftplugin/c.vim
autocmd User FloatermExit :FloatermNew --autoclose=0 exit 0
autocmd BufRead,BufNewFile *  hi clear SignColumn
autocmd BufRead,BufNewFile *  hi clear LineNr
autocmd BufRead,BufNewFile *  highlight LineNr ctermfg=darkgrey guifg=#555555
autocmd BufRead,BufNewFile *  hi Search ctermfg=0 ctermbg=11 guifg=Black guibg=Yellow
autocmd BufRead,BufNewFile *  highlight CursorLineNr ctermfg=yellow guifg=#FFFF00
autocmd BufRead,BufNewFile *  highlight CursorLine ctermbg=NONE guibg=NONE
autocmd BufEnter * if !g:initial_directory_set | silent! lcd %:p:h | let g:initial_directory_set = 1 | endif
autocmd FileType python setlocal makeprg=python3\ %

nnoremap <leader>pp :setlocal paste!<cr>
nnoremap <leader>L :call LoadTags()<cr>
" ======================= NEVIDIA 专属配置 =======================
if exists("g:neovide")
set linespace=8
let g:neovide_cursor_trail_size = 0.5          " 光标拖尾长度（0-1）
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

command! -bang -nargs=* Rg
  \ call fzf#vim#grep(
  \   'rg --threads 5  -L --column --line-number --no-heading --color=always --smart-case  '.shellescape(<q-args>), 1,
  \   fzf#vim#with_preview(), <bang>0)

endif "neovide config
" ======================= NEVIDIA 专属配置 =======================

"""""""""""""""""""""""""""""""COC.NVIM"""""""""""""""""""""""""""""""""""
if !exists("g:neovide")
let g:coc_node_path='/Users/ranxuefeng/.nvm/versions/node/v22.17.0/bin/node'
endif
inoremap <expr> <CR> pumvisible() ? "\<C-y>" : "\<CR>"
inoremap <silent><expr> <C-@> coc#refresh()
inoremap <silent><expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"
inoremap <silent><expr> <Tab> pumvisible() ? "\<C-n>" : "\<Tab>"
inoremap <silent><expr> <CR> pumvisible() ? coc#_select_confirm() : "\<CR>"
inoremap <silent><expr> <C-j> coc#pum#visible() ? coc#pum#next(1) : "\<C-j>"
inoremap <silent><expr> <C-k> coc#pum#visible() ? coc#pum#prev(1) : "\<C-k>"
inoremap <silent><expr> <CR> coc#pum#visible() ? coc#pum#confirm() : "\<CR>"
imap <silent><expr> <Tab> coc#pum#visible() ? coc#pum#confirm() : "\<Tab>"

" 跳转片段占位符
let g:coc_snippet_next = '<C-j>'
let g:coc_snippet_prev = '<C-k>'
let g:coc_disable_startup_warning = 1
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
