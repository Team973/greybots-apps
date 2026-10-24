<script setup lang="ts">
// @ts-nocheck
import { RouterLink } from 'vue-router';
import SearchableDropdown from "@greybots/common/components/SearchableDropdown.vue";

import { useEventStore } from "@/stores/event-store";
import { useAuthStore } from "@/stores/auth-store";
import { useWatchlistStore } from "@/stores/watchlist-store";
import { queryTeamNumbers } from "@/lib/data-query";
import { fetchTeamMatchSummaries, fetchTeamPitSummaries } from "@/lib/picklist-query";
import { computeInlineStats } from "@/lib/picklist-stats";
import { getCachedTbaRankings } from "@/lib/tba-cache";
</script>

<template>
    <div class="main-content">
        <div class="page-header">
            <h1>Watchlist</h1>
            <button type="button" class="refresh-button" @click="loadData" :disabled="!loaded">
                {{ loaded ? 'Refresh' : 'Loading…' }}
            </button>
        </div>
        <p class="hint">Teams the leads have starred for {{ eventStore.eventName }}, with how they're playing so
            far. <template v-if="!isLead">Only leads and admins can add or remove teams. </template>See
            <RouterLink to="/data-status">Data Status</RouterLink> for what's still left to scout on each.</p>

        <div v-if="!loaded" class="data-tile">Loading…</div>

        <template v-else>
            <div v-if="isLead" class="watch-add">
                <SearchableDropdown :choices="addChoices" model-value="" placeholder="Add a team…"
                    @update:modelValue="addTeam"></SearchableDropdown>
            </div>
            <p v-if="watchError" class="watch-error">{{ watchError }}</p>

            <div v-if="watchedRows.length === 0" class="data-tile">No teams are on the watchlist yet.</div>

            <div v-for="row in watchedRows" :key="row.teamNumber" class="watch-card">
                <div class="watch-card-header">
                    <RouterLink :to="`/team/${row.teamNumber}`" class="team-link">
                        <span class="star-mark">★</span> {{ row.teamNumber }}
                        <span v-if="row.name" class="team-name">{{ row.name }}</span>
                    </RouterLink>
                    <span v-if="row.rank" class="rank-badge">Rank {{ row.rank }}</span>
                    <button v-if="isLead" type="button" class="watch-remove" :title="`Remove ${row.teamNumber}`"
                        :aria-label="`Remove ${row.teamNumber} from the watchlist`"
                        @click="removeTeam(row.teamNumber)">✕</button>
                </div>
                <div class="watch-stats">
                    <span v-for="chip in row.chips" :key="chip.label" class="inline-stat"
                        :class="{ 'inline-stat--warn': chip.warn, 'inline-stat--highlight': chip.highlight }">
                        <span class="inline-stat-label">{{ chip.label }}</span> {{ chip.value }}
                    </span>
                </div>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            eventStore: null,
            authStore: null,
            watchlistStore: null,
            loaded: false,
            teams: [],
            matchSummaries: {},
            pitSummaries: {},
            watchError: ''
        }
    },
    computed: {
        isLead() {
            return this.authStore?.isLead ?? false;
        },
        // Watched teams with their stats, best TBA rank first; unranked teams
        // follow in team-number order.
        watchedRows() {
            const eventId = this.eventStore.eventId;
            const ranks = getCachedTbaRankings(eventId)?.ranks ?? {};
            const names = {};
            this.teams.forEach((team) => { names[team.team_number] = team.name; });

            return [...(this.watchlistStore?.watchedTeamNumbers ?? [])]
                .map((teamNumber) => ({
                    teamNumber,
                    name: names[teamNumber] ?? '',
                    rank: ranks[teamNumber] ?? null,
                    chips: computeInlineStats(eventId, teamNumber, this.matchSummaries[teamNumber], this.pitSummaries[teamNumber])
                }))
                .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.teamNumber - b.teamNumber);
        },
        addChoices() {
            const watched = new Set(this.watchlistStore?.watchedTeamNumbers ?? []);
            return this.teams
                .filter((team) => !watched.has(team.team_number))
                .map((team) => ({ key: team.team_number, text: `${team.team_number}${team.name ? ' - ' + team.name : ''}` }));
        }
    },
    methods: {
        async loadData() {
            this.loaded = false;

            await this.eventStore.updateEvent();
            const eventId = this.eventStore.eventId;

            const [teams, matchSummaries, pitSummaries] = await Promise.all([
                queryTeamNumbers(eventId),
                fetchTeamMatchSummaries(eventId),
                fetchTeamPitSummaries(eventId),
                this.watchlistStore.loadWatchlist(eventId)
            ]);

            this.teams = [...teams].sort((a, b) => a.team_number - b.team_number);
            this.matchSummaries = matchSummaries;
            this.pitSummaries = pitSummaries;

            this.loaded = true;
        },
        async addTeam(teamNumber) {
            if (!teamNumber || !this.isLead) return;
            this.watchError = '';
            const error = await this.watchlistStore.toggleWatch(this.eventStore.eventId, Number(teamNumber));
            if (error) this.watchError = `Couldn't add ${teamNumber}: ${error.message ?? 'unknown error'}`;
        },
        async removeTeam(teamNumber) {
            if (!this.isLead) return;
            this.watchError = '';
            const error = await this.watchlistStore.toggleWatch(this.eventStore.eventId, Number(teamNumber));
            if (error) this.watchError = `Couldn't remove ${teamNumber}: ${error.message ?? 'unknown error'}`;
        }
    },
    created() {
        this.eventStore = useEventStore();
        this.authStore = useAuthStore();
        this.watchlistStore = useWatchlistStore();
        this.loadData();
    }
}
</script>

<style scoped>
.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
}

.refresh-button {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background-color: var(--accent-color);
    color: var(--primary-text-color);
    cursor: pointer;
    font: inherit;
}

.refresh-button:hover:not(:disabled) {
    background-color: var(--header-hover-color);
}

.refresh-button:disabled {
    opacity: 0.6;
    cursor: default;
}

.hint {
    font-size: 0.85em;
    opacity: 0.75;
}

.watch-add {
    max-width: 360px;
    margin-bottom: 12px;
}

.watch-error {
    color: #d32f2f;
    font-size: 13px;
}

.watch-card {
    background: var(--tile-background-color);
    border-radius: 12px;
    margin-bottom: 8px;
    padding: 10px 14px;
    box-shadow:
        0 0 0 2px #e0b400,
        0 2px 10px hsla(230, 13%, 9%, 0.06);
}

.watch-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
}

.team-link {
    flex: 1;
    min-width: 0;
    color: inherit;
    text-decoration: none;
    font-weight: 700;
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.team-link:hover {
    text-decoration: underline;
}

.star-mark {
    color: #e0b400;
}

.team-name {
    font-weight: 400;
    font-size: 13px;
    color: rgba(128, 128, 128, 0.9);
    margin-left: 4px;
}

.rank-badge {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 6px;
    background: rgba(176, 87, 3, 0.18);
}

.watch-remove {
    flex-shrink: 0;
    min-width: 36px;
    min-height: 36px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: rgba(128, 128, 128, 0.9);
    font: inherit;
    cursor: pointer;
}

.watch-remove:hover {
    background: rgba(211, 47, 47, 0.14);
    color: #d32f2f;
}

.watch-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    margin-top: 6px;
}

/* Same chip look as the pick list's inline stats (PicklistRow.vue). */
.inline-stat {
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(128, 128, 128, 0.12);
    color: var(--primary-text-color);
    white-space: nowrap;
}

.inline-stat-label {
    font-weight: 500;
    color: rgba(128, 128, 128, 0.9);
}

.inline-stat--warn {
    background: rgba(211, 47, 47, 0.14);
}

.inline-stat--highlight {
    background: rgba(46, 160, 67, 0.18);
}
</style>
