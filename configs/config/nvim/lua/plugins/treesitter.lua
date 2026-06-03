-- Treesitter + Markdown rendering

return {
  {
    'nvim-treesitter/nvim-treesitter',
    build = ':TSUpdate',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      local ok, ts = pcall(require, 'nvim-treesitter.configs')
      if ok then
        ts.setup({
          ensure_installed = { 'c', 'cpp', 'markdown', 'markdown_inline' },
          highlight = {
            enable = true,
            additional_vim_regex_highlighting = {},
          },
          indent = { enable = true },
          install_dir = vim.fn.expand('~/.vim/treesitter'),
        })
      end
    end,
  },
  {
    'MeanderingProgrammer/render-markdown.nvim',
    ft = 'markdown',
    config = function()
      require('render-markdown').setup({
        render_modes = { 'n', 'c', 't' },
        anti_conceal = { enabled = true, above = 0, below = 0 },
        heading = { sign = false, icons = { ' ', ' ', ' ', ' ', ' ', ' ' } },
        code = { sign = false, width = 'block' },
        dash = { width = 'full' },
        checkbox = { enabled = true },
        quote = { icon = '▋' },
      })
    end,
  },
  {
    'plasticboy/vim-markdown',
    ft = 'markdown',
  },
}
