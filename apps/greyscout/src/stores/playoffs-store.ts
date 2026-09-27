// @ts-nocheck

import { defineStore } from 'pinia';
import { fetchTeamsForPicklist, fetchPastEvents, fetchPickedTeams, updatePickedTeams } from '@/lib/picklist-query';
import { fetchPlayoffs, upsertPlayoffs } from '@/lib/playoffs-query';
import {
    emptyAlliances,
    resolveBracket,
    eliminatedAlliances,
    championAlliance,
    withWinner,
    pruneWinners
} from '@/lib/playoffs-bracket';
import type { TeamEntry } from '@/stores/picklist-store';

const copyAlliances = (alliances: number[][]) => alliances.map((teams) => [...teams]);

export const usePlayoffsStore = defineStore('playoffs', {
    state() {
        return {
            // Whichever event's bracket is on screen — the current event, or
            // a past event a user selected to look back on (read-only).
            eventId: null as string | null,
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
        }
    },
    actions: {
        /** Load teams + saved alliances/results for an event, replacing whatever was on screen. */
        async load(eventId: string) {
            this.eventId = eventId;
            this.loading = true;
            this.loadError = false;
            this.lastSaveError = null;
            this.lastSaveSuccess = false;

            const [teams, playoffs] = await Promise.all([
                fetchTeamsForPicklist(eventId),
                fetchPlayoffs(eventId)
            ]);

            // A newer load (e.g. the user switched events again) has taken
            // over while this one was in flight — drop the stale result.
            if (this.eventId !== eventId) return;

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
            this.rebuildPool();
            this.loading = false;
            this.loaded = true;
        },

        async loadPastEvents(currentEventId: string) {
            this.pastEvents = await fetchPastEvents(currentEventId);
        },

        /** Recompute the unpicked pool (sorted by team number) from the teams not on any alliance. */
        rebuildPool() {
            const placed = new Set(this.alliances.flat());
            this.pool = this.teams
                .map((t) => t.team_number)
                .filter((n) => !placed.has(n))
                .sort((a, b) => a - b);
        },

        /**
         * Persist the current alliances/results. When `syncPicked` is set
         * (only for the current event), teams newly placed on an alliance
         * are marked picked on the pick list, and teams taken off one are
         * unmarked. Returns true on success; on failure local state is kept
         * so the user can retry.
         */
        async save(syncPicked: boolean) {
            const eventId = this.eventId;
            this.isSaving = true;
            this.lastSaveSuccess = false;
            this.lastSaveError = null;

            this.winners = pruneWinners(this.winners);
            const error = await upsertPlayoffs(eventId, this.alliances, this.winners);
            if (error) {
                this.isSaving = false;
                this.lastSaveError = error.message ?? 'Unknown error';
                return false;
            }

            const before = new Set(this.savedAlliances.flat());
            const now = new Set(this.alliances.flat());
            const added = [...now].filter((n) => !before.has(n));
            const removed = [...before].filter((n) => !now.has(n));

            if (syncPicked && (added.length > 0 || removed.length > 0)) {
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
