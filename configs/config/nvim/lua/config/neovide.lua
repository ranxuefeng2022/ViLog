-- ── Neovide 专属配置 ──────────────────────────────────

if not vim.g.neovide then return end

vim.o.linespace = 8

vim.g.neovide_floating_blur = true
vim.g.neovide_multigrid = true
vim.g.neovide_underline_automatic_scaling = true
vim.g.neovide_fullscreen = true

vim.g.neovide_cursor_animation_length = 0.1
vim.g.neovide_cursor_trail_size = 0.5
vim.g.neovide_cursor_antialiasing = true

vim.g.neovide_cursor_vfx_particle_lifetime = 0.3
vim.g.neovide_cursor_vfx_particle_density = 5.0
vim.g.neovide_cursor_vfx_particle_speed = 10.0
vim.g.neovide_cursor_vfx_particle_phase = 1.5
vim.g.neovide_cursor_vfx_particle_curl = 1.0
vim.g.neovide_cursor_vfx_opacity = 100.0

vim.g.neovide_font_face = 'FiraCode Nerd Font'
vim.g.neovide_font_size = 10
vim.g.neovide_padding_top = 1
vim.g.neovide_remember_window_size = true
vim.g.neovide_power_save_mode = true
vim.g.neovide_scale_factor = 0.84
vim.g.neovide_opacity = 1
vim.g.neovide_scroll_animation_length = 0.6
vim.g.neovide_cursor_trail_length = 0.2

vim.g.fzf_colors = {
  fg      = { 'fg', 'Normal' },
  bg      = { 'bg', 'Normal' },
  hl      = { 'fg', 'Comment' },
  ['fg+'] = { 'fg', 'CursorLine', 'CursorColumn', 'Normal' },
  ['bg+'] = { 'bg', 'CursorLine', 'CursorColumn' },
  ['hl+'] = { 'fg', 'Statement' },
  info    = { 'fg', 'PreProc' },
  border  = { 'fg', 'Ignore' },
  prompt  = { 'fg', 'Conditional' },
  pointer = { 'fg', 'Exception' },
  marker  = { 'fg', 'Keyword' },
  spinner = { 'fg', 'Label' },
  header  = { 'fg', 'Comment' },
}
