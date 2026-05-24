-- Terminal + file manager

return {
  {
    'akinsho/toggleterm.nvim',
    cmd = 'ToggleTerm',
    keys = {
      { '<leader>t', '<cmd>ToggleTerm<CR>', mode = 'n', desc = 'Toggle terminal' },
    },
    config = function()
      require('toggleterm').setup({
        size = function(term)
          if term.direction == 'horizontal' then return vim.o.lines * 0.4
          elseif term.direction == 'vertical' then return vim.o.columns * 0.4 end
        end,
        direction = 'float',
        close_on_exit = true,
        shell = vim.o.shell,
        auto_scroll = true,
        float_opts = { border = 'curved', winblend = 0 },
        highlights = {
          Normal = { guibg = '#1a1b26' },
          NormalFloat = { guibg = '#1a1b26' },
          FloatBorder = { guifg = '#565f89', guibg = '#1a1b26' },
        },
        winbar = {
          enabled = true,
          name_formatter = function(term) return string.format(' Terminal #%d ', term.id) end,
        },
      })
    end,
  },
  {
    'DreamMaoMao/yazi.nvim',
    cmd = 'Yazi',
    keys = {
      { 'ca', '<cmd>Yazi<CR>', mode = 'n', desc = 'Yazi file manager' },
    },
  },
}
