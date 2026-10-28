// SPDX-License-Identifier: GPL-2.0
/*
 * hm_battery - battery psy of the hm framework
 *
 * Role: the BATTERY-SIDE power supply. Registers the psy named
 * "battery" (the name is a hard contract: Android health HAL and
 * upower look it up by name) and exposes what the battery is going
 * through: status/health/capacity/voltage/current/temperature. The
 * input-side view (what the adapter offers) belongs to hm-charger's
 * "usb" psy; charging status is a synthesis of both sides and is
 * computed here, on the battery side, per the psy placement rules in
 * the framework README.
 *
 * Data flow:
 *
 *   FG hardware --> bat_fg_read() hook (the only hardware boundary)
 *              --> cache (lock-protected snapshot)
 *              --> status/health computation
 *                  + input evidence: usb psy USB_ONLINE (private
 *                    protocol) and the event bus
 *              --> psy get_property: the fast physical values
 *                  (voltage/current/temp) are PULL-THROUGH -- read
 *                  from the FG live on every get, so closed-loop
 *                  consumers get current data instead of the poll
 *                  cache; the derived values (status/health/ui_soc)
 *                  come from the cache + uevent on change
 *
 * Cross-module integration demonstrated here:
 *   - reads hm-charger's private psy via HM_PSY_GET_PROP
 *   - subscribes HM_EVT_PWR_USB_STATUS_CHANGED for immediate refresh
 *   - votes on hm-charger's "chg_disable"/"fv" votables via
 *     find_votable() for JEITA protection
 *
 * Conventions: mV/mA internally, x1000 at the psy boundary;
 * temperature in tenths of degree C (the ABI unit) throughout.
 */
#include <linux/device.h>
#include <linux/err.h>
#include <linux/kernel.h>
#include <linux/module.h>
#include <linux/mutex.h>
#include <linux/notifier.h>
#include <linux/of.h>
#include <linux/platform_device.h>
#include <linux/pm.h>
#include <linux/pm_wakeup.h>
#include <linux/power_supply.h>
#include <linux/workqueue.h>

#include "hm_event.h"
#include "hm_log.h"
#include "hm_power_supply.h"
#include "voter.h"

#define BAT_POLL_INTERVAL_DFLT_MS	10000
#define BAT_POLL_INTERVAL_MIN_MS		500

/* charging status computation */
#define BAT_IBAT_CHG_THLD_MA		50	/* ibat above: charging */
#define BAT_IBAT_TERM_THLD_MA		150	/* ibat below (CV): full */
/* full-state hysteresis: once FULL, only a soc drop below this level
 * (or losing the input) restarts charging -- in between the FG soc
 * wobble around 100 must not flip the status back and forth */
#define BAT_RECHARGE_SOC		97
/* a battery is declared REMOVED only after this many consecutive FG
 * read failures (single glitches keep the previous data) */
#define BAT_FG_FAIL_COUNT		3

/* JEITA bands (tenths of deg C), DT-tunable */
#define BAT_TEMP_COLD			0
#define BAT_TEMP_COOL			100
#define BAT_TEMP_WARM			450
#define BAT_TEMP_HOT			600
/*
 * JEITA float-voltage targets for the cool/warm bands: ABSOLUTE mV
 * values, not deltas -- the fv votable arbitrates absolute values and
 * a "base minus delta" vote would need a base nobody owns here (the
 * policy layer / cell profile votes the normal-zone base). Typical
 * values; real numbers come from the cell spec (DT-ify then).
 */
#define BAT_FV_COOL_MV			4100
#define BAT_FV_WARM_MV			4100

/* battery-side safety protections (thresholds per cell spec, DT-ify
 * when the real datasheet lands; every trip has a release threshold
 * below it -- hysteresis, so the protection cannot oscillate) */
#define BAT_VBAT_OV_MV			4600	/* trip: stop charging */
#define BAT_VBAT_OV_REL_MV		4450	/* release */
#define BAT_VBAT_UV_MV			3000	/* trip: precharge only */
#define BAT_VBAT_UV_REL_MV		3200	/* release: normal charging */
#define BAT_PRECHARGE_MA		100	/* trickle for a dead battery */
/* a temp reading outside this window is a broken sensor, not weather:
 * treat it as HOT (worst case) instead of trusting it */
#define BAT_TEMP_VALID_MIN		-400	/* tenths of deg C */
#define BAT_TEMP_VALID_MAX		900

/* capacity_level thresholds (%) */
#define BAT_CAP_CRITICAL		5
#define BAT_CAP_LOW			20
#define BAT_CAP_HIGH			95

/* voter client names this module casts; macros so the strings exist
 * exactly once; the string is exactly the macro name (#define X "X"),
 * so the vote-log client name and the source token are identical and
 * grepping either finds both */
#define VOTER_JEITA		"VOTER_JEITA"
#define VOTER_BAT_OV		"VOTER_BAT_OV"
#define VOTER_PRECHARGE	"VOTER_PRECHARGE"

/* hm_jeita_zone lives in hm_power_supply.h: it is the value contract
 * of the JEITA_ZONE property */

static const char * const jeita_zone_text[] = {
	"COLD", "COOL", "NORMAL", "WARM", "HOT",
};

struct bat_chip {
	struct device		*dev;
	struct delayed_work	refresh_work;
	unsigned int		poll_interval_ms;

	struct mutex		lock;		/* protects the cache below */
	/* cache: last FG snapshot + derived state */
	bool			present;
	int			vbat_mv;
	int			ibat_ma;	/* signed: + charging, - discharging */
	int			temp_tenth;	/* tenths of deg C */
	int			ui_soc;	/* user-facing percent; computed by the
				 * battery algorithm module (gauge/OCV
				 * model), NOT the raw FG register */
	int			raw_soc;	/* raw gauge soc percent; pushed by
					 * the algorithm module through the
					 * RAW_SOC property */
	unsigned int		charge_full_mah;
	unsigned int		charge_full_design_mah;
	unsigned int		cycle_count;
	int			technology;
	/* derived */
	int			status;		/* enum power_supply_status */
	int			health;		/* enum power_supply_health */
	enum hm_jeita_zone	jeita_zone;
	/* safety protection states (hysteresis latches) */
	bool			ov_active;	/* battery overvoltage */
	bool			uv_active;	/* dead battery, precharge */
	bool			temp_bad;	/* temp reading out of window */
	/* full-state hysteresis latch */
	bool			full_latched;
	/* consecutive FG read failures */
	int			fg_fail_cnt;
	/* last published snapshot, for change detection */
	int			rep_status;
	int			rep_ui_soc;
	int			rep_temp_tenth;

	bool			input_online;	/* cached input evidence */

	struct power_supply	*bat_psy;
	struct power_supply	*usb_psy;	/* hm-charger usb psy */
	struct notifier_block	nb;

	/* cached handles to hm-charger's votables (looked up once, see
	 * hm_votable_get_by_name); NULL until the peer module is up */
	struct votable		*chg_disable_vot;
	struct votable		*fv_vot;
	struct votable		*ichg_vot;
};

/* ------------------------------------------------------------------ */
/* FG hooks: the only hardware boundary, replace the bodies when
 * porting; the framework around them never changes ---- */

/*
 * One poll of the fuel gauge: fill the raw battery data. Returning
 * -EAGAIN keeps the previous values (FG busy), a hard error marks the
 * battery not present.
 */
static int bat_fg_read(struct bat_chip *chip)
{
	/* TODO: read the FG (vbat/ibat/temp/fcc/cycles); ui_soc comes
	 * from the battery algorithm module's computation, not from the
	 * raw gauge register */
	chip->present = true;
	chip->vbat_mv = 4000;
	chip->ibat_ma = 0;
	chip->temp_tenth = 250;		/* 25.0 degC */
	chip->ui_soc = 50;
	chip->charge_full_mah = 5000;
	chip->cycle_count = 0;
	return 0;
}

/*
 * Fast read of the three physical values, for the pull-through access
 * in bat_get_prop(): closed-loop consumers (e.g. direct charge) read
 * VOLTAGE_NOW / CURRENT_NOW / TEMP on demand and need live data, not
 * the up-to-poll-interval-old cache. A nonzero return falls back to
 * the cached values.
 */
static int bat_fg_read_fast(struct bat_chip *chip,
		int *vbat_mv, int *ibat_ma, int *temp_tenth)
{
	/* TODO: one FG register read of voltage/current/temp */
	*vbat_mv = chip->vbat_mv;
	*ibat_ma = chip->ibat_ma;
	*temp_tenth = chip->temp_tenth;
	return 0;
}

/* battery static identity; FG may or may not know these */
static unsigned int bat_fg_charge_full_design(struct bat_chip *chip)
{
	/* TODO: FG learned/OTP capacity, when available */
	return 5000;
}

static unsigned int bat_fg_cycle_count(struct bat_chip *chip)
{
	/* TODO: FG cycle counter */
	return 0;
}

/* ------------------------------------------------------------------ */
/* status / health computation                                        */
/* ------------------------------------------------------------------ */

/*
 * Refresh the input-side evidence through hm-charger's usb psy (the
 * kernel-only USB_ONLINE property). Needed for the boot case --
 * adapter already attached, no bus event will fire for it;
 * afterwards the event bus keeps the cache fresh. Sleepable (psy
 * read), so it runs from the refresh work only.
 */
static void bat_update_input_online(struct bat_chip *chip)
{
	union power_supply_propval val = { };

	if (hm_psy_get_by_name(&chip->usb_psy, "usb") ||
	    HM_PSY_GET_PROP(chip->usb_psy,
			    POWER_SUPPLY_PROP_ONLINE, &val))
		return;				/* keep the cached value */

	chip->input_online = !!val.intval;
}

/*
 * Compute status/health/jeita from the cached FG data + input
 * evidence. Called with chip->lock held.
 */
static void bat_compute_state(struct bat_chip *chip)
{
	/*
	 * Sensor sanity first: a reading outside the plausible window
	 * means a broken thermistor/ADC, not weather. Treat it as HOT
	 * (worst case: charging disabled) rather than trusting it.
	 */
	chip->temp_bad = chip->temp_tenth < BAT_TEMP_VALID_MIN ||
			 chip->temp_tenth > BAT_TEMP_VALID_MAX;

	/* JEITA zone first: health and status depend on it */
	if (chip->temp_bad)
		chip->jeita_zone = JEITA_HOT;
	else if (chip->temp_tenth < BAT_TEMP_COLD)
		chip->jeita_zone = JEITA_COLD;
	else if (chip->temp_tenth < BAT_TEMP_COOL)
		chip->jeita_zone = JEITA_COOL;
	else if (chip->temp_tenth > BAT_TEMP_HOT)
		chip->jeita_zone = JEITA_HOT;
	else if (chip->temp_tenth > BAT_TEMP_WARM)
		chip->jeita_zone = JEITA_WARM;
	else
		chip->jeita_zone = JEITA_NORMAL;

	/* over/undervoltage latches with hysteresis: trip at the
	 * threshold, release only below/at the release value, so a
	 * battery sitting right at the threshold cannot toggle the
	 * protection on and off */
	if (chip->vbat_mv >= BAT_VBAT_OV_MV)
		chip->ov_active = true;
	else if (chip->vbat_mv <= BAT_VBAT_OV_REL_MV)
		chip->ov_active = false;

	if (chip->vbat_mv <= BAT_VBAT_UV_MV)
		chip->uv_active = true;
	else if (chip->vbat_mv >= BAT_VBAT_UV_REL_MV)
		chip->uv_active = false;

	/* health: only the severe zones surface here; cool/warm are
	 * handled as reduced charging (JEITA votes), not as a fault */
	if (chip->ov_active)
		chip->health = POWER_SUPPLY_HEALTH_OVERVOLTAGE;
	else if (chip->jeita_zone == JEITA_COLD)
		chip->health = POWER_SUPPLY_HEALTH_COLD;
	else if (chip->jeita_zone == JEITA_HOT)
		chip->health = POWER_SUPPLY_HEALTH_OVERHEAT;
	else
		chip->health = POWER_SUPPLY_HEALTH_GOOD;

	/* battery overvoltage means no charging, unconditionally */
	if (chip->ov_active) {
		chip->status = POWER_SUPPLY_STATUS_NOT_CHARGING;
		return;
	}

	/* status synthesis */
	if (!chip->input_online || !chip->present) {
		chip->status = POWER_SUPPLY_STATUS_DISCHARGING;
		chip->full_latched = false;	/* input gone: reset */
		return;
	}

	/* Full-state hysteresis: once FULL is latched (soc hit 100 or
	 * the CV termination current was reached), it stays FULL until
	 * the soc actually falls below the recharge level -- the FG
	 * wobble 100 <-> 99 around a full battery must not flip the
	 * status back and forth (uevent storm, UI flicker). */
	if (chip->full_latched) {
		chip->status = POWER_SUPPLY_STATUS_FULL;
		if (chip->ui_soc <= BAT_RECHARGE_SOC)
			chip->full_latched = false;
		else
			return;
	}

	if (chip->ui_soc >= 100) {
		chip->full_latched = true;
		chip->status = POWER_SUPPLY_STATUS_FULL;
		return;
	}

	/* charging disabled (e.g. JEITA cold/hot, or any chg_disable
	 * voter): online but no current flowing */
	if (chip->ibat_ma < BAT_IBAT_CHG_THLD_MA) {
		if (chip->ibat_ma >= -BAT_IBAT_CHG_THLD_MA)
			chip->status = POWER_SUPPLY_STATUS_NOT_CHARGING;
		else
			chip->status = POWER_SUPPLY_STATUS_DISCHARGING;
		return;
	}

	/* CV-phase termination current reached: latch full before the
	 * FG soc catches up */
	if (chip->ibat_ma < BAT_IBAT_TERM_THLD_MA && chip->ui_soc >= 95) {
		chip->full_latched = true;
		chip->status = POWER_SUPPLY_STATUS_FULL;
		return;
	}

	chip->status = POWER_SUPPLY_STATUS_CHARGING;
}

/*
 * Resolve every votable handle this module votes on, ONCE per refresh
 * cycle (hm_votable_get_by_name caches: after first success it is a
 * single branch). Keeps the apply/withdraw functions below free of
 * scattered lookups; handles stay NULL until hm-charger is up, and
 * the vote sites simply skip while they are.
 */
static void bat_votables_resolve(struct bat_chip *chip)
{
	hm_votable_get_by_name(&chip->chg_disable_vot, "chg_disable");
	hm_votable_get_by_name(&chip->fv_vot, "fv");
	hm_votable_get_by_name(&chip->ichg_vot, "ichg");
}

/*
 * JEITA protection: the canonical consumer of hm-charger's votables.
 * Zones map to votes on "chg_disable" (hard stop) and "fv" (reduced
 * float voltage); NORMAL withdraws both.
 */
static void bat_jeita_apply(struct bat_chip *chip)
{
	int fv_mv = 0;
	bool disable = false;

	switch (chip->jeita_zone) {
	case JEITA_COLD:
	case JEITA_HOT:
		disable = true;
		break;
	case JEITA_COOL:
		fv_mv = BAT_FV_COOL_MV;
		break;
	case JEITA_WARM:
		fv_mv = BAT_FV_WARM_MV;
		break;
	case JEITA_NORMAL:
		break;
	}

	if (chip->chg_disable_vot)
		hm_vote(chip->chg_disable_vot, VOTER_JEITA, disable, 1);
	if (chip->fv_vot && fv_mv)
		hm_vote(chip->fv_vot, VOTER_JEITA, true, fv_mv);
	else if (chip->fv_vot)
		hm_vote(chip->fv_vot, VOTER_JEITA, false, 0);
}

/*
 * Battery-side safety protections, same shape as JEITA: latch states
 * computed under the lock (see bat_compute_state), votes cast here
 * outside it (vote -> callback -> psy write sleeps).
 *  - overvoltage: hard stop via "chg_disable";
 *  - dead battery: cap the charge current to a trickle via "ichg"
 *    (VOTE_MIN: the small precharge vote wins over any larger one).
 */
static void bat_safety_apply(struct bat_chip *chip)
{
	if (chip->chg_disable_vot)
		hm_vote(chip->chg_disable_vot, VOTER_BAT_OV, chip->ov_active, 1);
	if (chip->ichg_vot)
		hm_vote(chip->ichg_vot, VOTER_PRECHARGE, chip->uv_active,
				BAT_PRECHARGE_MA);
}

/* withdraw every vote this module casts (battery gone / driver
 * leaving): never leave a votable referencing our decisions */
static void bat_votes_withdraw(struct bat_chip *chip)
{
	if (chip->chg_disable_vot) {
		hm_vote(chip->chg_disable_vot, VOTER_JEITA, false, 0);
		hm_vote(chip->chg_disable_vot, VOTER_BAT_OV, false, 0);
	}
	if (chip->fv_vot)
		hm_vote(chip->fv_vot, VOTER_JEITA, false, 0);
	if (chip->ichg_vot)
		hm_vote(chip->ichg_vot, VOTER_PRECHARGE, false, 0);
}

static int bat_capacity_level(int soc)
{
	if (soc >= 100)
		return POWER_SUPPLY_CAPACITY_LEVEL_FULL;
	if (soc >= BAT_CAP_HIGH)
		return POWER_SUPPLY_CAPACITY_LEVEL_HIGH;
	if (soc >= BAT_CAP_LOW)
		return POWER_SUPPLY_CAPACITY_LEVEL_NORMAL;
	if (soc >= BAT_CAP_CRITICAL)
		return POWER_SUPPLY_CAPACITY_LEVEL_LOW;
	return POWER_SUPPLY_CAPACITY_LEVEL_CRITICAL;
}

/*
 * One refresh cycle: poll the FG, recompute, apply JEITA, publish on
 * change. Runs from the periodic work and from event-bus kicks (usb
 * online/offline changes the status immediately).
 */
static void bat_refresh(struct bat_chip *chip)
{
	bool changed;
	int rc;

	pm_stay_awake(chip->dev);

	rc = bat_fg_read(chip);
	if (rc == -EAGAIN) {
		pm_relax(chip->dev);
		return;			/* keep previous values */
	}

	/* input evidence (psy read, sleepable -- before the lock) */
	bat_update_input_online(chip);

	/* votable handles (cached lookups, near-free after first hit) */
	bat_votables_resolve(chip);

	mutex_lock(&chip->lock);
	if (rc) {
		/* FG read failed: only N consecutive failures declare the
		 * battery removed, a single glitch keeps the last data */
		if (++chip->fg_fail_cnt >= BAT_FG_FAIL_COUNT) {
			chip->present = false;
			chip->status = POWER_SUPPLY_STATUS_UNKNOWN;
			chip->full_latched = false;
		}
	} else {
		chip->fg_fail_cnt = 0;
		bat_compute_state(chip);
	}

	changed = chip->status != chip->rep_status ||
		  chip->ui_soc != chip->rep_ui_soc ||
		  chip->temp_tenth != chip->rep_temp_tenth;
	chip->rep_status = chip->status;
	chip->rep_ui_soc = chip->ui_soc;
	chip->rep_temp_tenth = chip->temp_tenth;
	mutex_unlock(&chip->lock);

	if (chip->present) {
		bat_jeita_apply(chip);
		bat_safety_apply(chip);
	} else {
		/* battery gone: no decision of ours may outlive it */
		bat_votes_withdraw(chip);
	}

	if (changed)
		power_supply_changed(chip->bat_psy);

	pm_relax(chip->dev);
}

static void bat_refresh_work(struct work_struct *ws)
{
	struct bat_chip *chip =
		container_of(ws, struct bat_chip, refresh_work.work);

	bat_refresh(chip);

	schedule_delayed_work(&chip->refresh_work,
			msecs_to_jiffies(chip->poll_interval_ms));
}

static int bat_evt_notify(struct notifier_block *nb, unsigned long event,
		void *ptr)
{
	struct bat_chip *chip =
		container_of(nb, struct bat_chip, nb);
	struct hm_evt_pwr_data *evt = ptr;

	switch (event) {
	case HM_EVT_PWR_USB_STATUS_CHANGED:
		/* the input side flipped: the status changes with it,
		 * refresh now instead of waiting for the next poll */
		chip->input_online = evt->usb_online;
		mod_delayed_work(system_wq, &chip->refresh_work, 0);
		break;
	default:
		break;
	}

	return NOTIFY_DONE;
}

static void bat_parse_dt(struct bat_chip *chip)
{
	of_property_read_u32(chip->dev->of_node, "poll-interval-ms",
			&chip->poll_interval_ms);
	if (chip->poll_interval_ms < BAT_POLL_INTERVAL_MIN_MS)
		chip->poll_interval_ms = BAT_POLL_INTERVAL_DFLT_MS;

	of_property_read_u32(chip->dev->of_node, "charge-full-design-mah",
			&chip->charge_full_design_mah);
	if (!chip->charge_full_design_mah)
		chip->charge_full_design_mah =
			bat_fg_charge_full_design(chip);

	chip->technology = POWER_SUPPLY_TECHNOLOGY_LION;
}

/* ------------------------------------------------------------------ */
/* power_supply interface (user space)                                 */
/* ------------------------------------------------------------------ */
static int bat_get_prop(struct power_supply *psy,
		enum power_supply_property psp,
		union power_supply_propval *val)
{
	struct bat_chip *chip = power_supply_get_drvdata(psy);
	int vbat_mv = 0, ibat_ma = 0, temp_tenth = 0;
	bool fast = false;
	int rc = 0;

	/* pull-through: the fast physical values are read live (I2C, ~ms,
	 * before the lock) instead of serving the poll cache; a failed
	 * fast read falls back to the cached snapshot below */
	switch ((int)psp) {
	case POWER_SUPPLY_PROP_VOLTAGE_NOW:
	case POWER_SUPPLY_PROP_CURRENT_NOW:
	case POWER_SUPPLY_PROP_TEMP:
		if (!bat_fg_read_fast(chip, &vbat_mv, &ibat_ma,
					&temp_tenth))
			fast = true;
		break;
	default:
		break;
	}

	/* the psy ABI reports voltage/current in micro units; internal
	 * units are mV/mA, convert at this boundary. Temperature is
	 * tenths of degree C on both sides, no conversion. */
	switch ((int)psp) {
	case POWER_SUPPLY_PROP_STATUS:
		val->intval = chip->status;
		break;
	case POWER_SUPPLY_PROP_PRESENT:
		val->intval = chip->present;
		break;
	case POWER_SUPPLY_PROP_HEALTH:
		val->intval = chip->health;
		break;
	case POWER_SUPPLY_PROP_TECHNOLOGY:
		val->intval = chip->technology;
		break;
	case POWER_SUPPLY_PROP_CAPACITY:
		val->intval = chip->ui_soc;
		break;
	case POWER_SUPPLY_PROP_CAPACITY_LEVEL:
		val->intval = bat_capacity_level(chip->ui_soc);
		break;
	case POWER_SUPPLY_PROP_VOLTAGE_NOW:
		val->intval = (fast ? vbat_mv : chip->vbat_mv) * 1000;
		break;
	case POWER_SUPPLY_PROP_CURRENT_NOW:
		val->intval = (fast ? ibat_ma : chip->ibat_ma) * 1000;
		break;
	case POWER_SUPPLY_PROP_TEMP:
		val->intval = fast ? temp_tenth : chip->temp_tenth;
		break;
	case POWER_SUPPLY_PROP_CHARGE_FULL:
		val->intval = chip->charge_full_mah * 1000;
		break;
	case POWER_SUPPLY_PROP_CHARGE_FULL_DESIGN:
		val->intval = chip->charge_full_design_mah * 1000;
		break;
	case POWER_SUPPLY_PROP_CYCLE_COUNT:
		val->intval = chip->cycle_count;
		break;
	/*
	 * Kernel-only custom properties: NOT in bat_props[], so they
	 * never appear in sysfs -- only reachable through the psy API
	 * (HM_PSY_GET_PROP) by hm modules.
	 */
	case HM_POWER_SUPPLY_PROP_RAW_SOC:
		val->intval = chip->raw_soc;
		break;
	case HM_POWER_SUPPLY_PROP_JEITA_ZONE:
		val->intval = chip->jeita_zone;
		break;
	default:
		rc = -EINVAL;
		break;
	}

	return rc;
}

/*
 * Kernel-only write path (same properties[] trick: no sysfs file, so
 * user space cannot reach it). The battery algorithm module pushes
 * its computed raw soc here; the derived JEITA zone is read-only --
 * forcing it would desync the zone from the temperature it is
 * computed from.
 */
static int bat_set_prop(struct power_supply *psy,
		enum power_supply_property psp,
		const union power_supply_propval *val)
{
	struct bat_chip *chip = power_supply_get_drvdata(psy);

	switch ((int)psp) {
	case HM_POWER_SUPPLY_PROP_RAW_SOC:
		if (val->intval < 0 || val->intval > 100)
			return -EINVAL;
		chip->raw_soc = val->intval;
		return 0;
	default:
		return -EINVAL;
	}
}

static void bat_external_power_changed(struct power_supply *psy)
{
	struct bat_chip *chip = power_supply_get_drvdata(psy);

	/* a supplier (usb psy) changed: refresh right away */
	mod_delayed_work(system_wq, &chip->refresh_work, 0);
}

static enum power_supply_property bat_props[] = {
	POWER_SUPPLY_PROP_STATUS,
	POWER_SUPPLY_PROP_PRESENT,
	POWER_SUPPLY_PROP_HEALTH,
	POWER_SUPPLY_PROP_TECHNOLOGY,
	POWER_SUPPLY_PROP_CAPACITY,
	POWER_SUPPLY_PROP_CAPACITY_LEVEL,
	POWER_SUPPLY_PROP_VOLTAGE_NOW,
	POWER_SUPPLY_PROP_CURRENT_NOW,
	POWER_SUPPLY_PROP_TEMP,
	POWER_SUPPLY_PROP_CHARGE_FULL,
	POWER_SUPPLY_PROP_CHARGE_FULL_DESIGN,
	POWER_SUPPLY_PROP_CYCLE_COUNT,
};

static const struct power_supply_desc bat_psy_desc = {
	.name			= "battery",	/* Android health HAL: by name */
	.type			= POWER_SUPPLY_TYPE_BATTERY,
	.properties		= bat_props,
	.num_properties		= ARRAY_SIZE(bat_props),
	.get_property		= bat_get_prop,
	.set_property		= bat_set_prop,
	.external_power_changed	= bat_external_power_changed,
};

static int __maybe_unused bat_suspend(struct device *dev)
{
	struct bat_chip *chip = dev_get_drvdata(dev);

	cancel_delayed_work_sync(&chip->refresh_work);
	return 0;
}

static int __maybe_unused bat_resume(struct device *dev)
{
	struct bat_chip *chip = dev_get_drvdata(dev);

	schedule_delayed_work(&chip->refresh_work, 0);
	return 0;
}

static SIMPLE_DEV_PM_OPS(bat_pm_ops, bat_suspend, bat_resume);

static int bat_probe(struct platform_device *pdev)
{
	struct bat_chip *chip;
	struct power_supply_config cfg = { };
	int rc;

	chip = devm_kzalloc(&pdev->dev, sizeof(*chip), GFP_KERNEL);
	if (!chip)
		return -ENOMEM;

	chip->dev = &pdev->dev;
	mutex_init(&chip->lock);

	bat_parse_dt(chip);

	/* works before anything external can kick them (probe order
	 * rule of the framework) */
	INIT_DELAYED_WORK(&chip->refresh_work, bat_refresh_work);

	cfg.drv_data = chip;
	cfg.of_node = chip->dev->of_node;

	chip->bat_psy = power_supply_register(chip->dev, &bat_psy_desc,
			&cfg);
	if (IS_ERR(chip->bat_psy))
		return PTR_ERR(chip->bat_psy);

	/* event subscription LAST: nothing can reach this driver before
	 * it is fully constructed */
	chip->nb.notifier_call = bat_evt_notify;
	rc = hm_event_register_notifier(&chip->nb);
	if (rc) {
		power_supply_unregister(chip->bat_psy);
		return rc;
	}

	device_init_wakeup(chip->dev, true);
	platform_set_drvdata(pdev, chip);

	schedule_delayed_work(&chip->refresh_work, 0);
	return 0;
}

static int bat_remove(struct platform_device *pdev)
{
	struct bat_chip *chip = platform_get_drvdata(pdev);

	hm_event_unregister_notifier(&chip->nb);
	cancel_delayed_work_sync(&chip->refresh_work);
	device_init_wakeup(chip->dev, false);
	power_supply_unregister(chip->bat_psy);

	/* withdraw every vote this module casts so the votables hold
	 * no references to our decisions after we are gone */
	bat_votes_withdraw(chip);
	return 0;
}

static const struct of_device_id bat_of_match[] = {
	{ .compatible = "hm,battery" },
	{ }
};

static struct platform_driver hm_battery_driver = {
	.driver = {
		.name		= "hm-battery",
		.of_match_table	= bat_of_match,
		.pm		= &bat_pm_ops,
	},
	.probe	= bat_probe,
	.remove	= bat_remove,
};

builtin_platform_driver(hm_battery_driver);

MODULE_AUTHOR("hm battery reference");
MODULE_DESCRIPTION("HM battery psy (status/health/capacity + JEITA)");
MODULE_LICENSE("GPL");
