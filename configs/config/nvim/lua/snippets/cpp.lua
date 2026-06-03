-- C++ 常用代码片段

local ls = require('luasnip')
local s = ls.snippet
local t = ls.text_node
local i = ls.insert_node
local f = ls.function_node
local fmt = require('luasnip.extras.fmt').fmt
local rep = require('luasnip.extras').rep

return {
  -- class 定义
  s('class', fmt([[
	class {name} {{
	public:
		{name}() = default;
		~{name}() = default;

	private:
		{body}
	}};
  ]], {
    name = i(1, 'MyClass'),
    body = i(2, '/* members */'),
  })),

  -- 头文件保护
  s('incguard', fmt([[
	#ifndef {guard}
	#define {guard}

	{body}

	#endif /* {guard} */
  ]], {
    guard = i(1, 'MY_HEADER_H'),
    body = i(2, '/* content */'),
  })),

  -- std::unique_ptr
  s('uptr', fmt('auto {name} = std::make_unique<{type}>({args});', {
    name = i(1, 'ptr'),
    type = i(2, 'T'),
    args = i(3, ''),
  })),

  -- std::shared_ptr
  s('sptr', fmt('auto {name} = std::make_shared<{type}>({args});', {
    name = i(1, 'ptr'),
    type = i(2, 'T'),
    args = i(3, ''),
  })),

  -- for range
  s('forr', fmt([[
	for (const auto& {var} : {container}) {{
		{body}
	}}
  ]], {
    var = i(1, 'item'),
    container = i(2, 'items'),
    body = i(3, '/* body */'),
  })),

  -- main 函数
  s('main', fmt([[
	#include <iostream>

	int main(int argc, char* argv[])
	{{
		{body}
		return 0;
	}}
  ]], {
    body = i(1, 'std::cout << "Hello" << std::endl;'),
  })),

  -- try-catch
  s('try', fmt([[
	try {{
		{try_body}
	}} catch (const std::exception& e) {{
		std::cerr << e.what() << '\\n';
		{catch_body}
	}}
  ]], {
    try_body = i(1, '/* try */'),
    catch_body = i(2, ''),
  })),

  -- enum class
  s('enumc', fmt([[
	enum class {name} {{
		{values}
	}};
  ]], {
    name = i(1, 'MyEnum'),
    values = i(2, 'A, B, C'),
  })),

  -- static_assert
  s('sassert', fmt('static_assert({cond}, "{msg}");', {
    cond = i(1, 'sizeof(T) <= 8'),
    msg = i(2, 'T must fit in 8 bytes'),
  })),

  -- template function
  s('tfn', fmt([[
	template <typename {tparam}>
	{ret} {name}({params}) {{
		{body}
	}}
  ]], {
    tparam = i(1, 'T'),
    ret = i(2, 'void'),
    name = i(3, 'func'),
    params = i(4, 'const T& val'),
    body = i(5, '/* body */'),
  })),

  -- lambda
  s('lambda', fmt('auto {name} = [{cap}]({params}) -> {ret} {{ {body} }};', {
    name = i(1, 'fn'),
    cap = i(2, ''),
    params = i(3, ''),
    ret = i(4, 'auto'),
    body = i(5, '/* body */'),
  })),

  -- override method
  s('ovr', fmt([[
	{ret} {name}({params}) override {{
		{body}
	}}
  ]], {
    ret = i(1, 'void'),
    name = i(2, 'method'),
    params = i(3, ''),
    body = i(4, '/* body */'),
  })),
}
