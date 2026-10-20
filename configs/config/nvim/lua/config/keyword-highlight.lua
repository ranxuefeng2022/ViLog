-- Keyword highlight with 256-color XTerm palette picker
-- visual `,` 打开:纯圆点网格(● 前景色渲染);hjkl/方向键移动光标
-- (从正中间出发),鼠标单击圆点跳转、双击直接生效;移动即实时预览
-- (该词背景色效果,buffer 内同步临时高亮);Enter 上色,q 撤销
-- 预览关窗;x 取消该词,X 全部清除;换色替换旧色不叠加;高亮同步到
-- 当前 tab 所有普通窗口。

local M = {}

-- XTerm 256 色:16 系统色 + 6×6×6 色立方(16-231) + 24 灰阶(232-255)
local function build_palette()
  local pal = {
    '#000000','#800000','#008000','#808000','#000080','#800080','#008080','#c0c0c0',
    '#808080','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff',
  }
  local cube = { 0, 95, 135, 175, 215, 255 }
  for r = 0, 5 do
    for g = 0, 5 do
      for b = 0, 5 do
        pal[#pal + 1] = string.format('#%02x%02x%02x', cube[r + 1], cube[g + 1], cube[b + 1])
      end
    end
  end
  for i = 0, 23 do
    local v = 8 + i * 10
    pal[#pal + 1] = string.format('#%02x%02x%02x', v, v, v)
  end
  return pal
end

M.PALETTE = build_palette()
M.COLS = 10                -- 列数:a-j,每列 26 色(列主序)
M._matches = {}
M._hl_ready = false

-- 默认选中:首色 aa
function M.center_index()
  return 0
end

-- 背景高亮的对比前景:按感知亮度(YIQ)自动配黑/白字
local function contrast_fg(hex)
  local r = tonumber(hex:sub(2, 3), 16)
  local g = tonumber(hex:sub(4, 5), 16)
  local b = tonumber(hex:sub(6, 7), 16)
  if (r * 299 + g * 587 + b * 114) / 1000 > 140 then
    return '#000000'
  end
  return '#ffffff'
end

function M.setup()
  if M._hl_ready then return end
  M._hl_ready = true
  -- 高亮样式 = 背景色块(词的底色换成所选色,字色自动配对比色)
  for i, hex in ipairs(M.PALETTE) do
    vim.api.nvim_set_hl(0, 'KwHL' .. (i - 1),
      { bg = hex, fg = contrast_fg(hex), bold = true })
    -- 面板字标组:纯前景色渲染(无色块,简约),不带下划线——
    -- 下划线全场唯一,只属于选中格(KwHLCur),跟着输入走
    vim.api.nvim_set_hl(0, 'KwCell' .. (i - 1), { fg = hex })
  end
  vim.api.nvim_set_hl(0, 'KwHLFoot', { link = 'Comment' })
  -- 面板卡片:背景与状态栏同表面(#1a1b26),边框用全局分隔色(#565f89,
  -- 与 statusline/toggleterm 一致),同表面上的卡片观感
  vim.api.nvim_set_hl(0, 'KwPanel', { bg = '#1a1b26' })
  vim.api.nvim_set_hl(0, 'KwBorder', { fg = '#565f89', bg = '#1a1b26' })
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

-- 当前 tab 的普通窗口(matchadd 是窗口局部的,同步要逐窗口添加;
-- 排除浮动窗/终端,只覆盖编辑视口)
local function normal_wins()
  local wins = {}
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    if vim.api.nvim_win_is_valid(w)
      and vim.api.nvim_win_get_config(w).relative == '' then
      wins[#wins + 1] = w
    end
  end
  return wins
end

function M._add_match(idx, text)
  if not text or text == '' then return end
  -- 换色语义:先取消该词已有颜色再上色,避免同词多条 match 叠加
  M.delete_word(text)
  local pattern = '\\V' .. vim.fn.escape(text, '\\')
  local entry = { text = text, idx = idx, ids = {} }
  for _, win in ipairs(normal_wins()) do
    local ok, id = pcall(vim.api.nvim_win_call, win, function()
      return vim.fn.matchadd('KwHL' .. idx, pattern)
    end)
    if ok then entry.ids[win] = id end
  end
  if next(entry.ids) then
    table.insert(M._matches, entry)
  end
end

function M.delete_word(text)
  if not text or text == '' then return 0 end
  local remaining = {}
  local deleted = 0
  for _, m in ipairs(M._matches) do
    if m.text == text then
      for win, id in pairs(m.ids) do
        if vim.api.nvim_win_is_valid(win) then
          pcall(vim.fn.matchdelete, id, win)
        end
      end
      deleted = deleted + 1
    else
      remaining[#remaining + 1] = m
    end
  end
  M._matches = remaining
  return deleted
end

function M.clear_all()
  local n = #M._matches
  for _, m in ipairs(M._matches) do
    for win, id in pairs(m.ids) do
      if vim.api.nvim_win_is_valid(win) then
        pcall(vim.fn.matchdelete, id, win)
      end
    end
  end
  M._matches = {}
  return n
end

-- 给单个窗口补放缺失的高亮(新开窗口/切窗口时同步用)
function M._sync_window(win)
  if not vim.api.nvim_win_is_valid(win) then return end
  if vim.api.nvim_win_get_config(win).relative ~= '' then return end
  for _, m in ipairs(M._matches) do
    if m.ids[win] == nil then
      local pattern = '\\V' .. vim.fn.escape(m.text, '\\')
      local ok, id = pcall(vim.api.nvim_win_call, win, function()
        return vim.fn.matchadd('KwHL' .. m.idx, pattern)
      end)
      if ok then m.ids[win] = id end
    end
  end
end

-- 色号 → 两位字母标记:列 a-j(每列 26 色,列主序)+ 行 a-z
function M.label_of(idx)
  return string.char(97 + math.floor(idx / 26)) .. string.char(97 + idx % 26)
end

-- 鼠标点击坐标(窗口内 1 基行 / 字节列)→ 色号;空白行/网格外返回 nil。
-- 布局:行1预览 行2分隔,内容行在 3,5,7,...(组 g 的内容行 = 3+g*2,
-- 组间空行分隔);每格 3 字节(标记 2 + 间隔 1)
function M.cell_at(line, col)
  local rel = line - 3
  if rel < 0 or rel % 2 ~= 0 then return nil end
  local g = math.floor(rel / 2)
  if g >= 10 then return nil end
  local pos = math.floor((col - 1) / 3)
  if pos < 0 or pos >= 26 then return nil end
  local idx = g * 26 + pos
  if idx >= #M.PALETTE then return nil end
  return idx
end

-- 构建色板窗内容(10 组行 a-j × 26 列 a-z,组间空行分隔,行同显示宽):
--   行 1      预览:#色号 (标记) 或首键后的 "组字母_" + 该词背景色效果
--   行 2      分隔线
--   行 3,5,7… 组行:每格两位标记以纯前景色渲染(无色块,简约);默认
--             选中 aa;选中格为全场唯一背景芯片+唯一下划线(KwHLCur)
--   空白行    组间分隔(避免上下连片)
--   末两行    空行 + footer:仅保留 u/x/q 提示,居中
function M._render(text, cursor, pending)
  cursor = math.max(0, math.min(#M.PALETTE - 1, cursor or M.center_index()))
  local dw = vim.fn.strdisplaywidth
  local function fit(s, w)
    while dw(s) > w do s = vim.fn.strcharpart(s, 0, vim.fn.strchars(s) - 1) end
    return s
  end

  -- 每格 3 显示宽(标记 2 + 间隔 1);26 列 → 78 宽
  local content_w = 26 * 3
  -- footer 只留必要提示,居中(与预览行呼应)
  local footer = 'x=unhl X=clear q=close'
  local fpad = math.floor((content_w - #footer) / 2)
  footer = string.rep(' ', fpad) .. footer
    .. string.rep(' ', content_w - fpad - #footer)

  local numstr = pending and (pending .. '_')
    or ('#%d (%s)'):format(cursor, M.label_of(cursor))
  local sample = fit(text:gsub('[\r\n]', ' '), content_w - #numstr - 4)
  local combo = #numstr + 2 + dw(sample)
  local pad = math.floor((content_w - combo) / 2)

  local lines, spans = {}, {}
  lines[1] = string.rep(' ', pad) .. numstr .. '  ' .. sample
    .. string.rep(' ', content_w - pad - combo)
  -- 前缀(#xx (yy) 或 组字母_)调暗,彩色词样是预览行唯一焦点
  spans[1] = { row = 0, col = pad, endc = pad + #numstr, group = 'KwHLFoot' }
  spans[#spans + 1] = {
    row = 0, col = pad + #numstr + 2, endc = pad + #numstr + 2 + #sample,
    group = 'KwHL' .. cursor,
  }
  -- 分隔线调暗(Comment 色),面板里最亮的只剩彩色字标与选中芯片
  lines[2] = string.rep('─', content_w)
  spans[#spans + 1] = { row = 1, col = 0, endc = -1, group = 'KwHLFoot' }

  for g = 0, 9 do
    local cells = {}
    for pos = 0, 25 do
      local idx = g * 26 + pos
      if idx < #M.PALETTE then
        cells[pos + 1] = M.label_of(idx) .. ' '
        -- 普通格:纯前景色字标;选中格:全场唯一背景芯片(KwHLCur,
        -- 该色为底+对比字+下划线),前后空格保留,不与邻格连片
        spans[#spans + 1] = {
          row = 2 + g * 2, col = pos * 3, endc = pos * 3 + 2,
          group = idx == cursor and 'KwHLCur' or ('KwCell' .. idx),
        }
      end
    end
    local line = table.concat(cells)
    lines[3 + g * 2] = line .. string.rep(' ', content_w - #line)
    if g < 9 then
      lines[4 + g * 2] = string.rep(' ', content_w)
    end
  end

  -- footer 上方留一行空白,与网格拉开一点距离
  lines[#lines + 1] = string.rep(' ', content_w)
  lines[#lines + 1] = footer
  spans[#spans + 1] = { row = #lines - 1, col = 0, endc = -1, group = 'KwHLFoot' }

  return {
    lines = lines,
    spans = spans,
    width = content_w,
    height = #lines,
  }
end

function M.pick()
  M.setup()
  local text, from_visual = M._get_text()
  if not text or text == '' then return end
  if from_visual then
    vim.api.nvim_feedkeys(
      vim.api.nvim_replace_termcodes('<Esc>', true, false, true), 'nx', true)
  end

  local pattern = '\\V' .. vim.fn.escape(text, '\\')
  local cursor = M.center_index()
  local pending = nil      -- 首键组字母,无限期等待次键(无超时)
  local pending_cursor = 0 -- 按首键前的光标位置,退格时恢复

  -- buffer 内实时预览:光标色临时盖在词上(优先级 20 高于正式高亮的 10),
  -- Enter 转正式,q/u/x 撤销
  local temp_ids = {}
  local function preview_clear()
    for win, id in pairs(temp_ids) do
      if vim.api.nvim_win_is_valid(win) then
        pcall(vim.fn.matchdelete, id, win)
      end
    end
    temp_ids = {}
  end
  local function preview_apply()
    preview_clear()
    for _, win in ipairs(normal_wins()) do
      local ok, id = pcall(vim.api.nvim_win_call, win, function()
        return vim.fn.matchadd('KwHL' .. cursor, pattern, 20)
      end)
      if ok then temp_ids[win] = id end
    end
  end

  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = 'wipe'
  local function redraw()
    -- 光标反色组:底/前景互换(该色作字、对比色作底),醒目且省宽度
    local hex = M.PALETTE[cursor + 1]
    vim.api.nvim_set_hl(0, 'KwHLCur',
      { fg = hex, bg = contrast_fg(hex), bold = true, underline = true })
    local r = M._render(text, cursor, pending)
    vim.bo[buf].modifiable = true
    vim.api.nvim_buf_set_lines(buf, 0, -1, true, r.lines)
    vim.bo[buf].modifiable = false
    vim.api.nvim_buf_clear_namespace(buf, -1, 0, -1)
    for _, s in ipairs(r.spans) do
      vim.api.nvim_buf_add_highlight(buf, -1, s.group, s.row, s.col, s.endc)
    end
    preview_apply()
    -- 强制立即重绘:轮询循环期间 TUI 不会自动刷新,不加这个括号标记不动
    vim.cmd('redraw')
    return r
  end
  local r = redraw()

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor',
    width = math.min(r.width, vim.o.columns - 2),
    height = math.min(r.height, vim.o.lines - 2),
    row = math.max(1, math.floor((vim.o.lines - r.height) / 2)),
    col = math.max(0, math.floor((vim.o.columns - r.width) / 2)),
    style = 'minimal',
    border = 'rounded',
    title = ' Highlight ',
    title_pos = 'center',
    zindex = 60,
  })
  vim.wo[win].winhl = 'NormalFloat:KwPanel,FloatBorder:KwBorder'

  -- 输入:getcharstr(0) 轮询读 typeahead + vim.wait 泵事件(定时器/重绘
  -- 不冻结)。交互:首键 a-j 跳到该组首色(预览同步),Enter 直接应用;
  -- 次键 a-z 跳到该组对应色并直接应用(150ms 停留展示过程);
  -- x(取消该词)/X(全清)/q 仅在无 pending 时作为命令(pending 中
  -- 小写字母是组内位字母);
  -- pending 无超时,任意间隔的次键都完成跳转;pending 中按退格撤销首键
  local done = false
  local function close()
    preview_clear()
    done = true
  end

  local function handle(key)
    if key == 'q' and not pending then
      close()
    elseif key == '<CR>' or key == '\r' or key == '\n' then
      pending = nil
      preview_clear()
      M._add_match(cursor, text)
      done = true
    elseif key == '<LeftMouse>' or key == '<2-LeftMouse>' then
      local m = vim.fn.getmousepos()
      if m.winid == win then
        local idx = M.cell_at(m.line, m.column)
        if idx then
          cursor = idx
          if key == '<2-LeftMouse>' then
            preview_clear()
            M._add_match(idx, text)
            done = true
          else
            redraw()
          end
        end
      end
    elseif not pending and key == 'x' then
      -- x = 取消该词高亮(原 u)
      preview_clear()
      local n = M.delete_word(text)
      if n > 0 then
        vim.notify(('Unhighlighted %s (%d color)'):format(text, n), vim.log.levels.INFO)
      else
        vim.notify('No highlight on ' .. text, vim.log.levels.WARN)
      end
      done = true
    elseif not pending and key == 'X' then
      -- X = 全部清除(原 x)
      preview_clear()
      local n = M.clear_all()
      vim.notify(('Cleared %d highlight%s'):format(n, n == 1 and '' or 's'), vim.log.levels.INFO)
      done = true
    elseif not pending and key:match('^[a-j]$') then
      pending = key
      pending_cursor = cursor
      cursor = (key:byte() - 97) * 26
      redraw()
    -- 注意:getcharstr(0) 对特殊键返回 K_SPECIAL 原始字节而非 '<BS>' 记法
    elseif pending and (key == '\128kb' or key == '\128kD'
      or key == '<BS>' or key == '\b' or key == '\x7f') then
      -- 退格/删除:撤销首键,回到按首键前的位置重新选择
      cursor = pending_cursor
      pending = nil
      redraw()
    elseif pending and key:match('^[a-z]$') then
      -- 次键:跳到该色,短暂停留展示选中过程(150ms)后直接应用关闭
      local idx = (pending:byte() - 97) * 26 + (key:byte() - 97)
      pending = nil
      if idx < #M.PALETTE then
        cursor = idx
        redraw()
        vim.wait(150)
        preview_clear()
        M._add_match(idx, text)
        done = true
      else
        redraw()
      end
    end
  end

  -- 键归一化:getcharstr(0) 可能返回数字(如 Esc 的 27)或
  -- K_SPECIAL 原始字节(如退格 \128kb),统一转成可比较的字符串
  local function norm_key(k)
    if type(k) == 'number' then
      return k > 0 and string.char(k) or nil
    end
    if type(k) ~= 'string' or k == '' then return nil end
    return k
  end

  vim.cmd('redraw')
  while not done do
    local key = norm_key(vim.fn.getcharstr(0))
    if key then
      handle(key)
    else
      vim.wait(25, function() return done end)
    end
  end
  pcall(vim.api.nvim_win_close, win, true)
end
vim.api.nvim_create_autocmd('ColorScheme', {
  group = vim.api.nvim_create_augroup('KwHighlight', { clear = true }),
  callback = function()
    M._hl_ready = false
    M.setup()
  end,
})

-- 新开窗口/切换窗口时补放缺失的高亮:先着色后 split,两边都能看到
vim.api.nvim_create_autocmd({ 'WinNew', 'WinEnter' }, {
  group = vim.api.nvim_create_augroup('KwHighlightSync', { clear = true }),
  callback = function()
    for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
      M._sync_window(win)
    end
  end,
})

return M
