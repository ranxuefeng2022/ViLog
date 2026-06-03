-- Animated editor border with breathing colors
return {
  {
    dir = vim.fn.stdpath('config'),
    name = 'border-anim',
    lazy = false,
    keys = {
      { '<leader>bd', function() require('config.border-anim').toggle() end, desc = 'Toggle border animation' },
    },
    config = function()
      local anim = require('config.border-anim')
      local ft = vim.bo[0].filetype
      local name = vim.api.nvim_buf_get_name(0)
      if ft ~= '' or name ~= '' then
        anim.start()
      end
    end,
  },
}
