-- UI: dressing, noice, notify, web-devicons

return {
  {
    'nvim-tree/nvim-web-devicons',
    lazy = true,
  },
  {
    'MunifTanjim/nui.nvim',
    lazy = true,
  },
  {
    'stevearc/dressing.nvim',
    event = 'VeryLazy',
    config = function()
      require('dressing').setup({
        input = {
          enabled = true,
          border = 'rounded',
          win_options = { winblend = 0 },
          insert_only = false,
          start_in_insert = true,
        },
        select = {
          enabled = true,
          backend = { 'fzf_lua', 'fzf', 'builtin' },
          fzf_lua = {
            winopts = { height = 0.5, width = 0.8 },
          },
          builtin = {
            border = 'rounded',
            win_options = { winblend = 0 },
          },
        },
      })
    end,
  },
  {
    'rcarriga/nvim-notify',
    event = 'VeryLazy',
    config = function()
      require('notify').setup({
        background_colour = '#1a1b26',
        stages = 'slide',
        timeout = 1500,
        render = 'compact',
        max_width = math.floor(vim.api.nvim_win_get_width(0) / 2),
        max_height = math.floor(vim.api.nvim_win_get_height(0) / 4),
        border = { style = 'rounded', padding = { 1, 2 } },
      })
    end,
  },
  {
    'folke/noice.nvim',
    event = 'VeryLazy',
    config = function()
      require('noice').setup({
        lsp = {
          progress = { enabled = false },
          signature = { enabled = false },
        },
        presets = {
          command_palette = false,
          long_message_to_split = true,
          lsp_doc_border = true,
        },
        cmdline = {
          view = 'cmdline_popup',
          format = {
            cmdline = { pattern = '^:', icon = ' ', lang = 'vim' },
            lua = { pattern = '^:%s*lua', icon = ' ', lang = 'lua' },
            help = { pattern = '^:%s*he?l?p?', icon = ' ' },
          },
        },
        views = {
          cmdline_popup = {
            position = { row = '100%', col = '50%' },
            size = { width = '100%', height = 'auto' },
          },
          popupmenu = {
            relative = 'editor',
            position = { row = '100%', col = '50%' },
            size = { width = '100%', height = 'auto' },
          },
          mini = {
            position = { row = -1, col = 0 },
            win_options = { winblend = 0 },
          },
        },
        routes = {
          { view = 'mini', filter = { event = 'msg_show', kind = 'search_count' } },
          { view = 'notify', filter = { error = true } },
        },
      })
    end,
  },
}
