-- LSP + Completion: coc.nvim

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
      -- C/C++ 无 LSP(clangd 已移除),CocAction 在无提供者的 buffer 上会抛
      -- E605 异常并被 noice 弹成错误通知;统一加 hasProvider 守卫并优雅回退
      local function bufmap(mode, lhs, rhs, desc)
        vim.keymap.set(mode, lhs, rhs, { silent = true, desc = desc })
      end

      local function has_provider(name)
        local ok, has = pcall(vim.fn.CocAction, 'hasProvider', name)
        return ok and (has == 1 or has == true)
      end

      -- 原生按键回退(feedkeys 带 'n' 标志不重入映射,不会递归)
      local function native(keys)
        vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(keys, true, true, true), 'n', false)
      end

      bufmap('n', 'gd', function()
        if has_provider('definition') then
          vim.fn.CocAction('jumpDefinition')
        else
          native('<C-]>')  -- 回退:tags 跳转(与 a 键一致)
        end
      end, 'Go to definition (fallback: tags)')
      bufmap('n', 'gr', function()
        if has_provider('reference') then
          vim.fn.CocAction('jumpReferences')
        else
          vim.notify('No references provider, use R to grep', vim.log.levels.WARN)
        end
      end, 'Find references')
      -- K 留给窗口调整(keymaps.lua: resize -3)，hover 放到 <leader>lh
      bufmap('n', '<leader>lh', function()
        if has_provider('hover') then
          vim.fn.CocAction('doHover')
        else
          native('K')  -- 回退:原生 K(keywordprg → man 手册)
        end
      end, 'Hover (fallback: man page)')
      bufmap('n', '<leader>rn', function()
        if has_provider('rename') then
          vim.fn.CocAction('rename')
        else
          vim.notify('No rename provider for this buffer', vim.log.levels.WARN)
        end
      end, 'Rename symbol')
      bufmap('n', '<leader>la', function()
        if has_provider('codeAction') then
          vim.fn.CocAction('codeAction', 'cursor')
        else
          vim.notify('No code action provider for this buffer', vim.log.levels.WARN)
        end
      end, 'Code action')
      bufmap('n', '<leader>lf', function()
        if has_provider('format') then
          vim.fn.CocAction('format')
        else
          vim.notify('No format provider for this buffer', vim.log.levels.WARN)
        end
      end, 'Format')
      bufmap('n', '[d', '<Plug>(coc-diagnostic-prev)', 'Previous diagnostic')
      bufmap('n', ']d', '<Plug>(coc-diagnostic-next)', 'Next diagnostic')

      -- Tab / S-Tab / CR 补全导航;片段内 Tab/S-Tab 跳占位符(菜单可见时优先 coc)
      vim.keymap.set('i', '<Tab>', function()
        if vim.fn['coc#pum#visible']() == 1 then
          return vim.fn['coc#pum#next'](1)
        end
        local ok, ls = pcall(require, 'luasnip')
        if ok and ls.jumpable(1) then
          ls.jump(1)
          return ''
        end
        return vim.api.nvim_replace_termcodes('<Tab>', true, true, true)
      end, { expr = true, silent = true })

      vim.keymap.set('i', '<S-Tab>', function()
        if vim.fn['coc#pum#visible']() == 1 then
          return vim.fn['coc#pum#prev'](1)
        end
        local ok, ls = pcall(require, 'luasnip')
        if ok and ls.jumpable(-1) then
          ls.jump(-1)
          return ''
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
}
