-- 用户命令 + 工具函数

local M = {}

-- 追踪当前光标所在的 C/C++ 函数名 (Vimscript 实现，确保 b:current_func 可被 statusline %{...} 读取)
vim.cmd([[
function! UpdateCurrentFunc()
    let lnum = line('.')
    if exists('b:current_func_lnum') && b:current_func_lnum == lnum
        return
    endif
    let start = max([1, lnum - 2000])
    let fname = ''
    let reserved = ['if', 'else', 'elseif', 'return', 'for', 'while', 'switch']
    for i in range(lnum, start, -1)
        let line_text = getline(i)
        if line_text =~# '^\s*\(if\|else\>\)'
            continue
        endif
        if line_text =~# '^\s*\%(\w\+\s\+\)\+\w\+\s*('
            let fname = matchstr(line_text, '\v\w+\ze\s*\(')
            if index(reserved, fname) != -1
                continue
            endif
            break
        endif
    endfor
    if !exists('b:current_func') || b:current_func !=# fname
        let b:current_func = fname
        redrawstatus
    endif
    let b:current_func_lnum = lnum
endfunction
]])

-- Lua wrapper（供 keymap 调用）
function M.update_current_func()
  vim.fn.UpdateCurrentFunc()
end

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
  local tags_opt = {}
  if vim.fn.filereadable(cwd .. '/tags_linux') == 1 then
    tags_opt[#tags_opt + 1] = './tags_linux'
  end
  tags_opt[#tags_opt + 1] = './tags'
  tags_opt[#tags_opt + 1] = 'tags;'
  local val = table.concat(tags_opt, ',')
  vim.schedule(function() vim.o.tags = val end)
end

-- 智能跳转: LSP 优先 → tags 兜底
function M.smart_goto_definition()
  -- 尝试 LSP（有 definition 能力的客户端）
  local ok, clients = pcall(vim.lsp.get_clients, { bufnr = 0 })
  if ok and clients then
    for _, c in ipairs(clients) do
      if c.server_capabilities and c.server_capabilities.definitionProvider then
        vim.lsp.buf.definition()
        return
      end
    end
  end

  -- 无 LSP: tag_jump（单匹配直接跳，多匹配弹 fzf 全屏选择）
  M.tag_jump()
end

-- 跳转到 tag 的 cmd 字段（行号或搜索模式）
function M._jump_tag_cmd(cmd)
  if type(cmd) == 'number' then
    vim.fn.cursor(cmd, 0)
  elseif type(cmd) == 'string' then
    if cmd:sub(1, 1) == '/' then
      local pat = cmd:sub(2)
      if pat:sub(-1) == '/' then pat = pat:sub(1, -2) end
      vim.fn.search(pat, 'w')
    elseif tonumber(cmd) then
      vim.fn.cursor(tonumber(cmd), 0)
    end
  end
end

-- fzf 全屏 tag 跳转（单匹配直接跳，多匹配弹 fzf）
function M.tag_jump(word)
  word = word or vim.fn.expand('<cword>')
  if word == '' then return end

  local all = vim.fn.taglist(word)
  local exact = {}
  for _, t in ipairs(all) do
    if t.name == word then exact[#exact + 1] = t end
  end
  local matches = #exact > 0 and exact or all

  if #matches == 0 then
    vim.notify('No tag: ' .. word, vim.log.levels.WARN)
    return
  end

  -- 单匹配：直接跳
  if #matches == 1 then
    local t = matches[1]
    vim.cmd('edit ' .. vim.fn.fnameescape(t.filename))
    M._jump_tag_cmd(t.cmd)
    vim.cmd('normal! zz')
    return
  end

  -- 多匹配：fzf 全屏选择
  local cwd = vim.fn.getcwd()
  local items = {}
  for i, t in ipairs(matches) do
    local rel = t.filename
    if rel:sub(1, #cwd + 1) == cwd .. '/' then
      rel = rel:sub(#cwd + 2)
    end
    items[#items + 1] = string.format('%d\t%s\t%s\t%s', i, t.kind or '?', t.name, rel)
  end

  require('fzf-lua').fzf_exec(items, {
    prompt = 'Tag "' .. word .. '"> ',
    fzf_opts = { ['--no-multi'] = '' },
    actions = {
      default = function(sel)
        if not sel then return end
        local idx = tonumber(sel[1]:match('^(%d+)'))
        local t = matches[idx]
        if t then
          vim.cmd('edit ' .. vim.fn.fnameescape(t.filename))
          M._jump_tag_cmd(t.cmd)
          vim.cmd('normal! zz')
        end
      end,
    },
  })
end

-- Manifest: 每行 "mtime path"
local function load_manifest(cwd)
  local f = io.open(cwd .. '/.tags_manifest', 'r')
  if not f then return nil end
  local m = {}
  for line in f:lines() do
    local mt, p = line:match('^(%d+) (.+)$')
    if mt then m[p] = tonumber(mt) end
  end
  f:close()
  return m
end

local function save_manifest(cwd, files, mtimes)
  local f = io.open(cwd .. '/.tags_manifest', 'w')
  if not f then return end
  for _, p in ipairs(files) do
    local mt = mtimes and mtimes[p] or vim.fn.getftime(p)
    if mt and mt >= 0 then f:write(mt .. ' ' .. p .. '\n') end
  end
  f:close()
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

-- 全量生成（首次 / 强制）
function M._full_generate(cwd, files, n, t0, progress, mtimes)
  n = math.min(n, #files)
  local tmpdir = vim.fn.stdpath('cache') .. '/ctags_' .. tostring(os.time())
  vim.fn.mkdir(tmpdir, 'p')

  progress(string.format('Full: %d files, %d jobs...', #files, n))

  local chunk_sz = math.ceil(#files / n)
  local chunks = {}
  for i = 1, n do
    local cp = tmpdir .. '/chunk_' .. i
    local f = io.open(cp, 'w')
    if f then
      for j = (i - 1) * chunk_sz + 1, math.min(i * chunk_sz, #files) do
        f:write(files[j] .. '\n')
      end
      f:close()
      chunks[#chunks + 1] = cp
    end
  end

  local done = 0
  local tag_files = {}
  for i = 1, #chunks do
    tag_files[i] = tmpdir .. '/tags_' .. i
    vim.system(
      { 'ctags', '--languages=C,C++', '--sort=yes', '-L', chunks[i], '-f', tag_files[i] },
      { stdout = false, stderr = false, env = { LC_ALL = 'C' } },
      function()
        done = done + 1
        if done < n then
          progress(string.format('Generating tags... %d/%d (%d%%)', done, n, math.floor(done / n * 100)))
          return
        end

        progress('Merging...')
        local tags_path = cwd .. '/tags'
        local sort_args = { 'sort', '-m', '-o', tags_path }
        for _, tf in ipairs(tag_files) do sort_args[#sort_args + 1] = tf end

        vim.system(sort_args, { stdout = false, env = { LC_ALL = 'C' } }, function()
          vim.schedule(function()
            -- 清理重复的 !_TAG_ 头
            vim.fn.system(string.format(
              "sed -i '1{/^!_TAG_FILE_SORTED/!i\\!_TAG_FILE_SORTED\\t1\\t/0=unsorted, 1=sorted, 2=foldcase/\\n}' %s && sed -i '2,${/^!_TAG_/d}' %s",
              vim.fn.shellescape(tags_path), vim.fn.shellescape(tags_path)
            ))
            vim.fn.system('rm -rf ' .. tmpdir)
            save_manifest(cwd, files, mtimes)
            local cnt = vim.fn.system(
              "grep -cv '^!_TAG_' " .. vim.fn.shellescape(tags_path) .. ' 2>/dev/null'
            ):gsub('\n', '')
            local elapsed = os.time() - t0
            M.load_tags(cwd)
            progress(
              string.format('Tags done: %s entries, %d files, %d jobs, %ds', cnt, #files, n, elapsed),
              true
            )
          end)
        end)
      end
    )
  end
end

-- 增量更新
function M._incremental(cwd, files, changed, removed, n, t0, progress, mtimes)
  local tmpdir = vim.fn.stdpath('cache') .. '/ctags_' .. tostring(os.time())
  vim.fn.mkdir(tmpdir, 'p')
  local tags_path = cwd .. '/tags'
  local filtered_path = tmpdir .. '/tags_filtered'

  progress(string.format('Incremental: %d changed, %d removed', #changed, #removed))

  -- 写入需要从 tags 中移除的文件列表（changed + removed）
  local filter_path = tmpdir .. '/filter_files'
  local ff = io.open(filter_path, 'w')
  if ff then
    for _, f in ipairs(changed) do ff:write(f .. '\n') end
    for _, f in ipairs(removed) do ff:write(f .. '\n') end
    ff:close()
  end

  -- Step 1: awk 过滤掉 changed/removed 文件的旧 tag
  local awk_cmd = string.format(
    "awk -F'\\t' 'BEGIN{while((getline f < \"%s\") > 0) rm[f]=1} !($2 in rm)' %s > %s",
    filter_path, vim.fn.shellescape(tags_path), vim.fn.shellescape(filtered_path)
  )

  vim.system({ 'sh', '-c', awk_cmd }, { stdout = false }, function()
    if #changed == 0 then
      -- 仅有删除，直接替换
      vim.schedule(function()
        vim.fn.system('mv ' .. vim.fn.shellescape(filtered_path) .. ' ' .. vim.fn.shellescape(tags_path))
        vim.fn.system('rm -rf ' .. tmpdir)
        save_manifest(cwd, files, mtimes)
        M.load_tags(cwd)
        local elapsed = os.time() - t0
        progress(
          string.format('Tags updated: -%d removed, %ds', #removed, elapsed),
          true
        )
      end)
      return
    end

    -- Step 2: 对 changed 文件并行生成新 tag
    local n_jobs = math.min(n, #changed)
    local chunk_sz = math.ceil(#changed / n_jobs)
    local chunks = {}
    for i = 1, n_jobs do
      local cp = tmpdir .. '/chunk_' .. i
      local f = io.open(cp, 'w')
      if f then
        for j = (i - 1) * chunk_sz + 1, math.min(i * chunk_sz, #changed) do
          f:write(changed[j] .. '\n')
        end
        f:close()
        chunks[#chunks + 1] = cp
      end
    end

    local done = 0
    local tag_files = {}
    for i = 1, #chunks do
      tag_files[i] = tmpdir .. '/tags_' .. i
      vim.system(
        { 'ctags', '--languages=C,C++', '--sort=yes', '-L', chunks[i], '-f', tag_files[i] },
        { stdout = false, stderr = false, env = { LC_ALL = 'C' } },
        function()
          done = done + 1
          if done < n_jobs then return end

          -- Step 3: sort -m 合并 filtered + 新 tag
          progress('Merging...')
          local sort_args = { 'sort', '-m', '-o', tags_path, filtered_path }
          for _, tf in ipairs(tag_files) do sort_args[#sort_args + 1] = tf end

          vim.system(sort_args, { stdout = false, env = { LC_ALL = 'C' } }, function()
            vim.schedule(function()
              vim.fn.system('rm -rf ' .. tmpdir)
              save_manifest(cwd, files, mtimes)
              M.load_tags(cwd)
              local elapsed = os.time() - t0
              progress(
                string.format('Tags updated: %d changed, %d removed, %ds', #changed, #removed, elapsed),
                true
              )
            end)
          end)
        end
      )
    end
  end)
end

-- 入口：ct — linux-master 单独生成 tags_linux，其余生成 tags
function M.generate_tags()
  local cwd = vim.fn.getcwd()
  tags_loaded_dirs[cwd] = nil
  local t0 = os.time()
  local progress = make_progress()
  local has_linux = vim.fn.isdirectory(cwd .. '/linux-master') == 1
  local ncpu = tonumber(vim.fn.system('nproc')) or 4

  -- 构建任务列表
  local tasks = {}
  tasks[#tasks + 1] = {
    name = 'tags',
    fd = string.format(
      'fd -L -e c -e h -e cpp -e hpp -e cxx -e hxx -e S --exclude linux-master . %s',
      vim.fn.shellescape(cwd)),
  }
  if has_linux and vim.fn.filereadable(cwd .. '/tags_linux') ~= 1 then
    tasks[#tasks + 1] = {
      name = 'tags_linux',
      fd = string.format(
        'fd -L -e c -e h -e cpp -e hpp -e cxx -e hxx -e S . %s/linux-master',
        vim.fn.shellescape(cwd)),
    }
  end

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
                  -- 清理重复的 !_TAG_ 头，只保留一个
                  vim.fn.system(string.format(
                    "sed -i '1{/^!_TAG_FILE_SORTED/!i\\!_TAG_FILE_SORTED\\t1\\t/0=unsorted, 1=sorted, 2=foldcase/\\n}' %s && sed -i '2,${/^!_TAG_/d}' %s",
                    vim.fn.shellescape(tag_path), vim.fn.shellescape(tag_path)
                  ))
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
  vim.fn.system('rm -f ' .. cwd .. '/tags ' .. cwd .. '/tags_linux ' .. cwd .. '/.tags_manifest*')
  vim.notify('Deleted tags + tags_linux', vim.log.levels.INFO, { title = 'Tags' })
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

vim.api.nvim_create_user_command('AIChat', function()
  require('config.ai-chat').open()
end, {})

vim.api.nvim_create_user_command('AIChatSelection', function()
  require('config.ai-chat').open_with_selection()
end, { range = true })

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

-- 加载 fzf.vim 后直接调用 fzf#vim#grep（等同 ce 快捷键）
function M.grep_code()
  require('lazy').load({ plugins = { 'fzf.vim' } })
  local rg_cmd = 'rg --threads 8 -L --with-filename --column --line-number --no-heading --color=always --smart-case -- ' .. vim.fn.shellescape('')
  local func_preview = "sh -c 'file=$(echo \"$1\" | cut -d: -f1); line=$(echo \"$1\" | cut -d: -f2); head -n \"$line\" \"$file\" 2>/dev/null | tac | grep -m1 -E \"^[a-zA-Z_].*\\(\" | sed \"s/^[ \\t]*//\"' _ {}"
  vim.fn['fzf#vim#grep'](rg_cmd, 1, {
    options = '--layout=default --preview ' .. vim.fn.shellescape(func_preview) .. ' --preview-window down:1:border-top',
  }, 1)
end

-- feedkeys 触发 cw（fzf-lua 不怕懒加载）
function M.buffer_lines()
  vim.api.nvim_feedkeys('cw', 'm', false)
end

return M
