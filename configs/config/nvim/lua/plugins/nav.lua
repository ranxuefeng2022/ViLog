-- Navigation: tagbar, vim-signature

return {
  {
    'preservim/tagbar',
    cmd = 'TagbarToggle',
    keys = {
      { 'cc', '<cmd>TagbarToggle<CR>', mode = 'n', desc = 'Toggle tagbar' },
    },
  },
  {
    'kshenoy/vim-signature',
    event = 'VeryLazy',
  },
}
