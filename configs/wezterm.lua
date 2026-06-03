local wezterm = require 'wezterm'
local mux = wezterm.mux

-------------------------------------------------
-- 主题定义
-------------------------------------------------
local dark_themes = {
  'Tokyo Night',
  'Catppuccin Mocha',
  'Dracula',
  'Gruvbox Dark',
  'OneDark (Gogh)',
  'Everforest Dark (Gogh)',
}

local light_themes = {
  'GitHub Light',
  'Gruvbox Light',
  'Edge Light (base16)',
}

-------------------------------------------------
-- 状态存储（重启记忆）
-------------------------------------------------
wezterm.GLOBAL.theme_state = wezterm.GLOBAL.theme_state or {
  mode = 'dark',
  index = 1,
}

local function current_theme()
  local state = wezterm.GLOBAL.theme_state
  if state.mode == 'dark' then
    return dark_themes[state.index]
  else
    return light_themes[state.index]
  end
end

-------------------------------------------------
-- F5：循环切换主题
-------------------------------------------------
wezterm.on('cycle-theme', function(window, pane)
  local state = wezterm.GLOBAL.theme_state
  local list = state.mode == 'dark' and dark_themes or light_themes

  state.index = state.index + 1
  if state.index > #list then
    state.index = 1
  end

  local overrides = window:get_config_overrides() or {}
  overrides.color_scheme = current_theme()
  window:set_config_overrides(overrides)
end)

-------------------------------------------------
-- F6：深色 / 浅色切换
-------------------------------------------------
wezterm.on('toggle-dark-light', function(window, pane)
  local state = wezterm.GLOBAL.theme_state

  state.mode = (state.mode == 'dark') and 'light' or 'dark'
  state.index = 1

  local overrides = window:get_config_overrides() or {}
  overrides.color_scheme = current_theme()
  window:set_config_overrides(overrides)
end)

-------------------------------------------------
-- 壁纸列表（自动扫描 wallpaper 目录）
-------------------------------------------------
local wallpaper_dir = wezterm.config_dir .. '/wallpaper'
local function get_wallpapers()
  local all_files = wezterm.glob(wallpaper_dir .. '/*')
  local images = {}
  local exts = { png = true, jpg = true, jpeg = true, gif = true, bmp = true, webp = true }
  for _, f in ipairs(all_files) do
    local ext = f:match('%.(%w+)$')
    if ext and exts[ext:lower()] then
      table.insert(images, f)
    end
  end
  table.sort(images)
  return images
end

-------------------------------------------------
-- 壁纸状态
-------------------------------------------------
wezterm.GLOBAL.wallpaper_index = wezterm.GLOBAL.wallpaper_index or 1

-------------------------------------------------
-- 文件存在性检查
-------------------------------------------------
local function file_exists(path)
  local ok, _, code = os.rename(path, path)
  if not ok and code == 13 then
    return true
  end
  return ok
end

-------------------------------------------------
-- 获取当前背景配置
-------------------------------------------------
local function get_background_config()
  local wps = get_wallpapers()
  local wp = wps[wezterm.GLOBAL.wallpaper_index]
  if wp and file_exists(wp) then
    return {
      {
        source = { File = wp },
        hsb = { brightness = 1.0, saturation = 1.0 },
      },
    }
  end
  return {
    {
      source = { Color = '#1e1e2e' },
      height = '100%',
      width = '100%',
    },
  }
end

-------------------------------------------------
-- 右下角状态栏：显示当前主题
-------------------------------------------------
wezterm.on('update-right-status', function(window, pane)
  local wps = get_wallpapers()
  local wp_name = (wps[wezterm.GLOBAL.wallpaper_index] or ''):match('.*/(.+)$') or ''
  window:set_right_status(
    wezterm.format {
      { Attribute = { Intensity = 'Bold' } },
      { Text = '🎨 ' .. current_theme() .. ' | 🖼 ' .. wp_name .. ' ' },
    }
  )
end)

-------------------------------------------------
-- 启动时：跟随系统深浅色（修复 mux 冲突）
-------------------------------------------------
wezterm.on('gui-startup', function(cmd)
  local appearance = wezterm.gui.get_appearance()
  local state = wezterm.GLOBAL.theme_state

  state.mode = appearance:find 'Dark' and 'dark' or 'light'
  state.index = 1

  if cmd then
    mux.spawn_window(cmd)
  else
    mux.spawn_window {
      config_overrides = {
        color_scheme = current_theme(),
      },
    }
  end
end)

-------------------------------------------------
-- F12：循环切换壁纸
-------------------------------------------------
wezterm.on('cycle-wallpaper', function(window, pane)
  wezterm.GLOBAL.wallpaper_index = wezterm.GLOBAL.wallpaper_index + 1
  if wezterm.GLOBAL.wallpaper_index > #get_wallpapers() then
    wezterm.GLOBAL.wallpaper_index = 1
  end

  local overrides = window:get_config_overrides() or {}
  overrides.background = get_background_config()
  window:set_config_overrides(overrides)
end)

-------------------------------------------------
-- Tab 样式
-------------------------------------------------
wezterm.on('format-tab-title', function(tab)
  local index = tab.tab_index + 1
  local is_active = tab.is_active

  local bg = is_active and '#2a2a37' or '#1e1e2e'
  local fg = is_active and '#cdd6f4' or '#6c7086'
  local accent = is_active and '#89b4fa' or '#313244'

  return {
    { Background = { Color = bg } },
    { Foreground = { Color = accent } },
    { Text = '▎' },
    { Foreground = { Color = fg } },
    { Text = ' ' .. index .. '  ' },
  }
end)

-------------------------------------------------
-- 最终配置（日志查看向）
-------------------------------------------------
return {
  -------------------------------------------------
  -- Shell
  -------------------------------------------------
  default_prog = {
    'C:/msys64/usr/bin/bash.exe',
    '--login',
    '-i',
  },

  set_environment_variables = {
    MSYSTEM = 'MSYS',
    CHERE_INVOKING = '1',
    LANG = 'C.UTF-8',
  },

  -------------------------------------------------
  -- 字体 & 渲染（日志更清晰）
  -------------------------------------------------
  font = wezterm.font('JetBrains Mono', { weight = 'Medium' }),
  font_size = 12,
  line_height = 1.0,
  harfbuzz_features = { "calt=0", "clig=0", "liga=0" },

  freetype_load_target = "Light",
  freetype_render_target = "HorizontalLcd",

  -------------------------------------------------
  -- 性能
  -------------------------------------------------
  front_end = "WebGpu",
  animation_fps = 120,
  max_fps = 120,

  scrollback_lines = 50000,

  -------------------------------------------------
  -- 窗口
  -------------------------------------------------
  window_padding = {
    left = 8,
    right = 8,
    top = 6,
    bottom = 6,
  },

  window_decorations = "RESIZE",
  front_end = 'OpenGL',

  -------------------------------------------------
  -- Tab
  -------------------------------------------------
  enable_tab_bar = true,
  hide_tab_bar_if_only_one_tab = true,
  use_fancy_tab_bar = false,

  -------------------------------------------------
  -- 主题 & 背景
  -------------------------------------------------
  color_scheme = current_theme(),
  background = get_background_config(),
  text_background_opacity = 1.0,

  -------------------------------------------------
  -- 毛玻璃
  -------------------------------------------------
  window_background_opacity = 0.85,
  win32_system_backdrop = "Acrylic",
  macos_window_background_blur = 20,

  -------------------------------------------------
  -- Tab
  -------------------------------------------------
  enable_tab_bar = true,
  hide_tab_bar_if_only_one_tab = true,
  use_fancy_tab_bar = false,

  enable_scroll_bar = true,
  -------------------------------------------------
  -- 键位（日志常用）
  -------------------------------------------------
  keys = {
    { key = 'F5', action = wezterm.action.EmitEvent 'cycle-theme' },
    { key = 'F6', action = wezterm.action.EmitEvent 'toggle-dark-light' },
    { key = 'F12', action = wezterm.action.EmitEvent 'cycle-wallpaper' },

    { key = 'Space', mods = 'SHIFT', action = wezterm.action.PasteFrom("Clipboard") },

    -- ALT + 数字切换 Tab
    { key = '1', mods = 'ALT', action = wezterm.action.ActivateTab(0) },
    { key = '2', mods = 'ALT', action = wezterm.action.ActivateTab(1) },
    { key = '3', mods = 'ALT', action = wezterm.action.ActivateTab(2) },
    { key = '4', mods = 'ALT', action = wezterm.action.ActivateTab(3) },
    { key = '5', mods = 'ALT', action = wezterm.action.ActivateTab(4) },
    { key = '6', mods = 'ALT', action = wezterm.action.ActivateTab(5) },
    { key = '7', mods = 'ALT', action = wezterm.action.ActivateTab(6) },
    { key = '8', mods = 'ALT', action = wezterm.action.ActivateTab(7) },
    { key = '9', mods = 'ALT', action = wezterm.action.ActivateTab(8) },

    -- Tab 左右切换
    { key = 'f', mods = 'ALT', action = wezterm.action.ActivateTabRelative(-1) },
    { key = 'g', mods = 'ALT', action = wezterm.action.ActivateTabRelative(1) },

    -- 日志常用
    { key = 'k', mods = 'ALT', action = wezterm.action.ClearScrollback 'ScrollbackAndViewport' },
    { key = 'c', mods = 'ALT', action = wezterm.action.CopyTo 'Clipboard' },
    { key = 'f', mods = 'CTRL|SHIFT', action = wezterm.action.ActivateCopyMode },
  },

  -------------------------------------------------
  -- 鼠标：Shift + 滚轮 横向滚动
  -------------------------------------------------
  mouse_bindings = {
    {
      event = { Down = { streak = 1, button = { WheelUp = 1 } } },
      mods = 'SHIFT',
      action = wezterm.action.ScrollByLine(-5),
    },
    {
      event = { Down = { streak = 1, button = { WheelDown = 1 } } },
      mods = 'SHIFT',
      action = wezterm.action.ScrollByLine(5),
    },
  },
}
