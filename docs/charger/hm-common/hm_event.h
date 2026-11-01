/* SPDX-License-Identifier: GPL-2.0 */
/*
 * hm_event.h - 模块间通信的公共事件总线
 *
 * 单一 blocking notifier chain + 集中分配的事件 ID: 任意模块可在
 * 任意可睡眠上下文经 hm_event_publish() 发布; 订阅者在自己的
 * notifier 回调里收到所有事件, 用 switch 过滤.
 *
 * 约定:
 *   - 事件 ID 集中在下方枚举分配, 按域分组前缀; 模块不得自定义
 *     ID(会撞号);
 *   - 事件是"边沿"(发生了什么)不是"状态"(现在如何); 当前状态问
 *     属主模块的 psy get property;
 *   - 回调同步跑在发布者上下文: 保持简短, 重活丢自己的
 *     workqueue; 不得同步回调发布者(死锁);
 *   - payload 指针仅回调期间有效, 要留着就拷贝.
 */
#ifndef __HM_EVENT_H__
#define __HM_EVENT_H__

#include <linux/notifier.h>

/* 事件类型(所有 hm 模块共享一个 ID 空间; 新模块域加在这里) */
enum hm_event {
	/* ---- 电源/充电域 (hm-charger 发布) ---- */
	HM_EVT_PWR_UPDATE = 0,		/* 周期轮询数据已刷新 */
	HM_EVT_PWR_USB_STATUS_CHANGED,	/* usb 翻转: 离线 <-> 在线 */
	HM_EVT_PWR_CHG_TYPE_CHANGED,	/* 充电类型检测收尾 */
};

/* HM_EVT_PWR_USB_STATUS_CHANGED 的 payload */
struct hm_evt_pwr_data {
	bool	usb_online;	/* 翻转后的新状态 */
};

/* HM_EVT_PWR_CHG_TYPE_CHANGED 的 payload */
struct hm_evt_chg_type_data {
	int		chg_type;	/* enum hm_power_supply_type */
	unsigned int	max_mv;		/* 适配器能力, 0 = 未知 */
	unsigned int	max_ma;		/* 适配器能力, 0 = 未知 */
	bool		pps;		/* PPS (可编程) 源 */
};

int hm_event_register_notifier(struct notifier_block *nb);
void hm_event_unregister_notifier(struct notifier_block *nb);

/* 返回最后一个回调的返回值 (NOTIFY_DONE 等) */
int hm_event_publish(unsigned long event, void *data);

#endif /* __HM_EVENT_H__ */
