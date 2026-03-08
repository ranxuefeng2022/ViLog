-- Neovim 主配置文件

-- 加载传统 Vim 配置
vim.cmd('source ' .. vim.fn.stdpath("config") .. '/init.VIM')

-- 加载模块化配置

-- 插件管理
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)


-- 主题配置
require('kanagawa').setup({
    compile = true,
    undercurl = true,
    commentStyle = { italic = true },
    functionStyle = {},
    keywordStyle = { italic = true},
    statementStyle = { bold = true },
    typeStyle = {},
    transparent = false,
    dimInactive = false,
    terminalColors = true,
    colors = {
        palette = {},
        theme = { wave = {}, lotus = {}, dragon = {}, all = {} },
    },
    overrides = function(colors)
        return {}
    end,
    theme = "wave",
    background = {
        dark = "wave",
        light = "lotus"
    },
})

-- 光标设置
vim.opt.guicursor = "n-v-c-sm:block,i-ci-ve:block,r-cr-o:block"

-- 插件配置
require("fzf-lua").setup {
  fzf_opts = {
    ["--preview-window"] = "down:50%"
  },
  winopts = {
    height = 1,
    width = 1,
    preview = {
      layout = 'horizontal',
      horizontal = 'down:50%',
    }
  }
}

require("scrollbar").setup()
require('dressing').setup()

-- 通知配置
require("notify").setup({
  background_colour = "#1a1b26",
  stages = "slide",
  timeout = 200,
  render = "minimal",
  max_width = math.floor(vim.api.nvim_win_get_width(0) / 2),
  max_height = math.floor(vim.api.nvim_win_get_height(0) / 4),
  border = {
    style = "rounded",
    padding = { 1, 2 },
  },
})

-- Noice 配置
require("noice").setup({
  lsp = {
    progress = { enabled = false },
    signature = { enabled = false },
  },
  presets = {
    command_palette = true,
    long_message_to_split = true,
    inc_rename = true,
  },
  views = {
    cmdline_popup = {
      position = { row = "100%", col = "50%" },
      size = { width = "100%", height = "auto" },
    },
    cmdline_popupsearch = {
      position = { row = "100%", col = "50%" },
      size = { width = "100%", height = "auto" },
    },
    popupmenu = {
      relative = "editor",
      position = { row = "100%", col = "50%" },
      size = { width = "100%", height = "auto" },
    },
  },
  routes = {
    { filter = { event = "msg_show", find = "已写入" }, opts = { skip = true } },
    { view = "notify", filter = { error = true } },
  },
})

-- Hop 插件
require('hop').setup()
