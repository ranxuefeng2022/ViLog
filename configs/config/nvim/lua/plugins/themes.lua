-- Color schemes: tokyonight (default), catppuccin, kanagawa

return {
  {
    'folke/tokyonight.nvim',
    lazy = false, -- loaded at startup as default theme
    priority = 1000,
  },
  {
    'catppuccin/nvim',
    name = 'catppuccin',
    lazy = true,
    config = function()
      require('catppuccin').setup({ flavour = 'mocha' })
    end,
  },
  {
    'rebelot/kanagawa.nvim',
    lazy = true,
    config = function()
      require('kanagawa').setup({ theme = 'wave' })
    end,
  },
}
