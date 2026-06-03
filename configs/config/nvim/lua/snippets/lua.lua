-- Lua (Neovim) 代码片段

local ls = require('luasnip')
local s = ls.snippet
local t = ls.text_node
local i = ls.insert_node
local fmt = require('luasnip.extras.fmt').fmt

return {
  -- local function
  s('lf', fmt([[
	local function {name}({params})
		{body}
	end
  ]], {
    name = i(1, 'fn'),
    params = i(2, ''),
    body = i(3, 'TODO'),
  })),

  -- vim.keymap.set
  s('kmap', fmt('vim.keymap.set({mode}, {lhs}, {rhs}, {{ desc = "{desc}" }})', {
    mode = i(1, "'n'"),
    lhs = i(2, "'<leader>x'"),
    rhs = i(3, 'function() end'),
    desc = i(4, 'description'),
  })),

  -- vim.api.nvim_create_autocmd
  s('aucmd', fmt([[
	vim.api.nvim_create_autocmd('{event}', {{
		group = vim.api.nvim_create_augroup('{group}', {{ clear = true }}),
		callback = function()
			{body}
		end,
	}})
  ]], {
    event = i(1, 'BufWritePre'),
    group = i(2, 'MyGroup'),
    body = i(3, 'TODO'),
  })),

  -- lazy.nvim plugin spec
  s('plugin', fmt([[
	{{
		'{repo}',
		event = '{event}',
		config = function()
			{body}
		end,
	}},
  ]], {
    repo = i(1, 'author/plugin.nvim'),
    event = i(2, 'BufReadPre'),
    body = i(3, 'require("plugin").setup()'),
  })),

  -- vim.opt
  s('vopt', fmt('vim.opt.{opt} = {val}', {
    opt = i(1, 'number'),
    val = i(2, 'true'),
  })),
}
