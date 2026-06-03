-- 光标下配对符号高亮（括号 + 引号）
-- 轻量实现，不依赖额外插件

local M = {}

local group = vim.api.nvim_create_augroup('MatchHighlight', { clear = true })
local match_ids = {}

-- 配对符号映射
local pairs = {
  ['('] = ')', [')'] = '(',
  ['['] = ']', [']'] = '[',
  ['{'] = '}', ['}'] = '{',
  ["'"] = "'",
  ['"'] = '"',
  ['`'] = '`',
}

local function clear_match()
  for _, id in ipairs(match_ids) do
    pcall(vim.fn.matchdelete, id)
  end
  match_ids = {}
end

-- 查找配对括号（开闭符不同，使用 stack）
local function find_bracket_pair(char, pair_char, row, col)
  local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  local is_open = (char == '(' or char == '[' or char == '{')
  local stack = 0

  if is_open then
    for r = row, #lines do
      local start_c = (r == row) and (col + 2) or 1
      local line = lines[r]
      for c = start_c, #line do
        local ch = line:sub(c, c)
        if ch == char then
          stack = stack + 1
        elseif ch == pair_char then
          if stack == 0 then
            return { r - 1, c - 1 }
          else
            stack = stack - 1
          end
        end
      end
    end
  else
    for r = row, 1, -1 do
      local end_c = (r == row) and col or #lines[r]
      local line = lines[r]
      for c = end_c, 1, -1 do
        local ch = line:sub(c, c)
        if ch == char then
          stack = stack + 1
        elseif ch == pair_char then
          if stack == 0 then
            return { r - 1, c - 1 }
          else
            stack = stack - 1
          end
        end
      end
    end
  end

  return nil
end

-- 查找配对引号（开闭符相同，双向搜索取最近）
local function find_quote_pair(char, row, col)
  local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
  local fwd_pos, bwd_pos = nil, nil

  -- 向前搜索
  for r = row, #lines do
    local start_c = (r == row) and (col + 2) or 1
    local line = lines[r]
    for c = start_c, #line do
      if line:sub(c, c) == char then
        fwd_pos = { r - 1, c - 1 }
        goto fwd_done
      end
    end
  end
  ::fwd_done::

  -- 向后搜索
  for r = row, 1, -1 do
    local end_c = (r == row) and col or #lines[r]
    local line = lines[r]
    for c = end_c, 1, -1 do
      if line:sub(c, c) == char then
        bwd_pos = { r - 1, c - 1 }
        goto bwd_done
      end
    end
  end
  ::bwd_done::

  if fwd_pos and bwd_pos then
    local fwd_dist = (fwd_pos[1] - row + 1) * 10000 + math.abs(fwd_pos[2] - col)
    local bwd_dist = (row - 1 - bwd_pos[1]) * 10000 + math.abs(col - bwd_pos[2])
    return fwd_dist <= bwd_dist and fwd_pos or bwd_pos
  end
  return fwd_pos or bwd_pos
end

-- Vim magic 模式：仅转义真正需要转义的字符
local function escape_vim_pattern(s)
  return s:gsub('([\\^$.*~%[%]])', '\\%1')
end

local function update_match()
  clear_match()

  local pos = vim.api.nvim_win_get_cursor(0)
  local row, col = pos[1], pos[2]  -- row 1-indexed, col 0-indexed

  local line = vim.api.nvim_get_current_line()
  local char = line:sub(col + 1, col + 1)

  local pair_char = pairs[char]
  if not pair_char then return end

  -- 高亮当前字符（使用 \V 让大部分字符成为字面量）
  local escaped_char = escape_vim_pattern(char)
  local pattern = string.format('\\V\\%%%dl\\%%%dc%s', row, col + 1, escaped_char)
  local id = vim.fn.matchadd('MatchPair', pattern, 11)
  table.insert(match_ids, id)

  -- 查找并高亮配对字符
  local pair_pos
  if char == pair_char then
    pair_pos = find_quote_pair(char, row, col)
  else
    pair_pos = find_bracket_pair(char, pair_char, row, col)
  end

  if pair_pos then
    local pr, pc = pair_pos[1] + 1, pair_pos[2] + 1
    local escaped_pair = escape_vim_pattern(pair_char)
    local pair_pattern = string.format('\\V\\%%%dl\\%%%dc%s', pr, pc, escaped_pair)
    id = vim.fn.matchadd('MatchPair', pair_pattern, 11)
    table.insert(match_ids, id)
  end
end

-- 延迟更新，避免频繁计算
local timer_version = 0
local function debounced_update()
  timer_version = timer_version + 1
  local version = timer_version
  vim.defer_fn(function()
    if version == timer_version then
      update_match()
    end
  end, 20)
end

function M.setup()
  vim.api.nvim_set_hl(0, 'MatchPair', { fg = '#1a1b26', bg = '#e6c384', bold = true })

  vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI' }, {
    group = group,
    callback = debounced_update,
  })

  vim.api.nvim_create_autocmd({ 'BufLeave', 'InsertEnter' }, {
    group = group,
    callback = clear_match,
  })

  vim.api.nvim_create_autocmd('ColorScheme', {
    group = group,
    callback = function()
      vim.api.nvim_set_hl(0, 'MatchPair', { fg = '#1a1b26', bg = '#e6c384', bold = true })
    end,
  })
end

return M
