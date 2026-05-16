-- 键映射

local cmd = require('config.commands')
local map = vim.keymap.set

-- ============================================================
-- Leader 快捷键 (fzf-lua 相关键位在 plugins/fzf.lua 的 keys 中定义)
-- ============================================================

map('n', '<leader>j',  function() require('flash').jump() end, { desc = 'Flash jump' })
map('n', '<leader>k',  function() require('flash').jump() end, { desc = 'Flash jump' })
map('n', '<leader>l',  function() require('flash').jump() end, { desc = 'Flash jump' })
map('n', '<leader>i',  function() require('flash').jump() end, { desc = 'Flash jump' })

map('n', '<leader>ba', ':bufdo bd<CR>',                        { desc = 'Close all buffers' })
map('n', '<leader>pp', ':setlocal paste!<CR>',                 { desc = 'Toggle paste' })
map('n', '<leader>L',  function() cmd.load_tags() end,         { desc = 'Load tags' })
map('n', '<leader>cd', ':cd %:p:h<CR>:pwd<CR>',               { desc = 'CD to file dir' })
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
map('i', '<A-j>', '<down>')
map('i', '<A-k>', '<up>')
map('i', '<A-l>', '<right>')

-- ============================================================
-- 撤销 + 自动保存
-- ============================================================
map('n', 'u', ':u<CR>:w<CR>', { silent = true })

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
-- Neovide 剪贴板
-- ============================================================
if vim.g.neovide then
  map('v', 'r', '"+y')
  map('c', '<S-Space>', '<C-r>+')
  map('i', '<S-Space>', '<C-r>+')
  map('', '<S-Leftmouse>', '<Nop>')
end

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
map('i', '<C-Space>', '<C-n>')

-- fzf 命令面板（多列浮动窗口，按字母直接执行）
map('n', ',', function()
  -- 在打开面板前就计算好 git 根目录，避免浮动窗口关闭后上下文丢失
  local file_dir = vim.fn.expand('%:p:h')
  local git_cwd = vim.fn.getcwd()
  if file_dir ~= '' then
    local root = vim.fn.systemlist('git -C ' .. vim.fn.shellescape(file_dir) .. ' rev-parse --show-toplevel 2>/dev/null')[1]
    if root and root ~= '' and vim.v.shell_error == 0 then git_cwd = root end
  end

  -- ce/cw 快捷键的回调函数（直接调用，不走命令行）
  local ce_fn = function()
    if vim.fn.exists('*fzf#vim#grep') == 0 then
      require('lazy').load({ plugins = { 'fzf.vim' } })
    end
    local rg_cmd = 'rg --threads 8 -L --with-filename --column --line-number --no-heading --color=always --smart-case -- ' .. vim.fn.shellescape('')
    local func_preview = "sh -c 'file=$(echo \"$1\" | cut -d: -f1); line=$(echo \"$1\" | cut -d: -f2); head -n \"$line\" \"$file\" 2>/dev/null | tac | grep -m1 -E \"^[a-zA-Z_].*\\(\" | sed \"s/^[ \\t]*//\"' _ {}"
    vim.fn['fzf#vim#grep'](rg_cmd, 1, {
      options = '--layout=default --preview ' .. vim.fn.shellescape(func_preview) .. ' --preview-window down:1:border-top',
    }, 1)
  end
  local cw_fn = function()
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

  local sections = {
    { title = 'fzf-lua', cmds = {
      { 'a', 'Files',      '搜索文件',     function() require('fzf-lua').files({ winopts = { preview = { hidden = true } } }) end },
      { 'b', 'Colors',     'colorscheme',  'FzfLua colorschemes' },
      { 'c', 'Commands',   '查看命令',     function() require('fzf-lua').commands({ winopts = { preview = { hidden = true } } }) end },
      { 'd', 'Helptags',   '搜索帮助',     'FzfLua helptags' },
      { 'e', 'GrepCode',   '代码搜索',     ce_fn },
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
      { 'w', 'BufLines',   'buffer行搜索', cw_fn },
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
      { 'K', 'KwHighlight',  '关键词着色',     'lua require("config.keyword-highlight").pick()' },
      { 'L', 'KwClear',      '清除高亮',       'lua require("config.keyword-highlight").clear_all()' },
      { 'M', 'KwUndo',       '撤销着色',       'lua require("config.keyword-highlight").undo()' },
      { 'N', 'AIChat',       'AI对话',         'AIChat' },
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
-- ============================================================
map('n', '<S-h>', ':vertical resize -3<CR>')
map('n', '<S-l>', ':vertical resize +3<CR>')
map('n', '<S-j>', ':resize +3<CR>')
map('n', '<S-k>', ':resize -3<CR>')

-- ============================================================
-- 平滑滚动
-- ============================================================
local function scroll_lines(lines)
  local view = vim.fn.winsaveview()
  local height = vim.fn.winheight(0)
  local max_top = math.max(1, vim.fn.line('$') - height + 1)
  view.topline = math.max(1, math.min(view.topline + lines, max_top))
  if view.lnum < view.topline then
    view.lnum = view.topline
  elseif view.lnum > view.topline + height - 1 then
    view.lnum = view.topline + height - 1
  end
  vim.fn.winrestview(view)
end
map('n', '<C-j>', function() scroll_lines(6) end,  { desc = 'Scroll down' })
map('n', '<C-k>', function() scroll_lines(-6) end, { desc = 'Scroll up' })
map('n', '<C-e>', function() scroll_lines(6) end,  { desc = 'Scroll down' })

-- ============================================================
-- 剪贴板（Neovide vs 终端）
-- ============================================================
if vim.g.neovide then
  map('v', '<C-c>', ':w! ~/c/.vim/cvbuf.c<CR>')
  map('n', '<C-v>', ':r ~/c/.vim/cvbuf.c<CR>')
else
  map('v', '<C-c>', ':w! ~/.vim/cvbuf.c<CR>')
  map('n', '<C-v>', ':r ~/.vim/cvbuf.c<CR>')
end

-- ============================================================
-- Flash 跳转
-- ============================================================
map('',  's', '<Nop>')
map('',  'S', '<Nop>')
map('n', 's', function() require('flash').jump() end,       { desc = 'Flash jump' })
map('n', 'S', function() require('flash').treesitter() end, { desc = 'Flash treesitter' })

-- ============================================================
-- 可视模式行移动
-- ============================================================
map('v', '<S-j>', ":m '>+1<CR>gv=gv")
map('v', '<S-k>', ":m '<-2<CR>gv=gv")

-- ============================================================
-- 跳转
-- ============================================================
map('',  'f', '<Nop>')
map('n', 'f', '<C-o>zz')
map('n', 'W', '<C-i>zz')
map('n', 'F', '[[k2wzz')
map('n', 'a', function() cmd.tag_jump() end)
map('n', '<S-u>', function() cmd.tag_jump() end)

-- ============================================================
-- 搜索 (显示所在函数名)
-- ============================================================
local function rg_with_func(keyword)
  local preview_cmd = [[sh -c 'file=$(echo "$1" | cut -d: -f1); line=$(echo "$1" | cut -d: -f2); func=$(head -n "$line" "$file" 2>/dev/null | tac | grep -m1 -E "^[a-zA-Z_].*\(" | sed "s/^[ \t]*//"); if [ -n "$func" ]; then printf "\033[33m[%s]\033[0m\n\n" "$func"; fi; head -n $((line+10)) "$file" | tail -n $((line+10>20?20:line+10)) | GREP_COLORS="mt=01;31" grep --color=always -E -e "]] .. keyword .. [[|^"' _ {}]]
  require('fzf-lua').fzf_exec(
    'rg --threads 8 -L --column --line-number --no-heading --color=always --smart-case -- ' .. vim.fn.shellescape(keyword),
    {
      prompt = 'Rg> ',
      preview = preview_cmd,
      fzf_opts = {
        ['--layout'] = 'default',
        ['--preview-window'] = 'up:40%:border-bottom',
      },
      actions = {
        ['default'] = function(sel)
          if not sel or #sel == 0 then return end
          local p = vim.split(sel[1], ':')
          vim.cmd(string.format('e +%s %s', p[2], p[1]))
        end,
      },
    }
  )
end

map('n', 'R', function() rg_with_func(vim.fn.expand('<cword>')) end)
map('v', 'R', function()
  vim.cmd('normal! "zy')
  rg_with_func(vim.fn.getreg('z'):gsub('\n', ''))
end)

map('n', '<leader>s', function() rg_with_func(vim.fn.expand('<cword>') .. ' = ') end, { desc = 'Grep cword + " = "' })
map('v', '<leader>s', function()
  vim.cmd('normal! "zy')
  rg_with_func(vim.fn.getreg('z'):gsub('\n', '') .. ' = ')
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
map('n', 'z', 'z')
map('v', 'z', 'z')
map('v', 'zf', 'zfzf')

-- ============================================================
-- 删除 visual match
-- ============================================================
map('v', '<leader>dm', function() cmd.delete_visual_match() end)

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
map('v', 'c',  '<Nop>')
map('v', 'C',  '<Nop>')
map('v', 'C',  '"bp')

if not vim.g.neovide then
  map('v', 'y', '"by<Cmd>call OSCYank(getreg(\'b\'))<CR>')
  map('v', 'c', '"by<Cmd>call OSCYank(getreg(\'b\'))<CR>')
else
  map('v', 'y', '"by')
end

map('n', 'Y',  've<Plug>OSCYankVisual')
map('n', 'cc', ':TagbarToggle<CR>',                 { desc = 'Tagbar' })
map('n', 'cs', ':sp<CR>')
map('n', 'cv', ':vsp<CR>')
map('n', 'ca', ':Yazi<CR>',                         { desc = 'Yazi' })
map('n', 'cq', ':copen 20<CR>')
map('n', 'e',  '<Plug>(expand_region_expand)')
map('n', '0',  '^')

-- 复制当前函数名
map('n', 'cl', function() cmd.yank_current_func() end, { desc = 'Yank function name' })

-- ============================================================
-- Markdown
-- ============================================================
map('n', 'cmp', ':MarkdownToPDF<CR>',  { desc = 'MD → PDF' })
map('n', 'cmh', ':MarkdownToHTML<CR>', { desc = 'MD → HTML' })

-- ============================================================
-- Alt + 滚轮 水平滚动
-- ============================================================
map('n', '<M-ScrollWheelUp>',   '5zh')
map('n', '<M-ScrollWheelDown>', '5zl')
map('i', '<M-ScrollWheelUp>',   '<Esc>5zh')
map('i', '<M-ScrollWheelDown>', '<Esc>5zl')
map('v', '<M-ScrollWheelUp>',   '5zh')
map('v', '<M-ScrollWheelDown>', '5zl')
