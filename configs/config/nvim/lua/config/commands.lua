-- 用户命令 + 工具函数

local M = {}

-- 追踪当前光标所在的 C/C++ 函数名 (Vimscript 实现，确保 b:current_func 可被 statusline %{...} 读取)
-- 优化：先尝试用 searchpairpos('{','',b:nr,'bWn') 找到函数体起点，再做小范围正则扫描
vim.cmd([[
function! UpdateCurrentFunc()
    let lnum = line('.')
    if exists('b:current_func_lnum') && b:current_func_lnum == lnum
        return
    endif

    " 快速路径：若已记录当前函数起点+终点，且光标仍在范围内，直接返回
    if exists('b:func_range') && !empty(b:func_range)
        \ && lnum >= b:func_range[0] && lnum <= b:func_range[1]
        \ && exists('b:current_func_lnum')
        let b:current_func_lnum = lnum
        return
    endif

    " 用 search() 向上找函数签名行：C 实现的正则引擎扫到即停，
    " 替代原先最多 2000 次 getline+match 的 VimL 逐行循环（快一个数量级）
    let start = max([1, lnum - 2000])
    let fname = ''
    let reserved = ['if', 'else', 'elseif', 'return', 'for', 'while', 'switch']
    let func_line = 0
    let save_view = winsaveview()
    " 从行尾起回搜，保证光标所在行本身也能被匹配（与原 range(lnum, start, -1) 一致）
    call cursor(lnum, col('$'))
    while search('\v^\s*(\w+\s+)+\w+\s*\(', 'bW', start) > 0
        let line_text = getline('.')
        if line_text =~# '^\s*\(if\|else\>\)'
            continue
        endif
        let fname = matchstr(line_text, '\v\w+\ze\s*\(')
        if index(reserved, fname) != -1
            continue
        endif
        let func_line = line('.')
        break
    endwhile
    if !exists('b:current_func') || b:current_func !=# fname
        let b:current_func = fname
        redrawstatus
    endif

    " 缓存函数体范围 [start_line, end_line]，下次光标若在范围内即跳过扫描
    " searchpair 需光标位于开括号上/内；直接从签名行起调会把函数体自身的
    " { 计为嵌套层导致配对失败（旧实现因此一直走 +500 兜底），先跳到 {
    if func_line > 0
        call cursor(func_line, 1)
        let end_line = 0
        if search('{', 'W') > 0
            let end_line = searchpair('{', '', '}', 'nW')
        endif
        if end_line > 0
            let b:func_range = [func_line, end_line]
        else
            let b:func_range = [func_line, func_line + 500]
        endif
    else
        let b:func_range = []
    endif
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

-- 删除 visual match
function M.delete_visual_match()
  local line_start = vim.fn.getpos("'<")[2]
  local col_start = vim.fn.getpos("'<")[3]
  local line_end = vim.fn.getpos("'>")[2]
  local col_end = vim.fn.getpos("'>")[3]
  local lines = vim.fn.getline(line_start, line_end)
  if #lines == 0 then return end
  lines[#lines] = lines[#lines]:sub(1, col_end)
  lines[1] = lines[1]:sub(col_start)
  local selected = table.concat(lines, '\n')
  for _, match in ipairs(vim.fn.getmatches()) do
    if match.pattern == selected then
      vim.fn.matchdelete(match.id)
      print('Deleted match ID: ' .. match.id)
      return
    end
  end
  print('No match found for selected text.')
end

-- XTerm 256 色高亮
local xterm_colors = nil

local function ensure_xterm_colors()
  if xterm_colors then return end
  xterm_colors = {
    '#000000','#800000','#008000','#808000','#000080','#800080','#008080','#c0c0c0',
    '#808080','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff',
  }
  local cube = { 0, 95, 135, 175, 215, 255 }
  for r = 0, 5 do
    for g = 0, 5 do
      for b = 0, 5 do
        xterm_colors[#xterm_colors + 1] = string.format('#%02x%02x%02x', cube[r + 1], cube[g + 1], cube[b + 1])
      end
    end
  end
  for i = 0, 23 do
    local v = 8 + i * 10
    xterm_colors[#xterm_colors + 1] = string.format('#%02x%02x%02x', v, v, v)
  end
end

function M.highlight_with_color_code(color_code, opts)
  opts = opts or {}
  ensure_xterm_colors()
  color_code = tonumber(color_code)
  if not color_code or color_code < 0 or color_code >= #xterm_colors then
    vim.api.nvim_err_writeln('Invalid color code: ' .. tostring(color_code))
    return
  end
  local start_line = opts.firstline or vim.fn.line("'<")
  local end_line = opts.lastline or vim.fn.line("'>")
  local start_col = vim.fn.col("'<") - 1
  local end_col = vim.fn.col("'>") - 1
  local text = vim.fn.getline(start_line):sub(start_col + 1, end_col + 1)
  local hl_group = 'MyColor' .. color_code
  if vim.o.termguicolors then
    vim.cmd('highlight ' .. hl_group .. ' guibg=' .. xterm_colors[color_code + 1])
  else
    vim.cmd('highlight ' .. hl_group .. ' ctermbg=' .. color_code)
  end
  vim.fn.matchadd(hl_group, text)
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

function M.search_in_current_func()
  -- 确保 current_func 已更新
  vim.fn.UpdateCurrentFunc()
  local func_name = vim.b.current_func
  if not func_name or func_name == '' then
    vim.notify('Not inside a function', vim.log.levels.WARN)
    return
  end

  local cursor = vim.api.nvim_win_get_cursor(0)

  -- 从光标位置向上搜索函数签名行
  local saved = vim.fn.getcurpos()
  vim.fn.cursor(cursor[1], #vim.fn.getline(cursor[1]))
  local sig_line = nil
  while true do
    if vim.fn.search([[\v^\s*(\w+\s+)+\w+\s*\(]], 'bW') == 0 then break end
    local lt = vim.fn.getline('.')
    if not lt:find('^%s*#') and not lt:find(';%s*$') and lt:find(func_name .. '%s*%(') then
      sig_line = vim.fn.line('.')
      break
    end
  end
  vim.fn.setpos('.', saved)

  if not sig_line then
    vim.notify('Not inside a function', vim.log.levels.WARN)
    return
  end

  -- 在签名行或往下最多 30 行找 {，利用 Vim 的 % 跳转到匹配的 }
  for scan = sig_line, math.min(sig_line + 30, vim.fn.line('$')) do
    local text = vim.fn.getline(scan)
    local col = text:find('{', 1, true)
    if col then
      vim.fn.cursor(scan, col)
      vim.cmd('normal! %')
      local end_line = vim.fn.line('.')

      -- 恢复光标
      vim.api.nvim_win_set_cursor(0, cursor)

      local start_0 = sig_line - 1
      local end_0 = end_line - 1

      if start_0 > end_0 or cursor[1] - 1 < start_0 or cursor[1] - 1 > end_0 then
        vim.notify('Function range does not contain cursor', vim.log.levels.WARN)
        return
      end

      local lines = vim.api.nvim_buf_get_lines(0, start_0, end_0 + 1, false)
      if #lines == 0 then
        vim.notify('Empty function body', vim.log.levels.WARN)
        return
      end

      local fzf_items = {}
      for i, text in ipairs(lines) do
        fzf_items[i] = string.format('%d: %s', start_0 + i, text)
      end

      require('fzf-lua').fzf_exec(fzf_items, {
        prompt = 'FuncSearch> ',
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
      return
    end
  end

  vim.notify('Cannot find function body', vim.log.levels.WARN)
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

vim.api.nvim_create_user_command('HighlightWithColorCode', function(opts)
  M.highlight_with_color_code(opts.args)
end, { range = true, nargs = 1 })

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
