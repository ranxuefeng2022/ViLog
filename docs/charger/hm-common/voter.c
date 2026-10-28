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
 * voter.c - voting framework shared by the hm modules (ported from the
 * mature Qualcomm pmic-voter)
 *
 * Changes relative to the upstream source:
 *   - include fixes (upstream includes pmic-voter.h, renamed here);
 *   - EXPORT_SYMBOL_GPL added to every public interface;
 *   - the debugfs interface was removed (status/force_val/force_active):
 *     observability comes from the hm_vote() call-site logs and the
 *     vote() election logs; force_active had no non-debugfs setter and
 *     is gone with it, vote_override() remains as the API override;
 *   - vote()'s switch default branch jumps to the out label to unlock
 *     and return (upstream returns while holding vote_lock, leaking
 *     the lock on an invalid type);
 *   - vote() also fires when the effective client changed at an
 *     unchanged value (upstream: value change only). This keeps
 *     effective_client_id from going stale and gives the callback
 *     fresh "who" context; callbacks must be idempotent;
 *   - bug fixes: vote_override() NULL-callback guard (crash on
 *     votables created without a callback); registry insertion moved
 *     to the end of create_votable() with an atomic duplicate check
 *     (error paths used to leave a freed votable on the list);
 *   - query APIs (is_client_vote_enabled/get_client_vote) no longer
 *     REGISTER the queried name as a side effect (upstream: a query
 *     on an unknown name allocates a slot).
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
 * vote_set_any()
 * @votable:	votable object
 * @client_id:	client number of the latest voter
 * @eff_res:	sets 0 or 1 based on the voting
 * @eff_id:	Always returns the client_id argument
 *
 * Note that for SET_ANY voter, the value is always same as enabled. There is
 * no idea of a voter abstaining from the election. Hence there is never a
 * situation when the effective_id will be invalid, during election.
 *
 * Context:	Must be called with the votable->lock held
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
 * vote_min() -
 * @votable:	votable object
 * @client_id:	client number of the latest voter
 * @eff_res:	sets this to the min. of all the values amongst enabled voters.
 *		If there is no enabled client, this is set to -EINVAL
 * @eff_id:	sets this to the client id that has the min value amongst all
 *		the enabled clients. If there is no enabled client, sets this
 *		to -EINVAL
 *
 * Context:	Must be called with the votable->lock held
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
 * vote_max() -
 * @votable:	votable object
 * @client_id:	client number of the latest voter
 * @eff_res:	sets this to the max. of all the values amongst enabled voters.
 *		If there is no enabled client, this is set to -EINVAL
 * @eff_id:	sets this to the client id that has the max value amongst all
 *		the enabled clients. If there is no enabled client, sets this
 *		to -EINVAL
 *
 * Context:	Must be called with the votable->lock held
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

	/* new client */
	for (i = 0; i < votable->num_clients; i++) {
		if (!votable->client_strs[i]) {
			if (!register_new)
				return -EINVAL;	/* query on unknown client */

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
	 * for SET_ANY the val is to be ignored, set it
	 * to enabled so that the election still works based on
	 * value regardless of the type
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
	 * Note that the callback is called with a NULL string and -EINVAL
	 * result when there are no enabled votes. Fire not only on a value
	 * change but also when the effective client changed at the same
	 * value: the callback then always sees fresh "who" context, and
	 * get_effective_client() never reports a stale client.
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

	/* override_client must be a persistent string (static / kstrdup'd):
	 * it is stored by pointer, not copied */
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
 * Add to the registry, -EEXIST if a votable of the same name raced in
 * between the caller's early check and here. Kept as the LAST step of
 * create_votable() so no error path can leave a freed votable on the
 * list (find_votable() would then walk into freed memory).
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

	/*
	 * Because effective_result and client states are invalid
	 * before the first vote, initialize them to -EINVAL
	 */
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
