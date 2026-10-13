-- Treesitter + Markdown rendering
-- 注意：nvim-treesitter 现在是 main 分支，已移除 nvim-treesitter.configs 模块
-- 与 highlight/indent/ensure_installed 等 module 系统。
-- 代码（C/C++ 等）不使用 TS 高亮，保持 regex 语法（after/syntax/*.vim）。
-- 仅 markdown 启动 TS，供 render-markdown.nvim 渲染使用。

return {
  {
    'nvim-treesitter/nvim-treesitter',
    branch = 'main',
    build = ':TSUpdate',
    -- 只为 markdown 服务，按 ft 懒加载；C/C++ 打开时完全不加载本插件
    ft = { 'markdown' },
    config = function()
      local nt = require('nvim-treesitter')

      -- 仅为 markdown 渲染装 parser；C/C++ 等代码不使用 TS 高亮（保持 regex 语法）
      local ensure = { 'markdown', 'markdown_inline' }
      local installed = nt.get_installed and nt.get_installed() or {}
      local missing = {}
      for _, lang in ipairs(ensure) do
        if not vim.tbl_contains(installed, lang) then missing[#missing + 1] = lang end
      end
      if #missing > 0 and nt.install then nt.install(missing) end

      -- 仅 markdown 启动 TS（render-markdown 依赖）；代码文件保持纯 regex 高亮
      vim.api.nvim_create_autocmd('FileType', {
        group = vim.api.nvim_create_augroup('NvimTreesitterStart', { clear = true }),
        pattern = 'markdown',
        callback = function(args)
          pcall(vim.treesitter.start, args.buf)
        end,
      })
      -- ft 懒加载触发时，当前 buffer 的 FileType 事件先于上面的 autocmd 注册，
      -- 直接补启动一次（若 lazy 重放了事件导致二次 start，pcall 兜底）
      if vim.bo.filetype == 'markdown' then
        pcall(vim.treesitter.start, 0)
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
