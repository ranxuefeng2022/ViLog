-- 自动命令

local cmd = require('config.commands')

local augroup = vim.api.nvim_create_augroup

-- 主自动命令组
local main = augroup('AutoCommands', { clear = true })

vim.api.nvim_create_autocmd('InsertLeave', {
  group = main,
  command = 'if &modified | silent! write | endif',
})

vim.api.nvim_create_autocmd('FocusGained', {
  group = main,
  command = 'silent! checktime',
})

vim.api.nvim_create_autocmd('BufReadPost', {
  group = main,
  callback = function()
    local mark = vim.api.nvim_buf_get_mark(0, '"')
    if mark[1] > 1 and mark[1] <= vim.api.nvim_buf_line_count(0) then
      vim.cmd('normal! g\'"')
    end
  end,
})

vim.api.nvim_create_autocmd('InsertLeave', {
  group = main,
  command = 'if pumvisible() == 0 | pclose | endif',
})

vim.api.nvim_create_autocmd('BufRead', {
  group = main,
  callback = function()
    vim.schedule(function() cmd.load_tags() end)
  end,
})

-- 启动时 cd 到命令行参数目录
vim.api.nvim_create_autocmd('VimEnter', {
  group = main,
  callback = function()
    local args = vim.fn.argv()
    if #args > 0 then
      local path = vim.fn.fnamemodify(args[1], ':p')
      if vim.fn.isdirectory(path) == 1 then
        vim.cmd('cd ' .. vim.fn.fnameescape(path))
      else
        vim.cmd('cd ' .. vim.fn.fnameescape(vim.fn.fnamemodify(path, ':h')))
      end
    end
  end,
  once = true,
})

vim.api.nvim_create_autocmd('FileType', {
  group = main,
  pattern = 'python',
  command = 'setlocal makeprg=python3\\ %',
})

-- 高亮覆盖（主题切换时重新应用）
-- 启动时由 init.lua 在 colorscheme 之后直接调用 apply_highlight_overrides()
function _G.apply_highlight_overrides()
  -- 行号：当前行绿色背景高亮
  vim.api.nvim_set_hl(0, 'LineNr',       { fg = '#3b3f52' })
  vim.api.nvim_set_hl(0, 'CursorLineNr', { fg = '#1a1b26', bg = '#9ece6a', bold = true })
  vim.api.nvim_set_hl(0, 'CursorLine',   { bg = 'NONE' })

  -- 搜索高亮
  vim.api.nvim_set_hl(0, 'Search',       { fg = 'Black', bg = '#e6c384' })
  vim.api.nvim_set_hl(0, 'IncSearch',    { fg = 'Black', bg = '#ff9e64', bold = true })

  -- 补全菜单
  vim.api.nvim_set_hl(0, 'Pmenu',        { bg = '#1e2030', fg = '#a9b1d6' })
  vim.api.nvim_set_hl(0, 'PmenuSel',     { bg = '#363b54', fg = '#e6c384', bold = true })
  vim.api.nvim_set_hl(0, 'PmenuSbar',    { bg = '#1e2030' })
  vim.api.nvim_set_hl(0, 'PmenuThumb',   { bg = '#565f89' })

  -- 配对符号高亮（括号/引号）- 与 match-hl.lua 同步
  vim.api.nvim_set_hl(0, 'MatchPair',   { fg = '#1a1b26', bg = '#e6c384', bold = true })
  vim.api.nvim_set_hl(0, 'MatchParen',  { fg = '#1a1b26', bg = '#e6c384', bold = true })

  -- 视觉选择区域
  vim.api.nvim_set_hl(0, 'Visual',       { bg = '#28304a' })
  vim.api.nvim_set_hl(0, 'VisualNOS',    { bg = '#28304a' })

  -- 其他非文本字符
  vim.api.nvim_set_hl(0, 'NonText',      { fg = '#2a2a3a' })
end

-- 主题切换时重新应用高亮覆盖
vim.api.nvim_create_autocmd('ColorScheme', {
  group = main,
  callback = function()
    vim.schedule(function()
      _G.apply_highlight_overrides()
    end)
  end,
})

-- 光标设置：正常模式用方块更显眼，插入模式用加粗竖线
vim.opt.guicursor =
  'n-v-c-sm:block,i-ci-ve:ver50,r-cr-o:hor20'

vim.api.nvim_create_autocmd('VimLeave', {
  group = main,
  callback = function()
    vim.opt.guicursor = 'n-v-c-sm:block,i-ci-ve:ver50,r-cr-o:hor20'
  end,
})

-- C/C++ 文件类型
local cgroup = augroup('CFileAutocmds', { clear = true })

vim.api.nvim_create_autocmd('FileType', {
  group = cgroup,
  pattern = { 'c', 'cpp' },
  callback = function()
    vim.api.nvim_create_autocmd({ 'CursorHold', 'CursorHoldI' }, {
      group = cgroup,
      buffer = 0,
      callback = function()
        vim.fn.UpdateCurrentFunc()
      end,
    })
    vim.fn.UpdateCurrentFunc()
  end,
})

-- c/cpp 语法扩展已通过 after/syntax/c.vim 自动加载，无需额外 autocommand
