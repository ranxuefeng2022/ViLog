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
 * voter.h - voting framework shared by the hm modules
 *
 * Ported from the mature Qualcomm pmic-voter. Compared to the early
 * version that used to live in this tree:
 *   - clients are strings instead of int indexes and register
 *     themselves on their first vote, so cross-module users can never
 *     collide on an index;
 *   - a global name registry plus find_votable() lets module B get a
 *     votable created by module A;
 *   - destroy_votable() / vote_override() / rerun_election() added;
 *   - no debugfs interface: observability comes from the hm_vote()
 *     call-site logs and the vote() election logs (both dynamic-debug
 *     controlled); vote_override() is the API-level forced vote.
 *
 * Typical usage: the owner creates the votable in probe(); users get it
 * by name through find_votable() and vote(). Votable and client names
 * are cross-module contracts; keep them centrally defined instead of
 * scattering string literals across modules.
 */
#ifndef __HM_VOTER_H__
#define __HM_VOTER_H__

#include <linux/types.h>

#include "hm_log.h"

struct votable;

enum votable_type {
	VOTE_MIN,		/* smallest value among enabled votes wins */
	VOTE_MAX,		/* largest value among enabled votes wins */
	VOTE_SET_ANY,		/* true if any client votes true */
	NUM_VOTABLE_TYPES,
};

/*
 * Create a votable. name is globally unique (duplicates return
 * -EEXIST); callback runs under the vote lock whenever the effective
 * result changes and data is passed through untouched; pass NULL if no
 * callback is needed.
 */
struct votable *create_votable(const char *name, int votable_type,
		int (*callback)(struct votable *votable, void *data,
				int effective_result,
				const char *effective_client),
		void *data);
void destroy_votable(struct votable *votable);

/* Look up a votable created by any module; NULL if not found */
struct votable *find_votable(const char *name);

/*
 * Persistent votable acquisition, mirroring hm_psy_get_by_name(): the
 * pointer is cached in *vot on first success and later calls reuse it,
 * so the name-registry list walk happens once per module lifetime
 * instead of on every vote. All hm modules are builtin and votables
 * are destroyed only at driver teardown, so the cached pointer is
 * valid for the module's whole life. Returns -ENODEV while the peer
 * module has not created the votable yet -- callers that retry
 * periodically simply skip that round.
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
 * vote() with call-site attribution: hm_dbg's __func__ expands at the
 * CALL site (naming the function the vote came from) and #votable
 * stringifies the votable argument, so a single client name used from
 * several places stays traceable in the log. Must stay a macro -- a
 * function wrapper would report its own name instead of the caller's.
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

/* Lock/unlock around the *_locked variants when several states must be
 * read atomically */
void lock_votable(struct votable *votable);
void unlock_votable(struct votable *votable);

#endif /* __HM_VOTER_H__ */
