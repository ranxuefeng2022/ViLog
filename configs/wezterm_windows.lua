local wezterm = require 'wezterm'
local mux = wezterm.mux

-------------------------------------------------
-- 1. 主题定义
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
-- 2. 状态管理
-------------------------------------------------
local active_font = { family = 'SF Mono', weight = 'Medium' } -- 当前生效字体

wezterm.GLOBAL.theme_state = wezterm.GLOBAL.theme_state or {
  mode = 'dark',
  index = 1,
}

wezterm.GLOBAL.wallpaper_index = wezterm.GLOBAL.wallpaper_index or 1

local function current_theme()
  local state = wezterm.GLOBAL.theme_state
  local list = state.mode == 'dark' and dark_themes or light_themes
  return list[state.index] or list[1]
end

-------------------------------------------------
-- 3. 壁纸工具
-------------------------------------------------
local wallpaper_dir = wezterm.config_dir .. '/wallpaper'

local function get_wallpapers()
  -- 缓存结果，避免每次切换壁纸都重新扫描目录
  if wezterm.GLOBAL.wallpaper_cache then
    return wezterm.GLOBAL.wallpaper_cache
  end

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
  wezterm.GLOBAL.wallpaper_cache = images
  return images
end

local function get_background_config()
  local wps = get_wallpapers()
  local wp = wps[wezterm.GLOBAL.wallpaper_index]
  if wp then
    return {
      {
        source = { File = wp },
        hsb = { brightness = wezterm.GLOBAL.theme_state.mode == 'dark' and 0.15 or 0.85, saturation = 1.0 },
      },
    }
  end
  return {
    {
      source = { Color = '#1e1e2e' },
      height = '100%',
      width = '100%',
      hsb = { brightness = 1.0, saturation = 1.0 },
    },
  }
end

-------------------------------------------------
-- 4. 事件处理
-------------------------------------------------
-- F5：循环切换主题
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

-- F6：深色/浅色切换
wezterm.on('toggle-dark-light', function(window, pane)
  local state = wezterm.GLOBAL.theme_state
  state.mode = (state.mode == 'dark') and 'light' or 'dark'
  state.index = 1

  local overrides = window:get_config_overrides() or {}
  overrides.color_scheme = current_theme()
  window:set_config_overrides(overrides)
end)

-- F12：循环切换壁纸
wezterm.on('cycle-wallpaper', function(window, pane)
  local wps = get_wallpapers()
  if #wps == 0 then return end

  wezterm.GLOBAL.wallpaper_index = wezterm.GLOBAL.wallpaper_index + 1
  if wezterm.GLOBAL.wallpaper_index > #wps then
    wezterm.GLOBAL.wallpaper_index = 1
  end

  local overrides = window:get_config_overrides() or {}
  overrides.background = get_background_config()
  window:set_config_overrides(overrides)
end)

-- 启动时跟随系统深浅色
wezterm.on('gui-startup', function(cmd)
  local appearance = wezterm.gui.get_appearance()
  local state = wezterm.GLOBAL.theme_state
  state.mode = appearance:lower():find 'dark' and 'dark' or 'light'
  state.index = 1

  local overrides = { color_scheme = current_theme() }

  -- 合并 cmd 与 overrides，确保启动时主题覆盖生效
  local spawn_args = cmd or {}
  spawn_args.config_overrides = overrides
  mux.spawn_window(spawn_args)
end)

-- Tab 标题样式
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
-- 5. 快捷键定义
-------------------------------------------------
local keys = {
  -- 主题切换
  { key = 'F5', action = wezterm.action.EmitEvent 'cycle-theme' },
  { key = 'F6', action = wezterm.action.EmitEvent 'toggle-dark-light' },
  { key = 'F12', action = wezterm.action.EmitEvent 'cycle-wallpaper' },

  -- 粘贴
  { key = 'Space', mods = 'SHIFT', action = wezterm.action.PasteFrom 'Clipboard' },

  -- Ctrl+Tab / Ctrl+Shift+Tab 左右切换 Tab
  { key = 'Tab', mods = 'CTRL', action = wezterm.action.ActivateTabRelative(1) },
  { key = 'Tab', mods = 'CTRL|SHIFT', action = wezterm.action.ActivateTabRelative(-1) },

  -- 清屏
  { key = 'k', mods = 'ALT', action = wezterm.action.ClearScrollback 'ScrollbackAndViewport' },
  -- 复制
  { key = 'c', mods = 'ALT', action = wezterm.action.CopyTo 'Clipboard' },
  -- 搜索模式
  { key = 'f', mods = 'CTRL|SHIFT', action = wezterm.action.ActivateCopyMode },

  -- 字体大小调整
  { key = '=', mods = 'CTRL', action = wezterm.action.IncreaseFontSize },
  { key = '-', mods = 'CTRL', action = wezterm.action.DecreaseFontSize },
  { key = '0', mods = 'CTRL', action = wezterm.action.ResetFontSize },

  -- 显示启动菜单
  { key = 'L', mods = 'CTRL|SHIFT', action = wezterm.action.ShowLauncher },
}

-- Alt + 数字切换 Tab（循环生成 1-9）
for i = 1, 9 do
  keys[#keys + 1] = {
    key = tostring(i),
    mods = 'ALT',
    action = wezterm.action.ActivateTab(i - 1),
  }
end

-------------------------------------------------
-- 6. 最终配置
-------------------------------------------------
return {
  -- 杂项
  check_for_updates = false,
  window_close_confirmation = 'NeverPrompt',

  -- Shell（Windows PowerShell）
  default_prog = {
    'powershell.exe',
    '-NoLogo',
  },

  set_environment_variables = {
    LANG = 'C.UTF-8',
  },

  -- 启动菜单（右键 Tab 栏 + 或 Ctrl+Shift+L）
  launch_menu = {
    { label = 'MSYS2 Bash', args = { 'C:/msys64/usr/bin/bash.exe', '--login', '-i' } },
    { label = 'PowerShell', args = { 'pwsh.exe', '-NoLogo' } },
    { label = 'Windows PowerShell', args = { 'powershell.exe', '-NoLogo' } },
    { label = 'Command Prompt', args = { 'cmd.exe' } },
    { label = 'Git Bash', args = { 'C:/Program Files/Git/bin/bash.exe', '--login', '-i' } },
  },

  -- 字体与渲染
  font = wezterm.font(active_font.family, { weight = active_font.weight }),
  font_size = 13,
  line_height = 1.15,
  harfbuzz_features = { 'calt=0', 'clig=0', 'liga=0' },
  freetype_load_target = 'Normal',
  freetype_render_target = 'Normal',
  custom_block_glyphs = false,

  -- 性能
  front_end = 'OpenGL',
  animation_fps = 120,
  max_fps = 120,
  scrollback_lines = 100000,
  enable_wayland = false,
  force_reverse_video_cursor = true,
  audible_bell = 'Disabled',
  anti_alias_custom_block_glyphs = true,
  visual_bell = {
    fade_in_duration_ms = 75,
    fade_out_duration_ms = 150,
    fade_in_function = 'EaseIn',
    fade_out_function = 'EaseOut',
    target = 'CursorColor',
  },

  -- 窗口
  window_padding = {
    left = 8,
    right = 8,
    top = 6,
    bottom = 6,
  },
  window_decorations = 'RESIZE',
  window_background_opacity = 0.85,
  win32_system_backdrop = 'Acrylic',
  win32_acrylic_accent_color = '#1e1e2e',
  macos_window_background_blur = 20,

  -- Tab 栏
  enable_tab_bar = true,
  hide_tab_bar_if_only_one_tab = true,
  use_fancy_tab_bar = false,
  tab_bar_at_bottom = false,
  tab_max_width = 20,
  window_frame = {
    font = wezterm.font { family = active_font.family, weight = 'Bold' },
    font_size = 11,
    active_titlebar_bg = '#1e1e2e',
    inactive_titlebar_bg = '#181825',
  },

  -- 滚动条
  enable_scroll_bar = true,

  -- 主题与背景
  color_scheme = current_theme(),
  background = get_background_config(),
  text_background_opacity = 1.0,
  inactive_pane_hsb = {
    brightness = 0.7,
    saturation = 0.7,
  },
  colors = {
    selection_fg = '#1e1e2e',
    selection_bg = '#89b4fa',
  },
  default_cursor_style = 'BlinkingBar',
  cursor_thickness = '2px',
  cursor_blink_rate = 500,
  cursor_blink_ease_in = 'Constant',
  cursor_blink_ease_out = 'Constant',
  bold_brightens_ansi_colors = 'BrightAndBold',

  -- 快捷键
  keys = keys,

  -- 鼠标绑定
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
