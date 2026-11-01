// SPDX-License-Identifier: GPL-2.0
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
 * voter.c - hm 模块共用的投票框架(移植自高通成熟的 pmic-voter)
 *
 * 相对 upstream 源码的改动:
 *   - include 修正(upstream 引 pmic-voter.h, 此处改名);
 *   - 所有公开接口补 EXPORT_SYMBOL_GPL;
 *   - 删 debugfs 接口(status/force_val/force_active): 可观测性由
 *     hm_vote() 调用点日志与 vote() 选举日志承担; force_active
 *     无非 debugfs 的设置途径, 一并移除, API 级覆盖用
 *     vote_override();
 *   - vote() switch 的 default 分支改为跳 out 标签解锁返回
 *     (upstream 持 vote_lock 直接 return, 非法类型会漏锁);
 *   - 值不变而生效 client 变了时 vote() 也触发回调(upstream 仅
 *     值变化触发), 保证 effective_client_id 不陈旧, 回调总能拿到
 *     新鲜的"谁"上下文; 回调必须幂等;
 *   - bug fix: vote_override() 的 NULL 回调保护(无回调建的
 *     votable 会崩); 注册表插入移到 create_votable() 末尾并做
 *     原子查重(原错误路径会把已释放的 votable 留在链表上);
 *   - 查询 API(is_client_vote_enabled/get_client_vote)不再把被查
 *     名字注册为副作用(upstream 查未知名会占一个槽).
 */
#include <linux/err.h>
#include <linux/errno.h>
#include <linux/kernel.h>
#include <linux/list.h>
#include <linux/module.h>
#include <linux/mutex.h>
#include <linux/slab.h>
#include <linux/spinlock.h>
#include <linux/string.h>

#include "hm_log.h"
#include "voter.h"

#define NUM_MAX_CLIENTS		32

static DEFINE_SPINLOCK(votable_list_slock);
static LIST_HEAD(votable_list);

struct client_vote {
	bool	enabled;
	int		value;
};

struct votable {
	const char		*name;
	const char		*override_client;
	struct list_head	list;
	struct client_vote	votes[NUM_MAX_CLIENTS];
	int			num_clients;
	int			type;
	int			effective_client_id;
	int			effective_result;
	int			override_result;
	struct mutex		vote_lock;
	void			*data;
	int			(*callback)(struct votable *votable,
					void *data,
					int effective_result,
					const char *effective_client);
	char			*client_strs[NUM_MAX_CLIENTS];
	bool			voted_on;
};

/**
 * vote_set_any() - SET_ANY 选举
 * @votable:	votable 对象
 * @client_id:	最新投票者的 client 编号
 * @eff_res:	输出: 按投票结果置 0 或 1
 * @eff_id:	输出: 恒等于传入的 client_id
 *
 * SET_ANY 的值恒等于 enabled, 没有"弃权"的概念, 因此选举过程中
 * effective_id 永远有效.
 *
 * Context:	须持有 votable->lock
 */
static void vote_set_any(struct votable *votable, int client_id,
				int *eff_res, int *eff_id)
{
	int i;

	*eff_res = 0;

	for (i = 0; i < votable->num_clients && votable->client_strs[i]; i++)
		*eff_res |= votable->votes[i].enabled;

	*eff_id = client_id;
}

/**
 * vote_min() - 取启用票中的最小值; 无启用票时结果与 id 均为 -EINVAL
 *
 * Context:	须持有 votable->lock
 */
static void vote_min(struct votable *votable, int client_id,
			int *eff_res, int *eff_id)
{
	int i;

	*eff_res = INT_MAX;
	*eff_id = -EINVAL;
	for (i = 0; i < votable->num_clients && votable->client_strs[i]; i++) {
		if (votable->votes[i].enabled
				&& *eff_res > votable->votes[i].value) {
			*eff_res = votable->votes[i].value;
			*eff_id = i;
		}
	}
	if (*eff_id == -EINVAL)
		*eff_res = -EINVAL;
}

/**
 * vote_max() - 取启用票中的最大值; 无启用票时结果与 id 均为 -EINVAL
 *
 * Context:	须持有 votable->lock
 */
static void vote_max(struct votable *votable, int client_id,
			int *eff_res, int *eff_id)
{
	int i;

	*eff_res = INT_MIN;
	*eff_id = -EINVAL;
	for (i = 0; i < votable->num_clients && votable->client_strs[i]; i++) {
		if (votable->votes[i].enabled
				&& *eff_res < votable->votes[i].value) {
			*eff_res = votable->votes[i].value;
			*eff_id = i;
		}
	}
	if (*eff_id == -EINVAL)
		*eff_res = -EINVAL;
}

static int get_client_id(struct votable *votable, const char *client_str,
		bool register_new)
{
	int i;

	for (i = 0; i < votable->num_clients; i++) {
		if (votable->client_strs[i]
		 && (strcmp(votable->client_strs[i], client_str) == 0))
			return i;
	}

	/* 新 client: 占第一个空槽 */
	for (i = 0; i < votable->num_clients; i++) {
		if (!votable->client_strs[i]) {
			if (!register_new)
				return -EINVAL;	/* 查询未知的 client */

			votable->client_strs[i]
				= kstrdup(client_str, GFP_KERNEL);
			if (!votable->client_strs[i])
				return -ENOMEM;
			return i;
		}
	}
	return -EINVAL;
}

static char *get_client_str(struct votable *votable, int client_id)
{
	if (!votable || (client_id == -EINVAL))
		return NULL;

	return votable->client_strs[client_id];
}

void lock_votable(struct votable *votable)
{
	mutex_lock(&votable->vote_lock);
}
EXPORT_SYMBOL_GPL(lock_votable);

void unlock_votable(struct votable *votable)
{
	mutex_unlock(&votable->vote_lock);
}
EXPORT_SYMBOL_GPL(unlock_votable);

bool is_override_vote_enabled_locked(struct votable *votable)
{
	if (!votable)
		return false;

	return votable->override_result != -EINVAL;
}
EXPORT_SYMBOL_GPL(is_override_vote_enabled_locked);

bool is_override_vote_enabled(struct votable *votable)
{
	bool enable;

	if (!votable)
		return false;

	lock_votable(votable);
	enable = is_override_vote_enabled_locked(votable);
	unlock_votable(votable);

	return enable;
}
EXPORT_SYMBOL_GPL(is_override_vote_enabled);

bool is_client_vote_enabled_locked(struct votable *votable,
					const char *client_str)
{
	int client_id;

	if (!votable || !client_str)
		return false;

	client_id = get_client_id(votable, client_str, false);
	if (client_id < 0)
		return false;

	return votable->votes[client_id].enabled;
}
EXPORT_SYMBOL_GPL(is_client_vote_enabled_locked);

bool is_client_vote_enabled(struct votable *votable, const char *client_str)
{
	bool enabled;

	if (!votable || !client_str)
		return false;

	lock_votable(votable);
	enabled = is_client_vote_enabled_locked(votable, client_str);
	unlock_votable(votable);
	return enabled;
}
EXPORT_SYMBOL_GPL(is_client_vote_enabled);

int get_client_vote_locked(struct votable *votable, const char *client_str)
{
	int client_id;

	if (!votable || !client_str)
		return -EINVAL;

	client_id = get_client_id(votable, client_str, false);
	if (client_id < 0)
		return -EINVAL;

	if ((votable->type != VOTE_SET_ANY)
		&& !votable->votes[client_id].enabled)
		return -EINVAL;

	return votable->votes[client_id].value;
}
EXPORT_SYMBOL_GPL(get_client_vote_locked);

int get_client_vote(struct votable *votable, const char *client_str)
{
	int value;

	if (!votable || !client_str)
		return -EINVAL;

	lock_votable(votable);
	value = get_client_vote_locked(votable, client_str);
	unlock_votable(votable);
	return value;
}
EXPORT_SYMBOL_GPL(get_client_vote);

int get_effective_result_locked(struct votable *votable)
{
	if (!votable)
		return -EINVAL;

	if (votable->override_result != -EINVAL)
		return votable->override_result;

	return votable->effective_result;
}
EXPORT_SYMBOL_GPL(get_effective_result_locked);

int get_effective_result(struct votable *votable)
{
	int value;

	if (!votable)
		return -EINVAL;

	lock_votable(votable);
	value = get_effective_result_locked(votable);
	unlock_votable(votable);
	return value;
}
EXPORT_SYMBOL_GPL(get_effective_result);

const char *get_effective_client_locked(struct votable *votable)
{
	if (!votable)
		return NULL;

	if (votable->override_result != -EINVAL)
		return votable->override_client;

	return get_client_str(votable, votable->effective_client_id);
}
EXPORT_SYMBOL_GPL(get_effective_client_locked);

const char *get_effective_client(struct votable *votable)
{
	const char *client_str;

	if (!votable)
		return NULL;

	lock_votable(votable);
	client_str = get_effective_client_locked(votable);
	unlock_votable(votable);
	return client_str;
}
EXPORT_SYMBOL_GPL(get_effective_client);

int vote(struct votable *votable, const char *client_str, bool enabled, int val)
{
	int effective_id = -EINVAL;
	int effective_result;
	int client_id;
	int rc = 0;
	bool similar_vote = false;

	if (!votable || !client_str)
		return -EINVAL;

	lock_votable(votable);

	client_id = get_client_id(votable, client_str, true);
	if (client_id < 0) {
		rc = client_id;
		goto out;
	}

	/*
	 * SET_ANY 忽略 val, 置成 enabled, 让选举对各种类型都
	 * 按值工作
	 */
	if (votable->type == VOTE_SET_ANY)
		val = enabled;

	if ((votable->votes[client_id].enabled == enabled) &&
		(votable->votes[client_id].value == val)) {
		hm_dbg("%s: %s,%d same vote %s of val=%d\n",
				votable->name,
				client_str, client_id,
				enabled ? "on" : "off",
				val);
		similar_vote = true;
	}

	votable->votes[client_id].enabled = enabled;
	votable->votes[client_id].value = val;

	if (similar_vote && votable->voted_on) {
		hm_dbg("%s: %s,%d Ignoring similar vote %s of val=%d\n",
				votable->name,
				client_str, client_id, enabled ? "on" : "off", val);
		goto out;
	}

	hm_dbg("%s: %s,%d voting %s of val=%d\n",
			votable->name,
			client_str, client_id, enabled ? "on" : "off", val);
	switch (votable->type) {
	case VOTE_MIN:
		vote_min(votable, client_id, &effective_result, &effective_id);
		break;
	case VOTE_MAX:
		vote_max(votable, client_id, &effective_result, &effective_id);
		break;
	case VOTE_SET_ANY:
		vote_set_any(votable, client_id,
				&effective_result, &effective_id);
		break;
	default:
		rc = -EINVAL;
		goto out;
	}

	/*
	 * 无启用票时回调收到 NULL 字符串和 -EINVAL 结果. 不仅值变
	 * 触发, 值不变而生效 client 变了也触发: 回调总能拿到新鲜的
	 * "谁"上下文, get_effective_client() 不报陈旧 client.
	 */
	if (!votable->voted_on
			|| (effective_result != votable->effective_result)
			|| (effective_id != votable->effective_client_id)) {
		votable->effective_client_id = effective_id;
		votable->effective_result = effective_result;
		hm_dbg("%s: effective vote is now %d voted by %s,%d\n",
				votable->name, effective_result,
				get_client_str(votable, effective_id),
				effective_id);
		if (votable->callback
				&& (votable->override_result == -EINVAL))
			rc = votable->callback(votable, votable->data,
					effective_result,
					get_client_str(votable, effective_id));
	}

	votable->voted_on = true;
out:
	unlock_votable(votable);
	return rc;
}
EXPORT_SYMBOL_GPL(vote);

int vote_override(struct votable *votable, const char *override_client,
		  bool enabled, int val)
{
	int rc = 0;

	/* override_client 必须是持久字符串(static/kstrdup): 按指针
	 * 存, 不拷贝 */
	if (!votable || !override_client || !votable->callback)
		return -EINVAL;

	lock_votable(votable);

	if (enabled) {
		rc = votable->callback(votable, votable->data,
					val, override_client);
		if (!rc) {
			votable->override_client = override_client;
			votable->override_result = val;
		}
	} else {
		rc = votable->callback(votable, votable->data,
				votable->effective_result,
				get_client_str(votable, votable->effective_client_id));
		votable->override_result = -EINVAL;
	}

	unlock_votable(votable);
	return rc;
}
EXPORT_SYMBOL_GPL(vote_override);

int rerun_election(struct votable *votable)
{
	int rc = 0;
	int effective_result;

	if (!votable)
		return -EINVAL;

	lock_votable(votable);
	effective_result = get_effective_result_locked(votable);
	if (votable->callback)
		rc = votable->callback(votable,
				votable->data,
				effective_result,
				get_client_str(votable, votable->effective_client_id));
	unlock_votable(votable);
	return rc;
}
EXPORT_SYMBOL_GPL(rerun_election);

struct votable *find_votable(const char *name)
{
	unsigned long flags;
	struct votable *v;
	bool found = false;

	if (!name)
		return NULL;

	spin_lock_irqsave(&votable_list_slock, flags);
	if (list_empty(&votable_list))
		goto out;

	list_for_each_entry(v, &votable_list, list) {
		if (strcmp(v->name, name) == 0) {
			found = true;
			break;
		}
	}
out:
	spin_unlock_irqrestore(&votable_list_slock, flags);

	if (found)
		return v;
	else
		return NULL;
}
EXPORT_SYMBOL_GPL(find_votable);

/*
 * 入注册表; 调用方早查之后有同名 votable 抢先入表则 -EEXIST.
 * 保持是 create_votable() 的最后一步, 错误路径才不会把已释放的
 * votable 留在链表上(find_votable() 会走进已释放内存).
 */
static int votable_list_add_unique(struct votable *votable)
{
	struct votable *v;
	unsigned long flags;

	spin_lock_irqsave(&votable_list_slock, flags);
	list_for_each_entry(v, &votable_list, list) {
		if (!strcmp(v->name, votable->name)) {
			spin_unlock_irqrestore(&votable_list_slock, flags);
			return -EEXIST;
		}
	}
	list_add(&votable->list, &votable_list);
	spin_unlock_irqrestore(&votable_list_slock, flags);

	return 0;
}

struct votable *create_votable(const char *name,
				int votable_type,
				int (*callback)(struct votable *votable,
						void *data,
						int effective_result,
						const char *effective_client),
				void *data)
{
	struct votable *votable;
	int rc;

	if (!name)
		return ERR_PTR(-EINVAL);

	votable = find_votable(name);
	if (votable)
		return ERR_PTR(-EEXIST);

	if (votable_type >= NUM_VOTABLE_TYPES) {
		hm_err("Invalid votable_type specified for voter\n");
		return ERR_PTR(-EINVAL);
	}

	votable = kzalloc(sizeof(struct votable), GFP_KERNEL);
	if (!votable)
		return ERR_PTR(-ENOMEM);

	votable->name = kstrdup(name, GFP_KERNEL);
	if (!votable->name) {
		kfree(votable);
		return ERR_PTR(-ENOMEM);
	}

	votable->num_clients = NUM_MAX_CLIENTS;
	votable->callback = callback;
	votable->type = votable_type;
	votable->data = data;
	votable->override_result = -EINVAL;
	mutex_init(&votable->vote_lock);

	/* 首次投票前 effective_result 与 client 状态无效, 置 -EINVAL */
	votable->effective_result = -EINVAL;
	if (votable->type == VOTE_SET_ANY)
		votable->effective_result = 0;
	votable->effective_client_id = -EINVAL;

	rc = votable_list_add_unique(votable);
	if (rc) {
		kfree(votable->name);
		kfree(votable);
		return ERR_PTR(rc);
	}

	return votable;
}
EXPORT_SYMBOL_GPL(create_votable);

void destroy_votable(struct votable *votable)
{
	unsigned long flags;
	int i;

	if (!votable)
		return;

	spin_lock_irqsave(&votable_list_slock, flags);
	list_del(&votable->list);
	spin_unlock_irqrestore(&votable_list_slock, flags);

	for (i = 0; i < votable->num_clients && votable->client_strs[i]; i++)
		kfree(votable->client_strs[i]);

	kfree(votable->name);
	kfree(votable);
}
EXPORT_SYMBOL_GPL(destroy_votable);
