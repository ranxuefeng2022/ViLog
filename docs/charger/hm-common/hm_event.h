/* SPDX-License-Identifier: GPL-2.0 */
/*
 * hm_event.h - common event bus for inter-module communication
 *
 * Single blocking notifier chain plus centralized event ID allocation:
 * any module may publish an event from any sleepable context through
 * hm_event_publish(); subscribers receive every event in their notifier
 * callback and filter with a switch.
 *
 * Conventions:
 *   - Event IDs are allocated centrally in the enum below, grouped by
 *     domain prefix; modules must NOT define their own IDs (they would
 *     collide);
 *   - An event is an "edge" (something happened), not a "state" (how
 *     things are now); query the current state through the owning
 *     module's psy get property;
 *   - Callbacks run synchronously in the publisher's context: keep them
 *     quick and defer heavy work to your own workqueue; never call back
 *     synchronously into the publisher (deadlock);
 *   - The payload pointer is only valid during the callback; copy it
 *     if you need to keep it.
 */
#ifndef __HM_EVENT_H__
#define __HM_EVENT_H__

#include <linux/notifier.h>

/* Event types (single ID space shared by all hm modules; append new
 * module domains here) */
enum hm_event {
	/* ---- power/charging domain (published by hm-charger) ---- */
	HM_EVT_PWR_UPDATE = 0,		/* periodic poll data refreshed */
	HM_EVT_PWR_USB_STATUS_CHANGED,	/* usb flipped: offline <-> online */
	HM_EVT_PWR_CHG_TYPE_CHANGED,	/* charger type detection concluded */
};

/* Payload of HM_EVT_PWR_USB_STATUS_CHANGED */
struct hm_evt_pwr_data {
	bool	usb_online;	/* new state after the flip */
};

/* Payload of HM_EVT_PWR_CHG_TYPE_CHANGED */
struct hm_evt_chg_type_data {
	int		chg_type;	/* enum hm_power_supply_type */
	unsigned int	max_mv;		/* adapter capability, 0 = unknown */
	unsigned int	max_ma;		/* adapter capability, 0 = unknown */
	bool		pps;		/* PPS (programmable) source */
};

int hm_event_register_notifier(struct notifier_block *nb);
void hm_event_unregister_notifier(struct notifier_block *nb);

/* Returns the last callback's return value (NOTIFY_DONE etc.) */
int hm_event_publish(unsigned long event, void *data);

#endif /* __HM_EVENT_H__ */
