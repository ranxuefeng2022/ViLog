-- 主题预览选择器：j/k 切换主题，Enter 确认，Esc 恢复

local M = {}

M.entries = {
  { name = 'TokyoNight Night',       cat = 'TokyoNight', apply = function() vim.cmd('colorscheme tokyonight-night') end },
  { name = 'TokyoNight Storm',       cat = 'TokyoNight', apply = function() vim.cmd('colorscheme tokyonight-storm') end },
  { name = 'TokyoNight Moon',        cat = 'TokyoNight', apply = function() vim.cmd('colorscheme tokyonight-moon') end },
  { name = 'TokyoNight Day',         cat = 'TokyoNight', apply = function() vim.cmd('colorscheme tokyonight-day') end },
  { name = 'Catppuccin Latte',       cat = 'Catppuccin',  apply = function() require('catppuccin').load('latte') end },
  { name = 'Catppuccin Frappe',      cat = 'Catppuccin',  apply = function() require('catppuccin').load('frappe') end },
  { name = 'Catppuccin Macchiato',   cat = 'Catppuccin',  apply = function() require('catppuccin').load('macchiato') end },
  { name = 'Catppuccin Mocha',       cat = 'Catppuccin',  apply = function() require('catppuccin').load('mocha') end },
  { name = 'Kanagawa Wave',          cat = 'Kanagawa',    apply = function() vim.cmd('colorscheme kanagawa-wave') end },
  { name = 'Kanagawa Dragon',        cat = 'Kanagawa',    apply = function() vim.cmd('colorscheme kanagawa-dragon') end },
  { name = 'Kanagawa Lotus',         cat = 'Kanagawa',    apply = function() vim.cmd('colorscheme kanagawa-lotus') end },
}

function M.open()
  local tp = M
  tp.original = vim.g.colors_name or ''

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_option(buf, 'bufhidden', 'wipe')
  vim.api.nvim_buf_set_option(buf, 'filetype', 'theme-picker')

  local lines = {}
  for i, entry in ipairs(tp.entries) do
    local is_new = i == 1 or tp.entries[i - 1].cat ~= entry.cat
    local cat_prefix = is_new and ('-- ' .. entry.cat .. ' ') or '  '
    lines[i] = cat_prefix .. entry.name
  end

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_buf_add_highlight(buf, -1, 'ThemePickerCategory', 0, 0, -1)

  local width = 30
  local height = math.min(#tp.entries, vim.o.lines - 4)
  local row = math.floor((vim.o.lines - height) / 2)
  local col = math.floor((vim.o.columns - width) / 2)

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor',
    width = width,
    height = height,
    row = row,
    col = col,
    style = 'minimal',
    border = 'rounded',
    title = ' Theme Picker (j/k select, Enter confirm, Esc cancel) ',
    title_pos = 'center',
  })
  vim.api.nvim_win_set_option(win, 'cursorline', true)

  tp.buf, tp.win, tp.idx = buf, win, 1

  vim.api.nvim_set_hl(0, 'ThemePickerCategory', { fg = '#7aa2f7', bold = true })
  vim.api.nvim_set_hl(0, 'ThemePickerCursor',    { fg = '#1a1b26', bg = '#e6c384', bold = true })

  local function preview_current()
    tp.idx = vim.api.nvim_win_get_cursor(win)[1]
    if tp.idx >= 1 and tp.idx <= #tp.entries then
      pcall(tp.entries[tp.idx].apply)
    end
  end

  vim.api.nvim_create_autocmd('CursorMoved', {
    buffer = buf,
    callback = function()
      if tp._previewing then return end
      tp._previewing = true
      preview_current()
      tp._previewing = false
    end,
  })

  local mappings = {
    j = function() vim.api.nvim_win_set_cursor(win, { math.min(#tp.entries, tp.idx + 1), 0 }) end,
    k = function() vim.api.nvim_win_set_cursor(win, { math.max(1, tp.idx - 1), 0 }) end,
    ['<Down>'] = function() vim.api.nvim_win_set_cursor(win, { math.min(#tp.entries, tp.idx + 1), 0 }) end,
    ['<Up>'] = function() vim.api.nvim_win_set_cursor(win, { math.max(1, tp.idx - 1), 0 }) end,
    ['<CR>'] = function()
      preview_current()
      local theme = vim.g.colors_name or ''
      if theme ~= '' then
        local vimrc = vim.fn.stdpath('config') .. '/init.lua'
        vim.fn.system(string.format(
          "sed -i \"s/^vim.cmd('colorscheme .*/vim.cmd('colorscheme %s')/\" %s",
          theme, vim.fn.shellescape(vimrc)
        ))
      end
      vim.api.nvim_win_close(win, true)
    end,
    q = function()
      if tp.original ~= '' then vim.cmd('colorscheme ' .. tp.original) end
      vim.api.nvim_win_close(win, true)
    end,
    ['<Esc>'] = function()
      if tp.original ~= '' then vim.cmd('colorscheme ' .. tp.original) end
      vim.api.nvim_win_close(win, true)
    end,
  }

  for key, fn in pairs(mappings) do
    vim.keymap.set('n', key, fn, { buffer = buf, nowait = true, silent = true })
  end

  vim.api.nvim_win_set_cursor(win, { 1, 0 })
  preview_current()
end

vim.api.nvim_create_user_command('ThemePicker', M.open, {})

return M
