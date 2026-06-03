-- Top + bottom border lines with random color breathing animation
-- Top border uses tabline (no content overlap)
-- Bottom border uses floating window above statusline

local M = {}

local HL = { top = 'BorderAnimTop', bottom = 'BorderAnimBottom' }

local PALETTE = {
  { 255, 158, 100 },
  { 122, 162, 247 },
  { 158, 206, 106 },
  { 247, 118, 142 },
  { 187, 154, 247 },
  { 42,  195, 222 },
  { 224, 175, 104 },
  { 180, 249, 248 },
}

local SPEED = 0.10
local PHASE_BOTTOM = math.pi
local TICK_MS = 120
local SMOOTH = 0.025

local state = {
  wins = {}, bufs = {},
  timer = nil, tick = 0, enabled = false,
  editor_bg = '#1a1b26',
  prev = {},
  colors = {
    top    = { r = 255, g = 158, b = 100 },
    bottom = { r = 122, g = 162, b = 247 },
  },
  targets = {
    top    = { r = 158, g = 206, b = 106 },
    bottom = { r = 247, g = 118, b = 142 },
  },
  saved_so = 0, saved_siso = 0,
  saved_showtabline = 0, saved_tabline = '',
}

local function rgb_to_hex(r, g, b)
  return string.format('#%02x%02x%02x',
    math.max(0, math.min(255, math.floor(r + 0.5))),
    math.max(0, math.min(255, math.floor(g + 0.5))),
    math.max(0, math.min(255, math.floor(b + 0.5))))
end

local function detect_bg()
  local ok, hl = pcall(vim.api.nvim_get_hl, 0, { name = 'Normal' })
  if ok and hl.bg then state.editor_bg = string.format('#%06x', hl.bg) end
end

local function close_windows()
  local win = state.wins.bottom
  if win and vim.api.nvim_win_is_valid(win) then
    vim.api.nvim_win_close(win, true)
  end
  state.wins = {}
  state.bufs = {}
end

local function make_line_buf(cols)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = 'wipe'
  vim.bo[buf].buftype = 'nofile'
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { string.rep('─', cols) })
  vim.bo[buf].modifiable = false
  return buf
end

local function open_border(buf, row, cols, hl, zindex)
  local win = vim.api.nvim_open_win(buf, false, {
    relative = 'editor', row = row, col = 0,
    width = cols, height = 1,
    focusable = false, style = 'minimal', zindex = zindex,
  })
  vim.wo[win].winhl = string.format(
    'Normal:%s,EndOfBuffer:%s,NonText:%s,Cursor:%s,CursorLine:%s,CursorColumn:%s',
    hl, hl, hl, hl, hl, hl)
  return win
end

local function create_windows()
  close_windows()
  local cols = vim.o.columns
  local bot = vim.o.lines - 2 - vim.o.cmdheight

  state.bufs.bottom = make_line_buf(cols)
  state.wins.bottom = open_border(state.bufs.bottom, bot, cols, HL.bottom, 50)
end

local function random_palette()
  return PALETTE[math.random(#PALETTE)]
end

local function init_highlights()
  detect_bg()
  for _, key in ipairs({ 'top', 'bottom' }) do
    local c = random_palette()
    local t = random_palette()
    state.colors[key] = { r = c[1], g = c[2], b = c[3] }
    state.targets[key] = { r = t[1], g = t[2], b = t[3] }
    local hex = rgb_to_hex(c[1], c[2], c[3])
    local bg = state.editor_bg
    vim.api.nvim_set_hl(0, HL[key], { fg = hex, bg = bg })
    state.prev[key] = hex
  end
end

local function update_colors()
  for _, key in ipairs({ 'top', 'bottom' }) do
    local c = state.colors[key]
    local t = state.targets[key]
    c.r = c.r + (t.r - c.r) * SMOOTH
    c.g = c.g + (t.g - c.g) * SMOOTH
    c.b = c.b + (t.b - c.b) * SMOOTH

    local dr, dg, db = t.r - c.r, t.g - c.g, t.b - c.b
    if dr * dr + dg * dg + db * db < 25 then
      local nt = random_palette()
      state.targets[key] = { r = nt[1], g = nt[2], b = nt[3] }
    end

    local phase = key == 'bottom' and PHASE_BOTTOM or 0
    local brightness = 0.65 + 0.35 * math.sin(state.tick * SPEED + phase)
    local hex = rgb_to_hex(c.r * brightness, c.g * brightness, c.b * brightness)
    if state.prev[key] ~= hex then
      local bg = state.editor_bg
      vim.api.nvim_set_hl(0, HL[key], { fg = hex, bg = bg })
      state.prev[key] = hex
    end
  end
end

local function set_tabline()
  vim.o.showtabline = 2
  vim.o.tabline = '%#BorderAnimTop#' .. string.rep('─', 300)
end

local function restore_tabline()
  vim.o.showtabline = state.saved_showtabline
  vim.o.tabline = state.saved_tabline
end

function M.start()
  if state.enabled then return end
  state.enabled = true
  state.saved_so = vim.o.scrolloff
  state.saved_siso = vim.o.sidescrolloff
  state.saved_showtabline = vim.o.showtabline
  state.saved_tabline = vim.o.tabline
  vim.o.scrolloff = 1
  vim.o.sidescrolloff = 0
  init_highlights()
  set_tabline()
  create_windows()
  state.timer = vim.uv.new_timer()
  state.timer:start(0, TICK_MS, vim.schedule_wrap(function()
    if not state.enabled then return end
    state.tick = state.tick + 1
    update_colors()
  end))
end

function M.stop()
  if not state.enabled then return end
  state.enabled = false
  vim.o.scrolloff = state.saved_so
  vim.o.sidescrolloff = state.saved_siso
  restore_tabline()
  if state.timer then
    state.timer:stop()
    state.timer:close()
    state.timer = nil
  end
  close_windows()
  state.tick = 0
  state.prev = {}
end

function M.toggle()
  if state.enabled then M.stop() else M.start() end
end

local DASHBOARD_FT = { dashboard = true, alpha = true, starter = true, snacks_dashboard = true }

local function is_dashboard()
  local buf = vim.api.nvim_get_current_buf()
  local ft = vim.bo[buf].filetype
  if DASHBOARD_FT[ft] then return true end
  local name = vim.api.nvim_buf_get_name(buf)
  if name == '' and ft == '' then return true end
  return false
end

local group = vim.api.nvim_create_augroup('BorderAnim', { clear = true })

vim.api.nvim_create_autocmd('VimResized', {
  group = group,
  callback = function()
    if state.enabled then create_windows() end
  end,
})

vim.api.nvim_create_autocmd('ColorScheme', {
  group = group,
  callback = function()
    if state.enabled then init_highlights() end
  end,
})

vim.api.nvim_create_autocmd('BufEnter', {
  group = group,
  callback = function()
    if is_dashboard() then
      if state.enabled then M.stop() end
    else
      if not state.enabled then M.start() end
    end
  end,
})

vim.api.nvim_create_autocmd('VimLeavePre', {
  group = group,
  callback = function() M.stop() end,
})

return M
