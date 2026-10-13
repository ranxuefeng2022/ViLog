-- Editing enhancements

return {
  {
    'mg979/vim-visual-multi',
    event = 'VeryLazy',
  },
  {
    'matze/vim-move',
    keys = {
      { '<A-j>', mode = { 'n', 'v' } },
      { '<A-k>', mode = { 'n', 'v' } },
    },
  },
  {
    'terryma/vim-expand-region',
    keys = {
      { '+', mode = { 'n', 'v' } },
      { '_', mode = { 'n', 'v' } },
    },
  },
  {
    'ojroques/vim-oscyank',
    event = 'VeryLazy',
  },
{
    'gbprod/yanky.nvim',
    keys = {
      { 'p',         '<Plug>(YankyPutAfter)',           mode = { 'n', 'v' }, desc = 'Paste (yanky)' },
      { 'P',         '<Plug>(YankyPutBefore)',          mode = 'n',           desc = 'Paste before (yanky)' },
      { '<C-n>',     '<Plug>(YankyCycleForward)',       mode = 'n',           desc = 'Yank cycle forward' },
      { '<C-p>',     '<Plug>(YankyCycleBackward)',      mode = 'n',           desc = 'Yank cycle backward' },
      { 'cp',        function()
          local items = require('yanky.history').all()
          if not items or #items == 0 then
            vim.notify('Yank history is empty', vim.log.levels.WARN)
            return
          end
          -- 全部条目一次写入单个缓存文件，预览用 sed 按行区间截取。
          -- 旧实现每条历史单独 vim.fn.writefile：100 条实测 ~1.7s
          -- (每次都是 Lua→VimL 桥接 + 文件创建)，且临时目录每次泄漏不清理
          local cache = vim.fn.stdpath('cache') .. '/yanky_preview.txt'
          local f = io.open(cache, 'w')
          if not f then
            vim.notify('Cannot write preview cache', vim.log.levels.ERROR)
            return
          end
          local display = {}
          local lnum = 1
          for i, entry in ipairs(items) do
            local content = entry.regcontents
            local start_line = lnum
            f:write(content, '\n')
            lnum = lnum + select(2, content:gsub('\n', '')) + 1
            local summary = content:gsub('\n', '\\n')
            if #summary > 100 then summary = summary:sub(1, 100) .. '...' end
            display[i] = string.format('%d\t%d\t%d\t%s', i, start_line, lnum - 1, summary)
          end
          f:close()
          require('fzf-lua').fzf_exec(display, {
            prompt = 'Yank History> ',
            fzf_opts = {
              ['--delimiter'] = '\t',
              ['--with-nth'] = '4..',
              ['--layout'] = 'default',
              ['--preview-window'] = 'up:60%:border-bottom',
              -- {2}/{3} 是条目在缓存文件中的起止行号；纯数字无注入风险
              ['--preview'] = 'sed -n {2},{3}p ' .. vim.fn.shellescape(cache),
            },
            actions = {
              ['default'] = function(sel)
                if not sel or #sel == 0 then return end
                local idx = tonumber(sel[1]:match('^(%d+)'))
                if not idx then return end
                local entry = items[idx]
                if not entry then return end
                vim.fn.setreg('"', entry.regcontents, entry.regtype)
                vim.cmd('normal! p')
              end,
            },
          })
        end, mode = 'n', desc = 'Yank history' },
    },
    config = function()
      require('yanky').setup({
        ring = {
          history_length = 100,
          storage = 'shada',
          sync_with_numbered_registers = true,
        },
        highlight = {
          on_put = true,
          on_yank = false,  -- yank 闪烁由 init.lua 的 TextYankPost 提供，避免双高亮
          timer = 200,
        },
      })
    end,
  },
}
