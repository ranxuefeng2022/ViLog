-- Editor enhancements: animations, indentation, flash jump

return {
  {
    'echasnovski/mini.animate',
    event = 'VeryLazy',
    config = function()
      local anim = require('mini.animate')
      anim.setup({
        cursor = { enable = false },  -- 光标动画：每次移动多帧重绘，是滚动卡顿主因之一
        scroll = { enable = false },
        resize = {
          enable = true,
          timing = anim.gen_timing.cubic({ easing = 'out', duration = 80, unit = 'total' }),
        },
        open = {
          enable = true,
          timing = anim.gen_timing.cubic({ easing = 'out', duration = 100, unit = 'total' }),
        },
        close = {
          enable = true,
          timing = anim.gen_timing.cubic({ easing = 'out', duration = 100, unit = 'total' }),
        },
      })
    end,
  },
{
    'folke/flash.nvim',
    event = 'VeryLazy',
    config = function()
      require('flash').setup({
        modes = { char = { enabled = false } },
      })
    end,
  },
}
