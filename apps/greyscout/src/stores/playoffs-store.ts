// @ts-nocheck

import { defineStore } from 'pinia';
import {
    fetchTeamsForPicklist,
    fetchPastEvents,
    fetchPickedTeams,
    updatePickedTeams,
    fetchTeamPicklist,
    fetchPersonalPicklist,
    parseTeamTiers
} from '@/lib/picklist-query';
import { fetchPlayoffs, upsertPlayoffs, fetchPlayoffsPrediction, upsertPlayoffsPrediction } from '@/lib/playoffs-query';
import { getCachedTbaRankings, refreshTbaRankings } from '@/lib/tba-cache';
import {
    emptyAlliances,
    resolveBracket,
    eliminatedAlliances,
    championAlliance,
    withWinner,
    pruneWinners,
    ALLIANCE_SIZE
} from '@/lib/playoffs-bracket';
import type { TeamEntry } from '@/stores/picklist-store';
import type { AlliancePoolOrder } from '@/lib/preferences';

const copyAlliances = (alliances: number[][]) => alliances.map((teams) => [...teams]);

// 'team' is the real alliance selection, shared by everyone and edited by
// leads and admins. 'personal' is one user's own prediction (issue #123):
// private, editable by that user, and with no effect on the pick list.
export type PlayoffsMode = 'team' | 'personal';

// Sorts unranked/unlisted teams after everything that has a position.
const LAST = Number.MAX_SAFE_INTEGER;

export const usePlayoffsStore = defineStore('playoffs', {
    state() {
        return {
            // Whichever event's bracket is on screen — the current event, or
            // a past event a user selected to look back on (read-only).
            eventId: null as string | null,
            mode: 'team' as PlayoffsMode,
            // Whose prediction is on screen in personal mode.
            userId: null as string | null,
            teams: [] as TeamEntry[],
            alliances: emptyAlliances() as number[][],
            // Teams not yet on an alliance. A real array (not a getter) so
            // the pool's draggable can mutate it directly during a drag.
            pool: [] as number[],
            winners: {} as Record<number, number>,
            // Last state known to be in the database, used to work out which
            // teams a save added to / removed from an alliance.
            savedAlliances: emptyAlliances() as number[][],
            loading: false,
            loaded: false,
            loadError: false,
            isSaving: false,
            lastSaveSuccess: false,
            lastSaveError: null as string | null,

            // How the pool is ordered (issue #123), and what it's ordered by.
            poolOrder: 'tba' as AlliancePoolOrder,
            // Team number -> current TBA qualification rank (1 = first).
            rankings: {} as Record<number, number>,
            rankingsFetchedAt: null as number | null,
            rankingsError: null as string | null,
            // Ranked teams of the pick list in use, best first, and which
            // list that is (null when there isn't one to use).
            picklistOrder: [] as number[],
            picklistSource: null as 'team' | 'personal' | null,

            pastEvents: [] as { event_id: string; name: string; start_date: string }[]
        };
    },
    getters: {
        teamMap(state): Record<number, TeamEntry> {
            const map: Record<number, TeamEntry> = {};
            state.teams.forEach((t) => { map[t.team_number] = t; });
            return map;
        },
        resolvedMatches(state) {
            return resolveBracket(state.winners);
        },
        eliminated(): Set<number> {
            return eliminatedAlliances(this.resolvedMatches);
        },
        champion(): number | null {
            return championAlliance(this.resolvedMatches);
        },
        hasRankings(state): boolean {
            return Object.keys(state.rankings).length > 0;
        },
        picklistPosition(state): Record<number, number> {
            const positions: Record<number, number> = {};
            state.picklistOrder.forEach((teamNumber, index) => { positions[teamNumber] = index + 1; });
            return positions;
        },
        /**
         * The available teams that would be alliance captains if selection
         * carried on from here: with N alliances still lacking a captain,
         * the N highest-ranked teams not yet on an alliance.
         */
        captainEligible(state): number[] {
            const openCaptains = state.alliances.filter((alliance) => alliance.length === 0).length;
            return state.pool
                .filter((teamNumber) => state.rankings[teamNumber] != null)
                .sort((a, b) => state.rankings[a] - state.rankings[b])
                .slice(0, openCaptains);
        }
    },
    actions: {
        /**
         * Load teams + saved alliances/results for an event, replacing
         * whatever was on screen. In personal mode the alliances/results are
         * `userId`'s own prediction.
         */
        async load(eventId: string, mode: PlayoffsMode = this.mode, userId: string | null = this.userId) {
            this.eventId = eventId;
            this.mode = mode;
            this.userId = userId;
            this.loading = true;
            this.loadError = false;
            this.lastSaveError = null;
            this.lastSaveSuccess = false;

            const [teams, playoffs] = await Promise.all([
                fetchTeamsForPicklist(eventId),
                mode === 'personal'
                    ? (userId ? fetchPlayoffsPrediction(eventId, userId) : Promise.resolve(null))
                    : fetchPlayoffs(eventId)
            ]);

            // A newer load (e.g. the user switched events or modes again)
            // has taken over while this one was in flight — drop the stale
            // result.
            if (this.eventId !== eventId || this.mode !== mode) return;

            this.teams = teams;
            if (playoffs) {
                this.alliances = playoffs.alliances;
                this.winners = playoffs.winners;
            } else {
                this.alliances = emptyAlliances();
                this.winners = {};
                this.loadError = true;
            }
            this.savedAlliances = copyAlliances(this.alliances);

            const cached = getCachedTbaRankings(eventId);
            this.rankings = cached?.ranks ?? {};
            this.rankingsFetchedAt = cached?.fetchedAt ?? null;

            this.rebuildPool();
            this.loading = false;
            this.loaded = true;
        },

        async loadPastEvents(currentEventId: string) {
            this.pastEvents = await fetchPastEvents(currentEventId);
        },

        /** Pull the event's current rankings from TBA and re-sort the pool by them. */
        async refreshRankings() {
            const eventId = this.eventId;
            if (!eventId) return;
            this.rankingsError = null;
            try {
                const entry = await refreshTbaRankings(eventId);
                if (this.eventId !== eventId) return;
                this.rankings = entry.ranks;
                this.rankingsFetchedAt = entry.fetchedAt;
            } catch (e) {
                this.rankingsError = e.message ?? String(e);
            }
            this.sortPool();
        },

        /**
         * Load the pick list the pool can be ordered by: the team list for
         * leads and admins, their own list for members (who can't see the
         * team list), and none for observers. Scorer archetype, ranked
         * tiers only.
         */
        async loadPicklistOrder(userId: string | null, isLead: boolean, isMember: boolean) {
            const eventId = this.eventId;
            if (!eventId) return;

            let source = null;
            let result = null;
            if (isLead) {
                source = 'team';
                result = await fetchTeamPicklist(eventId, 'scorer');
            } else if (isMember && userId) {
                source = 'personal';
                result = await fetchPersonalPicklist(userId, eventId, 'scorer');
            }
            if (this.eventId !== eventId) return;

            const tiers = parseTeamTiers(result?.team_tiers);
            this.picklistSource = source;
            this.picklistOrder = (result?.team_numbers ?? []).map(Number).filter((teamNumber) => tiers[teamNumber]);
            this.sortPool();
        },

        setPoolOrder(order: AlliancePoolOrder) {
            this.poolOrder = order;
            this.sortPool();
        },

        /** Recompute the unpicked pool from the teams not on any alliance. */
        rebuildPool() {
            const placed = new Set(this.alliances.flat());
            this.pool = this.teams
                .map((t) => t.team_number)
                .filter((n) => !placed.has(n));
            this.sortPool();
        },

        /**
         * Order the pool (issue #123):
         * - 'tba': by current TBA rank.
         * - 'picklist': by the pick list, then TBA rank for teams not on it.
         * - 'smart': the teams in line to be alliance captains first (by
         *   rank), then the rest by the pick list.
         * Teams with no rank or list position go last, by team number.
         */
        sortPool() {
            const rank = (n: number) => this.rankings[n] ?? LAST;
            const position = (n: number) => this.picklistPosition[n] ?? LAST;
            const byTba = (a: number, b: number) => rank(a) - rank(b) || a - b;
            const byPicklist = (a: number, b: number) => position(a) - position(b) || byTba(a, b);

            if (this.poolOrder === 'picklist') {
                this.pool.sort(byPicklist);
            } else if (this.poolOrder === 'smart') {
                const captains = new Set(this.captainEligible);
                this.pool.sort((a, b) => {
                    const aCaptain = captains.has(a);
                    const bCaptain = captains.has(b);
                    if (aCaptain !== bCaptain) return aCaptain ? -1 : 1;
                    return aCaptain ? byTba(a, b) : byPicklist(a, b);
                });
            } else {
                this.pool.sort(byTba);
            }
        },

        /**
         * Put an available team on an alliance (the typed-number way of
         * entering alliances). Local only — callers save afterwards.
         * Returns a message saying why it couldn't, or null on success.
         */
        addTeamToAlliance(allianceNumber: number, teamNumber: number): string | null {
            const alliance = this.alliances[allianceNumber - 1];
            if (!alliance) return 'No such alliance.';
            if (!Number.isInteger(teamNumber) || teamNumber <= 0) return 'Enter a team number.';

            const current = this.alliances.findIndex((teams) => teams.includes(teamNumber));
            if (current >= 0) return `Team ${teamNumber} is already on Alliance ${current + 1}.`;
            if (!this.teamMap[teamNumber]) return `Team ${teamNumber} isn't at this event.`;
            if (alliance.length >= ALLIANCE_SIZE) return `Alliance ${allianceNumber} is full.`;

            alliance.push(teamNumber);
            this.rebuildPool();
            return null;
        },

        /** Take a team off whichever alliance it's on. Local only. */
        removeTeam(teamNumber: number) {
            this.alliances = this.alliances.map((teams) => teams.filter((n) => n !== teamNumber));
            this.rebuildPool();
        },

        /**
         * Persist the current alliances/results. In team mode, when
         * `syncPicked` is set (only for the current event), teams newly
         * placed on an alliance are marked picked on the pick list, and
         * teams taken off one are unmarked. A personal prediction never
         * touches the pick list. Returns true on success; on failure local
         * state is kept so the user can retry.
         */
        async save(syncPicked: boolean) {
            const eventId = this.eventId;
            const isPrediction = this.mode === 'personal';
            this.isSaving = true;
            this.lastSaveSuccess = false;
            this.lastSaveError = null;

            this.winners = pruneWinners(this.winners);
            const error = isPrediction
                ? (this.userId
                    ? await upsertPlayoffsPrediction(eventId, this.userId, this.alliances, this.winners)
                    : { message: 'Not signed in' })
                : await upsertPlayoffs(eventId, this.alliances, this.winners);
            if (error) {
                this.isSaving = false;
                this.lastSaveError = error.message ?? 'Unknown error';
                return false;
            }

            const before = new Set(this.savedAlliances.flat());
            const now = new Set(this.alliances.flat());
            const added = [...now].filter((n) => !before.has(n));
            const removed = [...before].filter((n) => !now.has(n));

            if (!isPrediction && syncPicked && (added.length > 0 || removed.length > 0)) {
                // Merge into the *current* server-side picked set rather than
                // a cached copy, so a concurrent manual toggle on the picklist
                // page isn't clobbered.
                const picked = new Set(await fetchPickedTeams(eventId));
                added.forEach((n) => picked.add(n));
                removed.forEach((n) => picked.delete(n));
                const pickError = await updatePickedTeams(eventId, [...picked]);
                if (pickError) {
                    this.isSaving = false;
                    this.lastSaveError = `Saved, but couldn't update the pick list: ${pickError.message ?? 'Unknown error'}`;
                    return false;
                }
            }

            // Only snapshot once everything succeeded, so a retry after a
            // failed pick-list sync re-derives the same added/removed teams.
            this.savedAlliances = copyAlliances(this.alliances);
            this.isSaving = false;
            this.lastSaveSuccess = true;
            setTimeout(() => { this.lastSaveSuccess = false; }, 2500);
            return true;
        },

        /** Record (or clear, if already selected) a match winner. Local only — callers save afterwards. */
        setWinner(match: number, alliance: number) {
            this.winners = withWinner(this.winners, match, alliance);
        },

        /** Take every team off every alliance and clear all results. Local only. */
        resetAll() {
            this.alliances = emptyAlliances();
            this.winners = {};
            this.rebuildPool();
        }
    }
});
