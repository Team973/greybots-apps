// @ts-nocheck

import { defineStore } from 'pinia';
import {
    fetchTeamsForPicklist,
    fetchScoutRoster,
    fetchPastEvents,
    fetchPersonalPicklist,
    fetchTeamPicklist,
    fetchAllPersonalPicklists,
    fetchPickedTeams,
    upsertPersonalPicklist,
    upsertTeamPicklist,
    updatePickedTeams,
    computeTeamTierStats,
    computeDemocraticTierGroups,
    parseTeamTiers,
    fetchTeamMatchStats,
    fetchTeamMatchSummaries,
    fetchTeamComments,
    TIERS,
    TIER_GROUPS,
    ARCHETYPES,
    DEFAULT_ARCHETYPE
} from '@/lib/picklist-query';
import type { Tier, TierGroup, TeamTierStats, TeamMatchSummary, Archetype } from '@/lib/picklist-query';
import { defenseThresholdPercent } from '@/lib/constants';
export type { Archetype };

export type PicklistTab = 'personal' | 'democratic' | 'team';

export interface TeamEntry {
    team_number: number;
    name: string;
    photo_url: string | null;
}

/**
 * Fixed tier sizes pick'em sorts its top-32 ranked teams into — 3+7+8+10+4
 * = 32, so everyone ranked below that lands in DNP. Not used by the
 * general drag-and-drop picklist, which stays free-form.
 */
const PICKEM_TIER_SIZES: Record<Exclude<Tier, 'DNP'>, number> = {
    S: 3, A: 7, B: 8, C: 10, D: 4
};

function emptyTierSections(): Record<TierGroup, number[]> {
    const groups = {} as Record<TierGroup, number[]>;
    TIER_GROUPS.forEach((g) => { groups[g] = []; });
    return groups;
}

/** One entry per archetype (issue #27), each initialized via the given factory. */
function perArchetype<T>(factory: () => T): Record<Archetype, T> {
    const map = {} as Record<Archetype, T>;
    ARCHETYPES.forEach((a) => { map[a] = factory(); });
    return map;
}

/**
 * Bucket a saved (order, tier) pair into tier-grouped sections, in saved
 * order within each tier. Any team present in allTeams but missing from
 * teamNumbers (e.g. added to the event after this list was last saved)
 * is appended to "Unranked".
 */
function buildTierSections(
    teamNumbers: number[],
    tiersMap: Record<number, Tier>,
    allTeams: TeamEntry[]
): Record<TierGroup, number[]> {
    const groups = emptyTierSections();
    const seen = new Set<number>();
    const orderSource = teamNumbers.length ? teamNumbers : allTeams.map((t) => t.team_number);

    const place = (num: number) => {
        if (seen.has(num)) return;
        seen.add(num);
        const tier = tiersMap[num];
        groups[tier ?? 'Unranked'].push(num);
    };

    orderSource.forEach((num) => place(Number(num)));
    allTeams.forEach((t) => place(t.team_number));

    return groups;
}

export const usePicklistStore = defineStore('picklist', {
    state() {
        return {
            // Current tab
            activeTab: 'personal' as PicklistTab,

            // Current archetype "super tab" (issue #27) — Scorer vs Defender are
            // independent rankings, each with their own My/Democratic/Team lists.
            activeArchetype: DEFAULT_ARCHETYPE as Archetype,

            // Teams loaded for the event
            allTeams: [] as TeamEntry[],
            teamsLoaded: false,

            // Personal list — tier-grouped team numbers per archetype, source of truth for order + tier
            personalTierSections: perArchetype(emptyTierSections) as Record<Archetype, Record<TierGroup, number[]>>,
            personalListLoaded: perArchetype(() => false) as Record<Archetype, boolean>,

            // Admin-only "view a scout's pick list" filter (issue #56) — a
            // read-only look at one other scout's personal list, kept
            // entirely separate from the current user's own personalTierSections
            // so switching the filter on/off never risks clobbering their draft.
            scoutRoster: [] as { user_id: string; name: string }[],
            scoutRosterLoaded: false,
            viewingScoutUserId: null as string | null,
            viewingScoutName: null as string | null,
            viewedScoutTierSections: emptyTierSections() as Record<TierGroup, number[]>,
            viewedScoutListLoading: false,

            // Lead/admin-only "view a prior event's pick list" filter (issue
            // #58) — a read-only look at a past event's Democratic or Team
            // List, held entirely separately from the current event's state
            // (including its own team roster, since a past event's attending
            // teams differ from the current one's) so switching to/from it
            // never touches the live current-event data.
            pastEvents: [] as { event_id: string; name: string; start_date: string }[],
            pastEventsLoaded: false,
            viewingPastEventId: null as string | null,
            viewingPastEventName: null as string | null,
            viewedPastEventTeams: [] as TeamEntry[],
            viewedPastEventTierSections: emptyTierSections() as Record<TierGroup, number[]>,
            viewedPastEventTierStats: {} as Record<number, TeamTierStats>,
            viewedPastEventTeamMatchSummaries: {} as Record<number, TeamMatchSummary>,
            viewedPastEventListLoading: false,

            // Team (lead) list — tier-grouped team numbers per archetype
            teamTierSections: perArchetype(emptyTierSections) as Record<Archetype, Record<TierGroup, number[]>>,
            teamListLoaded: perArchetype(() => false) as Record<Archetype, boolean>,

            // Democratic list — computed (read-only) tier grouping from all personal lists, per archetype
            democraticTierSections: perArchetype(emptyTierSections) as Record<Archetype, Record<TierGroup, number[]>>,
            democraticListLoaded: perArchetype(() => false) as Record<Archetype, boolean>,

            // Per-team aggregate tier stats across all personal lists, per archetype
            teamTierStats: perArchetype(() => ({})) as Record<Archetype, Record<number, TeamTierStats>>,

            // Event-wide "has this team already been picked" set, visible to everyone,
            // editable by leads only. Real-world draft status isn't per-archetype (see
            // picklist-query.ts's fetchPickedTeams), so this stays a single value.
            pickedTeams: [] as number[],
            pickedTeamsLoaded: false,

            // Per-event-team expanded data cache, keyed by "eventId:teamNumber"
            teamDataCache: {} as Record<string, { stats: unknown[]; comments: unknown[] }>,

            // Per-team card status + broke/died/beached/defense counts across all
            // matches — loaded up front so card status can show on the collapsed
            // row without expanding.
            teamMatchSummaries: {} as Record<number, TeamMatchSummary>,

            // Save status
            isSaving: false,
            lastSaveError: null as string | null,
            lastSaveSuccess: false
        };
    },
    getters: {
        teamMap(): Record<number, TeamEntry> {
            const map: Record<number, TeamEntry> = {};
            this.allTeams.forEach((t) => { map[t.team_number] = t; });
            return map;
        },

        /** The tier-grouped sections for whichever tab/archetype is currently active. */
        activeSections(): Record<TierGroup, number[]> {
            if (this.activeTab === 'personal') {
                if (this.viewingScoutUserId) return this.viewedScoutTierSections;
                return this.personalTierSections[this.activeArchetype];
            }
            if (this.viewingPastEventId) return this.viewedPastEventTierSections;
            if (this.activeTab === 'team') return this.teamTierSections[this.activeArchetype];
            return this.democraticTierSections[this.activeArchetype];
        },

        /**
         * Team lookup for whichever tab/event is currently active — a past
         * event (issue #58) has an entirely different attending-teams roster
         * than the current event, so its rows must resolve team name/photo
         * from viewedPastEventTeams rather than the current event's teamMap.
         */
        activeTeamMap(): Record<number, TeamEntry> {
            if (this.viewingPastEventId && this.activeTab !== 'personal') {
                const map: Record<number, TeamEntry> = {};
                this.viewedPastEventTeams.forEach((t) => { map[t.team_number] = t; });
                return map;
            }
            return this.teamMap;
        },

        /** Like tierStatsFor but sourced from a viewed past event's votes when one is active (issue #58). */
        activeTierStatsFor(): (teamNumber: number) => TeamTierStats | null {
            return (teamNumber: number) => {
                if (this.viewingPastEventId && this.activeTab !== 'personal') {
                    return this.viewedPastEventTierStats[teamNumber] ?? null;
                }
                return this.teamTierStats[this.activeArchetype][teamNumber] ?? null;
            };
        },

        /** Like cardStatusFor but sourced from a viewed past event's matches when one is active (issue #58). */
        activeCardStatusFor(): (teamNumber: number) => 'red' | 'yellow' | null {
            return (teamNumber: number) => {
                if (this.viewingPastEventId && this.activeTab !== 'personal') {
                    return this.viewedPastEventTeamMatchSummaries[teamNumber]?.worstCard ?? null;
                }
                return this.teamMatchSummaries[teamNumber]?.worstCard ?? null;
            };
        },

        /** Returns a function since callers (e.g. Pick'em) need a specific archetype, not just the active one. */
        personalFlatOrder(): (archetype: Archetype) => number[] {
            return (archetype: Archetype) => TIER_GROUPS.flatMap((g) => this.personalTierSections[archetype][g] ?? []);
        },

        /** Like personalFlatOrder, but only the actually-ranked tiers (S-DNP) — excludes Unranked. */
        personalRankedFlatOrder(): (archetype: Archetype) => number[] {
            return (archetype: Archetype) => TIERS.flatMap((g) => this.personalTierSections[archetype][g] ?? []);
        },

        personalTiersMap(): (archetype: Archetype) => Record<number, Tier> {
            return (archetype: Archetype) => {
                const map: Record<number, Tier> = {};
                TIERS.forEach((tier) => {
                    (this.personalTierSections[archetype][tier] ?? []).forEach((num) => { map[num] = tier; });
                });
                return map;
            };
        },

        teamFlatOrder(): (archetype: Archetype) => number[] {
            return (archetype: Archetype) => TIER_GROUPS.flatMap((g) => this.teamTierSections[archetype][g] ?? []);
        },

        teamTiersMap(): (archetype: Archetype) => Record<number, Tier> {
            return (archetype: Archetype) => {
                const map: Record<number, Tier> = {};
                TIERS.forEach((tier) => {
                    (this.teamTierSections[archetype][tier] ?? []).forEach((num) => { map[num] = tier; });
                });
                return map;
            };
        },

        isTeamPicked(): (teamNumber: number) => boolean {
            return (teamNumber: number) => this.pickedTeams.includes(teamNumber);
        },

        cardStatusFor(): (teamNumber: number) => 'red' | 'yellow' | null {
            return (teamNumber: number) => this.teamMatchSummaries[teamNumber]?.worstCard ?? null;
        },

        /** Defense% over the threshold — used to pre-filter Pick'em's Defender candidate pool (issue #27). */
        isLikelyDefender(): (teamNumber: number) => boolean {
            return (teamNumber: number) =>
                (this.teamMatchSummaries[teamNumber]?.defensePercent ?? 0) > defenseThresholdPercent;
        }
    },
    actions: {
        setTab(tab: PicklistTab) {
            this.activeTab = tab;
        },

        setArchetype(archetype: Archetype) {
            this.activeArchetype = archetype;
        },

        async loadAll(eventId: string, userId: string | null, isLead: boolean) {
            await this.loadTeams(eventId);
            await this.loadPickedTeams(eventId);
            await this.loadTeamMatchSummaries(eventId);
            for (const archetype of ARCHETYPES) {
                await this.loadPersonalList(userId, eventId, archetype);
                await this.loadDemocraticList(eventId, archetype);
                if (isLead) {
                    await this.loadTeamList(eventId, archetype);
                }
            }
        },

        async loadTeamMatchSummaries(eventId: string) {
            this.teamMatchSummaries = await fetchTeamMatchSummaries(eventId);
        },

        async loadTeams(eventId: string) {
            this.teamsLoaded = false;
            this.allTeams = await fetchTeamsForPicklist(eventId);
            this.teamsLoaded = true;
        },

        async loadPersonalList(userId: string | null, eventId: string, archetype: Archetype) {
            this.personalListLoaded[archetype] = false;
            if (!userId) {
                this.personalTierSections[archetype] = buildTierSections([], {}, this.allTeams);
                this.personalListLoaded[archetype] = true;
                return;
            }

            const result = await fetchPersonalPicklist(userId, eventId, archetype);
            this.personalTierSections[archetype] = buildTierSections(
                result?.team_numbers ?? [],
                parseTeamTiers(result?.team_tiers),
                this.allTeams
            );
            this.personalListLoaded[archetype] = true;
        },

        async loadTeamList(eventId: string, archetype: Archetype) {
            this.teamListLoaded[archetype] = false;
            const result = await fetchTeamPicklist(eventId, archetype);
            this.teamTierSections[archetype] = buildTierSections(
                result?.team_numbers ?? [],
                parseTeamTiers(result?.team_tiers),
                this.allTeams
            );
            this.teamListLoaded[archetype] = true;
        },

        async loadDemocraticList(eventId: string, archetype: Archetype) {
            this.democraticListLoaded[archetype] = false;
            const allLists = await fetchAllPersonalPicklists(eventId, archetype);
            const stats = computeTeamTierStats(allLists);
            this.teamTierStats[archetype] = stats;
            this.democraticTierSections[archetype] = computeDemocraticTierGroups(
                this.allTeams.map((t) => t.team_number),
                stats
            );
            this.democraticListLoaded[archetype] = true;
        },

        /**
         * Loads the scout roster for the admin-only pick-list filter dropdown
         * (issue #56), excluding the viewing admin themself — they already
         * have their own list under "My List", there's nothing to filter to.
         */
        async loadScoutRoster(excludeUserId: string | null) {
            this.scoutRosterLoaded = false;
            const roster = await fetchScoutRoster();
            this.scoutRoster = roster.filter((s) => s.user_id !== excludeUserId);
            this.scoutRosterLoaded = true;
        },

        /**
         * Load a given scout's personal picklist read-only (issue #56). Kept
         * out of personalTierSections entirely so it can never be saved over
         * the viewing admin's own list.
         */
        async viewScoutList(scoutUserId: string, scoutName: string, eventId: string, archetype: Archetype) {
            this.viewingScoutUserId = scoutUserId;
            this.viewingScoutName = scoutName;
            this.viewedScoutListLoading = true;
            const result = await fetchPersonalPicklist(scoutUserId, eventId, archetype);
            this.viewedScoutTierSections = buildTierSections(
                result?.team_numbers ?? [],
                parseTeamTiers(result?.team_tiers),
                this.allTeams
            );
            this.viewedScoutListLoading = false;
        },

        /** Clears the scout filter, returning the My List tab to the current user's own editable list. */
        clearScoutFilter() {
            this.viewingScoutUserId = null;
            this.viewingScoutName = null;
            this.viewedScoutTierSections = emptyTierSections();
        },

        /**
         * Loads the roster of prior events (every event but the current one)
         * for the lead/admin-only "view a prior event's pick list" filter
         * (issue #58).
         */
        async loadPastEvents(currentEventId: string) {
            this.pastEventsLoaded = false;
            this.pastEvents = await fetchPastEvents(currentEventId);
            this.pastEventsLoaded = true;
        },

        /**
         * Start viewing a prior event's Democratic or Team List read-only
         * (issue #58) and load its data for the given tab/archetype.
         */
        async viewPastEvent(pastEventId: string, pastEventName: string, tab: 'democratic' | 'team', archetype: Archetype) {
            this.viewingPastEventId = pastEventId;
            this.viewingPastEventName = pastEventName;
            await this.loadViewedPastEventData(tab, archetype);
        },

        /**
         * (Re)loads the currently-viewed past event's data for the given
         * tab/archetype — called on initial selection and again whenever the
         * active tab or archetype changes while the filter is active, since
         * both the team roster and vote stats are archetype-specific and the
         * Team List vs. Democratic grouping differ.
         */
        async loadViewedPastEventData(tab: 'democratic' | 'team', archetype: Archetype) {
            if (!this.viewingPastEventId) return;
            this.viewedPastEventListLoading = true;
            const pastEventId = this.viewingPastEventId;

            const [teams, allLists, matchSummaries] = await Promise.all([
                fetchTeamsForPicklist(pastEventId),
                fetchAllPersonalPicklists(pastEventId, archetype),
                fetchTeamMatchSummaries(pastEventId)
            ]);
            this.viewedPastEventTeams = teams;
            this.viewedPastEventTierStats = computeTeamTierStats(allLists);
            this.viewedPastEventTeamMatchSummaries = matchSummaries;

            if (tab === 'team') {
                const result = await fetchTeamPicklist(pastEventId, archetype);
                this.viewedPastEventTierSections = buildTierSections(
                    result?.team_numbers ?? [],
                    parseTeamTiers(result?.team_tiers),
                    teams
                );
            } else {
                this.viewedPastEventTierSections = computeDemocraticTierGroups(
                    teams.map((t) => t.team_number),
                    this.viewedPastEventTierStats
                );
            }
            this.viewedPastEventListLoading = false;
        },

        /** Clears the prior-event filter, returning Democratic/Team List to the current event. */
        clearPastEventFilter() {
            this.viewingPastEventId = null;
            this.viewingPastEventName = null;
            this.viewedPastEventTeams = [];
            this.viewedPastEventTierSections = emptyTierSections();
            this.viewedPastEventTierStats = {};
            this.viewedPastEventTeamMatchSummaries = {};
        },

        async loadPickedTeams(eventId: string) {
            this.pickedTeamsLoaded = false;
            this.pickedTeams = await fetchPickedTeams(eventId);
            this.pickedTeamsLoaded = true;
        },

        /**
         * Reset the team list's tiers/order to the current democratic
         * grouping, overwriting whatever is currently staged for the team list.
         */
        resetTeamListFromDemocratic(archetype: Archetype) {
            const cloned = emptyTierSections();
            TIER_GROUPS.forEach((g) => { cloned[g] = [...(this.democraticTierSections[archetype][g] ?? [])]; });
            this.teamTierSections[archetype] = cloned;
        },

        /** Clear the team list's tiers/order entirely. */
        resetTeamList(archetype: Archetype) {
            this.teamTierSections[archetype] = emptyTierSections();
        },

        /** Unrank every team on the personal list, back to all-Unranked. */
        resetPersonalList(archetype: Archetype) {
            this.personalTierSections[archetype] = buildTierSections([], {}, this.allTeams);
        },

        /**
         * Moves a team out of wherever it currently sits (Unranked or any
         * ranked tier) and into the given position of the overall ranked
         * order — used by pick'em both to place a brand-new team (binary
         * search converging on where it belongs) and to move an
         * already-ranked team during continuous refinement (removing the
         * mover first means inserting it at its target index naturally
         * shifts everyone at/after that index down one).
         *
         * Tier boundaries are fixed sizes (PICKEM_TIER_SIZES), not
         * "whichever tier currently has room" — the top 32 ranked teams
         * split 3/7/8/10/4 across S/A/B/C/D, everyone else lands in DNP —
         * so every call re-slices the whole ranked order into those fixed
         * buckets rather than splicing into just one tier's array.
         * flatIndex is always within [0, personalRankedFlatOrder(archetype).length]
         * by construction.
         */
        placeTeamAtFlatIndex(archetype: Archetype, teamNumber: number, flatIndex: number) {
            const sections = this.personalTierSections[archetype];
            const flat = TIERS.flatMap((t) => sections[t]).filter((n) => n !== teamNumber);
            flat.splice(flatIndex, 0, teamNumber);

            let cursor = 0;
            TIERS.forEach((tier) => {
                if (tier === 'DNP') {
                    sections.DNP = flat.slice(cursor);
                } else {
                    const size = PICKEM_TIER_SIZES[tier];
                    sections[tier] = flat.slice(cursor, cursor + size);
                    cursor += size;
                }
            });

            sections.Unranked = sections.Unranked.filter((n) => n !== teamNumber);
        },

        async savePersonalList(userId: string, eventId: string, archetype: Archetype) {
            this.isSaving = true;
            this.lastSaveError = null;
            const error = await upsertPersonalPicklist(
                userId, eventId, archetype, this.personalFlatOrder(archetype), this.personalTiersMap(archetype)
            );
            this.isSaving = false;
            if (error) {
                this.lastSaveError = error.message ?? 'Unknown error';
                return false;
            }
            this.lastSaveSuccess = true;
            setTimeout(() => { this.lastSaveSuccess = false; }, 3000);
            return true;
        },

        async saveTeamList(eventId: string, archetype: Archetype) {
            this.isSaving = true;
            this.lastSaveError = null;
            const error = await upsertTeamPicklist(eventId, archetype, this.teamFlatOrder(archetype), this.teamTiersMap(archetype));
            this.isSaving = false;
            if (error) {
                this.lastSaveError = error.message ?? 'Unknown error';
                return false;
            }
            this.lastSaveSuccess = true;
            setTimeout(() => { this.lastSaveSuccess = false; }, 3000);
            return true;
        },

        /**
         * Toggle the event-wide picked status for a team. Optimistically
         * updates local state, reverting if the save fails.
         */
        async togglePicked(eventId: string, teamNumber: number) {
            const previous = this.pickedTeams;
            const wasPicked = previous.includes(teamNumber);
            const next = wasPicked
                ? previous.filter((n) => n !== teamNumber)
                : [...previous, teamNumber];

            this.pickedTeams = next;
            const error = await updatePickedTeams(eventId, next);
            if (error) {
                this.pickedTeams = previous;
                this.lastSaveError = error.message ?? 'Unknown error';
                return false;
            }
            return true;
        },

        async getTeamData(teamNumber: number, eventId: string) {
            // Keyed by event + team, not just team — the same team number
            // can attend multiple events, and issue #58 makes it possible to
            // view a past event's data in the same session as the current
            // event's, so a team-only key could return the wrong event's
            // cached stats/comments.
            const cacheKey = `${eventId}:${teamNumber}`;
            if (this.teamDataCache[cacheKey]) {
                return this.teamDataCache[cacheKey];
            }
            const [stats, comments] = await Promise.all([
                fetchTeamMatchStats(teamNumber, eventId),
                fetchTeamComments(teamNumber, eventId)
            ]);
            this.teamDataCache[cacheKey] = { stats, comments };
            return this.teamDataCache[cacheKey];
        }
    }
});
