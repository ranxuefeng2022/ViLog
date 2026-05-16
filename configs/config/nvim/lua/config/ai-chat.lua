-- AI Chat 双层浮动窗口
-- 上层：聊天历史（只读）  |  下层：输入区（可编辑）
-- 使用 DeepSeek API (OpenAI 兼容) 实现多轮对话

local M = {}

-- ===================================================================
-- 默认配置
-- ===================================================================
M.config = {
  api_url = 'https://api.deepseek.com/chat/completions',
  model = 'deepseek-chat',
  max_tokens = 4096,
  temperature = 0.7,
  enable_thinking = false,
}

-- ===================================================================
-- 内部状态
-- ===================================================================
M.state = {
  chat_win = nil,
  chat_buf = nil,
  input_win = nil,
  input_buf = nil,
  messages = {},        -- { {role, content}, ... }
  requesting = false,
  thinking_line = nil,  -- chat_buf 中 "thinking..." 占位行号 (1-indexed)
  prev_win = nil,
}

local ns_id = vim.api.nvim_create_namespace('AIChatNS')

-- ===================================================================
-- API Key 获取
-- ===================================================================
local function get_api_key()
  local key = os.getenv('DEEPSEEK_API_KEY')
  if key and key ~= '' then return key end

  local settings_path = os.getenv('HOME') .. '/.claude/settings_deepseek.json'
  local f = io.open(settings_path, 'r')
  if f then
    local content = f:read('*all')
    f:close()
    local ok, data = pcall(vim.json.decode, content)
    if ok and data.env and data.env.ANTHROPIC_AUTH_TOKEN then
      return data.env.ANTHROPIC_AUTH_TOKEN
    end
  end
  return nil
end

-- ===================================================================
-- API 调用（累积 stdout，在 on_exit 中解析，避免分段 JSON 错误）
-- ===================================================================
local function call_api(user_msg, callback)
  local api_key = get_api_key()
  if not api_key then
    vim.schedule(function()
      callback(nil, 'DeepSeek API key not found. Set $DEEPSEEK_API_KEY '
        .. 'or configure ~/.claude/settings_deepseek.json')
    end)
    return
  end

  if M.state.requesting then
    vim.schedule(function() callback(nil, 'A request is already in progress') end)
    return
  end
  M.state.requesting = true

  -- 构建消息列表
  local api_msgs = {}
  local system_prompt = 'You are a helpful programming and general assistant. '
    .. 'Answer in Chinese (Simplified) unless the user asks otherwise. '
    .. 'Be concise and precise.'
  if M.config.enable_thinking then
    system_prompt = system_prompt .. ' You may output reasoning before answers.'
  end
  table.insert(api_msgs, { role = 'system', content = system_prompt })

  for _, m in ipairs(M.state.messages) do
    if m.role ~= 'system' then
      table.insert(api_msgs, { role = m.role, content = m.content })
    end
  end
  table.insert(api_msgs, { role = 'user', content = user_msg })

  local body = vim.json.encode({
    model = M.config.model,
    messages = api_msgs,
    max_tokens = M.config.max_tokens,
    temperature = M.config.temperature,
    stream = false,
  })

  -- 累积 stdout
  local stdout_chunks = {}

  vim.fn.jobstart({
    'curl', '-s', '--max-time', '120',
    '-H', 'Content-Type: application/json',
    '-H', 'Authorization: Bearer ' .. api_key,
    '-d', body,
    M.config.api_url,
  }, {
    stdout_buffered = true,
    on_stdout = function(_, data)
      if data then
        for _, line in ipairs(data) do
          table.insert(stdout_chunks, line)
        end
      end
    end,
    on_exit = function(_, code)
      vim.schedule(function()
        M.state.requesting = false

        if code ~= 0 then
          callback(nil, 'curl exited with code ' .. tostring(code))
          return
        end

        local raw = table.concat(stdout_chunks, '')
        if raw == '' or raw:match('^%s*$') then
          callback(nil, 'Empty response from API')
          return
        end

        local ok, result = pcall(vim.json.decode, raw)
        if not ok then
          -- 截断原始响应用于调试
          local preview = raw:sub(1, 200)
          callback(nil, 'Failed to parse API response: ' .. preview)
          return
        end

        -- 优先检查错误
        if result.error then
          callback(nil, result.error.message or 'Unknown API error')
          return
        end

        local choice = result.choices and result.choices[1]
        if choice and choice.message then
          local content = choice.message.content or ''
          if choice.message.reasoning_content and choice.message.reasoning_content ~= '' then
            content = choice.message.reasoning_content .. '\n\n' .. content
          end
          callback(content, nil)
        else
          callback(nil, 'Unexpected API response structure')
        end
      end)
    end,
  })
end

-- ===================================================================
-- 高亮
-- ===================================================================
local function create_highlights()
  vim.api.nvim_set_hl(0, 'AIChatUser',  { fg = '#7dcfff', bold = true })
  vim.api.nvim_set_hl(0, 'AIChatAI',    { fg = '#c3e88d', bold = true })
  vim.api.nvim_set_hl(0, 'AIChatInput', { bg = '#1e2030' })
  vim.api.nvim_set_hl(0, 'AIChatSep',   { fg = '#585b70' })
end

-- ===================================================================
-- Chat buffer 渲染
-- ===================================================================
local function chat_append(role, content)
  local buf = M.state.chat_buf
  if not buf or not vim.api.nvim_buf_is_valid(buf) then return end

  local prefix, hl_group
  if role == 'user' then
    prefix = '▸ '
    hl_group = 'AIChatUser'
  else
    prefix = '◂ '
    hl_group = 'AIChatAI'
  end

  local last = vim.api.nvim_buf_line_count(buf)

  -- 前缀行
  vim.api.nvim_buf_set_lines(buf, last, last, false, { prefix .. content:match('^[^\r\n]*') or '' })
  vim.api.nvim_buf_add_highlight(buf, ns_id, hl_group, last, 0, -1)

  -- 续行（缩进两个空格）
  local rest_start = content:find('\n')
  if rest_start then
    local rest = content:sub(rest_start + 1)
    for line in rest:gmatch('[^\r\n]+') do
      last = vim.api.nvim_buf_line_count(buf)
      vim.api.nvim_buf_set_lines(buf, last, last, false, { '  ' .. line })
    end
  end

  -- 空行分隔
  last = vim.api.nvim_buf_line_count(buf)
  vim.api.nvim_buf_set_lines(buf, last, last, false, { '' })
end

local function show_thinking()
  local buf = M.state.chat_buf
  if not buf or not vim.api.nvim_buf_is_valid(buf) then return end
  local last = vim.api.nvim_buf_line_count(buf)
  vim.api.nvim_buf_set_lines(buf, last, last, false, { '◂ ⏳ 思考中...' })
  vim.api.nvim_buf_add_highlight(buf, ns_id, 'AIChatAI', last, 0, -1)
  M.state.thinking_line = last + 1 -- 1-indexed
end

local function replace_thinking(content)
  local buf = M.state.chat_buf
  if not buf or not M.state.thinking_line then return end
  if not vim.api.nvim_buf_is_valid(buf) then return end

  local line = M.state.thinking_line - 1 -- 0-indexed
  vim.api.nvim_buf_set_lines(buf, line, line + 1, false, {})
  M.state.thinking_line = nil

  -- 渲染实际消息
  local prefix = '◂ '
  vim.api.nvim_buf_set_lines(buf, line, line, false, { prefix .. content:match('^[^\r\n]*') or '' })
  vim.api.nvim_buf_add_highlight(buf, ns_id, 'AIChatAI', line, 0, -1)

  local next_line = line + 1
  local rest_start = content:find('\n')
  if rest_start then
    for content_line in content:sub(rest_start + 1):gmatch('[^\r\n]+') do
      vim.api.nvim_buf_set_lines(buf, next_line, next_line, false, { '  ' .. content_line })
      next_line = next_line + 1
    end
  end

  vim.api.nvim_buf_set_lines(buf, next_line, next_line, false, { '' })
end

-- ===================================================================
-- 发送消息
-- ===================================================================
-- 插入分隔线
local function insert_divider()
  local buf = M.state.chat_buf
  if not buf or not vim.api.nvim_buf_is_valid(buf) then return end
  local last = vim.api.nvim_buf_line_count(buf)
  vim.api.nvim_buf_set_lines(buf, last, last, false, { '─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─' })
  vim.api.nvim_buf_add_highlight(buf, ns_id, 'AIChatSep', last, 0, -1)
end

local function send_message(text)
  if not text or text:match('^%s*$') then return end

  -- 非首轮对话时插入分隔线
  if #M.state.messages > 0 then
    insert_divider()
  end

  -- 渲染到聊天区
  chat_append('user', text)
  show_thinking()

  -- 滚到底部
  local chat_buf = M.state.chat_buf
  if chat_buf and vim.api.nvim_buf_is_valid(chat_buf) then
    local last = vim.api.nvim_buf_line_count(chat_buf)
    vim.api.nvim_win_set_cursor(M.state.chat_win, { last, 0 })
  end

  -- 调用 API
  call_api(text, function(response, err)
    if not M.state.chat_win or not vim.api.nvim_win_is_valid(M.state.chat_win) then
      return
    end

    if err then
      if M.state.thinking_line then
        local buf = M.state.chat_buf
        if buf and vim.api.nvim_buf_is_valid(buf) then
          vim.api.nvim_buf_set_lines(buf, M.state.thinking_line - 1,
            M.state.thinking_line, false, {})
        end
        M.state.thinking_line = nil
      end
      chat_append('assistant', '❌ ' .. err)
      vim.notify('AI Chat: ' .. err, vim.log.levels.ERROR)
    else
      replace_thinking(response)
      table.insert(M.state.messages, { role = 'user', content = text })
      table.insert(M.state.messages, { role = 'assistant', content = response })
    end

    -- 滚到底部 + 聚焦输入区
    local chat_buf2 = M.state.chat_buf
    if chat_buf2 and vim.api.nvim_buf_is_valid(chat_buf2) then
      local last_line = vim.api.nvim_buf_line_count(chat_buf2)
      vim.api.nvim_win_set_cursor(M.state.chat_win, { last_line, 0 })
    end
    if M.state.input_win and vim.api.nvim_win_is_valid(M.state.input_win) then
      vim.api.nvim_set_current_win(M.state.input_win)
      vim.cmd('startinsert!')
    end
  end)
end

-- ===================================================================
-- 窗口管理
-- ===================================================================
local function create_chat_buf()
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = 'wipe'
  vim.bo[buf].buftype = 'nofile'
  vim.bo[buf].filetype = 'aichat'
  vim.bo[buf].modifiable = true

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, {
    'DeepSeek Chat  (' .. M.config.model .. ')',
    '',
  })

  return buf
end

local function create_input_buf()
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = 'wipe'
  vim.bo[buf].buftype = 'nofile'
  vim.bo[buf].filetype = 'aichat-input'
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { '' })
  return buf
end

local function open_windows()
  create_highlights()

  local total_width = math.min(100, vim.o.columns - 2)
  local total_height = math.min(36, vim.o.lines - 4)
  local col = math.max(2, math.floor((vim.o.columns - total_width) / 2))
  local row = math.max(2, math.floor((vim.o.lines - total_height) / 2))

  local input_height = 3
  local chat_height = total_height - input_height

  -- 聊天窗口（上层）
  local chat_buf = create_chat_buf()
  local chat_win = vim.api.nvim_open_win(chat_buf, true, {
    relative = 'editor',
    width = total_width,
    height = chat_height,
    row = row,
    col = col,
    style = 'minimal',
    border = 'rounded',
    title = ' DeepSeek Chat ',
    title_pos = 'center',
  })
  vim.wo[chat_win].wrap = true
  vim.wo[chat_win].linebreak = true
  vim.wo[chat_win].cursorline = false
  vim.wo[chat_win].scrolloff = 2

  -- 输入窗口（下层）
  local input_buf = create_input_buf()
  local input_win = vim.api.nvim_open_win(input_buf, false, {
    relative = 'editor',
    width = total_width,
    height = input_height,
    row = row + chat_height,
    col = col,
    style = 'minimal',
    border = 'rounded',
    title = ' Input ',
    title_pos = 'center',
  })
  vim.wo[input_win].wrap = true
  vim.wo[input_win].cursorline = true
  vim.wo[input_win].cursorlineopt = 'line'

  -- 输入窗口高亮背景
  vim.api.nvim_win_set_hl_ns(input_win, ns_id)
  vim.api.nvim_set_hl(ns_id, 'Normal', { bg = '#1e2030' })

  -- 聚焦输入窗口
  vim.api.nvim_set_current_win(input_win)
  vim.cmd('startinsert!')

  return chat_buf, chat_win, input_buf, input_win
end

-- ===================================================================
-- 键盘映射
-- ===================================================================
local function setup_keymaps()
  local input_buf = M.state.input_buf
  local chat_buf = M.state.chat_buf
  if not input_buf or not chat_buf then return end

  local input_opts = { buffer = input_buf, silent = true, nowait = true }
  local chat_opts  = { buffer = chat_buf,  silent = true, nowait = true }

  -- 输入区：Enter 发送
  vim.keymap.set('i', '<CR>', function()
    local buf = M.state.input_buf
    if not buf or not vim.api.nvim_buf_is_valid(buf) then return end
    local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    local text = table.concat(lines, '\n'):gsub('\n+$', '')
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, { '' })
    send_message(text)
  end, input_opts)

  vim.keymap.set('n', '<CR>', function()
    local buf = M.state.input_buf
    if not buf or not vim.api.nvim_buf_is_valid(buf) then return end
    local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    local text = table.concat(lines, '\n'):gsub('\n+$', '')
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, { '' })
    send_message(text)
  end, input_opts)

  -- 关闭（两侧均可，一起退出两个窗口）
  for _, key in ipairs({ '<Esc>', 'q', 'Q' }) do
    vim.keymap.set('n', key, function() M.close() end, input_opts)
    vim.keymap.set('n', key, function() M.close() end, chat_opts)
  end
  vim.keymap.set('i', '<Esc>', '<Esc>', input_opts)

  -- C-j 双向切换焦点（聊天 ↔ 输入）—— 唯一的窗口切换键
  local function toggle_focus()
    local cur = vim.api.nvim_get_current_win()
    if cur == M.state.input_win then
      if M.state.chat_win and vim.api.nvim_win_is_valid(M.state.chat_win) then
        vim.api.nvim_set_current_win(M.state.chat_win)
      end
    elseif cur == M.state.chat_win then
      if M.state.input_win and vim.api.nvim_win_is_valid(M.state.input_win) then
        vim.api.nvim_set_current_win(M.state.input_win)
        vim.cmd('startinsert!')
      end
    end
  end
  vim.keymap.set('n', '<C-j>', toggle_focus, chat_opts)
  vim.keymap.set('n', '<C-j>', toggle_focus, input_opts)
  vim.keymap.set('i', '<C-j>', '<Esc>:lua require("config.ai-chat").focus_chat()<CR>', input_opts)
end

-- ===================================================================
-- 公开 API
-- ===================================================================

function M.open(opts)
  opts = opts or {}
  if M.state.chat_win and vim.api.nvim_win_is_valid(M.state.chat_win) then
    -- 聚焦输入区
    if M.state.input_win and vim.api.nvim_win_is_valid(M.state.input_win) then
      vim.api.nvim_set_current_win(M.state.input_win)
      vim.cmd('startinsert!')
    end
    return
  end

  M.state.prev_win = vim.api.nvim_get_current_win()
  local chat_buf, chat_win, input_buf, input_win = open_windows()

  M.state.chat_buf = chat_buf
  M.state.chat_win = chat_win
  M.state.input_buf = input_buf
  M.state.input_win = input_win
  M.state.messages = {}
  M.state.requesting = false
  M.state.thinking_line = nil

  -- 任一窗口关闭时联动关闭另一个
  vim.api.nvim_create_autocmd('WinClosed', {
    buffer = chat_buf,
    once = true,
    callback = function()
      if M.state.input_win and vim.api.nvim_win_is_valid(M.state.input_win) then
        vim.api.nvim_win_close(M.state.input_win, true)
      end
    end,
  })
  vim.api.nvim_create_autocmd('WinClosed', {
    buffer = input_buf,
    once = true,
    callback = function()
      if M.state.chat_win and vim.api.nvim_win_is_valid(M.state.chat_win) then
        vim.api.nvim_win_close(M.state.chat_win, true)
      end
    end,
  })

  setup_keymaps()

  if opts.initial_text and opts.initial_text ~= '' then
    send_message(opts.initial_text)
  end
end

function M.open_with_selection()
  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")
  local selection = nil

  if start_pos[2] > 0 and end_pos[2] > 0 then
    local lines = vim.fn.getline(start_pos[2], end_pos[2])
    if #lines > 0 then
      lines[1] = lines[1]:sub(start_pos[3])
      lines[#lines] = lines[#lines]:sub(1, end_pos[3])
      selection = table.concat(lines, '\n')
    end
  end

  M.open({ initial_text = selection })
end

function M.close()
  -- 关闭输入窗口
  if M.state.input_win and vim.api.nvim_win_is_valid(M.state.input_win) then
    vim.api.nvim_win_close(M.state.input_win, true)
  end
  -- 关闭聊天窗口
  if M.state.chat_win and vim.api.nvim_win_is_valid(M.state.chat_win) then
    vim.api.nvim_win_close(M.state.chat_win, true)
  end

  M.state.chat_win = nil
  M.state.chat_buf = nil
  M.state.input_win = nil
  M.state.input_buf = nil
  M.state.messages = {}
  M.state.requesting = false
  M.state.thinking_line = nil

  if M.state.prev_win and vim.api.nvim_win_is_valid(M.state.prev_win) then
    vim.api.nvim_set_current_win(M.state.prev_win)
  end
end

function M.toggle()
  if M.state.chat_win and vim.api.nvim_win_is_valid(M.state.chat_win) then
    M.close()
  else
    M.open()
  end
end

function M.focus_chat()
  if M.state.chat_win and vim.api.nvim_win_is_valid(M.state.chat_win) then
    vim.api.nvim_set_current_win(M.state.chat_win)
  end
end

function M.focus_input()
  if M.state.input_win and vim.api.nvim_win_is_valid(M.state.input_win) then
    vim.api.nvim_set_current_win(M.state.input_win)
    vim.cmd('startinsert!')
  end
end

return M
