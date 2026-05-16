-- C kernel 代码片段

local ls = require('luasnip')
local s = ls.snippet
local t = ls.text_node
local i = ls.insert_node
local f = ls.function_node
local fmt = require('luasnip.extras.fmt').fmt
local rep = require('luasnip.extras').rep

-- 辅助：当前文件名（不含路径和后缀）
local function filename()
  return vim.fn.expand('%:t:r')
end

return {
  -- ============================================================
  -- 模块框架
  -- ============================================================

  -- module_init / module_exit
  s('modinit', fmt([[
static int __init {fname}_init(void)
{{
	{body}
	return 0;
}}
module_init({fname}_init);

static void __exit {fname}_exit(void)
{{
	{cleanup}
}}
module_exit({fname}_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("{author}");
MODULE_DESCRIPTION("{desc}");
  ]], {
    fname = f(filename),
    body = i(1, '/* init code */'),
    cleanup = i(2, '/* cleanup code */'),
    author = i(3, 'your name'),
    desc = i(4, 'module description'),
  })),

  -- platform_driver 框架
  s('platdrv', fmt([[
static int {name}_probe(struct platform_device *pdev)
{{
	struct {name}_data *data;
	{probe_body}
	return 0;
}}

static int {name}_remove(struct platform_device *pdev)
{{
	{remove_body}
	return 0;
}}

static const struct of_device_id {name}_of_match[] = {{
	{{ .compatible = "{compat}" }},
	{{ /* sentinel */ }}
}};
MODULE_DEVICE_TABLE(of, {name}_of_match);

static struct platform_driver {name}_driver = {{
	.probe = {name}_probe,
	.remove = {name}_remove,
	.driver = {{
		.name = "{name}",
		.of_match_table = {name}_of_match,
	}},
}};
module_platform_driver({name}_driver);
  ]], {
    name = i(1, 'mydev'),
    compat = i(2, 'vendor,mydev'),
    probe_body = i(3, '/* probe */'),
    remove_body = i(4, '/* remove */'),
  })),

  -- ============================================================
  -- 结构体模板
  -- ============================================================

  -- file_operations
  s('fops', fmt([[
static const struct file_operations {name}_fops = {{
	.owner = THIS_MODULE,
	.open = {name}_open,
	.release = {name}_release,
	.read = {name}_read,
	.write = {name}_write,
	{extra}
}};
  ]], {
    name = i(1, 'mydev'),
    extra = i(2, ''),
  })),

  -- of_device_id 表
  s('ofmatch', fmt([[
static const struct of_device_id {name}_of_match[] = {{
	{{ .compatible = "{compat}" }},
	{{ /* sentinel */ }}
}};
MODULE_DEVICE_TABLE(of, {name}_of_match);
  ]], {
    name = i(1, 'mydev'),
    compat = i(2, 'vendor,mydev'),
  })),

  -- platform_device_id 表
  s('platid', fmt([[
static const struct platform_device_id {name}_ids[] = {{
	{{ .name = "{id1}" }},
	{{ /* sentinel */ }}
}};
MODULE_DEVICE_TABLE(platform, {name}_ids);
  ]], {
    name = i(1, 'mydev'),
    id1 = i(2, 'mydev-id'),
  })),

  -- ============================================================
  -- 同步原语
  -- ============================================================

  -- mutex 模式
  s('mutex', fmt([[
DEFINE_MUTEX({name}_lock);

/* 加锁 */
mutex_lock(&{name}_lock);
{critical}
mutex_unlock(&{name}_lock);
  ]], {
    name = i(1, 'my'),
    critical = i(2, '/* critical section */'),
  })),

  -- spinlock 模式
  s('spinlock', fmt([[
static DEFINE_SPINLOCK({name}_lock);
unsigned long flags;

spin_lock_irqsave(&{name}_lock, flags);
{critical}
spin_unlock_irqrestore(&{name}_lock, flags);
  ]], {
    name = i(1, 'my'),
    critical = i(2, '/* critical section */'),
  })),

  -- ============================================================
  -- 日志 / 错误处理
  -- ============================================================

  -- dev_err/info/dbg
  s('deverr', fmt('dev_err(&pdev->dev, "{msg}\\n"{args});', {
    msg = i(1, 'error'),
    args = i(2, ''),
  })),
  s('devinfo', fmt('dev_info(&pdev->dev, "{msg}\\n"{args});', {
    msg = i(1, 'info'),
    args = i(2, ''),
  })),
  s('devdbg', fmt('dev_dbg(&pdev->dev, "{msg}\\n"{args});', {
    msg = i(1, 'debug'),
    args = i(2, ''),
  })),

  -- pr_err/info/dbg
  s('prerr', fmt('pr_err("{msg}\\n"{args});', {
    msg = i(1, 'error'),
    args = i(2, ''),
  })),
  s('prinfo', fmt('pr_info("{msg}\\n"{args});', {
    msg = i(1, 'info'),
    args = i(2, ''),
  })),

  -- goto 错误处理链
  s('goterr', fmt([[
	{var} = {func}({args});
	if (IS_ERR_OR_NULL({var})) {{
		ret = PTR_ERR({var});
		dev_err(&pdev->dev, "failed to {desc}\\n");
		goto {label};
	}}
  ]], {
    var = i(1, 'clk'),
    func = i(2, 'devm_clk_get'),
    args = i(3, '&pdev->dev, NULL'),
    desc = i(4, 'get clock'),
    label = i(5, 'err_clk'),
  })),

  -- ============================================================
  -- 设备树 / 属性读取
  -- ============================================================

  -- of_property_read
  s('ofprop', fmt('ret = of_property_read_{type}(&pdev->dev.of_node, "{prop}", &{var});', {
    type = i(1, 'u32'),
    prop = i(2, 'my-prop'),
    var = i(3, 'val'),
  })),

  -- devm_kzalloc
  s('kzalloc', fmt('data = devm_kzalloc(&pdev->dev, sizeof(*data), GFP_KERNEL);', {})),

  -- ============================================================
  -- 杂项
  -- ============================================================

  -- container_of
  s('cof', fmt('container_of({ptr}, {type}, {member})', {
    ptr = i(1, 'ptr'),
    type = i(2, 'struct my_data'),
    member = i(3, 'node'),
  })),

  -- PTR_ERR / IS_ERR 检查
  s('iserr', fmt([[
	if (IS_ERR({var})) {{
		ret = PTR_ERR({var});
		dev_err(dev, "failed to {desc}\\n");
		return ret;
	}}
  ]], {
    var = i(1, 'ptr'),
    desc = i(2, 'do something'),
  })),
}
