<script setup lang="ts">
// @ts-nocheck
import { RouterLink } from 'vue-router';

import { useEventStore } from "@/stores/event-store";
import { queryTeamNumbers } from "@/lib/data-query";
import { fetchLatestEpaByTeam } from "@/lib/prescout-query";
import { getTeamTbaStats, refreshTbaStats } from "@/lib/tba-cache";
</script>

<template>
    <div class="main-content">
        <div class="page-header">
            <h1>Stats</h1>
            <button type="button" class="refresh-button" :disabled="refreshing" @click="refreshStats">
                {{ refreshing ? 'Refreshing TBA Stats…' : '↻ Refresh TBA Stats' }}
            </button>
        </div>
        <p v-if="refreshError" class="stats-error">{{ refreshError }}</p>
        <p class="hint">EPA comes from pre-scouting entries; OPR/DPR come from The Blue Alliance — tap Refresh to
            re-pull the latest.</p>

        <div v-if="!loaded" class="stats-loading">Loading…</div>

        <div v-else-if="rows.length === 0" class="stats-empty">No teams loaded for this event yet.</div>

        <div v-else class="stats-table-wrap">
            <table>
                <thead>
                    <tr>
                        <th class="sortable" @click="sortBy('team_number')">Team{{ sortIndicator('team_number') }}</th>
                        <th class="sortable" @click="sortBy('name')">Name{{ sortIndicator('name') }}</th>
                        <th class="sortable" @click="sortBy('epa')">EPA{{ sortIndicator('epa') }}</th>
                        <th class="sortable" @click="sortBy('opr')">OPR{{ sortIndicator('opr') }}</th>
                        <th class="sortable" @click="sortBy('dpr')">DPR{{ sortIndicator('dpr') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in sortedRows" :key="row.team_number">
                        <td><RouterLink :to="`/team/${row.team_number}`" class="team-link">{{ row.team_number }}</RouterLink></td>
                        <td>{{ row.name }}</td>
                        <td>{{ formatNumber(row.epa) }}</td>
                        <td>{{ formatNumber(row.opr) }}</td>
                        <td>{{ formatNumber(row.dpr) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            eventStore: null,
            loaded: false,
            teams: [],
            epaByTeam: {},
            // Bumped after a refresh to force `rows` to re-read the TBA cache
            // (a plain localStorage read isn't reactive on its own).
            tbaStatsVersion: 0,
            refreshing: false,
            refreshError: '',
            sort: { key: 'team_number', direction: 'asc' }
        }
    },
    computed: {
        rows() {
            this.tbaStatsVersion;
            return this.teams.map((team) => {
                const tbaStats = getTeamTbaStats(this.eventStore.eventId, team.team_number) ?? {};
                return {
                    team_number: team.team_number,
                    name: team.name,
                    epa: this.epaByTeam[team.team_number] ?? null,
                    opr: tbaStats.opr ?? null,
                    dpr: tbaStats.dpr ?? null
                };
            });
        },
        sortedRows() {
            const { key, direction } = this.sort;
            const sign = direction === 'asc' ? 1 : -1;
            return [...this.rows].sort((a, b) => {
                const av = a[key];
                const bv = b[key];
                if (av == null && bv == null) return 0;
                if (av == null) return 1;
                if (bv == null) return -1;
                if (av < bv) return -sign;
                if (av > bv) return sign;
                return 0;
            });
        }
    },
    methods: {
        async loadData() {
            this.loaded = false;

            await this.eventStore.updateEvent();
            const eventId = this.eventStore.eventId;

            const [teams, epaByTeam] = await Promise.all([
                queryTeamNumbers(eventId),
                fetchLatestEpaByTeam(eventId)
            ]);

            this.teams = [...teams].sort((a, b) => a.team_number - b.team_number);
            this.epaByTeam = epaByTeam;

            this.loaded = true;
        },
        async refreshStats() {
            this.refreshing = true;
            this.refreshError = '';
            try {
                await refreshTbaStats(this.eventStore.eventId);
                this.tbaStatsVersion++;
            } catch (e) {
                this.refreshError = e.message ?? String(e);
            }
            this.refreshing = false;
        },
        sortBy(key) {
            if (this.sort.key === key) {
                this.sort.direction = this.sort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                // Team/name default to ascending (alphabetical-ish); the stat
                // columns default to descending, so the "best" teams surface
                // on the first click.
                this.sort = { key, direction: (key === 'team_number' || key === 'name') ? 'asc' : 'desc' };
            }
        },
        sortIndicator(key) {
            if (this.sort.key !== key) return '';
            return this.sort.direction === 'asc' ? ' ▲' : ' ▼';
        },
        formatNumber(value) {
            return value == null ? '—' : Number(value).toFixed(1);
        }
    },
    created() {
        this.eventStore = useEventStore();
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

.stats-error {
    color: #d32f2f;
    font-size: 13px;
}

.hint {
    font-size: 0.85em;
    opacity: 0.75;
}

.stats-loading,
.stats-empty {
    padding: 20px 0;
    opacity: 0.75;
}

.stats-table-wrap {
    overflow-x: auto;
    max-width: 100%;
}

table {
    border-collapse: collapse;
    width: 100%;
}

th,
td {
    padding: 8px 14px;
    text-align: left;
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

th.sortable {
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
}

th.sortable:hover {
    background: rgba(176, 87, 3, 0.1);
}

.team-link {
    color: inherit;
    text-decoration: none;
    font-weight: 700;
}

.team-link:hover {
    text-decoration: underline;
}
</style>
