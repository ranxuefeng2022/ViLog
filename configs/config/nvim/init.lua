-- Neovim 主配置文件

-- 加载传统 Vim 配置
vim.cmd('source ' .. vim.fn.stdpath("config") .. '/init.VIM')

-- 光标设置
vim.opt.guicursor = "n-v-c-sm-ci-ve-r-cr-o:ver25"

-- 退出时恢复光标形状
vim.api.nvim_create_autocmd("VimLeave", {
  callback = function()
    vim.opt.guicursor = "n-v-c-sm-ci-ve-r-cr-o:ver25"
  end,
})

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
  },
  file_icons = true,
  git_status = true,
  grep = {
    rg_opts = "--threads 79 -L --column --line-number --no-heading --color=always --smart-case",
  },
}

require("scrollbar").setup({
  show = true,
  handle = {
    text = " ",
    color = "#555555",
    hide_if_all_visible = true,
  },
  marks = {
    Cursor = { text = "•", color = "#e0af68" },
    Search = { text = "-", color = "#ff9e64" },
    Error = { text = "-", color = "#db4b4b" },
    Warn = { text = "-", color = "#e0af68" },
    Info = { text = "-", color = "#0db9d7" },
    Hint = { text = "-", color = "#1abc9c" },
    Misc = { text = "-", color = "#565f89" },
    GitAdd = { text = "┃", color = "#73daca" },
    GitChange = { text = "┃", color = "#7aa2f7" },
    GitDelete = { text = "▁", color = "#db4b4b" },
  },
  handlers = {
    cursor = true,
    diagnostic = true,
    gitsigns = false,
    search = false,
  },
})
require('dressing').setup({
  input = {
    enabled = true,
    border = "rounded",
    win_options = {
      winblend = 0,
    },
    insert_only = false,
    start_in_insert = true,
  },
  select = {
    enabled = true,
    backend = { "fzf_lua", "fzf", "builtin" },
    fzf_lua = {
      winopts = {
        height = 0.5,
        width = 0.8,
      },
    },
    builtin = {
      border = "rounded",
      win_options = {
        winblend = 0,
      },
    },
  },
})

-- 通知配置
require("notify").setup({
  background_colour = "#1a1b26",
  stages = "slide",
  timeout = 1500,
  render = "compact",
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
    override = {
      ["vim.lsp.util.convert_input_to_markdown_lines"] = true,
      ["vim.lsp.util.stylize_markdown"] = true,
    },
  },
  presets = {
    command_palette = true,
    long_message_to_split = true,
    inc_rename = true,
    lsp_doc_border = true,
  },
  search = {
    enabled = false,
  },
  cmdline = {
    format = {
      cmdline = { pattern = "^:", icon = " ", lang = "vim" },
      search_down = { kind = "search", pattern = "^/", icon = " 🔍⌄", lang = "regex" },
      search_up = { kind = "search", pattern = "^%?", icon = " 🔍⌃", lang = "regex" },
      lua = { pattern = "^:%s*lua", icon = " ", lang = "lua" },
      help = { pattern = "^:%s*he?l?p?", icon = " " },
    },
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
    { view = "notify", filter = { error = true } },
    { filter = { event = "msg_show" }, opts = { skip = true } },
  },
})

-- Hop 插件
require('hop').setup()

-- 复制时高亮闪烁确认
vim.api.nvim_create_autocmd("TextYankPost", {
  callback = function()
    vim.highlight.on_yank({ higroup = "IncSearch", timeout = 300 })
  end,
})

-- Indent Blankline：缩进对齐线
local ok_ibl, ibl = pcall(require, 'ibl')
if ok_ibl then
  ibl.setup({
    indent = { char = "│" },
    scope = { enabled = false },
  })
end

-- ======================= Flash：快速跳转 =======================
local ok_flash, flash = pcall(require, 'flash')
if ok_flash then
  flash.setup({
    modes = { search = { enabled = false } },
  })
  vim.keymap.set({ 'n', 'x', 'o' }, 'gs', function() flash.jump() end)
  vim.keymap.set({ 'n', 'x', 'o' }, 'gS', function() flash.treesitter() end)
  vim.keymap.set('o', 'r', function() flash.remote() end)
  vim.keymap.set({ 'x', 'o' }, '<leader>s', function() flash.treesitter_search() end)
end

-- ======================= Neoscroll：平滑滚动 =======================
local ok_neo, neoscroll = pcall(require, 'neoscroll')
if ok_neo then
  neoscroll.setup({
    mappings = {},
    hide_cursor = true,
    stop_eof = true,
    respect_scrolloff = true,
    cursor_scrolls_alone = true,
    performance_mode = true,
  })
  local ns = require('neoscroll').scroll
  vim.keymap.set('n', '<C-j>', function() ns(6, 'cursorline') end)
  vim.keymap.set('n', '<C-k>', function() ns(-6, 'cursorline') end)
  vim.keymap.set('n', '<C-e>', function() ns(6, 'cursorline') end)
end

-- ======================= Zen Mode：无干扰模式 =======================
local ok_zen, zen = pcall(require, 'zen-mode')
if ok_zen then
  zen.setup({
    window = {
      width = 120,
      height = 1,
      options = { signcolumn = 'no', number = false, cursorline = false },
    },
    plugins = {
      gitsigns = { enabled = false },
      scrollbar = { enabled = false },
    },
    on_open = function(win)
      vim.wo.wrap = true
      vim.wo.linebreak = true
    end,
    on_close = function()
      vim.wo.wrap = false
    end,
  })
end

-- ======================= Neogit：Git 界面 =======================
local ok_neogit, neogit = pcall(require, 'neogit')
if ok_neogit then
  neogit.setup({
    kind = 'tab',
    signs = {
      section = { '', '' },
      item = { '', '' },
      hunk = { '', '' },
    },
    integrations = { diffview = false },
    sections = {
      recent = { folded = false },
    },
  })
end
