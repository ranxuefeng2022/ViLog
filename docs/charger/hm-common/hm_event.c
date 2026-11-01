// SPDX-License-Identifier: GPL-2.0
/*
 * hm_event.c - 模块间通信的公共事件总线
 *
 * 框架唯一的 blocking notifier chain; register/unregister/publish
 * 对所有 hm 模块导出. 只在 hm-common 构建一次(见本目录 Makefile).
 */
#include <linux/export.h>
#include <linux/notifier.h>

#include "hm_event.h"

static BLOCKING_NOTIFIER_HEAD(hm_event_nh);

int hm_event_register_notifier(struct notifier_block *nb)
{
	return blocking_notifier_chain_register(&hm_event_nh, nb);
}
EXPORT_SYMBOL_GPL(hm_event_register_notifier);

void hm_event_unregister_notifier(struct notifier_block *nb)
{
	blocking_notifier_chain_unregister(&hm_event_nh, nb);
}
EXPORT_SYMBOL_GPL(hm_event_unregister_notifier);

int hm_event_publish(unsigned long event, void *data)
{
	return blocking_notifier_call_chain(&hm_event_nh, event, data);
}
EXPORT_SYMBOL_GPL(hm_event_publish);
