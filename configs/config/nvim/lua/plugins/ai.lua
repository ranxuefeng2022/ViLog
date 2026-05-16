-- AI assistants: claude-code, llm, minuet

return {
  {
    'greggh/claude-code.nvim',
    cmd = 'ClaudeCode',
    keys = {
      { '<leader>ac', '<cmd>ClaudeCode<CR>',              mode = 'n',     desc = 'Toggle Claude Code' },
      { '<C-,>',      '<cmd>ClaudeCode<CR>',              mode = { 'n', 't' } },
      { '<leader>cC', '<cmd>ClaudeCode continue<CR>',     mode = 'n',     desc = 'Claude continue' },
      { '<leader>cV', '<cmd>ClaudeCode verbose<CR>',      mode = 'n',     desc = 'Claude verbose' },
    },
    config = function()
      require('claude-code').setup({
        window = { split_ratio = 0.35, position = 'vertical', enter_insert = true },
        refresh = { enable = true, updatetime = 100, timer_interval = 1000, show_notifications = false },
        git = { use_git_root = true },
        keymaps = {
          toggle = {
            normal = '<C-,>',
            terminal = '<C-,>',
            variants = { continue = '<leader>cC', verbose = '<leader>cV' },
          },
          window_navigation = true,
          scrolling = true,
        },
      })

      vim.keymap.set({ 'n', 't' }, '<leader>az', function()
        local claude_buf
        for _, buf in ipairs(vim.api.nvim_list_bufs()) do
          if vim.api.nvim_buf_get_name(buf):match('claude%-code') then
            claude_buf = buf
            break
          end
        end
        if not claude_buf then return end
        local claude_win = vim.fn.bufwinid(claude_buf)
        if #vim.api.nvim_list_wins() == 1 then
          vim.cmd('leftabove vsplit')
          vim.api.nvim_win_set_buf(vim.api.nvim_get_current_win(), claude_buf)
          vim.cmd('wincmd h')
        else
          if claude_win > 0 then
            vim.api.nvim_set_current_win(claude_win)
            vim.cmd('only')
          end
        end
      end, { desc = 'Toggle Claude fullscreen' })
    end,
  },
  {
    'milanglacier/minuet-ai.nvim',
    event = 'InsertEnter',
    cond = function() return os.getenv('DEEPSEEK_API_KEY') ~= nil end,
    config = function()
      require('minuet').setup({
        provider = 'openai_compatible',
        notify = 'verbose',
        context_window = 8000,
        request_timeout = 5,
        throttle = 800,
        debounce = 300,
        n_completions = 3,
        virtualtext = {
          auto_trigger_ft = { '*' },
          keymap = {
            accept = '<C-Y>', accept_line = '<C-L>',
            prev = '<C-P>', next = '<C-N>', dismiss = '<C-E>',
          },
        },
        provider_options = {
          openai_compatible = {
            end_point = 'https://api.deepseek.com/chat/completions',
            api_key = 'DEEPSEEK_API_KEY',
            name = 'deepseek',
            model = 'deepseek-chat',
            optional = { max_tokens = 256, top_p = 0.9 },
          },
        },
      })
      vim.api.nvim_create_autocmd({ 'BufEnter', 'FileType' }, {
        callback = function() vim.b.minuet_virtual_text_auto_trigger = true end,
      })
    end,
  },
  {
    'Kurama622/llm.nvim',
    cmd = { 'LLMSessionToggle', 'LLMAppHandler' },
    keys = {
      { '<leader>al', '<cmd>LLMSessionToggle<cr>',              mode = 'n', desc = 'LLM chat' },
      { '<leader>ae', '<cmd>LLMAppHandler CodeExplain<cr>',     mode = 'x', desc = 'Explain code' },
      { '<leader>at', '<cmd>LLMAppHandler Translate<cr>',       mode = 'x', desc = 'Translate' },
    },
    cond = function() return os.getenv('DEEPSEEK_API_KEY') ~= nil end,
    config = function()
      local tools = require('llm.tools')
      require('llm').setup({
        url = 'https://api.deepseek.com/chat/completions',
        model = 'deepseek-chat',
        api_type = 'deepseek',
        max_tokens = 4096,
        temperature = 0.3,
        top_p = 0.7,
        enable_thinking = false,
        fetch_key = function() return os.getenv('DEEPSEEK_API_KEY') or '' end,
        prompt = 'You are a helpful programming assistant.',
        prefix = { user = { text = '> ', hl = 'Title' }, assistant = { text = 'AI ', hl = 'Added' } },
        style = 'float',
        chat_ui_opts = {
          relative = 'editor',
          position = { row = '3%', col = '62%' },
          size = { width = '36%', height = '94%' },
          border = { style = 'rounded' },
        },
        save_session = true,
        max_history = 15,
        max_history_name_length = 20,
        app_handler = {
          CodeExplain = {
            handler = tools.flexi_handler,
            prompt = 'You are a helpful programming assistant. Please explain the following code in detail in Chinese.',
            opts = { enter_flexible_window = false },
          },
          Translate = {
            handler = tools.flexi_handler,
            prompt = 'Translate the following text to Chinese. Only return the translation, no explanation.',
            opts = { enter_flexible_window = false },
          },
        },
        keys = {
          ['Input:Submit']      = { mode = { 'n', 'i' }, key = '<CR>' },
          ['Input:Cancel']      = { mode = { 'n', 'i' }, key = '<C-c>' },
          ['Input:Resend']      = { mode = { 'n', 'i' }, key = '<C-r>' },
          ['Input:HistoryNext'] = { mode = { 'i' },      key = '<C-j>' },
          ['Input:HistoryPrev'] = { mode = { 'i' },      key = '<C-k>' },
          ['Output:Cancel']     = { mode = 'n',          key = '<C-c>' },
          ['Output:Resend']     = { mode = 'n',          key = '<C-r>' },
          ['Focus:Input']       = { mode = 'n',          key = 'i' },
          ['Focus:Output']      = { mode = { 'i', 'n' }, key = '<C-o>' },
          ['Session:Toggle']    = { mode = 'n',          key = '<leader>al' },
          ['Session:Close']     = { mode = 'n',          key = { '<esc>', 'Q' } },
          ['PageUp']            = { mode = { 'i', 'n' }, key = '<C-b>' },
          ['PageDown']          = { mode = { 'i', 'n' }, key = '<C-f>' },
          ['HalfPageUp']        = { mode = { 'i', 'n' }, key = '<C-u>' },
          ['HalfPageDown']      = { mode = { 'i', 'n' }, key = '<C-d>' },
        },
      })
    end,
  },
}
