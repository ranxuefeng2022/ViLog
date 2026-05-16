-- LSP + Completion: mason, lspconfig, blink.cmp, LuaSnip

return {
  -- LSP 基础设施
  {
    'neovim/nvim-lspconfig',
    dependencies = { 'saghen/blink.cmp' },
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      local capabilities = require('blink.cmp').get_lsp_capabilities()

      -- clangd
      vim.lsp.config('clangd', {
        capabilities = capabilities,
        cmd = { 'clangd', '--compile-commands-dir=build' },
        filetypes = { 'c', 'cpp', 'objc', 'objcpp' },
        root_markers = { 'compile_commands.json', '.git' },
        on_attach = function(client, _)
          client.server_capabilities.semanticTokensProvider = nil
        end,
      })

      -- bashls
      vim.lsp.config('bashls', {
        capabilities = capabilities,
        filetypes = { 'sh', 'bash' },
      })

      vim.lsp.enable('clangd')
      vim.lsp.enable('bashls')

      -- LSP keymaps (on LspAttach)
      vim.api.nvim_create_autocmd('LspAttach', {
        group = vim.api.nvim_create_augroup('LspKeymaps', { clear = true }),
        callback = function(ev)
          local bufmap = function(mode, lhs, rhs, desc)
            vim.keymap.set(mode, lhs, rhs, { buffer = ev.buf, desc = desc })
          end
          bufmap('n', 'gd', vim.lsp.buf.definition, 'Go to definition')
          bufmap('n', 'gr', vim.lsp.buf.references, 'Find references')
          bufmap('n', 'K', vim.lsp.buf.hover, 'Hover documentation')
          bufmap('n', '<leader>rn', vim.lsp.buf.rename, 'Rename symbol')
          bufmap('n', '<leader>la', vim.lsp.buf.code_action, 'Code action')
          bufmap('n', '<leader>lf', function() vim.lsp.buf.format({ async = true }) end, 'Format')
          bufmap('n', '[d', vim.diagnostic.goto_prev, 'Previous diagnostic')
          bufmap('n', ']d', vim.diagnostic.goto_next, 'Next diagnostic')
        end,
      })
    end,
  },
  {
    'williamboman/mason.nvim',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      require('mason').setup()
    end,
  },
  {
    'williamboman/mason-lspconfig.nvim',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      require('mason-lspconfig').setup({
        ensure_installed = { 'clangd', 'bashls' },
      })
    end,
  },

  -- 补全引擎
  {
    'saghen/blink.cmp',
    version = '1.*',
    event = 'InsertEnter',
    dependencies = {
      { 'L3MON4D3/LuaSnip', version = 'v2.*' },
      'rafamadriz/friendly-snippets',
    },
    opts = {
      keymap = {
        ['<Tab>']     = { 'accept', 'snippet_forward', 'fallback' },
        ['<S-Tab>']   = { 'select_prev', 'snippet_backward', 'fallback' },
        ['<C-j>']     = { 'select_next', 'fallback' },
        ['<C-k>']     = { 'select_prev', 'fallback' },
        ['<CR>']      = { 'accept', 'fallback' },
        ['<C-Space>'] = { 'show', 'fallback' },
      },
      appearance = {
        use_nvim_cmp_as_default = true,
        nerd_font_variant = 'mono',
      },
      completion = {
        accept = { auto_brackets = { enabled = false } },
        documentation = { auto_show = false },
      },
      sources = {
        default = { 'lsp', 'path', 'snippets', 'buffer' },
      },
      snippets = { preset = 'luasnip' },
      fuzzy = { implementation = 'prefer_rust_with_warning' },
      signature = { enabled = true },
    },
    config = function(_, opts)
      require('luasnip.loaders.from_vscode').lazy_load()
      require('luasnip.loaders.from_lua').load({ paths = { '~/.config/nvim/lua/snippets' } })
      require('blink.cmp').setup(opts)
    end,
  },
}
