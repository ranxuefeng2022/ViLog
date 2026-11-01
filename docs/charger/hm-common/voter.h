/* SPDX-License-Identifier: GPL-2.0 */
/* Copyright (c) 2015-2017, 2019 The Linux Foundation. All rights reserved.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 2 and
 * only version 2 as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 */
/*
 * voter.h - hm 模块共用的投票框架
 *
 * 移植自高通成熟的 pmic-voter. 相对 upstream 的差异:
 *   - client 用字符串而非 int 下标, 首次投票时注册, 跨模块用户
 *     不会撞下标;
 *   - 全局名字注册表 + find_votable(), 模块 B 能拿到模块 A 创建
 *     的 votable;
 *   - 增加 destroy_votable() / vote_override() / rerun_election();
 *   - 无 debugfs 接口: 可观测性来自 hm_vote() 调用点日志与
 *     vote() 的选举日志(均受 dynamic-debug 控制); API 级强制票
 *     是 vote_override().
 *
 * 典型用法: 属主在 probe() 里 create_votable(), 使用者按名
 * find_votable() 后 vote(). votable 与 client 名是跨模块契约,
 * 应集中定义, 不要在各模块散落字符串字面量.
 */
#ifndef __HM_VOTER_H__
#define __HM_VOTER_H__

#include <linux/types.h>

#include "hm_log.h"

struct votable;

enum votable_type {
	VOTE_MIN,		/* 启用票中的最小值胜出 */
	VOTE_MAX,		/* 启用票中的最大值胜出 */
	VOTE_SET_ANY,		/* 任一 client 投 true 即 true */
	NUM_VOTABLE_TYPES,
};

/*
 * 创建 votable. name 全局唯一(重名返回 -EEXIST); 生效结果变化时
 * 回调在 vote 锁下运行, data 原样透传; 不需要回调传 NULL.
 */
struct votable *create_votable(const char *name, int votable_type,
		int (*callback)(struct votable *votable, void *data,
				int effective_result,
				const char *effective_client),
		void *data);
void destroy_votable(struct votable *votable);

/* 查任意模块创建的 votable; 没有返回 NULL */
struct votable *find_votable(const char *name);

/*
 * votable 的持久获取, 与 hm_psy_get_by_name() 对称: 首次成功后
 * 指针缓存在 *vot, 之后复用, 名字注册表的链表遍历每个模块生命
 * 周期只走一次. hm 模块全部内建且 votable 只在驱动拆除时销毁,
 * 缓存指针终生有效. 对端尚未创建时返回 -ENODEV, 周期重试的调用
 * 方跳过该轮即可.
 */
static inline int hm_votable_get_by_name(struct votable **vot,
		const char *name)
{
	if (*vot)
		return 0;

	*vot = find_votable(name);
	if (!*vot)
		return -ENODEV;

	return 0;
}

int vote(struct votable *votable, const char *client_str,
		bool enabled, int val);

/*
 * 带调用点归属的 vote(): hm_dbg 的 __func__ 在调用点展开(指出票
 * 来自哪个函数), #votable 字符串化 votable 实参, 同一 client 名
 * 在多处投票也能在日志里区分. 必须是宏 -- 函数包装会报它自己的
 * 名字而不是调用者的.
 */
#define hm_vote(votable, client, enabled, val) do { \
	hm_dbg("[%s] %s: %s val=%d\n", #votable, (client), \
			(enabled) ? "apply" : "withdraw", (val)); \
	vote((votable), (client), (enabled), (val)); \
} while (0)
int vote_override(struct votable *votable, const char *override_client,
		bool enabled, int val);
int rerun_election(struct votable *votable);

int get_client_vote(struct votable *votable, const char *client_str);
int get_client_vote_locked(struct votable *votable, const char *client_str);
bool is_client_vote_enabled(struct votable *votable,
		const char *client_str);
bool is_client_vote_enabled_locked(struct votable *votable,
		const char *client_str);

int get_effective_result(struct votable *votable);
int get_effective_result_locked(struct votable *votable);
const char *get_effective_client(struct votable *votable);
const char *get_effective_client_locked(struct votable *votable);
bool is_override_vote_enabled(struct votable *votable);
bool is_override_vote_enabled_locked(struct votable *votable);

/* 需要原子读多个状态时, 围绕 *_locked 变体加解锁 */
void lock_votable(struct votable *votable);
void unlock_votable(struct votable *votable);

#endif /* __HM_VOTER_H__ */
