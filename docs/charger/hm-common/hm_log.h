/* SPDX-License-Identifier: GPL-2.0 */
/*
 * hm_log.h - hm 模块共用日志宏
 *
 * 每条消息前缀 "<tag> <function>:<line> ". tag 缺省
 * KBUILD_MODNAME(包含文件的目标名, 如 "hm_charger", "voter"),
 * 包含本头文件前定义 HM_LOG_TAG 可覆盖.
 *
 * 用法:
 *   - hm_dbg() 映射 pr_debug: 不带 -DDEBUG 且未开
 *     CONFIG_DYNAMIC_DEBUG 时编译期消除; 开了 dynamic_debug 可经
 *     /sys/kernel/debug/dynamic_debug/control 运行时开关;
 *   - 格式串必须以 '\n' 结尾; 不许裸调 printk();
 *   - 周期路径(轮询 work/中断)用 *_ratelimited 变体, 防故障刷屏;
 *   - __LINE__ 随编辑漂移: 现场日志只与构建它的源码版本对得上.
 */
#ifndef __HM_LOG_H__
#define __HM_LOG_H__

#include <linux/kernel.h>
#include <linux/printk.h>

#ifndef HM_LOG_TAG
#define HM_LOG_TAG KBUILD_MODNAME
#endif

#define hm_err(fmt, ...) \
	pr_err(HM_LOG_TAG " %s:%d " fmt, __func__, __LINE__, ##__VA_ARGS__)
#define hm_warn(fmt, ...) \
	pr_warn(HM_LOG_TAG " %s:%d " fmt, __func__, __LINE__, ##__VA_ARGS__)
#define hm_info(fmt, ...) \
	pr_info(HM_LOG_TAG " %s:%d " fmt, __func__, __LINE__, ##__VA_ARGS__)
#define hm_dbg(fmt, ...) \
	pr_debug(HM_LOG_TAG " %s:%d " fmt, __func__, __LINE__, ##__VA_ARGS__)

#define hm_err_ratelimited(fmt, ...) \
	pr_err_ratelimited(HM_LOG_TAG " %s:%d " fmt, \
			__func__, __LINE__, ##__VA_ARGS__)

#endif /* __HM_LOG_H__ */
