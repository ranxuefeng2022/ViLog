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
    ["--preview-window"] = "down:50%",
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

-- ======================= mini.animate：动画效果 =======================
local ok_mini_animate, mini_animate = pcall(require, 'mini.animate')
if ok_mini_animate then
  mini_animate.setup({
    cursor = {
      enable = false, -- 禁用，已由 luxmotion + smear-cursor 处理
    },
    scroll = {
      enable = false,
    },
    resize = {
      enable = true,
      timing = function(_, n) return 50 / n end,
    },
    open = {
      enable = true,
      timing = function(_, n) return 30 / n end,
    },
    close = {
      enable = true,
      timing = function(_, n) return 30 / n end,
    },
  })
end

-- ======================= vim-matchup：增强 % 匹配 =======================
vim.g.matchup_matchparen_deferred = 1      -- 延迟高亮，提升性能
vim.g.matchup_matchparen_status_offscreen = 1 -- 在状态栏显示匹配信息
vim.g.matchup_surround_enabled = 1
vim.g.matchup_transmute_enabled = 1
vim.g.matchup_mappings_enable_count = 1     -- 允许使用数字前缀
vim.g.matchup_delim_noskips = 0
vim.g.matchup_matchparen_singleton = 1     -- 单行也高亮
vim.g.matchup_matchparen_deferred_show_delay = 50

-- ======================= neovim-luxmotion：流畅光标动画 =======================
local ok_luxmotion, luxmotion = pcall(require, 'luxmotion')
if ok_luxmotion then
  luxmotion.setup({
    fps = 60,
    performance_mode = false,
    cursor = {
      enable = true,
      move = {
        enable = true,
        duration = 100,
        easing = 'easeInOutCubic',
      },
      word_jump = {
        enable = true,
        duration = 80,
        easing = 'easeOutQuad',
      },
      viewport_scroll = {
        enable = false, -- 禁用视口滚动动画，避免滚动卡顿
      },
    },
    fast_action = {
      enable = false, -- 快速操作时不显示动画
      threshold = 100,
    },
  })
end

-- ======================= smear-cursor：光标拖尾 =======================
local ok_smear, smear_cursor = pcall(require, 'smear_cursor')
if ok_smear then
  smear_cursor.setup({
    smear_between_buffers = true,
    smear_between_neighbor_lines = true,
    scroll_buffer_space = false, -- 禁用滚动时的拖尾，避免卡顿
    legacy_computing_symbols_support = false,
    cursor_color = "#FF8C00",
    stiffness = 0.6,
    trailing_stiffness = 0.3,
    distance_stop_animating = 0.5,
    hide_target_hack = true,
  })
  -- 大文件自动禁用 smear-cursor，避免滚动卡顿
  vim.api.nvim_create_autocmd("BufReadPre", {
    callback = function()
      if vim.fn.getfsize(vim.fn.expand("<afile>")) > 500 * 1024 then
        vim.b.smear_cursor_disabled = true
      end
    end,
  })
end

-- ======================= NeoNoName：缓冲区切换淡入淡出 =======================
local ok_noname, neoname = pcall(require, 'neo-no-name')
if ok_noname then
  neoname.setup({
    blend = 10,
    fade_time = 150,
  })
end

-- ======================= hlchunk：代码块缩进高亮 =======================
vim.defer_fn(function()
  local ok_hlchunk, hlchunk = pcall(require, 'hlchunk')
  if ok_hlchunk then
    hlchunk.setup({
      chunk = {
        enable = true,
        use_treesitter = false,
        chars = {
          horizontal_line = "─",
          vertical_line = "│",
          left_top = "╭",
          left_bottom = "╰",
          right_top = "╮",
          right_bottom = "╯",
        },
        style = { { fg = "#7aa2f7" }, { fg = "#c21f30" } },
        duration = 0,   -- 禁用动画，瞬间绘制
        delay = 100,    -- 增大延迟，减少连续滚动时的重绘频率
      },
      indent = {
        enable = false,
      },
      line_num = {
        enable = false,
      },
      blank = {
        enable = false,
      },
    })
  end
end, 200)

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

-- ======================= Claude Code：AI 助手 =======================
local ok_claude, claude_code = pcall(require, 'claude-code')
if ok_claude then
  claude_code.setup({
    window = {
      split_ratio = 0.35,
      position = "botright",
      enter_insert = true,
    },
    refresh = {
      enable = true,
      updatetime = 100,
      timer_interval = 1000,
      show_notifications = false,
    },
    git = {
      use_git_root = true,
    },
    keymaps = {
      toggle = {
        normal = "<C-,>",
        terminal = "<C-,>",
        variants = {
          continue = "<leader>cC",
          verbose = "<leader>cV",
        },
      },
      window_navigation = true,
      scrolling = true,
    },
  })
  vim.keymap.set('n', '<leader>ac', '<cmd>ClaudeCode<CR>', { desc = 'Toggle Claude Code' })
end

-- ======================= LazyGit：Git 终端界面 =======================
vim.g.lazygit_floating_window_winblend = 0
vim.g.lazygit_floating_window_scaling_factor = 0.9
vim.g.lazygit_floating_window_corner_chars = {'╭', '╮', '╰', '╯'}
vim.g.lazygit_floating_window_use_plenary = 0
vim.g.lazygit_use_neovim_remote = 1

-- ======================= Aerial：代码大纲 =======================
local ok_aerial, aerial = pcall(require, 'aerial')
if ok_aerial then
  aerial.setup({
    backends = { "lsp", "treesitter", "markdown" },
    layout = {
      max_width = { 60, 0.3 },
      width = nil,
      min_width = 30,
      default_direction = "right",
      placement = "window",
    },
    attach_mode = "window",
    show_guides = true,
    guides = {
      mid_item = "├─",
      last_item = "└─",
      nested_top = "│ ",
      whitespace = "  ",
    },
    float = {
      border = "rounded",
      relative = "win",
      max_height = 0.9,
      height = nil,
      min_height = { 8, 0.1 },
    },
    keymaps = {
      ["<CR>"] = "actions.jump",
      ["<2-LeftMouse>"] = "actions.jump",
    },
    lsp = {
      diagnostics_trigger_update = false,
      update_when_errors = true,
    },
    treesitter = {
      update_delay = 300,
    },
    filter_kind = false,
    disable_max_lines = 100000,
  })
end

-- ======================= ToggleTerm：浮动终端 =======================
local ok_toggleterm, toggleterm = pcall(require, 'toggleterm')
if ok_toggleterm then
  toggleterm.setup({
    size = function(term)
      if term.direction == "horizontal" then
        return vim.o.lines * 0.4
      elseif term.direction == "vertical" then
        return vim.o.columns * 0.4
      end
    end,
    hide_mapping = '<Esc>',
    direction = 'float',
    close_on_exit = true,
    shell = vim.o.shell,
    auto_scroll = true,
    float_opts = {
      border = 'curved',
      winblend = 0,
    },
    highlights = {
      Normal = { guibg = '#1a1b26' },
      NormalFloat = { guibg = '#1a1b26' },
      FloatBorder = { guifg = '#565f89', guibg = '#1a1b26' },
    },
    winbar = {
      enabled = true,
      name_formatter = function(term)
        return string.format(' Terminal #%d ', term.id)
      end,
    },
  })

  -- 只在普通模式绑定终端开关
  vim.keymap.set('n', '<leader>t', '<cmd>ToggleTerm<CR>', { desc = 'Toggle terminal' })

  -- 终端模式快捷键：Esc 退出终端
  function _G.set_terminal_keymaps()
    local opts = { buffer = 0 }
    -- 检查是否是 fzf 终端，如果是则不设置窗口切换映射
    local buf_name = vim.api.nvim_buf_get_name(0)
    local is_fzf = buf_name:match("fzf") or buf_name:match("Fzf")

    vim.keymap.set('t', '<Esc>', [[<C-\><C-n>]], opts)

    -- 只在非 fzf 终端中设置 Ctrl+hjkl 窗口切换
    if not is_fzf then
      vim.keymap.set('t', '<C-h>', [[<C-\><C-n><C-w>h]], opts)
      vim.keymap.set('t', '<C-j>', [[<C-\><C-n><C-w>j]], opts)
      vim.keymap.set('t', '<C-k>', [[<C-\><C-n><C-w>k]], opts)
      vim.keymap.set('t', '<C-l>', [[<C-\><C-n><C-w>l]], opts)
    end
  end
  vim.api.nvim_create_autocmd("TermOpen", {
    pattern = "term://*",
    callback = set_terminal_keymaps,
  })
end


-- ======================= snacks.nvim：QoL 工具集 =======================
local ok_snacks, snacks = pcall(require, 'snacks')
if ok_snacks then
  snacks.setup({
    bigfile = { enabled = true },
    quickfile = { enabled = true },
    scroll = { enabled = false },
    indent = { enabled = false },
    input = { enabled = false },
    notifier = { enabled = false },
    statuscolumn = { enabled = false },
    dashboard = { enabled = false },
    explorer = { enabled = false },
    picker = { enabled = false },
    scope = { enabled = false },
    words = { enabled = false },
  })
end

-- ======================= drop.nvim：屏保下落动画 =======================
local ok_drop, drop = pcall(require, 'drop')
if ok_drop then
  local drop_themes = {
    "auto", "matrix", "snow", "leaves", "spring", "summer",
    "halloween", "xmas", "new_year", "valentines_day", "stars",
    "space", "ocean", "cats", "garden", "cyberpunk", "fantasy",
    "retro", "musical", "pirate", "zoo", "candy", "coffee",
    "beach", "jungle", "desert", "sports", "dice", "cards",
    "casino", "bugs", "deepsea", "binary", "emotional",
    "thanksgiving", "easter", "nocturnal", "lunar", "magical",
    "medieval", "mystery", "steampunk", "tropical", "urban",
    "wilderness", "wildwest", "winter_wonderland", "zodiac",
    "farm", "explorer", "art", "bakery", "carnival", "diner",
    "mathematical", "mystical", "spa", "travel", "st_patricks_day",
    "us_independence_day", "april_fools", "arcade", "business",
    "temporal", "us_thanksgiving", "northern_lights",
  }

  -- 设置不透明背景，遮住代码
  vim.api.nvim_set_hl(0, "Drop", { bg = "#1a1b26" })

  drop.setup({
    theme = "snow",
    max = 75,
    interval = 150,   -- 降低刷新频率，减少后台渲染开销
    screensaver = 1000 * 200 * 1,
    winblend = 0,
  })

  -- 快捷键：<leader>dt 选择主题
  vim.keymap.set('n', '<leader>dt', function()
    vim.ui.select(drop_themes, { prompt = "Drop Theme" }, function(choice)
      if choice then
        require("drop").setup({ theme = choice })
      end
    end)
  end, { desc = "Drop theme select" })
end


