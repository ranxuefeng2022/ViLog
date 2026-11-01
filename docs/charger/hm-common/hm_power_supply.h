/* SPDX-License-Identifier: GPL-2.0 */
/*
 * hm_power_supply.h - hm 模块私有 psy 之间的内核空间通信协议
 *
 * 每个 hm 模块(hm-charger / 充电 IC / 电池 FG / ...)注册自己的
 * 私有 psy; 模块间不引用对方符号, 只经 power_supply get/set
 * property 通信.
 *
 * 内核标准 power_supply.h 的 enum power_supply_property 没有厂商
 * 扩展区, 且未来内核还会追加标准属性. 自定义属性因此从最大标准
 * 值(POWER_SUPPLY_PROP_SERIAL_NUMBER, 字符串属性排最后)加
 * HM_POWER_SUPPLY_PROP_OFFSET 起编, 留足与未来标准增量的距离.
 *
 * 这些属性只在内核空间存在:
 *   - 不放进 power_supply_desc.properties -- sysfs 属性表按标准
 *     枚举索引, 自定义 ID 落在表外(老内核上直接越界), 于是不建
 *     sysfs 属性, 用户空间不可见;
 *   - power_supply_get/set_property() 不按 desc->properties 校验,
 *     直接分发到 get/set_property 回调, 未列出的自定义属性照样
 *     到达;
 *   - 读写一律走 HM_PSY_GET_PROP()/HM_PSY_SET_PROP() 宏, 枚举
 *     强转在宏里做, 调用方不会混用两套枚举.
 *
 * 其它模块用法示例(hm-charger 的私有 psy 名 "chg_psy"):
 *
 *	rc = hm_psy_get_by_name(&chip->chg_psy, "chg_psy");
 *	if (rc)
 *		return rc;		// hm-charger 还没起来, 重试 probe
 *	val.intval = 1;
 *	HM_PSY_SET_PROP(chip->chg_psy,
 *			HM_POWER_SUPPLY_PROP_CHARGING_ENABLED, &val);
 *	rc = HM_PSY_GET_PROP(chip->chg_psy,
 *			HM_POWER_SUPPLY_PROP_CHARGE_DONE, &val);
 *	...
 *	// 引用持有到本驱动生命周期结束, 无需 power_supply_put()
 */
#ifndef __HM_POWER_SUPPLY_H__
#define __HM_POWER_SUPPLY_H__

#include <linux/power_supply.h>

/* 自定义属性区相对最大标准值的偏移 */
#define HM_POWER_SUPPLY_PROP_OFFSET	64

enum hm_power_supply_property {
	/* 编号起点哨兵, 仅作标记, 不得当属性用 */
	HM_POWER_SUPPLY_PROP_BASE = POWER_SUPPLY_PROP_SERIAL_NUMBER +
				     HM_POWER_SUPPLY_PROP_OFFSET,

	HM_POWER_SUPPLY_PROP_CHARGING_ENABLED,	/* int: 充电使能 0/1 */
	HM_POWER_SUPPLY_PROP_INPUT_CURRENT_MA,	/* int: 输入限流, mA */
	HM_POWER_SUPPLY_PROP_CHARGE_CURRENT_MA,	/* int: 充电电流, mA */
	HM_POWER_SUPPLY_PROP_CHARGE_VOLTAGE_MV,	/* int: 浮充电压, mV */
	HM_POWER_SUPPLY_PROP_ITERM_MA,		/* int: 终止电流, mA */
	HM_POWER_SUPPLY_PROP_VINDPM_MV,		/* int: 输入压降门限, mV */
	HM_POWER_SUPPLY_PROP_CHARGE_DONE,	/* int: 充电完成 0/1 */
	HM_POWER_SUPPLY_PROP_USB_DETECT,	/* 写: 推入 vbus 原始采样 0/1 */
	HM_POWER_SUPPLY_PROP_CHG_TYPE,		/* int: 检测类型, enum hm_power_supply_type */
	HM_POWER_SUPPLY_PROP_PROTOCOL_SELECT,	/* 写: 输入协议, enum hm_chg_proto */
	HM_POWER_SUPPLY_PROP_INPUT_SUSPEND,	/* int: 输入挂起 0/1 (停止从适配器取电) */
	HM_POWER_SUPPLY_PROP_RAW_SOC,	/* int: 原始 soc 百分比 (battery psy; 写: 算法模块推入) */
	HM_POWER_SUPPLY_PROP_JEITA_ZONE,	/* int: JEITA 分区, enum hm_jeita_zone (battery psy; 只读) */

	/* 新自定义属性加在这行上面; 区间哨兵必须保持最后 */
	HM_POWER_SUPPLY_PROP_MAX,
};

/*
 * hm 框架的充电类型检测结果.
 *
 * 标准段按内核 enum power_supply_type 锚定(同序, 显式起点):
 * 标准段的值可直接强转 enum power_supply_type 给标准世界用
 * (power_supply_desc.type, uevent TYPE=), 无需映射表.
 *
 * 规则:
 *   - 标准段内不得重排/插入, 上面的强转兼容依赖它;
 *   - hm 专用类型只允许在尾部追加;
 *   - 喂给标准 type ABI(sysfs "type" / POWER_SUPPLY_PROP_TYPE)
 *     前先钳到标准区间: 内核按值索引名字数组, 越界的自定义值
 *     会读越界.
 */
enum hm_power_supply_type {
	/* ---- 标准段: 与 power_supply.h 保持同步 ---- */
	HM_POWER_SUPPLY_TYPE_UNKNOWN = 0,
	HM_POWER_SUPPLY_TYPE_BATTERY,
	HM_POWER_SUPPLY_TYPE_UPS,
	HM_POWER_SUPPLY_TYPE_MAINS,
	HM_POWER_SUPPLY_TYPE_USB,			/* Standard Downstream Port */
	HM_POWER_SUPPLY_TYPE_USB_DCP,		/* Dedicated Charging Port */
	HM_POWER_SUPPLY_TYPE_USB_CDP,		/* Charging Downstream Port */
	HM_POWER_SUPPLY_TYPE_USB_ACA,		/* Accessory Charger Adapters */
	HM_POWER_SUPPLY_TYPE_USB_TYPE_C,	/* Type C Port */
	HM_POWER_SUPPLY_TYPE_USB_PD,		/* Power Delivery Port */
	HM_POWER_SUPPLY_TYPE_USB_PD_DRP,	/* PD Dual Role Port */
	HM_POWER_SUPPLY_TYPE_APPLE_BRICK_ID,	/* Apple Charging Method */
	HM_POWER_SUPPLY_TYPE_WIRELESS,		/* Wireless */

	/* ---- hm 自定义段: 只在下方追加, 不得加在上方 ---- */
	HM_POWER_SUPPLY_TYPE_USB_HVDCP,		/* Qualcomm QC 2.0/3.0 */
	HM_POWER_SUPPLY_TYPE_USB_PPS,		/* PD PPS (programmable APDO) */
};

/* battery psy JEITA_ZONE 属性的值; hm-battery 拥有, 任意策略模块
 * 消费 */
enum hm_jeita_zone {
	JEITA_COLD,		/* 停充 */
	JEITA_COOL,		/* 降压浮充 */
	JEITA_NORMAL,
	JEITA_WARM,		/* 降压浮充 */
	JEITA_HOT,		/* 停充 */
};

/*
 * 策略层可选的输入协议, 写到 chg_psy 的 PROTOCOL_SELECT 属性.
 * 检测结果是菜单, 这是点菜.
 */
enum hm_chg_proto {
	HM_CHG_PROTO_5V = 0,	/* 纯 5V (BC1.2 缺省 / QC 空闲) */
	HM_CHG_PROTO_HVDCP,	/* QC 高压 */
	HM_CHG_PROTO_PD,	/* PD 固定 PDO 合同 */
	HM_CHG_PROTO_PPS,	/* PD PPS */
};

/*
 * get/set 一律走这两个宏(标准与 hm 自定义属性通用): psp 总被
 * 强转标准枚举, 消除枚举类型不匹配告警; val 是调用方构造的
 * union power_supply_propval, 可带 intval/strval.
 */
#define HM_PSY_GET_PROP(psy, psp, val) \
	power_supply_get_property((psy), \
			(enum power_supply_property)(psp), (val))

#define HM_PSY_SET_PROP(psy, psp, val) \
	power_supply_set_property((psy), \
			(enum power_supply_property)(psp), (val))

/*
 * psy 的持久获取: 首次成功缓存在 *psy, 之后直接复用不再取引用,
 * 因此永远不需要 power_supply_put(); 持有的引用也让对端 psy 在
 * 下面一直活着. 适合 probe 这类单线程上下文; 同一 *psy 的并发
 * 调用方需自行串行化. 对端未注册时返回 -EPROBE_DEFER, probe
 * 返回它会触发内核重试.
 */
static inline int hm_psy_get_by_name(struct power_supply **psy,
		const char *name)
{
	if (*psy)
		return 0;

	*psy = power_supply_get_by_name(name);
	if (!*psy)
		return -EPROBE_DEFER;

	return 0;
}

#endif /* __HM_POWER_SUPPLY_H__ */
