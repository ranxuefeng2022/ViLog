/* SPDX-License-Identifier: GPL-2.0 */
/*
 * hm_log.h - logging macros shared by the hm modules
 *
 * Every message is prefixed with "<tag> <function>:<line> ". The tag
 * defaults to KBUILD_MODNAME (the kbuild object name of the including
 * file, e.g. "hm_charger", "voter"); define HM_LOG_TAG before
 * including this header to override it.
 *
 * Usage rules:
 *   - hm_dbg() maps to pr_debug: it compiles away unless the file is
 *     built with -DDEBUG or CONFIG_DYNAMIC_DEBUG is enabled, in which
 *     case it is switchable at runtime through
 *     /sys/kernel/debug/dynamic_debug/control;
 *   - always terminate the format string with '\n'; never call bare
 *     printk();
 *   - in paths that run periodically (poll works, interrupts), prefer
 *     the *_ratelimited variants so a fault cannot flood the log;
 *   - keep in mind __LINE__ drifts with every edit: logs captured from
 *     a field unit only match the source tree it was built from.
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
