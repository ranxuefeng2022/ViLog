-- Git: gitsigns, neogit, diffview, blame, fugitive, gv

return {
  {
    'lewis6991/gitsigns.nvim',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      vim.api.nvim_set_hl(0, 'GitSignsAdd',    { fg = '#98bb6c' })
      vim.api.nvim_set_hl(0, 'GitSignsChange', { fg = '#e6c384' })
      vim.api.nvim_set_hl(0, 'GitSignsDelete', { fg = '#e46876' })

      require('gitsigns').setup({
        signs = {
          add          = { text = '+', texthl = 'GitSignsAdd' },
          change       = { text = '~', texthl = 'GitSignsChange' },
          delete       = { text = '-', texthl = 'GitSignsDelete' },
          topdelete    = { text = '▔', texthl = 'GitSignsDelete' },
          changedelete = { text = '~', texthl = 'GitSignsChange' },
          untracked    = { text = '*', texthl = 'GitSignsAdd' },
        },
        signcolumn = true,
        numhl = false,
        linehl = false,
        word_diff = false,
        watch_gitdir = { interval = 1000, follow_files = true },
        current_line_blame = false,
        current_line_blame_opts = {
          virt_text = true,
          virt_text_pos = 'eol',
          delay = 200,
        },
        preview_config = { border = 'rounded' },
        on_attach = function(bufnr)
          local gs = package.loaded.gitsigns
          local function map(mode, l, r, opts)
            opts = opts or {}
            opts.buffer = bufnr
            vim.keymap.set(mode, l, r, opts)
          end
          map('n', ']c', function()
            if vim.wo.diff then return ']c' end
            vim.schedule(function() gs.next_hunk() end)
            return '<Ignore>'
          end, { expr = true })
          map('n', '[c', function()
            if vim.wo.diff then return '[c' end
            vim.schedule(function() gs.prev_hunk() end)
            return '<Ignore>'
          end, { expr = true })
          map('n', '<leader>hs', gs.stage_hunk,        { desc = 'Stage hunk' })
          map('n', '<leader>hr', gs.reset_hunk,        { desc = 'Reset hunk' })
          map('v', '<leader>hs', function() gs.stage_hunk({ vim.fn.line('.'), vim.fn.line('v') }) end, { desc = 'Stage selected' })
          map('v', '<leader>hr', function() gs.reset_hunk({ vim.fn.line('.'), vim.fn.line('v') }) end, { desc = 'Reset selected' })
          map('n', '<leader>hS', gs.stage_buffer,      { desc = 'Stage buffer' })
          map('n', '<leader>hu', gs.undo_stage_hunk,   { desc = 'Undo stage' })
          map('n', '<leader>hR', gs.reset_buffer,      { desc = 'Reset buffer' })
          map('n', '<leader>hp', gs.preview_hunk,      { desc = 'Preview hunk' })
          map('n', '<leader>hb', function() gs.blame_line({ full = true }) end, { desc = 'Blame line' })
          map('n', '<leader>hd', gs.diffthis,          { desc = 'Diff this' })
          map('n', '<leader>hD', function() gs.diffthis('~') end, { desc = 'Diff this ~' })
          map('n', '<leader>td', gs.toggle_deleted,    { desc = 'Toggle deleted' })
        end,
      })
    end,
  },
  {
    'NeogitOrg/neogit',
    cmd = 'Neogit',
    keys = {
      { '<leader>ng', function() require('neogit').open({ cwd = vim.fn.expand('%:p:h') }) end, desc = 'Neogit' },
    },
    config = function()
      require('neogit').setup({
        kind = 'tab',
        signs = {
          section = { '', '' },
          item    = { '', '' },
          hunk    = { '', '' },
        },
        integrations = { diffview = true },
        sections = { recent = { folded = false } },
      })
    end,
  },
  {
    'sindrets/diffview.nvim',
    cmd = { 'DiffviewOpen', 'DiffviewClose', 'DiffviewFileHistory' },
    config = function()
      require('diffview').setup({
        enhanced_diff_hl = true,
        view = { merge_tool = { layout = 'diff3_mixed' } },
        keymaps = {
          disable_defaults = false,
          view       = { { 'n', '<leader>q', '<cmd>DiffviewClose<CR>', { desc = 'Close diffview' } } },
          file_panel = { { 'n', '<leader>q', '<cmd>DiffviewClose<CR>', { desc = 'Close diffview' } } },
        },
      })
    end,
  },
  {
    'tpope/vim-fugitive',
    cmd = { 'Git', 'G', 'Gdiff', 'Gblame', 'Gstatus', 'Glog' },
  },
  {
    'junegunn/gv.vim',
    cmd = 'GV',
  },
  {
    'FabijanZulj/blame.nvim',
    cmd = 'BlameToggle',
    config = function()
      require('blame').setup {}
    end,
  },
}
