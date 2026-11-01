// SPDX-License-Identifier: GPL-2.0
/*
 * hm_battery - hm 框架的电池侧 psy
 *
 * 职责: 纯信息层. 轮询 FG, 注册名为 "battery" 的 power supply
 * (名字是硬契约: Android health HAL / upower 按名查找), 暴露
 * 电池数据: status/capacity/电压/电流/温度. 所有值都是读来的,
 * 本模块不做任何合成/判决 -- status 也来自 FG(或主充), 保护与
 * 充电策略归 hm-charger 侧的 votable 消费者.
 *
 * 数据流:
 *   FG 硬件 --> bat_fg_read() 钩子(唯一的硬件边界)
 *            --> 缓存(锁保护快照)
 *            --> psy get_property: 快物理量(电压/电流/温度)是
 *                pull-through -- 每次 get 现读 FG, 闭环消费者拿到
 *                实时数据而非轮询缓存; 其余值来自轮询缓存,
 *                变化时发 uevent
 *
 * 跨模块集成:
 *   - 算法模块经 RAW_SOC 属性推入 gauge 原始 soc
 *   - usb psy 的 supplied_to 级联触发 external_power_changed,
 *     即时踢一次刷新
 *
 * 约定: 内部单位 mV/mA, psy 边界 x1000; 温度两侧都是 0.1 摄氏度
 * (ABI 单位), 不换算.
 */
#include <linux/device.h>
#include <linux/err.h>
#include <linux/kernel.h>
#include <linux/module.h>
#include <linux/mutex.h>
#include <linux/of.h>
#include <linux/platform_device.h>
#include <linux/pm.h>
#include <linux/pm_wakeup.h>
#include <linux/power_supply.h>
#include <linux/workqueue.h>

#include "hm_log.h"
#include "hm_power_supply.h"

#define BAT_POLL_INTERVAL_DFLT_MS	10000
#define BAT_POLL_INTERVAL_MIN_MS		500
/* 连续这么多次 FG 读失败才判定电池移除(单次毛刺保留旧数据) */
#define BAT_FG_FAIL_COUNT		3

/* capacity_level 阈值 (%) */
#define BAT_CAP_CRITICAL		5
#define BAT_CAP_LOW			20
#define BAT_CAP_HIGH			95

struct bat_chip {
	struct device		*dev;
	struct delayed_work	refresh_work;
	unsigned int		poll_interval_ms;

	struct mutex		lock;		/* 保护下方缓存 */
	/* 缓存: 最近一次 FG 快照 */
	bool			present;
	int			vbat_mv;
	int			ibat_ma;	/* 带符号: + 充电, - 放电 */
	int			temp_tenth;	/* 0.1 摄氏度 */
	int			status;		/* enum power_supply_status,
						 * 读自 FG, 非本地合成 */
	int			ui_soc;	/* 用户看到的百分比; 由电池算法
					 * 模块(gauge/OCV 模型)算出, 不是
					 * FG 原始寄存器值 */
	int			raw_soc;	/* gauge 原始 soc 百分比; 算法
					 * 模块经 RAW_SOC 属性推入 */
	unsigned int		charge_full_mah;
	unsigned int		charge_full_design_mah;
	unsigned int		cycle_count;
	int			technology;
	/* FG 连续读失败计数 */
	int			fg_fail_cnt;
	/* 最近发布的快照, 变化检测用 */
	int			rep_status;
	int			rep_ui_soc;
	int			rep_temp_tenth;

	struct power_supply	*bat_psy;
};

/* ------------------------------------------------------------------ */
/* FG 钩子: 唯一的硬件边界, 移植时只换函数体, 框架不动 ---- */

/*
 * 轮询一次 fuel gauge: 填入原始电池数据. -EAGAIN 保留旧值(FG 忙),
 * 硬错误标记电池不在.
 */
static int bat_fg_read(struct bat_chip *chip)
{
	/* TODO (移植): 读 FG(vbat/ibat/temp/fcc/cycles/status);
	 * ui_soc 来自电池算法模块的计算, 不是 gauge 原始寄存器;
	 * status 来自 FG 的状态寄存器(或读主充 psy) */
	chip->present = true;
	chip->vbat_mv = 4000;
	chip->ibat_ma = 0;
	chip->temp_tenth = 250;		/* 25.0 摄氏度 */
	chip->status = POWER_SUPPLY_STATUS_UNKNOWN;
	chip->ui_soc = 50;
	chip->charge_full_mah = 5000;
	chip->cycle_count = 0;
	return 0;
}

/*
 * 三个物理量的快速读, 供 bat_get_prop() 的 pull-through: 闭环
 * 消费者(如直充)按需读 VOLTAGE_NOW/CURRENT_NOW/TEMP, 要实时数据
 * 而非最多旧一个轮询周期的缓存. 非零返回则回退缓存.
 */
static int bat_fg_read_fast(struct bat_chip *chip,
		int *vbat_mv, int *ibat_ma, int *temp_tenth)
{
	/* TODO (移植): 一次 FG 寄存器读, 电压/电流/温度 */
	*vbat_mv = chip->vbat_mv;
	*ibat_ma = chip->ibat_ma;
	*temp_tenth = chip->temp_tenth;
	return 0;
}

/* 电池静态身份; FG 不一定知道这些 */
static unsigned int bat_fg_charge_full_design(struct bat_chip *chip)
{
	/* TODO (移植): FG 学习到的/OTP 里的设计容量 */
	return 5000;
}

static unsigned int bat_fg_cycle_count(struct bat_chip *chip)
{
	/* TODO (移植): FG 循环计数 */
	return 0;
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
 * 一个刷新周期: 轮询 FG, 变化才发布. 由周期 work 与
 * external_power_changed 踢驱动.
 */
static void bat_refresh(struct bat_chip *chip)
{
	bool changed;
	int rc;

	pm_stay_awake(chip->dev);

	rc = bat_fg_read(chip);
	if (rc == -EAGAIN) {
		pm_relax(chip->dev);
		return;			/* 保留旧值 */
	}

	mutex_lock(&chip->lock);
	if (rc) {
		/* FG 读失败: 连续 N 次才判电池移除, 单次毛刺保留
		 * 旧数据 */
		if (++chip->fg_fail_cnt >= BAT_FG_FAIL_COUNT) {
			chip->present = false;
			chip->status = POWER_SUPPLY_STATUS_UNKNOWN;
		}
	} else {
		chip->fg_fail_cnt = 0;
	}

	changed = chip->status != chip->rep_status ||
		  chip->ui_soc != chip->rep_ui_soc ||
		  chip->temp_tenth != chip->rep_temp_tenth;
	chip->rep_status = chip->status;
	chip->rep_ui_soc = chip->ui_soc;
	chip->rep_temp_tenth = chip->temp_tenth;
	mutex_unlock(&chip->lock);

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
/* power_supply 接口 (用户空间)                                        */
/* ------------------------------------------------------------------ */
static int bat_get_prop(struct power_supply *psy,
		enum power_supply_property psp,
		union power_supply_propval *val)
{
	struct bat_chip *chip = power_supply_get_drvdata(psy);
	int vbat_mv = 0, ibat_ma = 0, temp_tenth = 0;
	bool fast = false;
	int rc = 0;

	/* pull-through: 快物理量在锁前现读 FG(I2C, 毫秒级), 不给轮询
	 * 缓存; 快读失败回退下方缓存快照 */
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

	/* psy ABI 电压/电流用微单位, 内部 mV/mA, 在此边界换算 */
	switch ((int)psp) {
	case POWER_SUPPLY_PROP_STATUS:
		val->intval = chip->status;
		break;
	case POWER_SUPPLY_PROP_PRESENT:
		val->intval = chip->present;
		break;
	case POWER_SUPPLY_PROP_HEALTH:
		/* 纯信息层不做健康判决, 恒报 GOOD; 保护归策略层 */
		val->intval = POWER_SUPPLY_HEALTH_GOOD;
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
	 * 内核专用属性: 不在 bat_props[] 里, 不上 sysfs, 只有 hm
	 * 模块经 psy API(HM_PSY_GET_PROP)可达
	 */
	case HM_POWER_SUPPLY_PROP_RAW_SOC:
		val->intval = chip->raw_soc;
		break;
	default:
		rc = -EINVAL;
		break;
	}

	return rc;
}

/*
 * 内核专用写入口(同 properties[] 技巧: 无 sysfs 文件, 用户空间
 * 够不到). 算法模块把算好的 raw soc 推进来.
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

	/* 供电方(usb psy)变化: 立即踢一次刷新 */
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
	.name			= "battery",	/* Android health HAL 按名查找 */
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

	chip = devm_kzalloc(&pdev->dev, sizeof(*chip), GFP_KERNEL);
	if (!chip)
		return -ENOMEM;

	chip->dev = &pdev->dev;
	mutex_init(&chip->lock);

	bat_parse_dt(chip);

	/* works 先于 psy 注册: 注册后 external_power_changed 就能踢 */
	INIT_DELAYED_WORK(&chip->refresh_work, bat_refresh_work);

	cfg.drv_data = chip;
	cfg.of_node = chip->dev->of_node;

	chip->bat_psy = power_supply_register(chip->dev, &bat_psy_desc,
			&cfg);
	if (IS_ERR(chip->bat_psy))
		return PTR_ERR(chip->bat_psy);

	device_init_wakeup(chip->dev, true);
	platform_set_drvdata(pdev, chip);

	schedule_delayed_work(&chip->refresh_work, 0);
	return 0;
}

static int bat_remove(struct platform_device *pdev)
{
	struct bat_chip *chip = platform_get_drvdata(pdev);

	cancel_delayed_work_sync(&chip->refresh_work);
	device_init_wakeup(chip->dev, false);
	power_supply_unregister(chip->bat_psy);
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
MODULE_DESCRIPTION("HM battery psy (FG read/expose)");
MODULE_LICENSE("GPL");
