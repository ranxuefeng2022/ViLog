-- Keyword highlight with color picker

local M = {}

M.COLORS = {
  { name = 'Red',        fg = '#FF6C6B', bg = '#3D1F1F' },
  { name = 'Coral',      fg = '#FF8A80', bg = '#3D2420' },
  { name = 'Orange',     fg = '#FFB86C', bg = '#3D2E1A' },
  { name = 'Amber',      fg = '#FFCB6B', bg = '#3D3420' },
  { name = 'Yellow',     fg = '#FFD866', bg = '#3D381A' },
  { name = 'Lime',       fg = '#D4E157', bg = '#303D1A' },
  { name = 'Green',      fg = '#A9DC76', bg = '#263D1A' },
  { name = 'Mint',       fg = '#80CBC4', bg = '#1A3D38' },
  { name = 'Cyan',       fg = '#78DCE8', bg = '#1A363A' },
  { name = 'Teal',       fg = '#4DB6AC', bg = '#1A3535' },
  { name = 'Sky',        fg = '#82AAFF', bg = '#1A2A3D' },
  { name = 'Blue',       fg = '#6C9EF7', bg = '#1A2240' },
  { name = 'Lavender',   fg = '#AB9DF2', bg = '#2D2060' },
  { name = 'Purple',     fg = '#C3A6FF', bg = '#2D1F4A' },
  { name = 'Magenta',    fg = '#E040FB', bg = '#351A3D' },
  { name = 'Pink',       fg = '#FF6188', bg = '#3D1A2A' },
  { name = 'Rose',       fg = '#F48FB1', bg = '#3D1A28' },
  { name = 'Gold',       fg = '#FFD54F', bg = '#3D3518' },
  { name = 'Salmon',     fg = '#FA8072', bg = '#3D201C' },
  { name = 'Turquoise',  fg = '#64FFDA', bg = '#1A3D35' },
}

M._KEYS = '1234567890abcdefghij'
M._matches = {}
M._hl_ready = false

function M.setup()
  if M._hl_ready then return end
  M._hl_ready = true
  for i, c in ipairs(M.COLORS) do
    vim.api.nvim_set_hl(0, 'KwHL' .. i, { fg = c.fg, bg = c.bg, bold = true })
  end
end

function M._get_text()
  local mode = vim.fn.mode()
  if mode == 'v' or mode == 'V' or mode:byte() == 22 then
    local saved = { vim.fn.getreg('z'), vim.fn.getregtype('z') }
    vim.cmd('noautocmd normal! "zy')
    local text = vim.fn.getreg('z')
    vim.fn.setreg('z', saved[1], saved[2])
    return text, true
  end
  return vim.fn.expand('<cword>'), false
end

function M._add_match(idx, text)
  if not text or text == '' then return end
  local pattern = '\\V' .. vim.fn.escape(text, '\\')
  local win = vim.api.nvim_get_current_win()
  local ok, id = pcall(vim.fn.matchadd, 'KwHL' .. idx, pattern)
  if ok then
    table.insert(M._matches, { id = id, win = win })
  end
end

function M.clear_all()
  for _, m in ipairs(M._matches) do
    if vim.api.nvim_win_is_valid(m.win) then
      pcall(vim.fn.matchdelete, m.id, m.win)
    end
  end
  M._matches = {}
end

function M.undo()
  local m = table.remove(M._matches)
  if not m then return end
  if vim.api.nvim_win_is_valid(m.win) then
    pcall(vim.fn.matchdelete, m.id, m.win)
  end
end

function M.pick()
  M.setup()
  local text, from_visual = M._get_text()
  if not text or text == '' then return end
  if from_visual then
    vim.api.nvim_feedkeys(
      vim.api.nvim_replace_termcodes('<Esc>', true, false, true), 'nx', true)
  end

  local key_map = {}
  local lines = {}
  for i, c in ipairs(M.COLORS) do
    local key = M._KEYS:sub(i, i)
    table.insert(lines, string.format(' %s  ●●● %s', key, c.name))
    key_map[key] = i
  end
  table.insert(lines, ' u  Undo Last')
  table.insert(lines, ' x  Clear All')

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, true, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].bufhidden = 'wipe'

  for i = 1, #M.COLORS do
    vim.api.nvim_buf_add_highlight(buf, -1, 'KwHL' .. i, i - 1, 4, -1)
  end

  local max_w = 0
  for _, l in ipairs(lines) do
    max_w = math.max(max_w, vim.fn.strdisplaywidth(l))
  end
  local width = max_w + 4
  local height = #lines + 2

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor',
    width = math.min(width, vim.o.columns - 4),
    height = math.min(height, vim.o.lines - 4),
    row = math.max(1, math.floor((vim.o.lines - height) / 2)),
    col = math.max(0, math.floor((vim.o.columns - width) / 2)),
    style = 'minimal',
    border = 'rounded',
    title = ' Highlight: ' .. text .. ' ',
    title_pos = 'center',
    zindex = 60,
  })

  vim.cmd('redraw')
  local ok, key = pcall(vim.fn.getcharstr)
  pcall(vim.api.nvim_win_close, win, true)
  if not ok then return end

  if key_map[key] then
    M._add_match(key_map[key], text)
  elseif key == 'u' then
    M.undo()
  elseif key == 'x' then
    M.clear_all()
  end
end

vim.api.nvim_create_autocmd('ColorScheme', {
  group = vim.api.nvim_create_augroup('KwHighlight', { clear = true }),
  callback = function()
    M._hl_ready = false
    M.setup()
  end,
})

return M
