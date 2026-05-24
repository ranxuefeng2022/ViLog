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
          rg_opts = '--threads 8 -L --column --line-number --no-heading --color=always --smart-case',
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
      { 'ce', function()
          local rg_cmd = 'rg --threads 8 -L --with-filename --column --line-number --no-heading --color=always --smart-case -- ' .. vim.fn.shellescape('')
          local func_preview = "sh -c 'file=$(echo \"$1\" | cut -d: -f1); line=$(echo \"$1\" | cut -d: -f2); head -n \"$line\" \"$file\" 2>/dev/null | tac | grep -m1 -E \"^[a-zA-Z_].*\\(\" | sed \"s/^[ \\t]*//\"' _ {}"
          vim.fn['fzf#vim#grep'](rg_cmd, 1, {
            options = '--layout=default --preview ' .. vim.fn.shellescape(func_preview) .. ' --preview-window down:1:border-top',
          }, 1)
        end, mode = 'n', desc = 'Grep code' },
      { 'cw', function()
          local file = vim.fn.expand('%:p')
          if file == '' then return end
          local func_preview = string.format(
            "sh -c 'line=$(echo \"$1\" | cut -d: -f1); head -n \"$line\" %s 2>/dev/null | tac | grep -m1 -E \"^[a-zA-Z_].*\\(\" | sed \"s/^[ \\t]*//\"' _ {}",
            vim.fn.shellescape(file))
          require('fzf-lua').fzf_exec(
            'rg --threads 8 --no-filename --line-number --no-heading --color=never --smart-case -- "" '
            .. vim.fn.shellescape(file),
            {
              prompt = 'Lines> ',
              fzf_opts = {
                ['--layout'] = 'default',
                ['--delimiter'] = ':',
                ['--preview'] = func_preview,
                ['--preview-window'] = 'down:1:border-top',
              },
              actions = {
                ['default'] = function(sel)
                  if not sel or #sel == 0 then return end
                  local lnum = sel[1]:match('^(%d+):')
                  if lnum then vim.cmd('normal! ' .. lnum .. 'Gzz') end
                end,
              },
            }
          )
        end, mode = 'n', desc = 'Buffer lines' },
    },
    cmd = { 'BTags', 'Tags', 'Rg', 'Files', 'Buffers', 'Windows', 'Lines', 'BLines', 'Marks', 'Maps', 'History', 'Commands', 'Helptags', 'Filetypes' },
    config = function()
      vim.g.fzf_preview_window = {}
    end,
  },
}
