-- Fuzzy finder: fzf + fzf-lua + fzf.vim

return {
  {
    'junegunn/fzf',
    build = './install --all',
    lazy = true,
  },
  {
    'ibhagwan/fzf-lua',
    dependencies = { 'junegunn/fzf' },
    keys = {
      { '<leader>f',  function() require('fzf-lua').files({ winopts = { preview = { hidden = true } } }) end, mode = 'n', desc = 'Find files' },
      { '<leader>b',  '<Cmd>FzfLua buffers<CR>',            mode = 'n', desc = 'Find buffers' },
      { '<leader>r',  '<Cmd>FzfLua buffers<CR>',            mode = 'n', desc = 'Switch buffer' },
      { '<leader>hk', '<Cmd>FzfLua keymaps<CR>',            mode = 'n', desc = 'Keymaps' },
    },
    cmd = { 'FzfLua' },
    config = function()
      require('fzf-lua').setup({
        fzf_opts = {
          ['--layout'] = 'default',
          ['--preview-window'] = 'up:30%',
          ['--tiebreak'] = 'length,begin,index',
        },
        winopts = {
          height = 1,
          width = 1,
          preview = {
            layout = 'vertical',
            vertical = 'up:30%',
          },
        },
        file_icons = true,
        git_status = true,
        files = {
          cmd = 'fd --type f --hidden --follow --exclude .git',
        },
        grep = {
          rg_opts = '--threads 8 -L --column --line-number --no-heading --color=always --smart-case -g "!tags*"',
          filename_first = true,  -- 文件名前置到行首并单独高亮,便于扫读
        },
        lsp = {
          symbols = {
            symbol_style = 2,
            symbol_fmt = function(s)
              local icon = {
                Function = '', Method = '', Class = '', Struct = '',
                Variable = '', Field = '', Enum = '', Constant = '',
              }
              return string.format('%s %s', icon[s.kind] or ' ', s.name)
            end,
          },
        },
      })
    end,
  },
  {
    'junegunn/fzf.vim',
    dependencies = { 'junegunn/fzf' },
    keys = {
      { '<leader><leader>', function()
          local file = vim.fn.expand('%:p')
          if file == '' then return end
          local tags = vim.fn.systemlist(
            'ctags --format=2 --excmd=number --fields=K --c-kinds=f --c++-kinds=f -f- '
            .. vim.fn.shellescape(file) .. ' 2>/dev/null'
          )
          if vim.v.shell_error ~= 0 or #tags == 0 then
            vim.notify('No functions found', vim.log.levels.WARN)
            return
          end
          local display = {}
          local lnums = {}
          for _, tag in ipairs(tags) do
            local name, lnum = tag:match('^(%S+)\t%S+\t(%d+);"')
            if name and lnum then
              table.insert(display, string.format('%d:%s', lnum, name))
              lnums[#display] = tonumber(lnum)
            end
          end
          if #display == 0 then return end
          require('fzf-lua').fzf_exec(display, {
            prompt = 'Functions> ',
            fzf_opts = {
              ['--delimiter'] = ':',
              ['--with-nth'] = '2..',
              ['--layout'] = 'default',
              ['--no-preview'] = '',
            },
            actions = {
              ['default'] = function(sel)
                if not sel or #sel == 0 then return end
                local lnum = sel[1]:match('^(%d+):')
                if lnum then vim.cmd('normal! ' .. lnum .. 'Gzz') end
              end,
            },
          })
        end, mode = 'n', desc = 'Buffer functions' },
      { 'ce', function() require('config.commands').grep_code() end, mode = 'n', desc = 'Grep code' },
      { 'cw', function() require('config.commands').buffer_lines() end, mode = 'n', desc = 'Buffer lines' },
    },
    cmd = { 'BTags', 'Tags', 'Rg', 'Files', 'Buffers', 'Windows', 'Lines', 'BLines', 'Marks', 'Maps', 'History', 'Commands', 'Helptags', 'Filetypes' },
    config = function()
      vim.g.fzf_preview_window = {}
    end,
  },
}
