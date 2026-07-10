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
        start_in_insert = true,
        close_on_exit = true,
        -- Export NVIM_TOGGLETERM so .zshrc can skip starship/compinit for faster startup.
        shell = 'env NVIM_TOGGLETERM=1 ' .. vim.o.shell,
        auto_scroll = true,
        float_opts = { border = 'curved', winblend = 0 },
        highlights = {
          Normal = { guibg = '#1a1b26' },
          NormalFloat = { guibg = '#1a1b26' },
          FloatBorder = { guifg = '#565f89', guibg = '#1a1b26' },
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
