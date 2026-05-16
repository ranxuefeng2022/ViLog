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
          -- 每条历史写到临时文件，用于预览
          local tmpdir = vim.fn.tempname()
          vim.fn.mkdir(tmpdir, 'p')
          local display = {}
          for i, entry in ipairs(items) do
            local fpath = tmpdir .. '/' .. i
            vim.fn.writefile(vim.split(entry.regcontents, '\n'), fpath)
            local summary = entry.regcontents:gsub('\n', '\\n')
            if #summary > 100 then summary = summary:sub(1, 100) .. '...' end
            display[i] = string.format('%d\t%s', i, summary)
          end
          require('fzf-lua').fzf_exec(display, {
            prompt = 'Yank History> ',
            fzf_opts = {
              ['--delimiter'] = '\t',
              ['--with-nth'] = '2..',
              ['--layout'] = 'default',
              ['--preview-window'] = 'up:60%:border-bottom',
              ['--preview'] = 'cat ' .. vim.fn.shellescape(tmpdir) .. '/{1}',
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
          on_yank = true,
          timer = 200,
        },
      })
    end,
  },
}
