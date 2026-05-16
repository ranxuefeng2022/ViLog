-- 缩进/空格可视化 - VSCode/SourceInsight 简约风格

local M = {}

-- 方案选择：'minimal' (极简直线) | 'subtle' (淡色点线) | 'dot' (点阵)
local style = 'subtle'

local styles = {
  minimal = {
    tab = '│ ',
    lead = '│',
    space = '·',
  },
  subtle = {
    tab = '▸ ',
    lead = '·',
    space = '·',
  },
  dot = {
    tab = '▸ ',
    lead = '·',
    space = '·',
  },
}

local s = styles[style]

-- 启用 list 模式
vim.o.list = true
vim.opt.listchars = {
  tab = s.tab,
  lead = s.lead,
  trail = s.space,
  nbsp = '␣',
  extends = '›',
  precedes = '‹',
}

-- 高亮组设置（低对比度，不干扰阅读）
local function setup_highlights()
  local palette = {
    -- 根据背景自动调整
    indent = '#3a3a4a',      -- 缩进线：极淡灰
    space = '#3a3a4a',       -- 空格：与缩进线同色
    trail = '#4a3a3a',       -- 行尾空格：淡红底色（提示性）
  }

  -- Whitespace 控制所有 listchars 显示
  vim.api.nvim_set_hl(0, 'Whitespace', { fg = palette.indent })
  -- 行尾空格高亮
  vim.api.nvim_set_hl(0, 'TrailingSpace', { bg = palette.trail })
end

-- 初始设置
setup_highlights()

-- 主题变更时重新应用
vim.api.nvim_create_autocmd('ColorScheme', {
  group = vim.api.nvim_create_augroup('IndentGuideHL', { clear = true }),
  callback = setup_highlights,
})

return M
