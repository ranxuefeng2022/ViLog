-- 用户命令 + 工具函数

local M = {}

-- 追踪当前光标所在的 C/C++ 函数名 (Vimscript 实现，确保 b:current_func 可被 statusline %{...} 读取)
-- 算法：块结构分析，不用正则"猜"签名行——由内向外找包裹光标的最近未配对 {，
-- 验证它是否函数体开头；不是(if/for/初始化/枚举...)就跳到外层块继续，最多 60 层。
-- 因此函数体内写什么(return ERR_PTR(...)、宏、goto 标签)都不影响结果。
vim.cmd([[
" 光标位于 ( 上：取其左侧的函数名标识符，'' 表示不像函数定义
function! UCFWordBefore()
    if search('\v\w+', 'bW', max([1, line('.') - 3])) == 0
        return ''
    endif
    let w = expand('<cword>')
    if w ==# '' || index(['if','for','while','switch','do','else','return','sizeof','case'], w) != -1
        return ''
    endif
    " 名字前是 = . -> & 一类取值上下文 → 表达式调用而非定义
    if col('.') > 1 && getline('.')[col('.') - 2] =~# '[=.>&]'
        return ''
    endif
    return w
endfunction

" 判断 open(=[lnum,col]) 处的 { 是否函数体开头；是则返回函数名，否则 ''
function! UCFBlockName(open, skip)
    call cursor(a:open[0], a:open[1])

    " 1) { 前最后一个非空白字符
    let before = strpart(getline(a:open[0]), 0, a:open[1] - 1)
    if before =~# '\S'
        let p = matchstrpos(before, '\S\ze\s*$')
        let tl = a:open[0]
        let tc = p[1] + 1
    else
        call cursor(a:open[0], 1)
        if search('\v\S', 'bW') == 0
            return ''
        endif
        let tl = line('.')
        let tc = col('.')
    endif
    let ch = getline(tl)[tc - 1]

    " ({ GNU 语句表达式(宏里常见) → 非函数体
    if ch ==# '('
        return ''
    endif

    " 2) 定位参数表的右括号 )
    if ch ==# ')'
        call cursor(tl, tc)
    else
        " { 前是标识符或 ; ：K&R 参数声明、__must_check 一类后缀注解，
        " 或 enum/struct/= 等非函数块。向上 10 行内找 )
        call cursor(tl, tc)
        if search('\v\)', 'bW', max([1, tl - 10])) == 0
            return ''
        endif
        " ) 后紧跟 ; → 独立调用语句 foo(x); → 非函数体
        if getline('.')[col('.')] ==# ';'
            return ''
        endif
        " ) 到 { 之间的文本：剥掉注释后不允许 =(排除 = { 初始化)；
        " 无 ; 时(非 K&R)只允许 __attr 注解标识符(排除 do {、enum x {)
        let rl = line('.')
        let rc = col('.')
        let seg = strpart(getline(rl), rc)
        if a:open[0] > rl
            let seg = seg . "\n" . join(getline(rl + 1, a:open[0] - 1), "\n")
            let seg = seg . "\n" . strpart(getline(a:open[0]), 0, a:open[1] - 1)
        endif
        let seg = substitute(seg, '/\*\_.\{-}\*/', '', 'g')
        let seg = substitute(seg, '//.*', '', 'g')
        if seg =~# '='
            return ''
        endif
        if seg !~# ';'
            let flat = substitute(seg, '\_s\+', '', 'g')
            if flat !~# '^__\w\+\%(,__\w\+\)*$'
                return ''
            endif
        endif
    endif

    " 3) ) 配对回 ( 取名字；__acquires/__releases 注解在中间时跳过一次
    for _ in range(2)
        let pp = searchpairpos('(', '', ')', 'bnW', a:skip, max([1, line('.') - 3000]))
        if pp == [0, 0]
            return ''
        endif
        call cursor(pp[0], pp[1])
        let w = UCFWordBefore()
        if w ==# '__acquires' || w ==# '__releases'
            " 注解宏的参数不是函数参数表：找它前面真正的 )
            if search('\v\)', 'bW', max([1, line('.') - 10])) == 0
                return ''
            endif
            continue
        endif
        return w
    endfor
    return ''
endfunction

function! UpdateCurrentFunc()
    let lnum = line('.')
    if exists('b:current_func_lnum') && b:current_func_lnum == lnum
        return
    endif

    " 快速路径：光标仍在缓存的函数范围(含签名行)内
    if exists('b:func_range') && !empty(b:func_range)
        \ && lnum >= b:func_range[0] && lnum <= b:func_range[1]
        \ && exists('b:current_func_lnum')
        let b:current_func_lnum = lnum
        return
    endif

    " skip 同时排除 cppout(#if 0 死代码区,文本上只开不闭的 { 会把配对推过
    " 函数尾,范围吞进下一个函数)与 define(#define 宏体里的 {})
    let skip = 'synIDattr(synID(line("."),col("."),1),"name") =~? "string\\|comment\\|character\\|cppout\\|define"'
    let stop = max([1, lnum - 3000])
    let save_view = winsaveview()
    let ocol = col('.')
    " 光标恰在 { 或 ( 上时，后退搜索不匹配光标自身：
    " 搜索起点右移一列；{ 在行尾则移到下一行行首
    let slnum = lnum
    let scol = ocol
    if getline(slnum)[scol - 1] =~# '[{(]'
        if scol >= len(getline(slnum))
            let slnum += 1
            let scol = 1
        else
            let scol += 1
        endif
        call cursor(slnum, scol)
    endif
    let fname = ''
    let frange = []

    for _ in range(60)
        " 包裹光标的最近未配对 {（searchpair 自带嵌套配对，且跳过注释/字符串）
        let open = searchpairpos('{', '', '}', 'bnW', skip, stop)
        if open == [0, 0]
            break
        endif

        let w = UCFBlockName(open, skip)
        if w !=# ''
            let fname = w
            " 函数体结束行（searchpair 从 { 上取配对 }）
            " 注意: 嵌套下标后紧跟右括号的写法会产生双右方括号序列,
            " 会终止外层 Lua 长字符串,故先取到临时变量再组列表
            call cursor(open[0], open[1])
            let bend = searchpairpos('{', '', '}', 'nW', skip)
            let bl = open[0]
            let el = bend != [0, 0] ? bend[0] : bl + 500
            let frange = [bl, el]
            " 范围向上吸收签名行(跨行返回类型/参数表)：
            " 遇空行、# 行、; { } 结尾的行即停，最多 8 行
            let ext = 0
            while ext < 8
                let pl = open[0] - 1 - ext
                if pl < 1
                    break
                endif
                let t = getline(pl)
                if t =~# '^\s*$' || t =~# '^\s*#' || t =~# '[;{}]\s*$'
                    break
                endif
                let ext += 1
            endwhile
            let frange[0] -= ext
            break
        endif

        " 非函数体 → 光标移到该 { 之前，继续上溯外层块
        if open[1] > 1
            call cursor(open[0], open[1] - 1)
        elseif open[0] > 1
            call cursor(open[0] - 1, 2000000)
        else
            break
        endif
    endfor

    " 兜底：光标还在签名的参数括号内(尚无包围它的 {)时，直接取包裹 ( 前的名字
    if fname == ''
        call cursor(slnum, scol)
        let pp = searchpairpos('(', '', ')', 'bnW', skip, stop)
        if pp != [0, 0]
            call cursor(pp[0], pp[1])
            let fname = UCFWordBefore()
        endif
    endif

    " 二次兜底：光标在函数之外的"死区"(EXPORT 行/枚举/初始化器/文件作用域)时，
    " 与旧正则版行为一致——显示上方最近函数的名字。逐个检查上方 { 是否函数体。
    " 从光标行行尾起搜：同行光标右侧的 { (void fast(void) { 行首) 也能覆盖
    if fname == ''
        call cursor(slnum, 2000000)
        for _ in range(30)
            if search('\v\{', 'bW') == 0
                break
            endif
            let ob = [line('.'), col('.')]
            let w = UCFBlockName(ob, skip)
            if w !=# ''
                let fname = w
                let frange = []   " 死区不缓存范围,避免误吞下一个函数
                break
            endif
            if ob[1] > 1
                call cursor(ob[0], ob[1] - 1)
            elseif ob[0] > 1
                call cursor(ob[0] - 1, 2000000)
            else
                break
            endif
        endfor
    endif

    if !exists('b:current_func') || b:current_func !=# fname
        let b:current_func = fname
        redrawstatus
    endif
    let b:func_range = frange
    call winrestview(save_view)
    let b:current_func_lnum = lnum
endfunction
]])

-- 复制当前函数名
function M.yank_current_func()
  local func = vim.b.current_func or ''
  if func ~= '' then
    local osc52 = string.format('\x1b]52;c;%s\x07', vim.base64.encode(func))
    vim.api.nvim_chan_send(vim.v.stderr, osc52)
    vim.notify('Copied: ' .. func, vim.log.levels.INFO, { title = 'Function Name' })
  else
    vim.notify('No function found at cursor', vim.log.levels.WARN, { title = 'Function Name' })
  end
end

-- 复制文本到系统剪贴板（跨平台双写，覆盖本地 + 远程/Windows）
-- 1) + 寄存器：本地环境（macOS pbcopy / WSL clip.exe / Windows / X11）直接生效
-- 2) OSC52：SSH 远程或 Windows Terminal，由终端把序列透传回本地剪贴板
function M.copy_to_clipboard(text)
  if text == nil or text == '' then return end
  pcall(vim.fn.setreg, '+', text)
  pcall(function()
    local seq = string.format('\x1b]52;c;%s\x07', vim.base64.encode(text))
    vim.api.nvim_chan_send(vim.v.stderr, seq)
  end)
end

-- Tags
local tags_loaded_dirs = {}

function M.load_tags(cwd)
  cwd = cwd or vim.fn.getcwd()
  if tags_loaded_dirs[cwd] then return end
  tags_loaded_dirs[cwd] = true
  vim.schedule(function() vim.o.tags = './tags,tags;' end)
end

-- 进度通知（原地刷新，不自动消失）
local function make_progress()
  local nid = nil
  return function(msg, final)
    vim.schedule(function()
      if final then
        nid = vim.notify(msg, vim.log.levels.INFO, { replace = nid, title = 'Tags', timeout = 3000 })
      else
        nid = vim.notify(msg, vim.log.levels.INFO, { replace = nid, title = 'Tags', timeout = false })
      end
    end)
  end
end

-- 入口：panel H — 并行生成项目全部源文件的 tags（不做目录分流）
function M.generate_tags()
  local cwd = vim.fn.getcwd()
  tags_loaded_dirs[cwd] = nil
  local t0 = os.time()
  local progress = make_progress()
  -- 跨平台核数:nproc 在 macOS 不存在,vim.uv.cpu_info() 全平台可用且免子进程
  local ncpu = math.max(1, #vim.uv.cpu_info())

  -- 构建任务列表
  local tasks = {}
  tasks[#tasks + 1] = {
    name = 'tags',
    fd = string.format(
      'fd -L -e c -e h -e cpp -e hpp -e cxx -e hxx -e S . %s',
      vim.fn.shellescape(cwd)),
  }

  progress(string.format('Scanning %d tag tasks...', #tasks))

  local task_done = 0
  for _, task in ipairs(tasks) do
    local tmpfile = vim.fn.stdpath('cache') .. '/ctags_' .. task.name .. '_' .. os.time()
    local tag_path = cwd .. '/' .. task.name

    -- Step 1: fd 列文件
    vim.system({ 'sh', '-c', task.fd .. ' > ' .. tmpfile }, { stdout = false, stderr = false }, function(ok)
      -- 整个后续逻辑包在 schedule 里，避免 fast event 限制
      vim.schedule(function()
        if not ok then
          progress(string.format('%s: fd failed', task.name), true)
          return
        end
        local f = io.open(tmpfile, 'r')
        if not f then
          progress(string.format('%s: no files', task.name), true)
          return
        end
        local files = {}
        for line in f:lines() do files[#files + 1] = line end
        f:close()
        os.remove(tmpfile)

        if #files == 0 then
          progress(string.format('%s: empty', task.name), true)
          task_done = task_done + 1
          if task_done >= #tasks then
            M.load_tags(cwd)
            progress(string.format('Done: 0 files, %ds', os.time() - t0), true)
          end
          return
        end

        -- Step 2: 分块并行 ctags
        local n = math.min(ncpu, #files)
        local chunk_sz = math.ceil(#files / n)
        local tmpdir = vim.fn.stdpath('cache') .. '/ctags_' .. task.name .. '_' .. os.time()
        vim.fn.mkdir(tmpdir, 'p')

        progress(string.format('%s: %d files, %d jobs...', task.name, #files, n))

        local chunks = {}
        for i = 1, n do
          local cp = tmpdir .. '/chunk_' .. i
          local cf = io.open(cp, 'w')
          if cf then
            for j = (i - 1) * chunk_sz + 1, math.min(i * chunk_sz, #files) do
              cf:write(files[j] .. '\n')
            end
            cf:close()
            chunks[#chunks + 1] = cp
          end
        end

        local cdone = 0
        local tag_files = {}
        for i = 1, #chunks do
          tag_files[i] = tmpdir .. '/tags_' .. i
          vim.system(
            { 'ctags', '--languages=C,C++', '--sort=yes', '-L', chunks[i], '-f', tag_files[i] },
            { stdout = false, stderr = false, env = { LC_ALL = 'C' } },
            function()
              cdone = cdone + 1
              if cdone < n then
                progress(string.format('%s: %d/%d jobs...', task.name, cdone, n))
                return
              end
              -- Step 3: sort -m 合并
              progress(string.format('%s: merging...', task.name))
              local sort_args = { 'sort', '-m', '-o', tag_path }
              for _, tf in ipairs(tag_files) do sort_args[#sort_args + 1] = tf end
              vim.system(sort_args, { stdout = false, env = { LC_ALL = 'C' } }, function()
                vim.schedule(function()
                  -- 清理各块 ctags 带入的重复 !_TAG_ 头，只保留一个 SORTED 头
                  -- (保证 tagbsearch 二分查找生效)。原 sed -i 写法在 macOS
                  -- BSD sed 上会失败，改用 awk 流式重写，无平台方言差异;
                  -- LC_ALL=C 按字节处理,防止内核源码里的非 UTF-8 字节
                  -- 让 macOS awk 中途 multibyte conversion failure 崩溃
                  local esc = vim.fn.shellescape(tag_path)
                  vim.fn.system(
                    "env LC_ALL=C awk 'BEGIN{print \"!_TAG_FILE_SORTED\\t1\\t/0=unsorted, 1=sorted, 2=foldcase/\"} /^!_TAG_/{next} {print}' "
                    .. esc .. ' > ' .. esc .. '.tmp && mv ' .. esc .. '.tmp ' .. esc
                  )
                  vim.fn.system({ 'rm', '-rf', tmpdir })
                  task_done = task_done + 1
                  local cnt = vim.fn.system("grep -cv '^!_TAG_' " .. vim.fn.shellescape(tag_path) .. ' 2>/dev/null'):gsub('\n', '')
                  progress(string.format('%s done: %s entries, %d files, %d jobs', task.name, cnt, #files, n))
                  if task_done >= #tasks then
                    M.load_tags(cwd)
                    local elapsed = os.time() - t0
                    progress(string.format('All done: %ds', elapsed), true)
                  end
                end)
              end)
            end
          )
        end
      end)
    end)
  end
end

-- 删除 tags 文件：cT
function M.generate_tags_full()
  local cwd = vim.fn.getcwd()
  vim.fn.system('rm -f ' .. vim.fn.shellescape(cwd .. '/tags'))
  vim.notify('Deleted tags', vim.log.levels.INFO, { title = 'Tags' })
end

-- 状态栏开关
function M.toggle_statusline()
  if vim.g.param1 then
    vim.o.laststatus = 3
  else
    vim.o.laststatus = 0
  end
  vim.g.param1 = not vim.g.param1
end

-- fzf 命令/路径列表
local cd_list = {
  ':cd ~/codecenter/vimcode/pri-charge_vivo_mtk_1.0/',
  ':cd ~/de/pri-charge/',
  ':cd ~/codecenter/vimcode/dx5/kernel/',
  ':cd ~/codecenter/vimcode/dx5/lk/',
  ':cd ~/codecenter/vimcode/dx5/pl/',
  ':cd ~/codecenter/vimcode/2362/kernel/',
  ':cd ~/codecenter/vimcode/2362/lk/',
  ':cd ~/codecenter/vimcode/2362/pl/',
  ':cd ~/codecenter/vimcode/2406/kernel/',
  ':cd ~/codecenter/vimcode/2406/lk/',
  ':cd ~/codecenter/vimcode/2406/pl/',
  ':cd ~/codecenter/vimcode/2417/kernel/',
  ':cd ~/codecenter/vimcode/2417/lk/',
  ':cd ~/codecenter/vimcode/2417/pl/',
  ':cd ~/codecenter/vimcode/2415/kernel/',
  ':cd ~/codecenter/vimcode/2415/lk/',
  ':cd ~/codecenter/vimcode/2415/pl/',
  ':cd ~/codecenter/vimcode/2437/kernel/',
  ':cd ~/codecenter/vimcode/2437/lk/',
  ':cd ~/codecenter/vimcode/2437/pl/',
  ':cd ~/codecenter/gaotog/pri-charge',
  ':cd ~/codecenter/vimcode/ard16s/healthd',
  ':cd ~/codecenter/vimcode/ard16s/minui',
  ':cd ~/codecenter/fold5/ap_vendor/vim',
}

local cmd_list = {
  ':FzfLua keymaps',
  ':FzfLua blines',
  ':BlameToggle',
  ':Git blame',
  ':FzfLua git_bcommits',
  ':FzfLua git_commits',
  ':%s/\\s\\+$//',
  ':%s/    /\\t/g',
  ':set scrollbind',
  ':call clearmatches()',
  ':lua require("config.commands").git_reset_pull()',
  ':DiffviewOpen',
  ':DiffviewClose',
  ':DiffviewFileHistory',
  ':AsyncRun ctags -R *',
  ':colorscheme tokyonight-night | set termguicolors',
  ':%s/\\[[0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\} [0-9]\\{2\\}:[0-9]\\{2\\}:[0-9]\\{2\\}] //g',
  ':lua require("config.commands").search_in_current_func()',
  ':ThemePicker',
  ':MarkdownToPDF',
  ':MarkdownToHTML',
}

function M.execute_cd()
  require('fzf-lua').fzf_exec(cd_list, {
    prompt = 'CD> ',
    actions = {
      ['default'] = function(selected) vim.cmd(selected[1]) end,
    },
  })
end

function M.execute_command()
  require('fzf-lua').fzf_exec(cmd_list, {
    prompt = 'Cmd> ',
    actions = {
      ['default'] = function(selected) vim.cmd(selected[1]) end,
    },
  })
end

-- Grep 当前词/选中文本
function M.grep_current()
  local keyword
  if vim.fn.mode():match('v') then
    vim.cmd('normal! "vy')
    keyword = vim.fn.getreg('v'):gsub('\n', '')
  else
    keyword = vim.fn.expand('<cword>')
  end
  keyword = vim.fn.input('Search: ', keyword)
  if keyword == '' then return end
  require('fzf-lua').grep({ search = keyword })
end

-- ce:全局代码搜索(fzf.vim Rg,预览首行显示所在函数名)
function M.grep_code()
  if vim.fn.exists('*fzf#vim#grep') == 0 then
    require('lazy').load({ plugins = { 'fzf.vim' } })
  end
  local rg_cmd = 'rg --threads 8 -L --with-filename --column --line-number --no-heading --color=always --smart-case -- ' .. vim.fn.shellescape('')
  local func_preview = "sh -c 'file=$(echo \"$1\" | cut -d: -f1); line=$(echo \"$1\" | cut -d: -f2); head -n \"$line\" \"$file\" 2>/dev/null | tac | grep -m1 -E \"^[a-zA-Z_].*\\(\" | sed \"s/^[ \\t]*//\"' _ {}"
  vim.fn['fzf#vim#grep'](rg_cmd, 1, {
    options = '--layout=default --preview ' .. vim.fn.shellescape(func_preview) .. ' --preview-window down:1:border-top',
  }, 1)
end

-- cw:当前 buffer 行搜索(fzf-lua,预览首行显示所在函数名)
function M.buffer_lines()
  local file = vim.fn.expand('%:p')
  if file == '' then return end
  local func_preview = string.format(
    "sh -c 'line=$(echo \"$1\" | cut -d: -f1); head -n \"$line\" %s 2>/dev/null | tac | grep -m1 -E \"^[a-zA-Z_].*\\(\" | sed \"s/^[ \\t]*//\"' _ {}",
    vim.fn.shellescape(file))
  require('fzf-lua').fzf_exec(
    'rg --threads 8 --no-filename --line-number --no-heading --color=never --smart-case -- "" '
    .. vim.fn.shellescape(file),
    {
      prompt = 'Lines> ',
      fzf_opts = {
        ['--layout'] = 'default',
        ['--delimiter'] = ':',
        ['--preview'] = func_preview,
        ['--preview-window'] = 'down:1:border-top',
      },
      actions = {
        ['default'] = function(sel)
          if not sel or #sel == 0 then return end
          local lnum = sel[1]:match('^(%d+):')
          if lnum then vim.cmd('normal! ' .. lnum .. 'Gzz') end
        end,
      },
    }
  )
end

-- panel O:函数体内搜索(直接复用 UpdateCurrentFunc 维护的 b:func_range,不再自行扫签名)
function M.search_in_current_func()
  vim.fn.UpdateCurrentFunc()
  local func_name = vim.b.current_func
  if not func_name or func_name == '' then
    vim.notify('Not inside a function', vim.log.levels.WARN)
    return
  end

  local range = vim.b.func_range
  -- range[2] == range[1] 合法:单行函数 void f(void) { ... } 的范围就是 [l, l]
  if not range or #range ~= 2 or range[2] < range[1] then
    vim.notify('Cannot resolve function range', vim.log.levels.WARN)
    return
  end

  local cursor = vim.api.nvim_win_get_cursor(0)
  if cursor[1] < range[1] or cursor[1] > range[2] then
    vim.notify('Not inside a function', vim.log.levels.WARN)
    return
  end

  local start_0 = range[1] - 1
  local lines = vim.api.nvim_buf_get_lines(0, start_0, range[2], false)
  if #lines == 0 then
    vim.notify('Empty function body', vim.log.levels.WARN)
    return
  end

  local fzf_items = {}
  for i, text in ipairs(lines) do
    fzf_items[i] = string.format('%d: %s', start_0 + i, text)
  end

  require('fzf-lua').fzf_exec(fzf_items, {
    prompt = 'FuncSearch [' .. func_name .. ']> ',
    actions = {
      ['default'] = function(selected)
        local lnum = tonumber(selected[1]:match('^(%d+)'))
        if lnum then
          vim.api.nvim_win_set_cursor(0, { lnum, 0 })
          vim.cmd('normal! zz')
        end
      end,
    },
  })
end

-- 删除包含关键词的行
function M.delete_lines_keyword()
  local default = vim.fn.expand('<cword>')
  local kw = vim.fn.input('Delete lines containing: ', default)
  if kw == '' then
    print('Cancelled')
    return
  end
  vim.cmd('normal! m`')
  vim.cmd('g/' .. vim.fn.escape(kw, '/') .. '/d')
  print("Deleted lines containing '" .. kw .. "'")
end

-- Markdown → PDF/HTML
function M.markdown_to_pdf()
  if vim.bo.filetype ~= 'markdown' then
    vim.api.nvim_err_writeln('Not a markdown file')
    return
  end
  local src = vim.fn.expand('%:p')
  local dst = vim.fn.expand('%:p:r') .. '.pdf'
  vim.cmd('write')
  print('Converting to PDF...')
  vim.fn.system(string.format(
    'pandoc %s -o %s --pdf-engine=xelatex -V mainfont="DejaVu Serif"'
    .. ' -V monofont="DejaVu Sans Mono" -V CJKmainfont="Noto Sans CJK SC"'
    .. ' -V geometry:margin=2.5cm --toc --toc-depth=3'
    .. ' --highlight-style=tango --number-sections',
    vim.fn.shellescape(src), vim.fn.shellescape(dst)
  ))
  if vim.v.shell_error == 0 then print('Done: ' .. dst)
  else vim.api.nvim_err_writeln('PDF conversion failed') end
end

function M.markdown_to_html()
  if vim.bo.filetype ~= 'markdown' then
    vim.api.nvim_err_writeln('Not a markdown file')
    return
  end
  local src = vim.fn.expand('%:p')
  local dst = vim.fn.expand('%:p:r') .. '.html'
  vim.cmd('write')
  print('Converting to HTML...')
  vim.fn.system(string.format(
    'pandoc %s -o %s --standalone --toc --toc-depth=3'
    .. ' --highlight-style=tango --number-sections'
    .. ' --metadata title="%s"',
    vim.fn.shellescape(src), vim.fn.shellescape(dst),
    vim.fn.expand('%:t:r')
  ))
  if vim.v.shell_error == 0 then print('Done: ' .. dst)
  else vim.api.nvim_err_writeln('HTML conversion failed') end
end

-- 注册用户命令
vim.api.nvim_create_user_command('Rg', function(opts)
  local query = opts.args or ''
  if query == '' then
    require('fzf-lua').live_grep_native()
  else
    require('fzf-lua').grep({ search = query })
  end
end, { bang = true, nargs = '*' })

vim.api.nvim_create_user_command('MarkdownToPDF', M.markdown_to_pdf, {})
vim.api.nvim_create_user_command('MarkdownToHTML', M.markdown_to_html, {})

-- 后台串行 git: reset → pull → status（不阻塞 UI）
function M.git_reset_pull()
  local root = vim.fn.systemlist('git -C ' .. vim.fn.shellescape(vim.fn.expand('%:p:h')) .. ' rev-parse --show-toplevel 2>/dev/null')[1]
  if not root or root == '' then
    root = vim.fn.getcwd()
  end

  local stderr = {}
  vim.notify('git reset --hard HEAD~4 ...', vim.log.levels.INFO)
  vim.fn.jobstart({ 'git', '-C', root, 'reset', '--hard', 'HEAD~4' }, {
    stderr_buffered = true,
    on_stderr = function(_, data) if data then vim.list_extend(stderr, data) end end,
    on_exit = function(_, code)
      if code ~= 0 then
        local msg = table.concat(stderr, ''):gsub('\n+$', '') or ''
        if msg == '' then msg = 'exit ' .. code end
        vim.schedule(function()
          vim.notify('git reset failed: ' .. msg, vim.log.levels.ERROR)
        end)
        return
      end
      vim.schedule(function()
        vim.notify('git pull ...', vim.log.levels.INFO)
      end)

      stderr = {}
      vim.fn.jobstart({ 'git', '-C', root, 'pull' }, {
        stderr_buffered = true,
        on_stderr = function(_, data) if data then vim.list_extend(stderr, data) end end,
        on_exit = function(_, code2)
          vim.schedule(function()
            if code2 == 0 then
              vim.cmd('Git status')
            else
              local msg2 = table.concat(stderr, ''):gsub('\n+$', '') or ''
              if msg2 == '' then msg2 = 'exit ' .. code2 end
              vim.notify('git pull failed: ' .. msg2, vim.log.levels.ERROR)
            end
          end)
        end,
      })
    end,
  })
end

return M
