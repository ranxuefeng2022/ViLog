// SPDX-License-Identifier: GPL-2.0
#include <linux/completion.h>
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

#include "hm_charger.h"
#include "hm_event.h"
#include "hm_log.h"
#include "hm_power_supply.h"
#include "voter.h"

#define USB_ONLINE_DEBOUNCE_DFLT_MS	100	/* rising edge: contact bounce */
#define USB_OFFLINE_DEBOUNCE_DFLT_MS	500	/* falling edge: absorb vbus glitches */
/* charger detection state machine tuning */
#define DET_POLL_MS		100	/* detection result poll interval */
#define BC12_TIMEOUT_MS		600	/* BC1.2 detection timeout */
#define HVDCP_TIMEOUT_MS	800	/* QC (HVDCP) probe timeout */
/* power detection tuning (single blocking implementation) */
#define PWR_DET_START_MA	200	/* first step, also the floor */
/* per-step settle default; DT-tunable ("pwr-det-step-settle-ms") so it
 * can be tightened per board after bench validation. Two-sided
 * tradeoff, do not guess: too short FALSELY fails a step on the
 * adapter's load-step transient dip (underestimates the adapter);
 * too long only costs sweep time (a slow soft overload sag is caught
 * one step later either way). Typical adapters need 50-150ms. Also
 * CONSTRAINT: 2x settle must stay <= the offline debounce window
 * (rescue window, see chg_parse_dt) */
#define PWR_DET_STEP_SETTLE_DFLT_MS	200
#define PWR_DET_STEP_SETTLE_MIN_MS	50
#define PWR_DET_CAP_CDP_MA	1500	/* type-based caps */
#define PWR_DET_CAP_DCP_MA	2000
#define PWR_DET_VINDPM_HEADROOM_MV	300	/* buck converter headroom */
#define PWR_DET_VBAT_FALLBACK_MV	4400	/* assumed when no battery psy */
#define PWR_DET_STEP_MA		100	/* linear step of the sweep */
#define PWR_DET_START_DFLT_MA	500	/* DT default start value, all types */
#define DEFALUT_VOTER "DEFALUT_VOTER"
/* primary charger psy name; must match the name the peer module
 * registers its psy with */
#define PRIMARY_CHG_PSY_NAME "primary_chg_psy"

static char *chg_supplied_to[] = {
	"battery",		/* canonical usb->battery supply relation;
				 * power_supply_changed(usb) cascades the
				 * battery psy's external_power_changed */
	"cms_psy",
};

/* charger detection state machine */
enum chg_det_st {
	DET_IDLE,		/* no adapter */
	DET_BC12,		/* BC1.2 D+/D- detection running */
	DET_PWR,		/* 5V power detection (CDP/DCP, after BC12) */
	DET_HVDCP,		/* QC probe (after the 5V sweep, DCP only) */
	DET_PWR_QC,		/* QC mode power detection (probe hit) */
	DET_DONE,		/* concluded, chg_type/caps valid */
};

static const char * const det_st_text[] = {
	"IDLE", "BC12", "PWR", "HVDCP", "PWR_QC", "DONE",
};

/* BC1.2 detection result */
enum hm_bc12_type {
	HM_BC12_UNKNOWN,
	HM_BC12_SDP,
	HM_BC12_CDP,
	HM_BC12_DCP,
};

struct chg_chip {
	struct device		*dev;

	struct mutex		lock;
	bool				usb_present;
	unsigned int		vbus_mv; //VBUS voltage at the device, after adapter cable drop
	unsigned int		ibus_ma;
	unsigned int		input_ilim_ma;

	bool				usb_last_present;

	/* vbus online debounce: usb_present is the committed (debounced)
	 * state the framework sees; usb_raw is the latest sample pushed
	 * by the detector, committed only after the confirmation window */
	struct delayed_work	debounce_work;
	bool				usb_raw;
	unsigned int		debounce_online_ms;
	unsigned int		debounce_offline_ms;

	/* wakes the power sweep the instant the detector pushes a
	 * vbus drop sample (vs sleeping the whole settle window) */
	struct completion	sweep_drop;

	struct power_supply	*usb_psy;
	struct power_supply	*primary_chg_psy;
	struct power_supply	*secondery_chg_psy;
	struct power_supply	*bat_psy;


	struct notifier_block	chg_nb;

	struct votable		*icl_votable;	/* input current limit, mA */
	struct votable		*ichg_votable;	/* charge current, mA */
	struct votable		*fv_votable;	/* charge float voltage, mV */
	struct votable		*iterm_votable;	/* charge termination current, mA */
	struct votable		*vindpm_votable; /* input voltage droop protection threshold, mV */
	struct votable		*chg_disable_votable;	/* SET_ANY: any true = battery charging off */
	struct votable		*chg_suspend_votable;	/* SET_ANY: any true = input suspended */

	int chg_type;	/* concluded type, enum hm_power_supply_type */

	/* charger detection state machine (see chg_det_*) */
	enum chg_det_st	det_st;
	struct delayed_work	det_work;
	struct work_struct	pd_work;	/* PD evidence -> arbitration */
	int			det_retries;
	unsigned long		det_jiffies;	/* start time, duration log */
	bool			det_stage_started;
	int			bc12_result;	/* enum hm_bc12_type */
	bool			hvdcp_ok;
	/* PD listener results, fed by chg_pd_event() from the tcpc
	 * notifier; preempt every other source at any state */
	bool			pd_capable;
	bool			pps_capable;
	unsigned int		pd_max_mv;
	unsigned int		pd_max_ma;
	/* concluded adapter capability */
	unsigned int		adapter_max_mv;	/* selected mode's max voltage */
	unsigned int		adapter_max_ma;	/* selected mode's ICL */
	/* power detection results, one per input mode: HVDCP adapters
	 * switch 9V <-> 5V (DCP mode) mid-charge (taper / thermal), each
	 * switch re-applies the ICL measured for that mode */
	unsigned int		icl_5v_ma;	/* measured 5V (DCP mode) ICL */
	unsigned int		icl_hvdcp_ma;	/* measured QC mode ICL, 0 = n/a */
	/* power detection start values, one per type; DT-configurable,
	 * always clamped to the type's standard cap at parse time */
	unsigned int		pwr_start_cdp_ma;
	unsigned int		pwr_start_dcp_ma;
	unsigned int		pwr_start_hvdcp_ma;
	unsigned int		pwr_step_settle_ms;	/* per-step settle, DT-tunable */
	int			sel_protocol;	/* selected input protocol, enum hm_chg_proto */
};

static void chg_reset_voters(struct chg_chip *chip, bool online)
{
	hm_vote(chip->vindpm_votable, DEFALUT_VOTER, false, 0);
	hm_vote(chip->icl_votable, DEFALUT_VOTER, false, 0);
}

/* ------------------------------------------------------------------ */
/* charger detection state machine                                     */
/* ------------------------------------------------------------------ */
/*
 * Two fully independent detectors, one arbitration:
 *
 *   pipeline (chg_det_work): BC12 -> 5V sweep -> QC probe -> QC
 *     sweep, always runs to completion, never disturbed by PD
 *   PD listener (chg_pd_event): records the contract evidence at
 *     any time, from the tcpc notifier
 *
 *   IDLE --insert--> BC12 --SDP--> COMPLETE (capability fixed by spec)
 *                        |--CDP--> PWR (5V sweep) ------------> COMPLETE
 *                        |--DCP--> PWR (5V sweep) --> HVDCP (QC probe)
 *                                                    |--miss-> COMPLETE
 *                                                    |--hit--> PWR_QC --> COMPLETE
 *   any state --unplug--> IDLE
 *
 * Both sides only record EVIDENCE; chg_arbitrate() recomputes the
 * classification (priority PD > QC > BC1.2) at every commit point --
 * pipeline completion, or a PD contract arriving/being lost at any
 * time -- and publishes only when the conclusion actually changed.
 *
 * The 5V sweep runs while the adapter is still at its post-BC1.2 idle
 * state and the QC-mode sweep reuses the voltage the probe itself
 * raised -- exactly one voltage transition in the whole pipeline.
 *
 * Power detection produces one ICL per input mode (5V/DCP mode and
 * QC mode). chg_det_complete() only publishes the results and
 * settles into the safe 5V default; WHICH protocol to charge with is
 * a policy decision made through chg_protocol_select() (exposed
 * to other modules as the PROTOCOL_SELECT property on usb psy).
 * Each selection re-votes the ICL measured for that mode -- the vote
 * is the programming path to the primary charger (chg_icl_callback
 * -> chg_set_prop_to_primary_chg), so switching protocols never
 * re-detects.
 */

/* ---- detection hooks: the only hardware boundary, replace the
 * bodies when porting; the machine itself never changes ---- */

/* kick the BC1.2 detector in the charger IC / transceiver */
static int chg_bc12_start(struct chg_chip *chip)
{
	return 0;
}

/* read the BC1.2 detector status; -EAGAIN while still running */
static int chg_bc12_poll(struct chg_chip *chip, int *result)
{
	/* placeholder: report DCP immediately so the pipeline advances */
	*result = HM_BC12_DCP;
	return 0;
}

/* start the QC probe: drive D+/D- per the QC spec, watch whether VBUS
 * rises; harmless no-op when the adapter is not QC capable */
static int chg_hvdcp_probe_start(struct chg_chip *chip)
{
	return 0;
}

/* read the QC probe result; -EAGAIN while still running */
static int chg_hvdcp_probe_poll(struct chg_chip *chip, bool *ok)
{
	/* placeholder: no QC adapter */
	*ok = false;
	return 0;
}

/*
 * Adapter power detection sweeps. Always invoked from
 * chg_det_work() (a sleepable context), so msleep() below is legal
 * and the event chain is never blocked; each sweep is bounded by the
 * step ladder x settle time (<= ~1s).
 *
 * Method: step the ICL up the coarse ladder through the icl votable
 * (the vote IS the programming path to the primary charger), watch
 * the vindpm fold-back after each step and settle at the last step
 * that passed. Two sweeps: 5V right after BC1.2 (adapter idle state),
 * QC mode after a successful QC probe (which already raised VBUS).
 */

/* sensor hook: did the primary charger fold back the input current
 * since the last call? Replace the body when porting */
static bool chg_pwr_vindpm_hit(struct chg_chip *chip)
{
	/* TODO: read the primary charger's vindpm fold-back status */
	return false;
}

/* hook: command the adapter into QC mode for the second phase.
 * Replace the body when porting */
static int chg_pwr_qc_enter(struct chg_chip *chip)
{
	/* TODO: QC handshake to the operating voltage */
	return 0;
}

/*
 * Arm the sweep's fold-back threshold, relative to the battery
 * voltage: the threshold must sit above VBAT + converter headroom,
 * otherwise a sag first pushes the buck out of regulation and the
 * "fold-back" we detect is the converter's dropout, not the adapter's
 * current limit (which would badly underestimate the adapter).
 * Falls back to a near-full battery assumption when the battery psy
 * is not readable yet.
 */
static void chg_pwr_arm_vindpm(struct chg_chip *chip)
{
	union power_supply_propval val = { };
	unsigned int vbat_mv = PWR_DET_VBAT_FALLBACK_MV;

	if (!hm_psy_get_by_name(&chip->bat_psy, "battery") &&
	    !HM_PSY_GET_PROP(chip->bat_psy, POWER_SUPPLY_PROP_VOLTAGE_NOW,
				&val) &&
	    val.intval > 0)
		vbat_mv = val.intval / 1000;	/* uV -> mV */

	hm_vote(chip->vindpm_votable, DEFALUT_VOTER, true,
			vbat_mv + PWR_DET_VINDPM_HEADROOM_MV);
	hm_dbg("sweep vindpm armed at %dmV (vbat %dmV)\n",
			vbat_mv + PWR_DET_VINDPM_HEADROOM_MV, vbat_mv);
}

/*
 * Apply one sweep step and report whether it survived its settle
 * window. Event-driven: a vbus drop pushed by the detector completes
 * early (worst-case reaction latency ~0 instead of a whole settle
 * period); a timed-out window is then confirmed against the vindpm
 * fold-back sensor (a sag to the threshold need not produce a drop
 * sample), and finally against usb_raw as a late-race belt.
 */
static bool chg_pwr_step_passes(struct chg_chip *chip,
		unsigned int step)
{
	/* fail fast without waiting: the input is already gone */
	if (!chip->usb_raw)
		return false;

	reinit_completion(&chip->sweep_drop);
	hm_vote(chip->icl_votable, DEFALUT_VOTER, true, step);

	if (wait_for_completion_timeout(&chip->sweep_drop,
			msecs_to_jiffies(chip->pwr_step_settle_ms)))
		return false;			/* drop signaled in window */

	if (chg_pwr_vindpm_hit(chip))
		return false;			/* folded back, no drop */

	return chip->usb_raw;
}

/*
 * One linear sweep: start at the type's DT-configured start value and
 * walk up in PWR_DET_STEP_MA increments; the FIRST step that folds
 * back (vindpm) or drops vbus settles the result at the PREVIOUS
 * step. Reaching the cap without a fold-back settles at the cap.
 * When even the first step fails there is no tested previous value:
 * the result falls back to the insertion-safe floor (an untested
 * start-minus-step would just be a guess).
 */
static unsigned int chg_pwr_sweep_phase(struct chg_chip *chip,
		unsigned int cap, unsigned int start_ma)
{
	unsigned int stable = 0, cur = start_ma;

	/*
	 * Any PD source has its power fixed by the contract (fixed PDO or
	 * PPS APDO): skip the whole sweep -- sweeping would waste ~1.5s
	 * and pull past the default current allowed before a contract.
	 * Reading the evidence here is a decision input only; the pipeline
	 * itself stays independent of PD traffic. Return 0 = "not
	 * applicable"; every consumer already falls back to the SDP-class
	 * default for an unmeasured value.
	 */
	if (chip->pd_capable)
		return 0;

	chg_pwr_arm_vindpm(chip);

	while (cur <= cap) {
		if (!chg_pwr_step_passes(chip, cur))
			break;			/* settle at the previous step */

		stable = cur;
		cur += PWR_DET_STEP_MA;
	}

	stable = max(stable, PWR_DET_START_MA);

	/* settle at the result and hand the vindpm threshold back */
	hm_vote(chip->icl_votable, DEFALUT_VOTER, true, stable);
	hm_vote(chip->vindpm_votable, DEFALUT_VOTER, false, 0);
	hm_dbg("sweep result %umA\n", stable);
	return stable;
}

/*
 * PD capability ingestion point -- call this from the tcpc notifier
 * callback with the parsed SRC_CAP result (best fixed PDO or best PPS
 * APDO), or with capable=false on contract loss (hard reset).
 * Atomic-safe: it only records the data under the lock and kicks the
 * machine; (re)classification happens in the work context. SRC_CAP may
 * arrive before the debounce commits online -- which is exactly why
 * chg_det_start() must NOT clear these fields.
 */
static void chg_pd_event(struct chg_chip *chip, bool capable,
		bool pps, unsigned int max_mv, unsigned int max_ma)
{
	mutex_lock(&chip->lock);
	chip->pd_capable = capable;
	chip->pps_capable = capable ? pps : false;
	chip->pd_max_mv = capable ? max_mv : 0;
	chip->pd_max_ma = capable ? max_ma : 0;
	mutex_unlock(&chip->lock);

	/* Hand the evidence to the arbitration; the detection pipeline
	 * itself is never disturbed by PD traffic */
	schedule_work(&chip->pd_work);
}

/*
 * Program a selected protocol into the hardware (PD Request for a
 * fixed PDO or PPS APDO, QC voltage class, nothing for plain 5V):
 * the only place protocol requests are issued.
 */
static int chg_protocol_apply(struct chg_chip *chip, int proto)
{
	/*
	 * TODO: issue the request for the selected protocol:
	 *  - HM_CHG_PROTO_5V: drop the adapter back to 5V -- the QC sweep
	 *    leaves it at the high voltage, this MUST command it down;
	 *  - HM_CHG_PROTO_HVDCP: QC handshake to the voltage class;
	 *  - HM_CHG_PROTO_PD/PPS: PD Request for the chosen (A)PDO.
	 */
	return 0;
}

/*
 * Protocol selection interface -- the policy layer (this driver or
 * any module through the HM_POWER_SUPPLY_PROP_PROTOCOL_SELECT
 * property on usb psy) picks the input protocol. Detection results
 * are only the menu: a request for a capability that was not
 * detected is rejected. Each selection re-votes the ICL measured for
 * that mode (the vote is the programming path to the primary
 * charger), so switching protocols never re-detects.
 */
static int chg_protocol_select(struct chg_chip *chip, int proto)
{
	int rc;

	/* The menu is published only at DET_DONE: refuse selections while
	 * the detection pipeline is still running (an early HVDCP pick
	 * would vote an unmeasured -- possibly zero -- ICL and stop
	 * charging). complete()'s own safe-default call runs after the
	 * state was set to DONE, so it is unaffected. */
	if (chip->det_st != DET_DONE)
		return -EAGAIN;

	switch (proto) {
	case HM_CHG_PROTO_5V:
		chip->adapter_max_mv = 5000;
		chip->adapter_max_ma = chip->icl_5v_ma ? : 500;
		break;
	case HM_CHG_PROTO_HVDCP:
		if (!chip->hvdcp_ok)
			return -EINVAL;
		/* adapter_max_mv: QC voltage class, set by the hook */
		chip->adapter_max_ma = chip->icl_hvdcp_ma;
		break;
	case HM_CHG_PROTO_PD:
		if (!chip->pd_capable)
			return -EINVAL;
		chip->adapter_max_mv = chip->pd_max_mv;
		chip->adapter_max_ma = chip->pd_max_ma;
		break;
	case HM_CHG_PROTO_PPS:
		if (!chip->pps_capable)
			return -EINVAL;
		chip->adapter_max_mv = chip->pd_max_mv;
		chip->adapter_max_ma = chip->pd_max_ma;
		break;
	default:
		return -EINVAL;
	}

	rc = chg_protocol_apply(chip, proto);
	if (rc)
		return rc;

	chip->sel_protocol = proto;
	hm_vote(chip->icl_votable, DEFALUT_VOTER, true,
			chip->adapter_max_ma);
	power_supply_changed(chip->usb_psy);
	hm_info("protocol: %d %dmV %dmA\n", proto,
			chip->adapter_max_mv, chip->adapter_max_ma);
	return 0;
}

/*
 * ---- Arbitration: evidence in, one answer out ----
 *
 * The detection pipeline (chg_det_work) and the PD listener
 * (chg_pd_event) run fully independent and never disturb each
 * other; both only record EVIDENCE (pd_capable/pps_capable,
 * bc12_result, hvdcp_ok, icl_*). Whenever either side has something
 * new -- pipeline completion, or a PD contract arriving / being lost
 * at any time -- arbitration recomputes the classification from the
 * evidence and publishes it if (and only if) the conclusion changed.
 */

/* classification: pure function of the evidence, priority PD > QC >
 * BC1.2; no state machine of its own */
static int chg_classify(struct chg_chip *chip)
{
	if (chip->pd_capable)
		return chip->pps_capable ?
			HM_POWER_SUPPLY_TYPE_USB_PPS :
			HM_POWER_SUPPLY_TYPE_USB_PD;
	if (chip->bc12_result == HM_BC12_DCP && chip->hvdcp_ok)
		return HM_POWER_SUPPLY_TYPE_USB_HVDCP;
	if (chip->bc12_result == HM_BC12_DCP)
		return HM_POWER_SUPPLY_TYPE_USB_DCP;
	if (chip->bc12_result == HM_BC12_CDP)
		return HM_POWER_SUPPLY_TYPE_USB_CDP;
	return HM_POWER_SUPPLY_TYPE_USB;	/* SDP / unknown */
}

/* recompute and publish on change; idempotent */
static void chg_arbitrate(struct chg_chip *chip)
{
	struct hm_evt_chg_type_data evt;
	int t;

	/* nothing to classify before the pipeline finished; PD evidence
	 * recorded in the meantime is picked up at completion */
	if (chip->det_st != DET_DONE || !chip->usb_present)
		return;

	t = chg_classify(chip);
	if (t == chip->chg_type)
		return;				/* conclusion unchanged */

	chip->chg_type = t;
	hm_info("arbitrated type=%d\n", t);

	/* safe default until the policy layer decides */
	chg_protocol_select(chip, HM_CHG_PROTO_5V);

	if (chip->pd_capable) {
		evt.max_mv = chip->pd_max_mv;
		evt.max_ma = chip->pd_max_ma;
	} else if (chip->hvdcp_ok) {
		evt.max_mv = 0;			/* QC class voltage set at select */
		evt.max_ma = chip->icl_hvdcp_ma;
	} else {
		evt.max_mv = 5000;
		evt.max_ma = chip->icl_5v_ma ? : 500;
	}

	evt.chg_type = chip->chg_type;
	evt.pps = chip->pps_capable;
	hm_event_publish(HM_EVT_PWR_CHG_TYPE_CHANGED, &evt);
}

static void chg_pd_work(struct work_struct *ws)
{
	struct chg_chip *chip =
		container_of(ws, struct chg_chip, pd_work);

	chg_arbitrate(chip);
}

static void chg_det_set_st(struct chg_chip *chip,
		enum chg_det_st st)
{
	hm_info("det: %s -> %s\n", det_st_text[chip->det_st],
			det_st_text[st]);
	chip->det_retries = 0;
	chip->det_stage_started = false;
	chip->det_st = st;
}

/*
 * Entry half of a stage: kick the stage's start hook exactly once
 * per state, always from chg_det_work() context (sleepable), so a
 * blocking hook never stalls the event chain that led here. Returns
 * true on the entry run -- the caller reschedules and starts polling
 * on the next tick.
 */
static bool chg_det_stage_enter(struct chg_chip *chip)
{
	if (chip->det_stage_started)
		return false;

	chip->det_stage_started = true;
	switch (chip->det_st) {
	case DET_BC12:
		chg_bc12_start(chip);
		break;
	case DET_HVDCP:
		chg_hvdcp_probe_start(chip);
		break;
	default:
		break;
	}

	return true;
}

/*
 * Detection pipeline finished: mark DONE and hand the accumulated
 * evidence (including whatever PD contract arrived meanwhile) to the
 * arbitration, which classifies, publishes and settles the safe
 * default -- see chg_arbitrate().
 */
static void chg_det_complete(struct chg_chip *chip)
{
	if (!chip->usb_present) {
		/* adapter went away mid-detection: the offline path
		 * (cable cb -> chg_det_stop) is already tearing the
		 * machine down and waits for this run -- publish nothing,
		 * its cleanup has the last word */
		return;
	}

	/* DONE first: protocol selections are only accepted from a
	 * finished detection (see chg_protocol_select) */
	chg_det_set_st(chip, DET_DONE);
	hm_info("pipeline took %lums\n",
			jiffies_to_msecs(jiffies - chip->det_jiffies));

	chg_arbitrate(chip);
}

static void chg_det_work(struct work_struct *ws)
{
	struct chg_chip *chip =
		container_of(ws, struct chg_chip, det_work.work);
	int rc;

	pm_stay_awake(chip->dev);

	/* adapter went away: the offline path is tearing the machine
	 * down (chg_det_stop's cancel_work_sync waits for this run);
	 * stop here without advancing the state machine any further */
	if (!chip->usb_present && chip->det_st != DET_IDLE)
		goto out;

	/* entry run of a state: kick its start hook here (this sleepable
	 * context), poll from the next tick on */
	if (chg_det_stage_enter(chip))
		goto resched;

	switch (chip->det_st) {
	case DET_BC12: {
		int r;

		rc = chg_bc12_poll(chip, &r);
		if (rc == -EAGAIN) {
			if (++chip->det_retries * DET_POLL_MS < BC12_TIMEOUT_MS)
				goto resched;

			hm_warn("BC1.2 detect timeout, assuming DCP\n");
			r = HM_BC12_DCP;
		}

		chip->bc12_result = r;
		if (r == HM_BC12_DCP || r == HM_BC12_CDP) {
			/* both sweep the 5V capability first, while the
			 * adapter is still at its post-BC1.2 idle state;
			 * the QC probe follows only for a DCP, afterwards */
			chg_det_set_st(chip, DET_PWR);
			goto resched;
		}

		/* SDP/unknown: capability fixed by the spec, conclude */
		chg_det_complete(chip);
		break;
	}

	case DET_HVDCP: {
		bool ok;

		rc = chg_hvdcp_probe_poll(chip, &ok);
		if (rc == -EAGAIN) {
			if (++chip->det_retries * DET_POLL_MS <
					HVDCP_TIMEOUT_MS)
				goto resched;

			hm_warn("HVDCP probe timeout\n");
			ok = false;
		}

		chip->hvdcp_ok = ok;
		if (ok) {
			/* adapter already at 9V from the probe: sweep the
			 * QC-mode capability right here */
			chg_det_set_st(chip, DET_PWR_QC);
		} else {
			/* plain DCP: the 5V sweep already measured it */
			chg_det_complete(chip);
		}
		goto resched;
	}

	case DET_PWR: {
		bool is_cdp = (chip->bc12_result == HM_BC12_CDP);
		unsigned int cap = is_cdp ?
				PWR_DET_CAP_CDP_MA : PWR_DET_CAP_DCP_MA;
		unsigned int start = is_cdp ?
				chip->pwr_start_cdp_ma : chip->pwr_start_dcp_ma;

		/* one blocking linear sweep, bounded by steps x settle; the
		 * stage_enter mechanism guarantees this runs in the
		 * sleepable det_work context */
		chip->icl_5v_ma = chg_pwr_sweep_phase(chip, cap, start);

		if (!chip->usb_present)
			break;		/* offline is being handled elsewhere */

		if (chip->bc12_result == HM_BC12_CDP) {
			/* CDP: no QC probe, done */
			chip->icl_hvdcp_ma = 0;
			chg_det_complete(chip);
			break;
		}

		/* DCP: QC probe next (PD absence was checked at the top
		 * of this run) */
		chg_det_set_st(chip, DET_HVDCP);
		goto resched;
	}

	case DET_PWR_QC:
		/* enter QC mode (the probe left the adapter at 5V) and
		 * sweep the QC-mode capability; failure degrades to the
		 * 5V result only */
		if (chg_pwr_qc_enter(chip)) {
			hm_warn("QC mode enter failed, 5V result only\n");
			chip->icl_hvdcp_ma = 0;
			chg_det_complete(chip);
			break;
		}

		chip->icl_hvdcp_ma = chg_pwr_sweep_phase(chip,
				PWR_DET_CAP_DCP_MA, chip->pwr_start_hvdcp_ma);
		chg_det_complete(chip);
		break;

	default:
		break;
	}

out:
	pm_relax(chip->dev);
	return;

resched:
	pm_relax(chip->dev);
	schedule_delayed_work(&chip->det_work,
			msecs_to_jiffies(DET_POLL_MS));
}

/* adapter confirmed online: run the detection pipeline; icl already
 * holds the insertion-safe 500mA vote from the cable callback */
static void chg_det_start(struct chg_chip *chip)
{
	/* The PD fields are deliberately NOT cleared here: SRC_CAP may
	 * arrive before the debounce commits online (tcpc moves faster
	 * than our confirmation window) -- they belong to the tcpc
	 * listener and are wiped by chg_det_stop() on a real detach */
	chip->chg_type = HM_POWER_SUPPLY_TYPE_UNKNOWN;
	chip->bc12_result = HM_BC12_UNKNOWN;
	chip->hvdcp_ok = false;
	chip->adapter_max_mv = 0;
	chip->adapter_max_ma = 0;
	chip->icl_5v_ma = 0;
	chip->icl_hvdcp_ma = 0;
	chip->sel_protocol = HM_CHG_PROTO_5V;
	chip->det_jiffies = jiffies;

	/* only state + schedule here: the BC1.2 start hook runs from the
	 * first chg_det_work() run, so a blocking hook cannot stall
	 * the event chain that called us */
	chg_det_set_st(chip, DET_BC12);
	mod_delayed_work(system_wq, &chip->det_work, 0);
}

/* adapter removed: stop the machine and wipe every detection result
 * so the next insertion starts clean */
static void chg_det_stop(struct chg_chip *chip)
{
	cancel_delayed_work_sync(&chip->det_work);
	chg_det_set_st(chip, DET_IDLE);
	chip->chg_type = HM_POWER_SUPPLY_TYPE_UNKNOWN;
	chip->bc12_result = HM_BC12_UNKNOWN;
	chip->hvdcp_ok = false;
	chip->pd_capable = false;
	chip->pps_capable = false;
	chip->pd_max_mv = 0;
	chip->pd_max_ma = 0;
	chip->adapter_max_mv = 0;
	chip->adapter_max_ma = 0;
	chip->icl_5v_ma = 0;
	chip->icl_hvdcp_ma = 0;
	chip->sel_protocol = HM_CHG_PROTO_5V;
}

static void chg_response_cable_cb(struct chg_chip *chip, bool online)
{
	chg_reset_voters(chip, online);

	if (online) {
		/* insertion-safe ICL until detection completes: aligned with
		 * PWR_DET_START_MA, deliberately below the SDP-class 500mA
		 * (BC1.2/PD have not run yet, assume the weakest source) */
		hm_vote(chip->icl_votable, DEFALUT_VOTER, true, PWR_DET_START_MA);
		chg_det_start(chip);
	} else {
		chg_det_stop(chip);
	}
}

static int chg_evt_notify(struct notifier_block *nb, unsigned long event,
		void *ptr)
{
	struct chg_chip *chip =
		container_of(nb, struct chg_chip, chg_nb);
	struct hm_evt_pwr_data *evt = ptr;

	switch (event) {
		case HM_EVT_PWR_USB_STATUS_CHANGED:
			chg_response_cable_cb(evt->usb_online);
			break;
		default:
			break;
	}

	return NOTIFY_DONE;
}

static void chg_psy_changed(struct chg_chip *chip)
{
	if (chip->usb_present != chip->usb_last_present) {
		struct hm_evt_pwr_data evt = {
			.usb_online = chip->usb_present,
		};
		unsigned long ev = HM_EVT_PWR_USB_STATUS_CHANGED;

		chip->usb_last_present = chip->usb_present;
		power_supply_changed(chip->usb_psy);
		hm_event_publish(ev, &evt);
	}
}

/*
 * Vbus online debounce.
 *
 */
static void chg_debounce_work(struct work_struct *ws)
{
	struct chg_chip *chip =
		container_of(ws, struct chg_chip, debounce_work.work);

	mutex_lock(&chip->lock);
	if (chip->usb_raw == chip->usb_present) {
		/* recovered before the window elapsed */
		mutex_unlock(&chip->lock);
		return;
	}

	hm_info("vbus %s confirmed\n", chip->usb_raw ? "online" : "offline");
	chip->usb_present = chip->usb_raw;
	mutex_unlock(&chip->lock);

	/* commit: uevent + event bus broadcast to every module */
	chg_psy_changed(chip);
}

static void chg_vbus_irq_cb(struct chg_chip *chip)
{
	unsigned int db_ms;
	bool raw = false;//这里实现vbus是否在线的检测

	/* wake the power sweep immediately on a physical drop: it waits
	 * on this completion while a step settles */
	if (!raw)
		complete(&chip->sweep_drop);

	mutex_lock(&chip->lock);
	if (raw == chip->usb_present) {
		if (raw != chip->usb_raw) {
			cancel_delayed_work(&chip->debounce_work);
			chip->usb_raw = raw;
			hm_dbg("glitch absorbed, staying %sline\n",
					raw ? "on" : "off");
		}
		mutex_unlock(&chip->lock);
		return;
	}

	if (raw == chip->usb_raw) {
		/* window already running for this value; keep it */
		mutex_unlock(&chip->lock);
		return;
	}

	chip->usb_raw = raw;
	db_ms = raw ? chip->debounce_online_ms : chip->debounce_offline_ms;
	mod_delayed_work(system_wq, &chip->debounce_work,
			msecs_to_jiffies(db_ms));
	mutex_unlock(&chip->lock);

	hm_dbg("raw vbus %s, confirming in %ums\n",
			raw ? "online" : "offline", db_ms);
}

static void chg_parse_dt(struct chg_chip *chip)
{
	of_property_read_u32(chip->dev->of_node, "debounce-online-ms",
			&chip->debounce_online_ms);
	if (!chip->debounce_online_ms)
		chip->debounce_online_ms = USB_ONLINE_DEBOUNCE_DFLT_MS;

	of_property_read_u32(chip->dev->of_node, "debounce-offline-ms",
			&chip->debounce_offline_ms);
	if (!chip->debounce_offline_ms)
		chip->debounce_offline_ms = USB_OFFLINE_DEBOUNCE_DFLT_MS;
	/* per-step settle of the power sweep: default conservative, tune
	 * per board on the bench (see PWR_DET_STEP_SETTLE_DFLT_MS) */
	of_property_read_u32(chip->dev->of_node, "pwr-det-step-settle-ms",
			&chip->pwr_step_settle_ms);
	if (!chip->pwr_step_settle_ms)
		chip->pwr_step_settle_ms = PWR_DET_STEP_SETTLE_DFLT_MS;
	chip->pwr_step_settle_ms = max(chip->pwr_step_settle_ms,
			PWR_DET_STEP_SETTLE_MIN_MS);

	/* keep the power-detection rescue window intact: settle + adapter
	 * recovery must fit inside the offline debounce */
	if (chip->debounce_offline_ms < 2 * chip->pwr_step_settle_ms) {
		hm_warn("debounce-offline-ms too small, raised to %d\n",
				2 * chip->pwr_step_settle_ms);
		chip->debounce_offline_ms = 2 * chip->pwr_step_settle_ms;
	}

	/* per-type power detection start values: DT-configurable but
	 * never below the insertion-safe floor and never above the
	 * type's standard cap */
	of_property_read_u32(chip->dev->of_node, "pwr-det-start-cdp-ma",
			&chip->pwr_start_cdp_ma);
	if (!chip->pwr_start_cdp_ma)
		chip->pwr_start_cdp_ma = PWR_DET_START_DFLT_MA;
	chip->pwr_start_cdp_ma = clamp_val(chip->pwr_start_cdp_ma,
			PWR_DET_START_MA, PWR_DET_CAP_CDP_MA);

	of_property_read_u32(chip->dev->of_node, "pwr-det-start-dcp-ma",
			&chip->pwr_start_dcp_ma);
	if (!chip->pwr_start_dcp_ma)
		chip->pwr_start_dcp_ma = PWR_DET_START_DFLT_MA;
	chip->pwr_start_dcp_ma = clamp_val(chip->pwr_start_dcp_ma,
			PWR_DET_START_MA, PWR_DET_CAP_DCP_MA);

	of_property_read_u32(chip->dev->of_node, "pwr-det-start-hvdcp-ma",
			&chip->pwr_start_hvdcp_ma);
	if (!chip->pwr_start_hvdcp_ma)
		chip->pwr_start_hvdcp_ma = PWR_DET_START_DFLT_MA;
	chip->pwr_start_hvdcp_ma = clamp_val(chip->pwr_start_hvdcp_ma,
			PWR_DET_START_MA, PWR_DET_CAP_DCP_MA);
}

/* ------------------------------------------------------------------ */
/* power_supply interface (user space)                                 */
/* ------------------------------------------------------------------ */
/*
 * One psy, two audiences: the "usb" psy carries the standard
 * user-space view AND the framework's kernel-only protocol. The
 * properties[] trick keeps the audiences apart: custom properties
 * are handled in the same switches but are NOT listed in
 * chg_usb_props[], so they never appear in sysfs -- they are only
 * reachable through the psy API (HM_PSY_GET_PROP / HM_PSY_SET_PROP)
 * by hm modules (detector pushes USB_DETECT samples, cms picks
 * PROTOCOL_SELECT, hm-battery reads USB_ONLINE/CHG_TYPE).
 */
static int chg_usb_get_prop(struct power_supply *psy,
		enum power_supply_property psp,
		union power_supply_propval *val)
{
	struct chg_chip *chip = power_supply_get_drvdata(psy);
	int rc = 0;

	/* The psy ABI reports voltage/current in microvolts/microamps;
	 * internal units are mV/mA, convert at this boundary */
	switch ((int)psp) {
		case POWER_SUPPLY_PROP_ONLINE:
			val->intval = chip->usb_present;
			break;
		case POWER_SUPPLY_PROP_VOLTAGE_NOW:
			val->intval = chip->vbus_mv * 1000;
			break;
		case POWER_SUPPLY_PROP_CURRENT_NOW:
			val->intval = chip->ibus_ma * 1000;
			break;
		case POWER_SUPPLY_PROP_INPUT_CURRENT_LIMIT:
			val->intval = chip->input_ilim_ma * 1000;
			break;
		case POWER_SUPPLY_PROP_CURRENT_MAX:
			val->intval = chip->adapter_max_ma * 1000;
			break;
		case POWER_SUPPLY_PROP_VOLTAGE_MAX:
			val->intval = chip->adapter_max_mv * 1000;
			break;
	/* ---- kernel-only protocol, no sysfs file ---- */
		case HM_POWER_SUPPLY_PROP_CHG_TYPE:
			val->intval = chip->chg_type;
			break;
		default:
			rc = -EINVAL;
			break;
	}

	return rc;
}

static int chg_usb_set_prop(struct power_supply *psy,
		enum power_supply_property psp,
		const union power_supply_propval *val)
{
	struct chg_chip *chip = power_supply_get_drvdata(psy);

	switch ((int)psp) {
		case POWER_SUPPLY_PROP_ONLINE:
			/* route through the debouncer like every other
			 * sample source, so sysfs test writes get the
			 * same semantics as the detector pushes */
			chg_vbus_irq_cb(chip);
			break;
	/* ---- kernel-only protocol, no sysfs file ---- */
		case HM_POWER_SUPPLY_PROP_USB_DETECT:
			/* detector pushes a raw vbus sample: 0/1 */
			chg_vbus_irq_cb(chip);
			return 0;
		case HM_POWER_SUPPLY_PROP_PROTOCOL_SELECT:
			/* policy layer picks the input protocol,
			 * enum hm_chg_proto */
			return chg_protocol_select(chip, val->intval);
		default:
			return -EINVAL;
	}

	return 0;
}

static int chg_usb_prop_is_writeable(struct power_supply *psy,
		enum power_supply_property psp)
{
	switch ((int)psp) {
		case POWER_SUPPLY_PROP_ONLINE:
		case POWER_SUPPLY_PROP_INPUT_CURRENT_LIMIT:
			return 1;
		default:
			return 0;
	}
}

static enum power_supply_property chg_usb_props[] = {
	POWER_SUPPLY_PROP_ONLINE,
	POWER_SUPPLY_PROP_VOLTAGE_NOW,
	POWER_SUPPLY_PROP_CURRENT_NOW,
	POWER_SUPPLY_PROP_INPUT_CURRENT_LIMIT,
	POWER_SUPPLY_PROP_CURRENT_MAX,
	POWER_SUPPLY_PROP_VOLTAGE_MAX,
};

static const struct power_supply_desc chg_usb_desc = {
	.name			= "usb",
	.type			= POWER_SUPPLY_TYPE_USB,
	.properties		= chg_usb_props,
	.num_properties		= ARRAY_SIZE(chg_usb_props),
	.get_property		= chg_usb_get_prop,
	.set_property		= chg_usb_set_prop,
	.property_is_writeable	= chg_usb_prop_is_writeable,
};

/* ------------------------------------------------------------------ */
/* votable (charging policy arbitration)                               */
/* ------------------------------------------------------------------ */
/*
 * Program an effective votable result into the primary charger's psy.
 *  - a negative result means "no vote" (all clients abstained) and is
 *    not programmed;
 *  - a not-yet-registered primary psy only warns: vote() callers must
 *    not fail for that transient state, the next election re-applies
 *    the value once the peer appears.
 */
static int chg_set_prop_to_primary_chg(struct chg_chip *chip,
		const char *tag, enum hm_power_supply_property psp,
		int result)
{
	union power_supply_propval val = { .intval = result };
	int rc;

	if (result < 0)
		return 0;

	rc = hm_psy_get_by_name(&chip->primary_chg_psy,
			PRIMARY_CHG_PSY_NAME);
	if (rc) {
		hm_warn("%s: primary charger not ready, %d not applied\n",
				tag, result);
		return 0;
	}

	rc = HM_PSY_SET_PROP(chip->primary_chg_psy, psp, &val);
	if (rc)
		hm_err("%s: program %d failed: %d\n",
				tag, result, rc);

	return rc;
}

/*
 * Each callback logs which voter produced the new effective result
 * (client), whether that client's vote is enabled (true/false) and the
 * value. The hm_log macros prepend __func__, so grepping the log for
 * "chg_icl_callback" etc. directly lands on the right votable.
 * These run under the votable's vote_lock: the *_locked query variant
 * must be used, the plain one would deadlock on the mutex vote() holds.
 */
static int chg_icl_callback(struct votable *votable, void *data,
		int result, const char *client)
{
	hm_info("voter=%s vote=%s val=%d\n",
			client ? client : "none",
			is_client_vote_enabled_locked(votable, client) ?
				"true" : "false",
			result);

	return chg_set_prop_to_primary_chg(data, "icl",
			HM_POWER_SUPPLY_PROP_INPUT_CURRENT_MA, result);
}

static int chg_ichg_callback(struct votable *votable, void *data,
		int result, const char *client)
{
	hm_info("voter=%s vote=%s val=%d\n",
			client ? client : "none",
			is_client_vote_enabled_locked(votable, client) ?
				"true" : "false",
			result);

	return chg_set_prop_to_primary_chg(data, "ichg",
			HM_POWER_SUPPLY_PROP_CHARGE_CURRENT_MA, result);
}

static int chg_fv_callback(struct votable *votable, void *data,
		int result, const char *client)
{
	hm_info("voter=%s vote=%s val=%d\n",
			client ? client : "none",
			is_client_vote_enabled_locked(votable, client) ?
				"true" : "false",
			result);

	return chg_set_prop_to_primary_chg(data, "fv",
			HM_POWER_SUPPLY_PROP_CHARGE_VOLTAGE_MV, result);
}

static int chg_iterm_callback(struct votable *votable, void *data,
		int result, const char *client)
{
	hm_info("voter=%s vote=%s val=%d\n",
			client ? client : "none",
			is_client_vote_enabled_locked(votable, client) ?
				"true" : "false",
			result);

	return chg_set_prop_to_primary_chg(data, "iterm",
			HM_POWER_SUPPLY_PROP_ITERM_MA, result);
}

static int chg_vindpm_callback(struct votable *votable, void *data,
		int result, const char *client)
{
	hm_info("voter=%s vote=%s val=%d\n",
			client ? client : "none",
			is_client_vote_enabled_locked(votable, client) ?
				"true" : "false",
			result);

	return chg_set_prop_to_primary_chg(data, "vindpm",
			HM_POWER_SUPPLY_PROP_VINDPM_MV, result);
}

/*
 * chg_disable / chg_suspend are SET_ANY: any client voting true wins.
 * Keep their roles orthogonal: disable gates the BATTERY charge path
 * (safety / user / factory), suspend gates the INPUT (temporary
 * algorithmic pauses such as OCV relax measurements) -- they program
 * different primary-charger properties and can never fight over one
 * register. Note the SET_ANY effective client label is "the last
 * voter", informative only (see vote_set_any).
 */
static int chg_disable_callback(struct votable *votable, void *data,
		int result, const char *client)
{
	hm_info("voter=%s vote=%s val=%d\n",
			client ? client : "none",
			is_client_vote_enabled_locked(votable, client) ?
				"true" : "false",
			result);

	return chg_set_prop_to_primary_chg(data, "chg_disable",
			HM_POWER_SUPPLY_PROP_CHARGING_ENABLED, !result);
}

static int chg_suspend_callback(struct votable *votable, void *data,
		int result, const char *client)
{
	hm_info("voter=%s vote=%s val=%d\n",
			client ? client : "none",
			is_client_vote_enabled_locked(votable, client) ?
				"true" : "false",
			result);

	return chg_set_prop_to_primary_chg(data, "chg_suspend",
			HM_POWER_SUPPLY_PROP_INPUT_SUSPEND, result);
}

static void chg_destroy_votables(struct chg_chip *chip)
{
	destroy_votable(chip->chg_suspend_votable);
	destroy_votable(chip->chg_disable_votable);
	destroy_votable(chip->vindpm_votable);
	destroy_votable(chip->iterm_votable);
	destroy_votable(chip->fv_votable);
	destroy_votable(chip->ichg_votable);
	destroy_votable(chip->icl_votable);
}

static int chg_create_votables(struct chg_chip *chip)
{
	int rc;

	chip->icl_votable = create_votable("icl", VOTE_MIN,
			chg_icl_callback, chip);
	if (IS_ERR(chip->icl_votable)) {
		rc = PTR_ERR(chip->icl_votable);
		chip->icl_votable = NULL;
		goto err;
	}

	chip->ichg_votable = create_votable("ichg", VOTE_MIN,
			chg_ichg_callback, chip);
	if (IS_ERR(chip->ichg_votable)) {
		rc = PTR_ERR(chip->ichg_votable);
		chip->ichg_votable = NULL;
		goto err;
	}

	chip->fv_votable = create_votable("fv", VOTE_MIN,
			chg_fv_callback, chip);
	if (IS_ERR(chip->fv_votable)) {
		rc = PTR_ERR(chip->fv_votable);
		chip->fv_votable = NULL;
		goto err;
	}

	chip->iterm_votable = create_votable("iterm", VOTE_MAX,
			chg_iterm_callback, chip);
	if (IS_ERR(chip->iterm_votable)) {
		rc = PTR_ERR(chip->iterm_votable);
		chip->iterm_votable = NULL;
		goto err;
	}

	chip->vindpm_votable = create_votable("vindpm", VOTE_MAX,
			chg_vindpm_callback, chip);
	if (IS_ERR(chip->vindpm_votable)) {
		rc = PTR_ERR(chip->vindpm_votable);
		chip->vindpm_votable = NULL;
		goto err;
	}

	chip->chg_disable_votable = create_votable("chg_disable", VOTE_SET_ANY,
			chg_disable_callback, chip);
	if (IS_ERR(chip->chg_disable_votable)) {
		rc = PTR_ERR(chip->chg_disable_votable);
		chip->chg_disable_votable = NULL;
		goto err;
	}

	chip->chg_suspend_votable = create_votable("chg_suspend", VOTE_SET_ANY,
			chg_suspend_callback, chip);
	if (IS_ERR(chip->chg_suspend_votable)) {
		rc = PTR_ERR(chip->chg_suspend_votable);
		chip->chg_suspend_votable = NULL;
		goto err;
	}

	return 0;

err:
	chg_destroy_votables(chip);
	return rc;
}

static int __maybe_unused chg_suspend(struct device *dev)
{
	struct chg_chip *chip = dev_get_drvdata(dev);

	cancel_delayed_work_sync(&chip->debounce_work);
	cancel_delayed_work_sync(&chip->det_work);

	/* Drop any sample that was still awaiting its confirmation window:
	 * without the window it is meaningless, and a stale usb_raw would
	 * make the next identical sample take the "window already running"
	 * path while no window exists -- the transition would stall. */
	mutex_lock(&chip->lock);
	chip->usb_raw = chip->usb_present;
	mutex_unlock(&chip->lock);

	hm_dbg("suspended\n");
	return 0;
}

static int __maybe_unused chg_resume(struct device *dev)
{
	struct chg_chip *chip = dev_get_drvdata(dev);

	/* resume an interrupted detection pipeline */
	if (chip->usb_present && chip->det_st != DET_IDLE &&
			chip->det_st != DET_DONE)
		mod_delayed_work(system_wq, &chip->det_work, 0);

	hm_dbg("resumed\n");
	return 0;
}

static SIMPLE_DEV_PM_OPS(chg_pm_ops, chg_suspend, chg_resume);

static int chg_probe(struct platform_device *pdev)
{
	struct chg_chip *chip;
	struct power_supply_config usb_cfg = { };
	int rc;

	chip = devm_kzalloc(&pdev->dev, sizeof(*chip), GFP_KERNEL);
	if (!chip)
		return -ENOMEM;

	chip->dev = &pdev->dev;
	mutex_init(&chip->lock);

	chg_parse_dt(chip);

	/* Create the votables before registering the psys: other modules
	 * may vote via find_votable() as soon as they see the psy */
	rc = chg_create_votables(chip);
	if (rc)
		return rc;

	/* works first: the event subscription below is the first point
	 * where an external event (a concurrent module's probe publishing
	 * on the bus) can reach chg_evt_notify -> chg_det_start ->
	 * mod_delayed_work -- the work must be initialized by then */
	INIT_DELAYED_WORK(&chip->debounce_work, chg_debounce_work);
	INIT_DELAYED_WORK(&chip->det_work, chg_det_work);
	INIT_WORK(&chip->pd_work, chg_pd_work);
	init_completion(&chip->sweep_drop);

	usb_cfg.drv_data = chip;
	usb_cfg.of_node = chip->dev->of_node;
	usb_cfg.supplied_to = chg_supplied_to;	/* usb -> other psys power relationship */
	usb_cfg.num_supplies = ARRAY_SIZE(chg_supplied_to);

	chip->usb_psy = power_supply_register(chip->dev, &chg_usb_desc, &usb_cfg);
	if (IS_ERR(chip->usb_psy)) {
		rc = PTR_ERR(chip->usb_psy);
		goto err_votables;
	}

	/* Subscribe to the common event bus LAST: nothing external can
	 * reach this driver before it is fully constructed, and no probe
	 * failure path after this point exists to leak the notifier */
	chip->chg_nb.notifier_call = chg_evt_notify;
	rc = hm_event_register_notifier(&chip->chg_nb);
	if (rc) {
		power_supply_unregister(chip->usb_psy);
		goto err_votables;
	}

	device_init_wakeup(chip->dev, true);
	platform_set_drvdata(pdev, chip);

	return 0;

err_votables:
	chg_destroy_votables(chip);
	return rc;
}

static int chg_remove(struct platform_device *pdev)
{
	struct chg_chip *chip = platform_get_drvdata(pdev);

	hm_event_unregister_notifier(&chip->chg_nb);
	cancel_delayed_work_sync(&chip->debounce_work);
	cancel_delayed_work_sync(&chip->det_work);
	cancel_work_sync(&chip->pd_work);
	device_init_wakeup(chip->dev, false);
	power_supply_unregister(chip->usb_psy);
	chg_destroy_votables(chip);
	return 0;
}

static const struct of_device_id chg_of_match[] = {
	{ .compatible = "hm,charger" },
	{ }
};

static struct platform_driver chg_info_driver = {
	.driver = {
		.name		= "hm-charger",
		.of_match_table	= chg_of_match,
		.pm		= &chg_pm_ops,
	},
	.probe	= chg_probe,
	.remove	= chg_remove,
};

builtin_platform_driver(chg_info_driver);

MODULE_AUTHOR("chg-info reference");
MODULE_DESCRIPTION("HM charging shared info hub (poll work + notifier + usb psy)");
MODULE_LICENSE("GPL");
