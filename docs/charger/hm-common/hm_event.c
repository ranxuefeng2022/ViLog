// SPDX-License-Identifier: GPL-2.0
/*
 * hm_event.c - common event bus for inter-module communication
 *
 * The one and only blocking notifier chain of the framework; the
 * register/unregister/publish API is exported to all hm modules. Built
 * exactly once in hm-common (see this directory's Makefile).
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
