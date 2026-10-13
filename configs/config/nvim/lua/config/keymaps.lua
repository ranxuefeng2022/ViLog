-- 键映射

local cmd = require('config.commands')
local map = vim.keymap.set

-- ============================================================
-- Leader 快捷键 (fzf-lua 相关键位在 plugins/fzf.lua 的 keys 中定义)
-- ============================================================

-- flash 跳转:<leader>j/k/i 即按即开
-- 不映射 <leader>l,否则会与 <leader>la/lf/lh 前缀竞争,每次多等 timeoutlen
map('n', '<leader>j',  function() require('flash').jump() end, { desc = 'Flash jump' })
map('n', '<leader>k',  function() require('flash').jump() end, { desc = 'Flash jump' })
map('n', '<leader>i',  function() require('flash').jump() end, { desc = 'Flash jump' })

map('n', '<leader>ba', '<Cmd>bufdo bd<CR>',                    { desc = 'Close all buffers' })
map('n', '<leader>pp', '<Cmd>setlocal paste!<CR>',             { desc = 'Toggle paste' })
map('n', '<leader>L',  function() cmd.load_tags() end,         { desc = 'Load tags' })
map('n', '<leader>cd', '<Cmd>cd %:p:h<Bar>pwd<CR>',            { desc = 'CD to file dir' })
map('n', '<leader>e',  function() cmd.toggle_statusline() end, { desc = 'Toggle statusline' })
map('n', '<leader>g',  function() cmd.grep_current() end,      { desc = 'Grep current word' })
map('x', '<leader>g',  function() cmd.grep_current() end,      { desc = 'Grep selection' })
map('n', '<leader>d',  function() cmd.delete_lines_keyword() end, { desc = 'Delete lines with keyword' })

-- ============================================================
-- 删除到黑洞寄存器
-- ============================================================
map('n', 'd', '"_d')
map('n', 'D', '"_D')
map('n', 'x', '"_x')
map('v', 'd', '"_d')
map('v', 'x', '"_x')

-- ============================================================
-- 插入模式移动 (Alt + hjkl)
-- ============================================================
map('i', '<A-h>', '<left>')
map('i', '<A-l>', '<right>')
map('i', '<A-j>', '<down>')
map('i', '<A-k>', '<up>')

-- ============================================================
-- 撤销 + 自动保存
-- ============================================================
map('n', 'u', '<Cmd>undo<Bar>write<CR>', { silent = true })

-- ============================================================
-- 可视模式
-- ============================================================
map('v', '<', '<gv')
map('v', '>', '>gv')
map('v', '$', '$h')

-- ============================================================
-- 退出 / 快速保存
-- ============================================================
map('n', 'Z', 'ZZ')
map('i', 'jj', '<Esc>')

-- ============================================================
-- 命令行
-- ============================================================
map('c', '<C-A>', '<Home>')
map('c', '<C-E>', '<End>')
map('c', '<C-K>', '<C-U>')

-- ============================================================
-- 搜索导航
-- ============================================================
map('', '<Rightmouse>', '<Leftmouse>E#')
map('n', '#', '#N')
map('n', 'n', 'nzzzv')
map('n', 'N', 'Nzzzv')

-- ============================================================
-- 命令模式入口
-- ============================================================
map('n', '<C-Space>', ':')
map('n', ';', ':')
map('v', ';', ':')
map('i', '<C-Space>', 'coc#refresh()', { expr = true })

-- fzf 命令面板（多列浮动窗口，按字母直接执行）
map('n', ',', function()
  -- 在打开面板前就计算好 git 根目录，避免浮动窗口关闭后上下文丢失
  local file_dir = vim.fn.expand('%:p:h')
  local git_cwd = vim.fn.getcwd()
  if file_dir ~= '' then
    local root = vim.fn.systemlist('git -C ' .. vim.fn.shellescape(file_dir) .. ' rev-parse --show-toplevel 2>/dev/null')[1]
    if root and root ~= '' and vim.v.shell_error == 0 then git_cwd = root end
  end

  local sections = {
    { title = 'fzf-lua', cmds = {
      { 'a', 'Files',      '搜索文件',     function() require('fzf-lua').files({ winopts = { preview = { hidden = true } } }) end },
      { 'b', 'Colors',     'colorscheme',  'FzfLua colorschemes' },
      { 'c', 'Commands',   '查看命令',     function() require('fzf-lua').commands({ winopts = { preview = { hidden = true } } }) end },
      { 'd', 'Helptags',   '搜索帮助',     'FzfLua helptags' },
      { 'e', 'GrepCode',   '代码搜索',     function() cmd.grep_code() end },
      { 'f', 'Files',      '搜索文件',     'Files' },
      { 'g', 'Buffers',    '切换buffer',   function() require('fzf-lua').buffers({ winopts = { preview = { hidden = true } } }) end },
    }},
    { title = 'fzf.vim', cmds = {
      { 'h', 'Registers',  '寄存器',       'FzfLua registers' },
      { 'i', 'Diffview',   'diff视图',     'DiffviewOpen' },
      { 'j', 'Rg',         'ripgrep',      function()
        if vim.fn.exists('*fzf#vim#grep') == 0 then require('lazy').load({ plugins = { 'fzf.vim' } }) end
        vim.fn['fzf#vim#grep'](
          'rg -L --threads 8 --column --line-number --no-heading --color=always --smart-case -- ' .. vim.fn.shellescape(''),
          1, vim.empty_dict())
      end },
      { 'k', 'BLines',     'buffer行',     'BLines' },
      { 'l', 'BTags',      'buffer tags',  'BTags' },
      { 'm', 'Maps',       '快捷键',       'Maps' },
      { 'w', 'BufLines',   'buffer行搜索', function() cmd.buffer_lines() end },
      { 'r', 'Buffers',    '切换buffer',   'Buffers' },
    }},
    { title = 'Git', cmds = {
      { 'n', 'GitStatus',  'git status',   'Git' },
      { 'o', 'Commits',    'git log',      'FzfLua git_commits' },
      { 'p', 'BCommits',   '文件log',      'FzfLua git_bcommits' },
      { 'q', 'GitFiles',   'git文件',      'FzfLua git_files' },
      { 's', 'FileHistory','文件历史',     'DiffviewFileHistory' },
      { 'u', 'Blame',      'git blame',    'BlameToggle' },
      { 'A', 'HunkPreview','预览hunk',     'Gitsigns preview_hunk' },
      { 'B', 'HunkDiff',   'hunk diff',    'Gitsigns diffthis' },
      { 'C', 'GV',         'git graph',    'GV' },
      { 'D', 'StageHunk',  '暂存hunk',     'Gitsigns stage_hunk' },
      { 'E', 'ResetHunk',  '重置hunk',     'Gitsigns reset_hunk' },
      { 'F', 'StageBuf',   '暂存buffer',   'Gitsigns stage_buffer' },
      { 'G', 'ResetBuf',   '重置buffer',   'Gitsigns reset_buffer' },
    }},
    { title = 'Misc', cmds = {
      { 'J', 'ThemePicker',  '主题选择',       'ThemePicker' },
      { 'O', 'FuncSearch',   '函数内搜索',     function() cmd.search_in_current_func() end },
      { 't', 'Terminal',     '打开终端',       function() vim.cmd('ToggleTerm') end },
      { 'H', 'GenTags',      '生成tags',       function() cmd.generate_tags() end },
      { 'I', 'DelTags',      '删除tags',       function() cmd.generate_tags_full() end },
    }},
  }

  local cmd_map = {}
  for _, sec in ipairs(sections) do
    for _, c in ipairs(sec.cmds) do
      cmd_map[c[1]] = c[4]
    end
  end

  local function dw(s) return vim.fn.strdisplaywidth(s) end
  local function rpad(s, w) return s .. string.rep(' ', math.max(0, w - dw(s))) end

  local col_name_w, col_desc_w = 12, 14
  local col_entry_w = 1 + 1 + 2 + col_name_w + 1 + col_desc_w
  local sep = ' │ '
  local max_rows = 0
  for _, sec in ipairs(sections) do
    if #sec.cmds > max_rows then max_rows = #sec.cmds end
  end

  local lines = {}
  local header = ''
  for i, sec in ipairs(sections) do
    local title = ' ' .. sec.title .. ' '
    local half = math.floor((col_entry_w - dw(title)) / 2)
    local h = string.rep('─', half) .. title .. string.rep('─', col_entry_w - dw(title) - half)
    header = header .. (i > 1 and sep or '') .. h
  end
  table.insert(lines, header)

  for row = 1, max_rows do
    local line = ''
    for col, sec in ipairs(sections) do
      local entry = string.rep(' ', col_entry_w)
      if row <= #sec.cmds then
        local c = sec.cmds[row]
        entry = string.format(' %s  %s %s', c[1], rpad(c[2], col_name_w), rpad(c[3], col_desc_w))
      end
      line = line .. (col > 1 and sep or '') .. rpad(entry, col_entry_w)
    end
    table.insert(lines, line)
  end

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, true, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].bufhidden = 'wipe'

  local width = dw(lines[1]) + 2
  local height = #lines + 2
  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor',
    width = math.min(width, vim.o.columns - 2),
    height = math.min(height, vim.o.lines - 4),
    row = math.max(1, math.floor((vim.o.lines - height) / 2)),
    col = math.max(0, math.floor((vim.o.columns - width) / 2)),
    style = 'minimal',
    border = 'rounded',
  })

  vim.cmd('redraw')
  local ok, key = pcall(vim.fn.getcharstr)
  pcall(vim.api.nvim_win_close, win, true)
  if not ok then return end

  if key == '/' or key == '\t' then
    -- 搜索模式：用 fzf-lua 模糊过滤
    local all_cmds = {}
    local items = {}
    for _, sec in ipairs(sections) do
      for _, c in ipairs(sec.cmds) do
        table.insert(all_cmds, c)
        table.insert(items, string.format('%s\t%-14s %-14s [%s]', c[1], c[2], c[3], sec.title))
      end
    end
    require('fzf-lua').fzf_exec(items, {
      prompt = 'Search> ',
      fzf_opts = {
        ['--delimiter'] = '\t',
        ['--with-nth'] = '2..',
        ['--layout'] = 'default',
        ['--no-preview'] = '',
      },
      actions = {
        ['default'] = function(sel)
          if not sel or #sel == 0 then return end
          local letter = sel[1]:match('^(%S+)')
          for _, c in ipairs(all_cmds) do
            if c[1] == letter then
                  local cmd = c[4]
                  if type(cmd) == 'function' then
                    cmd()
                  elseif cmd:find('^FzfLua git_') then
                    local fn = cmd:match('^FzfLua (%S+)')
                    require('fzf-lua')[fn]({ cwd = git_cwd })
                  elseif cmd:find('^FzfLua ') then
                    local fn = cmd:match('^FzfLua (%S+)')
                    require('fzf-lua')[fn]()
                  else
                    vim.cmd(cmd)
                  end
                  return
                end
          end
        end,
      },
    })
  elseif cmd_map[key] then
    local c = cmd_map[key]
    if type(c) == 'function' then
      c()
    elseif c:find('^FzfLua git_') then
      local fn = c:match('^FzfLua (%S+)')
      require('fzf-lua')[fn]({ cwd = git_cwd })
    elseif c:find('^FzfLua ') then
      local fn = c:match('^FzfLua (%S+)')
      require('fzf-lua')[fn]()
    else
      vim.cmd(c)
    end
  end
end)

-- ============================================================
-- 窗口大小调整
-- <Cmd> 形式不进入命令行，避免 noice 在底部闪现 cmdline 浮窗
-- 终端按 Shift+字母 发送的就是大写字节，nvim 也会把 <S-k> 规范化成 K，
-- 直接写大写字母，避免与 coc 等插件的 K 映射隐式撞键
-- ============================================================
map('n', 'H', '<Cmd>vertical resize -5<CR>')
map('n', 'L', '<Cmd>vertical resize +5<CR>')
map('n', 'J', '<Cmd>resize +5<CR>')
map('n', 'K', '<Cmd>resize -5<CR>')

-- ============================================================
-- 平滑滚动
-- ============================================================
local function scroll_lines(lines)
  local key = lines > 0 and '\\<C-e>' or '\\<C-y>'
  vim.cmd(('execute "normal! %d%s"'):format(math.abs(lines), key))
end
map('n', '<C-j>', function() scroll_lines(6) end,  { desc = 'Scroll down' })
map('n', '<C-k>', function() scroll_lines(-6) end, { desc = 'Scroll up' })
map('n', '<C-e>', function() scroll_lines(6) end,  { desc = 'Scroll down' })

-- ============================================================
-- 剪贴板（写/读 cvbuf.c）
-- ============================================================
-- <Cmd> 不自动加 '<,'> 范围，visual 写文件需显式行号
map('v', '<C-c>', function()
  local s = math.min(vim.fn.line('v'), vim.fn.line('.'))
  local e = math.max(vim.fn.line('v'), vim.fn.line('.'))
  vim.cmd(s .. ',' .. e .. 'w! ~/.vim/cvbuf.c')
end)
map('n', '<C-v>', '<Cmd>r ~/.vim/cvbuf.c<CR>')

-- ============================================================
-- Flash 跳转
-- ============================================================
map('',  's', '<Nop>')
map('',  'S', '<Nop>')
map('n', 's', function() require('flash').jump() end,       { desc = 'Flash jump' })
map('n', 'S', function() require('flash').treesitter() end, { desc = 'Flash treesitter' })

-- ============================================================
-- 可视模式行移动（Shift+j / Shift+k）
-- ============================================================
map('v', 'J', ":m '>+1<CR>gv=gv")
map('v', 'K', ":m '<-2<CR>gv=gv")

-- ============================================================
-- 跳转
-- ============================================================
map('',  'f', '<Nop>')
map('n', 'f', '<C-o>zz')
map('n', 'W', '<C-i>zz')
map('n', 'F', '[[k2wzz')
map('n', 'a', '<C-]>')

-- ============================================================
-- 搜索(取光标词/选区 → :Rg 命令,commands.lua 定义)
-- 用 nvim_cmd 的 args 列表传参,带空格/引号的选区也能干净送达;
-- 不要用 shellescape 拼 :命令 参数——那是 shell 转义,引号会混进搜索词
-- ============================================================
local function run_rg(kw)
  if kw and kw ~= '' then
    vim.api.nvim_cmd({ cmd = 'Rg', args = { kw } }, {})
  end
end

map('n', 'R', function() run_rg(vim.fn.expand('<cword>')) end)
map('v', 'R', function()
  vim.cmd('normal! "zy')
  run_rg(vim.fn.getreg('z'):gsub('\n', ''))
end)

map('n', '<leader>s', function() run_rg(vim.fn.expand('<cword>') .. ' = ') end, { desc = 'Grep cword + " = "' })
map('v', '<leader>s', function()
  vim.cmd('normal! "zy')
  run_rg(vim.fn.getreg('z'):gsub('\n', '') .. ' = ')
end, { desc = 'Grep selection + " = "' })

-- ============================================================
-- 高亮色码 / 搜索选中
-- ============================================================
map('v', ',', function() require('config.keyword-highlight').pick() end)
map('v', '#', 'y/<C-r>"<CR>N', { silent = true })

-- ============================================================
-- F1/F2 水平滚动
-- ============================================================
map('',  '<F1>', '<Nop>')
map('',  '<F2>', '<Nop>')
map('n', '<F1>', '15zh')
map('n', '<F2>', '15zl')

-- ============================================================
-- z 映射
-- ============================================================
map('v', 'zf', 'zfzf')

-- ============================================================
-- 插入模式片段
-- ============================================================
map('i', 'El', '->')
map('i', 'E1', '()<esc>i')
map('i', 'E2', '[]<esc>i')
map('i', 'E3', '{}<esc>i')
map('i', 'E4', '{<esc>o}<esc>O')

-- ============================================================
-- 可视模式包裹
-- ============================================================
map('v', 'E1', [[<esc>`>a)<esc>`<i(<esc>]])
map('v', 'E2', [[<esc>`>a]<esc>`<i[<esc>]])
map('v', 'E3', [[<esc>`>a}<esc>`<i{<esc>]])
map('v', 'E4', [[<esc>`>a"<esc>`<i"<esc>]])
map('v', 'E5', [[<esc>`>a'<esc>`<i'<esc>]])

-- ============================================================
-- t/q 快捷命令
-- ============================================================
map('n', 't', function() cmd.execute_cd() end,     { desc = 'CD menu' })
map('n', 'q', function() cmd.execute_command() end, { desc = 'Command menu' })

-- ============================================================
-- c 前缀快捷键
-- ============================================================
map('n', 'c',  '<Nop>')
map('v', 'C',  '"bp')

-- 可视模式：y/c 复制选中到 b 寄存器（供下面的 C 粘贴）并写入系统剪贴板
-- copy_to_clipboard 双写：+寄存器（本地 macOS/WSL/Windows）+ OSC52（SSH 远程/Windows Terminal）
map('v', 'y', '"by<Cmd>lua require("config.commands").copy_to_clipboard(vim.fn.getreg("b"))<CR>')
map('v', 'c', '"by<Cmd>lua require("config.commands").copy_to_clipboard(vim.fn.getreg("b"))<CR>')

map('n', 'Y',  've<Plug>OSCYankVisual')
map('n', 'cc', '<Cmd>TagbarToggle<CR>',             { desc = 'Tagbar' })
map('n', 'cs', '<Cmd>sp<CR>')
map('n', 'cv', '<Cmd>vsp<CR>')
map('n', 'ca', '<Cmd>Yazi<CR>',                     { desc = 'Yazi' })
map('n', 'cq', '<Cmd>copen 20<CR>')
map('n', 'e',  '<Plug>(expand_region_expand)')
map('n', '0',  '^')

-- 复制当前函数名
map('n', 'cl', function() cmd.yank_current_func() end, { desc = 'Yank function name' })

-- ============================================================
-- Markdown
-- ============================================================
map('n', 'cmp', '<Cmd>MarkdownToPDF<CR>',  { desc = 'MD → PDF' })
map('n', 'cmh', '<Cmd>MarkdownToHTML<CR>', { desc = 'MD → HTML' })

-- ============================================================
-- Alt + 滚轮 水平滚动
-- ============================================================
map('n', '<M-ScrollWheelUp>',   '5zh')
map('n', '<M-ScrollWheelDown>', '5zl')
map('i', '<M-ScrollWheelUp>',   '<Esc>5zh')
map('i', '<M-ScrollWheelDown>', '<Esc>5zl')
map('v', '<M-ScrollWheelUp>',   '5zh')
map('v', '<M-ScrollWheelDown>', '5zl')
