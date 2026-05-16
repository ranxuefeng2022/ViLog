-- Neovim 主配置
-- 加载顺序: options → lazy(plugins) → UI/commands/keymaps/autocmds

require('config.options')
require('config.lazy')

-- 主题预览选择器
require('config.theme-picker')

-- UI / 交互模块
require('config.statusline')
require('config.indent-guide')
require('config.match-hl').setup()  -- 括号/引号配对高亮
require('config.commands')
require('config.keymaps')
require('config.autocmds')
require('config.neovide')

-- 默认主题
vim.cmd('colorscheme tokyonight-night')
-- 覆盖主题高亮（直接跟在 colorscheme 之后，保证启动时一定生效）
_G.apply_highlight_overrides()

-- 窗口分隔线 - 更精致的细线
vim.api.nvim_set_hl(0, 'WinSeparator', { fg = '#2f3040', bg = 'NONE' })
vim.opt.fillchars:append({ vert = '│', horiz = '─', verthoriz = '┼', horizup = '┴', horizdown = '┬' })

-- yank 闪烁确认
vim.api.nvim_create_autocmd('TextYankPost', {
  callback = function()
    vim.highlight.on_yank({ higroup = 'IncSearch', timeout = 300 })
  end,
})
