/* SPDX-License-Identifier: GPL-2.0 */
/*
 * hm_power_supply.h - kernel-space communication protocol between the
 * private power supplies of the hm modules
 *
 * Every hm module (hm-charger / charger IC / battery FG / ...) registers
 * its own private psy; modules never reference each other's symbols and
 * communicate exclusively through power_supply get/set property calls.
 *
 * The stock kernel power_supply.h provides no vendor extension area in
 * enum power_supply_property, and future kernels may keep appending
 * standard properties. Custom properties are therefore numbered from
 * the largest standard value (POWER_SUPPLY_PROP_SERIAL_NUMBER, the
 * string properties come last) plus HM_POWER_SUPPLY_PROP_OFFSET,
 * leaving headroom to avoid collisions with future standard additions.
 *
 * These properties are kernel-space only:
 *   - They are NOT put into power_supply_desc.properties -- the sysfs
 *     attribute table is indexed by the standard enum and custom IDs
 *     fall outside it (out of bounds on older kernels), so no sysfs
 *     attribute is created and user space never sees them;
 *   - power_supply_get/set_property() does not validate against
 *     desc->properties, it dispatches straight to the get_property/
 *     set_property callbacks, so unlisted custom properties still work;
 *   - All reads/writes go through the HM_PSY_GET_PROP()/HM_PSY_SET_PROP()
 *     macros; the enum cast is done there so callers never mix the two
 *     enum types.
 *
 * Usage example from another module (hm-charger's private psy is
 * named "chg_psy"):
 *
 *	rc = hm_psy_get_by_name(&chip->chg_psy, "chg_psy");
 *	if (rc)
 *		return rc;		// hm-charger not up yet, retry probe
 *	val.intval = 1;
 *	HM_PSY_SET_PROP(chip->chg_psy,
 *			HM_POWER_SUPPLY_PROP_CHARGING_ENABLED, &val);
 *	rc = HM_PSY_GET_PROP(chip->chg_psy,
 *			HM_POWER_SUPPLY_PROP_CHARGE_DONE, &val);
 *	...
 *	// the reference is held for this driver's lifetime, no
 *	// power_supply_put() needed
 */
#ifndef __HM_POWER_SUPPLY_H__
#define __HM_POWER_SUPPLY_H__

#include <linux/power_supply.h>

/* Offset of the custom property range from the largest standard value */
#define HM_POWER_SUPPLY_PROP_OFFSET	64

enum hm_power_supply_property {
	/* Range base sentinel; marks the numbering origin only, never
	 * use it as a property */
	HM_POWER_SUPPLY_PROP_BASE = POWER_SUPPLY_PROP_SERIAL_NUMBER +
				     HM_POWER_SUPPLY_PROP_OFFSET,

	HM_POWER_SUPPLY_PROP_CHARGING_ENABLED,	/* int: charging enabled 0/1 */
	HM_POWER_SUPPLY_PROP_INPUT_CURRENT_MA,	/* int: input current limit, mA */
	HM_POWER_SUPPLY_PROP_CHARGE_CURRENT_MA,	/* int: charge current, mA */
	HM_POWER_SUPPLY_PROP_CHARGE_VOLTAGE_MV,	/* int: charge float voltage, mV */
	HM_POWER_SUPPLY_PROP_ITERM_MA,		/* int: charge termination current, mA */
	HM_POWER_SUPPLY_PROP_VINDPM_MV,		/* int: input voltage droop threshold, mV */
	HM_POWER_SUPPLY_PROP_CHARGE_DONE,	/* int: charge done 0/1 */
	HM_POWER_SUPPLY_PROP_USB_DETECT,	/* write: push a raw vbus sample 0/1 */
	HM_POWER_SUPPLY_PROP_CHG_TYPE,		/* int: detected type, enum hm_power_supply_type */
	HM_POWER_SUPPLY_PROP_PROTOCOL_SELECT,	/* write: input protocol, enum hm_chg_proto */
	HM_POWER_SUPPLY_PROP_INPUT_SUSPEND,	/* int: input suspended 0/1 (stop drawing from the adapter) */
	HM_POWER_SUPPLY_PROP_RAW_SOC,	/* int: raw soc percent (battery psy; write: algorithm module pushes) */
	HM_POWER_SUPPLY_PROP_JEITA_ZONE,	/* int: jeita zone, enum hm_jeita_zone (battery psy; read-only) */

	/* Append new custom properties above this line; the range
	 * sentinel must stay last */
	HM_POWER_SUPPLY_PROP_MAX,
};

/*
 * Charger type detection result of the hm framework.
 *
 * The standard section below is value-anchored to the kernel's
 * enum power_supply_type (same order, explicit start): a value from
 * the standard section can be cast straight to enum power_supply_type
 * for the standard world (power_supply_desc.type, uevent TYPE=), no
 * mapping table needed.
 *
 * Rules:
 *   - never reorder or insert inside the standard section; the cast
 *     compatibility above depends on it;
 *   - hm specific types are appended at the tail only;
 *   - when feeding a value to the STANDARD type ABI (sysfs "type" or
 *     POWER_SUPPLY_PROP_TYPE), clamp it to the standard range: the
 *     kernel prints type names from an array indexed by the value and
 *     an out-of-range custom value would read past it.
 */
enum hm_power_supply_type {
	/* ---- standard section: keep in sync with power_supply.h ---- */
	HM_POWER_SUPPLY_TYPE_UNKNOWN = 0,
	HM_POWER_SUPPLY_TYPE_BATTERY,
	HM_POWER_SUPPLY_TYPE_UPS,
	HM_POWER_SUPPLY_TYPE_MAINS,
	HM_POWER_SUPPLY_TYPE_USB,			/* Standard Downstream Port */
	HM_POWER_SUPPLY_TYPE_USB_DCP,		/* Dedicated Charging Port */
	HM_POWER_SUPPLY_TYPE_USB_CDP,		/* Charging Downstream Port */
	HM_POWER_SUPPLY_TYPE_USB_ACA,		/* Accessory Charger Adapters */
	HM_POWER_SUPPLY_TYPE_USB_TYPE_C,		/* Type C Port */
	HM_POWER_SUPPLY_TYPE_USB_PD,		/* Power Delivery Port */
	HM_POWER_SUPPLY_TYPE_USB_PD_DRP,		/* PD Dual Role Port */
	HM_POWER_SUPPLY_TYPE_APPLE_BRICK_ID,	/* Apple Charging Method */
	HM_POWER_SUPPLY_TYPE_WIRELESS,		/* Wireless */

	/* ---- hm custom section: append below, never above ---- */
	HM_POWER_SUPPLY_TYPE_USB_HVDCP,		/* Qualcomm QC 2.0/3.0 */
	HM_POWER_SUPPLY_TYPE_USB_PPS,		/* PD PPS (programmable APDO) */
};

/* JEITA zone of the battery psy's JEITA_ZONE property (values of the
 * enum below); owned by hm-battery, consumed by any policy module */
enum hm_jeita_zone {
	JEITA_COLD,		/* charging disabled */
	JEITA_COOL,		/* reduced float voltage */
	JEITA_NORMAL,
	JEITA_WARM,		/* reduced float voltage */
	JEITA_HOT,		/* charging disabled */
};

/*
 * Input protocol the policy layer may select, written to the
 * HM_POWER_SUPPLY_PROP_PROTOCOL_SELECT property of chg_psy.
 * Detection results are the menu, this is the order.
 */
enum hm_chg_proto {
	HM_CHG_PROTO_5V = 0,	/* plain 5V (BC1.2 default / QC idle) */
	HM_CHG_PROTO_HVDCP,	/* QC high voltage */
	HM_CHG_PROTO_PD,	/* PD fixed PDO contract */
	HM_CHG_PROTO_PPS,	/* PD PPS */
};

/*
 * All get/set property calls go through these macros (they apply to
 * standard and hm custom properties alike): psp is always cast to the
 * standard enum, which removes the enum type mismatch warning; val is
 * a union power_supply_propval built by the caller and may carry
 * intval/strval.
 */
#define HM_PSY_GET_PROP(psy, psp, val) \
	power_supply_get_property((psy), \
			(enum power_supply_property)(psp), (val))

#define HM_PSY_SET_PROP(psy, psp, val) \
	power_supply_set_property((psy), \
			(enum power_supply_property)(psp), (val))

/*
 * Persistent psy acquisition: cache the pointer in *psy on first
 * success; later calls just reuse it without taking another reference,
 * so no power_supply_put() is ever needed; the held reference also
 * keeps the peer psy alive underneath us. Suitable for single-threaded
 * contexts such as probe; concurrent callers on the same *psy must
 * serialize themselves. Returns -EPROBE_DEFER while the peer psy is
 * not registered yet; returning it from probe makes the kernel retry.
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
