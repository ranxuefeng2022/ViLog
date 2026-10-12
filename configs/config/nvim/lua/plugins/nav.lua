-- Navigation: tagbar, vim-signature

return {
  {
    'preservim/tagbar',
    -- cc 键位在 config/keymaps.lua 中定义，这里只保留 cmd 懒加载入口
    cmd = 'TagbarToggle',
  },
  {
    'kshenoy/vim-signature',
    event = 'VeryLazy',
  },
}
