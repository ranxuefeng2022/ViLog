-- 状态栏：固定背景色 + 模式彩色指示条 + 呼吸动画
-- Insert → 红色 ┃I┃ 呼吸闪烁    Visual → 绿色 ┃V┃ 呼吸闪烁

local M = {}

local BG = '#1a1b26'

-- 模式颜色（基色 + 呼吸亮色）
local ModeColor = {
  normal  = { base = '#98bb6c' },
  insert  = { base = '#ff4060', bright = '#ff90a8' },
  visual  = { base = '#40d060', bright = '#80f0a0' },
  command = { base = '#e0af68' },
  other   = { base = '#c8c093' },
}

-- 固定颜色（不随模式变化）
local Static = {
  text = '#e6c384',
  git  = '#ffd866',
  file = '#7aa2f7',
  sep  = '#565f89',
  info = '#a9b1d6',
}

local function init_highlights()
  vim.cmd('highlight StatusLine   guibg=' .. BG .. ' gui=none cterm=none')
  vim.cmd('highlight StatusLineNC guibg=' .. BG .. ' gui=none cterm=none')

  local hl = vim.api.nvim_set_hl
  hl(0, 'StlMode', { fg = ModeColor.normal.base, bg = BG })
  hl(0, 'StlText', { fg = Static.text, bg = BG })
  hl(0, 'StlGit',  { fg = Static.git,  bg = BG })
  hl(0, 'StlFile', { fg = Static.file, bg = BG })
  hl(0, 'StlSep',  { fg = Static.sep,  bg = BG })
  hl(0, 'StlInfo',  { fg = Static.info,  bg = BG })
  hl(0, 'StlSearch', { fg = '#ff9e64',    bg = BG })
end

init_highlights()

-- ===================================================================
-- 呼吸动画
-- ===================================================================
local anim_timer = nil
local anim_active = false

-- 在两个 hex 颜色间做线性插值
local function blend(c1, c2, t)
  local r1, g1, b1 = tonumber(c1:sub(2, 3), 16), tonumber(c1:sub(4, 5), 16), tonumber(c1:sub(6, 7), 16)
  local r2, g2, b2 = tonumber(c2:sub(2, 3), 16), tonumber(c2:sub(4, 5), 16), tonumber(c2:sub(6, 7), 16)
  local r = math.floor(r1 + (r2 - r1) * t + 0.5)
  local g = math.floor(g1 + (g2 - g1) * t + 0.5)
  local b = math.floor(b1 + (b2 - b1) * t + 0.5)
  return string.format('#%02x%02x%02x', r, g, b)
end

local function stop_anim()
  anim_active = false
  if anim_timer then
    anim_timer:stop()
    anim_timer:close()
    anim_timer = nil
  end
end

local function start_anim(base, bright)
  stop_anim()
  if not bright then return end

  anim_active = true
  local step = 0
  anim_timer = vim.uv.new_timer()
  anim_timer:start(0, 50, function()
    if not anim_active then return end
    step = step + 1
    -- 正弦波，周期约 800ms (16 * 50ms)
    local t = (math.sin(step / 16 * 2 * math.pi) + 1) / 2
    local color = blend(base, bright, t)
    -- nvim_set_hl 必须从主循环调用，uv 回调是 fast context
    vim.schedule(function()
      if not anim_active then return end
      vim.api.nvim_set_hl(0, 'StlMode', { fg = color, bg = BG })
    end)
  end)
end

-- ===================================================================
-- 模式高亮
-- ===================================================================
local function set_mode_hl()
  stop_anim()

  local m = vim.api.nvim_get_mode().mode
  local cfg
  if m == 'i' then
    cfg = ModeColor.insert
    start_anim(cfg.base, cfg.bright)
  elseif m == 'v' or m == 'V' or m == '\22' or m == 's' then
    cfg = ModeColor.visual
    start_anim(cfg.base, cfg.bright)
  elseif m == 'c' then
    cfg = ModeColor.command
  else
    cfg = ModeColor.normal
  end

  vim.api.nvim_set_hl(0, 'StlMode', { fg = cfg.base, bg = BG })
end

-- 模式显示字符
local function mode_str()
  set_mode_hl()
  local m = vim.api.nvim_get_mode().mode
  if m == 'n' then
    return ' N '
  elseif m == 'i' then
    return '┃I┃'
  elseif m == 'v' or m == 'V' or m == '\22' or m == 's' then
    return '┃V┃'
  elseif m == 'c' then
    return ' C '
  else
    return ' ' .. m .. ' '
  end
end

-- ===================================================================
-- Git 分支（异步）
-- ===================================================================
local function update_git_branch()
  local dir = vim.fn.expand('%:p:h')
  if dir == '' then return end
  local stdout = {}
  vim.fn.jobstart(
    { 'git', '-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD' },
    {
      stdout_buffered = true,
      on_stdout = function(_, data)
        if data then vim.list_extend(stdout, data) end
      end,
      on_exit = function(_, code)
        if code == 0 then
          local branch = vim.trim(table.concat(stdout, ''))
          vim.b.git_branch = (branch ~= '' and branch ~= 'HEAD') and branch or ''
          vim.cmd('redrawstatus')
        end
      end,
    }
  )
end

local function st_git()
  if vim.b.git_branch and vim.b.git_branch ~= '' then
    return ' ' .. vim.b.git_branch .. ' '
  end
  return ''
end

-- 注册到全局，供 statusline %{v:lua...} 动态求值
_G.StatusLineModule = M

function M.git_branch()
  return st_git()
end

-- 搜索计数：仅 hlsearch 激活且有匹配时显示 ?N/M
function M.search_info()
  if vim.v.hlsearch ~= 1 then return '' end
  local ok, sc = pcall(vim.fn.searchcount, { maxcount = 9999, timeout = 50 })
  if not ok or not sc or sc.total == 0 then return '' end
  local cur = sc.current or 0
  local total = sc.total or 0
  if sc.incomplete == 1 then
    return string.format(' %d/>%d', cur, sc.maxcount)
  end
  return string.format(' %d/%d', cur, total)
end

-- ===================================================================
-- 状态栏更新
-- ===================================================================
function M.current_func()
  local f = vim.b.current_func or ''
  if #f > 50 then
    return f:sub(1, 47) .. '...'
  end
  return f
end

function M.update()
  local m = mode_str()
  vim.o.statusline = string.format(
    '%%#StlMode#%s %%#StlSep#│ %%#StlFile#%%t%%{&modified?\" [+]\":\"\"}%%#StlSep# │ %%#StlText#%%<%%{v:lua.StatusLineModule.current_func()}%%=%%#StlGit#%%{v:lua.StatusLineModule.git_branch()} %%#StlSep#│ %%#StlInfo#%%l/%%L %%#StlSep#│ %%#StlSearch#%%{v:lua.StatusLineModule.search_info()}',
    m
  )
end

-- ===================================================================
-- Autocommands
-- ===================================================================
local group = vim.api.nvim_create_augroup('StatusLine', { clear = true })

vim.api.nvim_create_autocmd('ModeChanged', {
  group = group,
  callback = M.update,
})

vim.api.nvim_create_autocmd({ 'BufEnter', 'FileType' }, {
  group = group,
  callback = M.update,
})

vim.api.nvim_create_autocmd({ 'BufEnter', 'FocusGained', 'BufReadPost' }, {
  group = group,
  callback = update_git_branch,
})

-- 搜索后刷新（n/N 跳转已通过 CursorMoved 自动触发）
vim.api.nvim_create_autocmd('CmdlineLeave', {
  group = group,
  pattern = { '/', '?' },
  callback = function() vim.cmd('redrawstatus') end,
})

-- 退出时清理动画
vim.api.nvim_create_autocmd('VimLeavePre', {
  group = group,
  callback = stop_anim,
})

M.update()

-- 兼容旧接口
M.update_git_branch = update_git_branch

return M
