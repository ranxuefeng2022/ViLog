-- LSP + Completion: coc.nvim + LuaSnip

return {
  {
    'neoclide/coc.nvim',
    branch = 'release',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      vim.g.coc_global_extensions = {
        'coc-sh',
        'coc-git',
      }

      -- GoTo / hover / rename / action / format / diagnostic
      local function bufmap(mode, lhs, rhs, desc)
        vim.keymap.set(mode, lhs, rhs, { silent = true, desc = desc })
      end
      bufmap('n', 'gd', '<Plug>(coc-definition)', 'Go to definition')
      bufmap('n', 'gr', '<Plug>(coc-references)', 'Find references')
      bufmap('n', 'K', ':call CocAction("doHover")<CR>', 'Hover documentation')
      bufmap('n', '<leader>rn', '<Plug>(coc-rename)', 'Rename symbol')
      bufmap('n', '<leader>la', '<Plug>(coc-codeaction-cursor)', 'Code action')
      bufmap('n', '<leader>lf', ':call CocAction("format")<CR>', 'Format')
      bufmap('n', '[d', '<Plug>(coc-diagnostic-prev)', 'Previous diagnostic')
      bufmap('n', ']d', '<Plug>(coc-diagnostic-next)', 'Next diagnostic')

      -- Tab / S-Tab / CR 补全导航
      vim.keymap.set('i', '<Tab>', function()
        if vim.fn['coc#pum#visible']() == 1 then
          return vim.fn['coc#pum#next'](1)
        end
        return vim.api.nvim_replace_termcodes('<Tab>', true, true, true)
      end, { expr = true, silent = true })

      vim.keymap.set('i', '<S-Tab>', function()
        if vim.fn['coc#pum#visible']() == 1 then
          return vim.fn['coc#pum#prev'](1)
        end
        return vim.api.nvim_replace_termcodes('<S-Tab>', true, true, true)
      end, { expr = true, silent = true })

      vim.keymap.set('i', '<CR>', function()
        if vim.fn['coc#pum#visible']() == 1 then
          return vim.fn['coc#pum#confirm']()
        end
        return vim.api.nvim_replace_termcodes('<CR>', true, true, true)
      end, { expr = true, silent = true })

      -- C-j / C-k 补全列表上下移动
      vim.keymap.set('i', '<C-j>', function()
        if vim.fn['coc#pum#visible']() == 1 then
          return vim.fn['coc#pum#next'](1)
        end
        return vim.api.nvim_replace_termcodes('<C-j>', true, true, true)
      end, { expr = true, silent = true })

      vim.keymap.set('i', '<C-k>', function()
        if vim.fn['coc#pum#visible']() == 1 then
          return vim.fn['coc#pum#prev'](1)
        end
        return vim.api.nvim_replace_termcodes('<C-k>', true, true, true)
      end, { expr = true, silent = true })

      -- C-Space 唤出补全列表
      vim.keymap.set('i', '<C-Space>', 'coc#refresh()', { expr = true, silent = true })
    end,
  },

  -- Snippets (LuaSnip，自定义片段)
  {
    'L3MON4D3/LuaSnip',
    version = 'v2.*',
    event = 'InsertEnter',
    config = function()
      local ls = require('luasnip')
      ls.setup({})
      require('luasnip.loaders.from_lua').load({ paths = { '~/.config/nvim/lua/snippets' } })
    end,
  },
}
