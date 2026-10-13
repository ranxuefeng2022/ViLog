-- LuaSnip + lua/snippets/ 下的 Lua 格式代码片段(c/cpp/lua)
-- 展开:输入触发词后按 <C-l>(如 modinit、platdrv、fops)
-- 片段内占位符跳转:<Tab>/<S-Tab>(分支加在 plugins/lsp.lua 的 Tab 映射里,
-- 补全菜单可见时仍优先走 coc)
return {
  {
    'L3MON4D3/LuaSnip',
    event = 'InsertEnter',
    config = function()
      require('luasnip').setup({
        history = false,  -- 不允许跳出片段后再跳回上一个,保证 <Tab> 语义干净
      })
      require('luasnip.loaders.from_lua').load({
        paths = { vim.fn.stdpath('config') .. '/lua/snippets' },
      })

      vim.keymap.set('i', '<C-l>', function()
        local ls = require('luasnip')
        if ls.expand_or_jumpable() then
          ls.expand_or_jump()
          return ''
        end
        return vim.api.nvim_replace_termcodes('<C-l>', true, true, true)
      end, { expr = true, silent = true, desc = 'Snippet expand/jump' })
    end,
  },
}
