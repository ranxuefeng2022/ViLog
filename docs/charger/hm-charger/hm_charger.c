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

#define USB_ONLINE_DEBOUNCE_DFLT_MS	100	/* 上升沿: 吸收接触抖动 */
#define USB_OFFLINE_DEBOUNCE_DFLT_MS	500	/* 下降沿: 吸收 vbus 毛刺 */
/* 检测状态机节奏 */
#define DET_POLL_MS		100	/* 检测轮询间隔 */
#define BC12_TIMEOUT_MS		600	/* BC1.2 检测超时 */
#define HVDCP_TIMEOUT_MS	800	/* QC 探测超时 */
/* 功率扫描参数 (单次阻塞实现) */
#define PWR_DET_START_MA	200	/* 首档, 同时是安全下限 */
/* 每档 settle 缺省, 可 DT 调 ("pwr-det-step-settle-ms"), 上机台
 * 验证后按板收紧. 双向权衡, 别拍脑袋: 太短会把适配器负载瞬态
 * 下探误判成该档失败(低估适配器); 太长只多花扫描时间(缓慢的
 * 软过载下沉早晚只差一档). 典型适配器 50-150ms.
 * 约束: 2x settle 不得超过离线防抖窗(营救窗, 见 chg_parse_dt) */
#define PWR_DET_STEP_SETTLE_DFLT_MS	200
#define PWR_DET_STEP_SETTLE_MIN_MS	50
#define PWR_DET_CAP_CDP_MA	1500	/* 按类型的扫描上限 */
#define PWR_DET_CAP_DCP_MA	2000
#define PWR_DET_VINDPM_HEADROOM_MV	300	/* buck 变换余量 */
#define PWR_DET_VBAT_FALLBACK_MV	4400	/* 电池 psy 读不到时的假设值 */
#define PWR_DET_STEP_MA		100	/* 扫描步进 */
#define PWR_DET_START_DFLT_MA	500	/* 各类型 DT 缺省起点 */
#define DEFALUT_VOTER "DEFALUT_VOTER"
/* 主充 psy 名, 须与对端模块注册的 psy 名一致 */
#define PRIMARY_CHG_PSY_NAME "primary_chg_psy"

static char *chg_supplied_to[] = {
	"battery",		/* usb -> battery 供电关系:
					 * power_supply_changed(usb) 会级联触发
					 * battery psy 的 external_power_changed */
	"cms_psy",
};

/* 充电检测状态机 */
enum chg_det_st {
	DET_IDLE,		/* 无适配器 */
	DET_BC12,		/* BC1.2 D+/D- 检测中 */
	DET_PWR,		/* 5V 功率扫描 (BC12 后) */
	DET_HVDCP,		/* QC 探测 (5V 扫描后, 仅 DCP) */
	DET_PWR_QC,		/* QC 模式功率扫描 (探测命中) */
	DET_DONE,		/* 收尾, chg_type/能力值有效 */
};

static const char * const det_st_text[] = {
	"IDLE", "BC12", "PWR", "HVDCP", "PWR_QC", "DONE",
};

/* BC1.2 检测结果 */
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
	unsigned int		vbus_mv;	/* 设备端 VBUS 电压, 已含适配器与线损 */
	unsigned int		ibus_ma;
	unsigned int		input_ilim_ma;

	bool				usb_last_present;

	/* 防抖: usb_present 是确认后的状态, usb_raw 是检测器推入的
	 * 最新采样, 确认窗口到期才提交 */
	struct delayed_work	debounce_work;
	bool				usb_raw;
	unsigned int		debounce_online_ms;
	unsigned int		debounce_offline_ms;

	/* 掉线采样立即唤醒正在 settle 的功率扫描 */
	struct completion	sweep_drop;

	struct power_supply	*usb_psy;
	struct power_supply	*primary_chg_psy;
	struct power_supply	*secondery_chg_psy;
	struct power_supply	*bat_psy;


	struct notifier_block	chg_nb;

	struct votable		*icl_votable;	/* 输入限流, mA */
	struct votable		*ichg_votable;	/* 充电电流, mA */
	struct votable		*fv_votable;	/* 浮充电压, mV */
	struct votable		*iterm_votable;	/* 终止电流, mA */
	struct votable		*vindpm_votable; /* 输入压降保护门限, mV */
	struct votable		*chg_disable_votable;	/* SET_ANY: 任一 true 即关电池充电 */
	struct votable		*chg_suspend_votable;	/* SET_ANY: 任一 true 即挂起输入 */

	int chg_type;	/* 收尾的检测类型, enum hm_power_supply_type */

	/* 充电检测状态机 (见 chg_det_*) */
	enum chg_det_st	det_st;
	struct delayed_work	det_work;
	struct work_struct	pd_work;	/* PD 证据 -> 仲裁 */
	int			det_retries;
	unsigned long		det_jiffies;	/* 起始时刻, 时长日志用 */
	bool			det_stage_started;
	int			bc12_result;	/* enum hm_bc12_type */
	bool			hvdcp_ok;
	/* PD 监听结果, 由 chg_pd_event() 从 tcpc notifier 喂入;
	 * 任意状态下都压过其它证据 */
	bool			pd_capable;
	bool			pps_capable;
	unsigned int		pd_max_mv;
	unsigned int		pd_max_ma;
	/* 收尾后的适配器能力 */
	unsigned int		adapter_max_mv;	/* 选定模式的最高电压 */
	unsigned int		adapter_max_ma;	/* 选定模式的 ICL */
	/* 功率扫描结果, 按输入模式一份: HVDCP 适配器充电中会在
	 * 9V <-> 5V(DCP 模式)之间切换(taper/温降), 每次切换按该模式
	 * 实测的 ICL 重投 */
	unsigned int		icl_5v_ma;	/* 5V(DCP 模式) 实测 ICL */
	unsigned int		icl_hvdcp_ma;	/* QC 模式实测 ICL, 0 = 无 */
	/* 各类型扫描起点; 可 DT 配, 解析时钳到类型规范上限 */
	unsigned int		pwr_start_cdp_ma;
	unsigned int		pwr_start_dcp_ma;
	unsigned int		pwr_start_hvdcp_ma;
	unsigned int		pwr_step_settle_ms;	/* 每档 settle, 可 DT 调 */
	int			sel_protocol;	/* 选定的输入协议, enum hm_chg_proto */
};

static void chg_reset_voters(struct chg_chip *chip, bool online)
{
	hm_vote(chip->vindpm_votable, DEFALUT_VOTER, false, 0);
	hm_vote(chip->icl_votable, DEFALUT_VOTER, false, 0);
}

/* ------------------------------------------------------------------ */
/* 充电检测状态机                                                      */
/* ------------------------------------------------------------------ */
static int chg_bc12_start(struct chg_chip *chip)
{
	return 0;
}

/* 读 BC1.2 检测结果; -EAGAIN = 还在跑 */
static int chg_bc12_poll(struct chg_chip *chip, int *result)
{
	/* 占位: 直接报 DCP, 让管线前进 */
	*result = HM_BC12_DCP;
	return 0;
}

/* 启动 QC 探测: 按 QC 规范驱动 D+/D- 摆压, 看 VBUS 是否升起;
 * 非 QC 适配器上是安全空操作 */
static int chg_hvdcp_probe_start(struct chg_chip *chip)
{
	return 0;
}

/* 读 QC 探测结果; -EAGAIN = 还在跑 */
static int chg_hvdcp_probe_poll(struct chg_chip *chip, bool *ok)
{
	/* 占位: 无 QC 适配器 */
	*ok = false;
	return 0;
}

static bool chg_pwr_vindpm_hit(struct chg_chip *chip)
{
	/* TODO: 读主充的 vindpm 折返状态 */
	return false;
}

/* 钩子: 命令适配器进入 QC 模式(第二阶段扫描). 移植时替换 */
static int chg_pwr_qc_enter(struct chg_chip *chip)
{
	/* TODO: QC 握手到工作电压 */
	return 0;
}

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

static bool chg_pwr_step_passes(struct chg_chip *chip,
		unsigned int step)
{
	/* 输入已消失, 不等直接判败 */
	if (!chip->usb_raw)
		return false;

	reinit_completion(&chip->sweep_drop);
	hm_vote(chip->icl_votable, DEFALUT_VOTER, true, step);

	if (wait_for_completion_timeout(&chip->sweep_drop,
				msecs_to_jiffies(chip->pwr_step_settle_ms)))
		return false;			/* 窗口内收到掉线信号 */

	if (chg_pwr_vindpm_hit(chip))
		return false;			/* 已折返, 只是没有掉线 */

	return chip->usb_raw;
}

static unsigned int chg_pwr_sweep_phase(struct chg_chip *chip,
		unsigned int cap, unsigned int start_ma)
{
	unsigned int stable = 0, cur = start_ma;

	if (chip->pd_capable)
		return 0;

	chg_pwr_arm_vindpm(chip);

	while (cur <= cap) {
		if (!chg_pwr_step_passes(chip, cur))
			break;			/* 停在上一档 */

		stable = cur;
		cur += PWR_DET_STEP_MA;
	}

	stable = max(stable, PWR_DET_START_MA);

	/* 落在结果上, 归还 vindpm 门限 */
	hm_vote(chip->icl_votable, DEFALUT_VOTER, true, stable);
	hm_vote(chip->vindpm_votable, DEFALUT_VOTER, false, 0);
	hm_dbg("sweep result %umA\n", stable);
	return stable;
}

static void chg_pd_event(struct chg_chip *chip, bool capable,
		bool pps, unsigned int max_mv, unsigned int max_ma)
{
	mutex_lock(&chip->lock);
	chip->pd_capable = capable;
	chip->pps_capable = capable ? pps : false;
	chip->pd_max_mv = capable ? max_mv : 0;
	chip->pd_max_ma = capable ? max_ma : 0;
	mutex_unlock(&chip->lock);

	/* 证据交给仲裁; 检测管线本身不受 PD 流量打扰 */
	schedule_work(&chip->pd_work);
}

static int chg_protocol_apply(struct chg_chip *chip, int proto)
{
	/*
	 * TODO (移植): 发出选定协议的请求:
	 *  - HM_CHG_PROTO_5V: 命令适配器降回 5V -- QC 扫描后适配器
	 *    停在高压, 必须显式降回;
	 *  - HM_CHG_PROTO_HVDCP: QC 握手到电压档;
	 *  - HM_CHG_PROTO_PD/PPS: 对选定的 (A)PDO 发 PD Request.
	 */
	return 0;
}

static int chg_protocol_select(struct chg_chip *chip, int proto)
{
	int rc;

	/* 菜单只在 DET_DONE 发布: 管线运行期间拒绝选择(过早选
	 * HVDCP 会投下未测(可能为 0)的 ICL 而停充). complete() 自己
	 * 的安全缺省调用发生在置 DONE 之后, 不受影响 */
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
			/* adapter_max_mv: QC 电压档, 由钩子设置 */
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
	return HM_POWER_SUPPLY_TYPE_USB;	/* SDP / 未知 */
}

/* 重算并在变化时发布; 幂等 */
static void chg_arbitrate(struct chg_chip *chip)
{
	struct hm_evt_chg_type_data evt;
	int t;

	/* 管线没收尾没有可分类的; 期间记录的 PD 证据在收尾时被拾起 */
	if (chip->det_st != DET_DONE || !chip->usb_present)
		return;

	t = chg_classify(chip);
	if (t == chip->chg_type)
		return;				/* 结论没变 */

	chip->chg_type = t;
	hm_info("arbitrated type=%d\n", t);

	/* 策略层决策前的安全缺省 */
	chg_protocol_select(chip, HM_CHG_PROTO_5V);

	if (chip->pd_capable) {
		evt.max_mv = chip->pd_max_mv;
		evt.max_ma = chip->pd_max_ma;
	} else if (chip->hvdcp_ok) {
		evt.max_mv = 0;			/* QC 电压档在选择时定 */
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

static void chg_det_complete(struct chg_chip *chip)
{
	if (!chip->usb_present) {
		/* 检测中途拔出: 离线路径(cable cb -> chg_det_stop)
		 * 正在拆机并等本次运行 -- 什么都不发布, 清理有最终
		 * 话语权 */
		return;
	}

	/* 先置 DONE: 只接受已完成检测之后的协议选择
	 * (见 chg_protocol_select) */
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

	/* 拔出: 离线路径正在拆机(chg_det_stop 的 cancel_work_sync
	 * 在等本次运行), 到此为止, 不再推进状态机 */
	if (!chip->usb_present && chip->det_st != DET_IDLE)
		goto out;

	/* 状态入口当次: 在此 kick start 钩子(本上下文可睡眠),
	 * 下一 tick 起转入轮询 */
	if (chg_det_stage_enter(chip))
		goto resched;

	switch (chip->det_st) {
		case DET_BC12: 
			{
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
					/* 两者都先扫 5V 能力(适配器还在 BC1.2 后的
					 * 空闲态); QC 探测只跟 DCP, 在扫描之后 */
					chg_det_set_st(chip, DET_PWR);
					goto resched;
				}

				/* SDP/未知: 能力由规范固定, 直接收尾 */
				chg_det_complete(chip);
				break;
			}

		case DET_HVDCP: 
			{
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
					/* 探测命中: 转 QC 模式扫描 */
					chg_det_set_st(chip, DET_PWR_QC);
				} else {
					/* 普通 DCP: 5V 扫描已测过它 */
					chg_det_complete(chip);
				}
				goto resched;
			}

		case DET_PWR: 
			{
				bool is_cdp = (chip->bc12_result == HM_BC12_CDP);
				unsigned int cap = is_cdp ?
					PWR_DET_CAP_CDP_MA : PWR_DET_CAP_DCP_MA;
				unsigned int start = is_cdp ?
					chip->pwr_start_cdp_ma : chip->pwr_start_dcp_ma;

				/* 一次阻塞式线性扫描, 耗时上界 = 档数 x settle;
				 * stage_enter 机制保证跑在可睡眠的 det_work 上下文 */
				chip->icl_5v_ma = chg_pwr_sweep_phase(chip, cap, start);

				if (!chip->usb_present)
					break;		/* 拔出在别处处理 */

				if (chip->bc12_result == HM_BC12_CDP) {
					/* CDP: 不做 QC 探测, 收尾 */
					chip->icl_hvdcp_ma = 0;
					chg_det_complete(chip);
					break;
				}

				/* DCP: 接着 QC 探测 */
				chg_det_set_st(chip, DET_HVDCP);
				goto resched;
			}

		case DET_PWR_QC:
			/* 进入 QC 模式(探测后适配器仍在 5V)再扫 QC 模式能力;
			 * 失败则只有 5V 结果可用 */
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

static void chg_det_start(struct chg_chip *chip)
{
	chip->chg_type = HM_POWER_SUPPLY_TYPE_UNKNOWN;
	chip->bc12_result = HM_BC12_UNKNOWN;
	chip->hvdcp_ok = false;
	chip->adapter_max_mv = 0;
	chip->adapter_max_ma = 0;
	chip->icl_5v_ma = 0;
	chip->icl_hvdcp_ma = 0;
	chip->sel_protocol = HM_CHG_PROTO_5V;
	chip->det_jiffies = jiffies;

	chg_det_set_st(chip, DET_BC12);
	mod_delayed_work(system_wq, &chip->det_work, 0);
}

/* 拔出: 停机并清掉所有检测证据, 下次插入从零开始 */
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
		/* 检测完成前的插入安全 ICL, 刻意低于 SDP 级 500mA
		 * (BC1.2/PD 还没跑, 先按最弱源算) */
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

static void chg_debounce_work(struct work_struct *ws)
{
	struct chg_chip *chip =
		container_of(ws, struct chg_chip, debounce_work.work);

	mutex_lock(&chip->lock);
	if (chip->usb_raw == chip->usb_present) {
		/* 窗口内恢复了, 不提交 */
		mutex_unlock(&chip->lock);
		return;
	}

	hm_info("vbus %s confirmed\n", chip->usb_raw ? "online" : "offline");
	chip->usb_present = chip->usb_raw;
	mutex_unlock(&chip->lock);

	/* 提交: uevent + 事件总线广播给所有模块 */
	chg_psy_changed(chip);
}

static void chg_vbus_irq_cb(struct chg_chip *chip)
{
	unsigned int db_ms;
	bool raw = false;	/* TODO (移植): 读真实 VBUS 在线检测 */

	/* 物理掉线立即唤醒正在 settle 的功率扫描 */
	if (!raw)
		complete(&chip->sweep_drop);

	mutex_lock(&chip->lock);
	if (raw == chip->usb_present) {
		if (raw != chip->usb_raw) {
			/* 毛刺吸收: 采样回到了已确认状态 */
			cancel_delayed_work(&chip->debounce_work);
			chip->usb_raw = raw;
			hm_dbg("glitch absorbed, staying %sline\n",
					raw ? "on" : "off");
		}
		mutex_unlock(&chip->lock);
		return;
	}

	if (raw == chip->usb_raw) {
		/* 该值的确认窗口已在跑, 保持 */
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
	/* 扫描每档 settle: 缺省保守, 板级上机台后调
	 * (见 PWR_DET_STEP_SETTLE_DFLT_MS) */
	of_property_read_u32(chip->dev->of_node, "pwr-det-step-settle-ms",
			&chip->pwr_step_settle_ms);
	if (!chip->pwr_step_settle_ms)
		chip->pwr_step_settle_ms = PWR_DET_STEP_SETTLE_DFLT_MS;
	chip->pwr_step_settle_ms = max(chip->pwr_step_settle_ms,
			PWR_DET_STEP_SETTLE_MIN_MS);

	/* 保住功率扫描的营救窗: settle + 适配器恢复必须装进离线防抖 */
	if (chip->debounce_offline_ms < 2 * chip->pwr_step_settle_ms) {
		hm_warn("debounce-offline-ms too small, raised to %d\n",
				2 * chip->pwr_step_settle_ms);
		chip->debounce_offline_ms = 2 * chip->pwr_step_settle_ms;
	}

	/* 各类型扫描起点: 可 DT 配, 但不低于插入安全底线, 不高于该
	 * 类型规范上限 */
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
/* power_supply 接口 (用户空间)                                        */
/* ------------------------------------------------------------------ */
static int chg_usb_get_prop(struct power_supply *psy,
		enum power_supply_property psp,
		union power_supply_propval *val)
{
	struct chg_chip *chip = power_supply_get_drvdata(psy);
	int rc = 0;

	/* psy ABI 电压/电流用 uV/uA, 内部单位 mV/mA, 在此边界换算 */
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
			/* ---- 内核专用协议, 无 sysfs 文件 ---- */
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
			/* 与其它采样源一样走防抖: sysfs 测试写与检测器推送
			 * 语义一致 */
			chg_vbus_irq_cb(chip);
			break;
			/* ---- 内核专用协议, 无 sysfs 文件 ---- */
		case HM_POWER_SUPPLY_PROP_USB_DETECT:
			/* 检测器推入 vbus 原始采样: 0/1 */
			chg_vbus_irq_cb(chip);
			return 0;
		case HM_POWER_SUPPLY_PROP_PROTOCOL_SELECT:
			/* 策略层点输入协议, enum hm_chg_proto */
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
/* votable (充电策略仲裁)                                              */
/* ------------------------------------------------------------------ */
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

	/* 丢弃还在等确认窗口的采样: 没有窗口它就没有意义, 而残留的
	 * usb_raw 会让下一个相同采样走"窗口已在跑"分支, 但窗口其实
	 * 不存在 -- 状态切换会卡死 */
	mutex_lock(&chip->lock);
	chip->usb_raw = chip->usb_present;
	mutex_unlock(&chip->lock);

	hm_dbg("suspended\n");
	return 0;
}

static int __maybe_unused chg_resume(struct device *dev)
{
	struct chg_chip *chip = dev_get_drvdata(dev);

	/* 恢复被打断的检测管线 */
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

	/* 注册 psy 前先建 votables: 其它模块一看到 psy 就可能经
	 * find_votable() 投票 */
	rc = chg_create_votables(chip);
	if (rc)
		return rc;

	/* works 先行: 下面的订阅是外部事件(并发模块的 probe 在总线上
	 * 发布)能进入 chg_evt_notify -> chg_det_start ->
	 * mod_delayed_work 的第一个入口, work 到那时必须已初始化 */
	INIT_DELAYED_WORK(&chip->debounce_work, chg_debounce_work);
	INIT_DELAYED_WORK(&chip->det_work, chg_det_work);
	INIT_WORK(&chip->pd_work, chg_pd_work);
	init_completion(&chip->sweep_drop);

	usb_cfg.drv_data = chip;
	usb_cfg.of_node = chip->dev->of_node;
	usb_cfg.supplied_to = chg_supplied_to;	/* usb -> 其它 psy 的供电关系 */
	usb_cfg.num_supplies = ARRAY_SIZE(chg_supplied_to);

	chip->usb_psy = power_supply_register(chip->dev, &chg_usb_desc, &usb_cfg);
	if (IS_ERR(chip->usb_psy)) {
		rc = PTR_ERR(chip->usb_psy);
		goto err_votables;
	}

	/* 事件总线最后订阅: 完整构造之前外部到达不了本驱动, 此后也
	 * 不存在会泄漏 notifier 的失败路径 */
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
