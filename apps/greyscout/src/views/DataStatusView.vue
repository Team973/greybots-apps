<script setup lang="ts">
// @ts-nocheck

import { RouterLink } from 'vue-router';
import CollapsibleSection from "@greybots/common/components/CollapsibleSection.vue";
import SearchableDropdown from "@greybots/common/components/SearchableDropdown.vue";

import { useEventStore } from "@/stores/event-store";
import { useAuthStore } from "@/stores/auth-store";
import { useWatchlistStore } from "@/stores/watchlist-store";
import { queryEventMatchSchedule, queryEventData, queryEventPitData, queryEventPrescoutData, queryTeamNumbers } from "@/lib/data-query";
import { matchNumberColumn, teamNumberColumn } from "@/lib/constants";
</script>

<template>
    <div class="main-content">
        <div class="page-header">
            <h1>Data Status</h1>
            <button type="button" class="refresh-button" @click="loadData" :disabled="!loaded">
                {{ loaded ? 'Refresh' : 'Loading…' }}
            </button>
        </div>

        <div v-if="loaded">
            <CollapsibleSection title="Starred Teams">
                <p>{{ starredRows.length }} starred team{{ starredRows.length === 1 ? '' : 's' }}, with everything
                    collected on each so far. Stars are shared by the whole team<template v-if="!isLead">; leads
                        and admins can change them</template>.</p>

                <div v-if="isLead" class="star-add">
                    <SearchableDropdown :choices="starChoices" model-value="" placeholder="Star a team…"
                        @update:modelValue="addStar"></SearchableDropdown>
                </div>
                <p v-if="starError" class="star-error">{{ starError }}</p>

                <p v-if="starredRows.length === 0">No teams are starred yet.</p>
                <div v-else class="schedule-table-wrap">
                    <table class="starred-table">
                        <thead>
                            <tr>
                                <th>Team</th>
                                <th>Prescout</th>
                                <th>Pit</th>
                                <th>Matches scouted</th>
                                <th>No-shows</th>
                                <th>Cards</th>
                                <th v-if="isLead"></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in starredRows" :key="row.teamNumber">
                                <td>
                                    <RouterLink :to="`/team/${row.teamNumber}`" class="team-link">
                                        <span class="star-mark">★</span> {{ row.teamNumber }}
                                        <span v-if="row.name" class="star-team-name">{{ row.name }}</span>
                                    </RouterLink>
                                </td>
                                <td><span class="status-dot" :class="row.prescouted ? 'status-scouted' : 'status-missing'"></span>
                                    {{ row.prescouted ? 'Done' : 'Missing' }}</td>
                                <td><span class="status-dot" :class="row.pitScouted ? 'status-scouted' : 'status-missing'"></span>
                                    {{ row.pitScouted ? 'Done' : 'Missing' }}</td>
                                <td>{{ row.scouted }} / {{ row.scheduled }}<template v-if="row.otherMatches"> (+{{ row.otherMatches }}
                                        practice / playoff)</template></td>
                                <td>{{ row.noShows || '—' }}</td>
                                <td>
                                    <span v-if="row.yellow" class="card-tag card-tag--yellow">{{ row.yellow }} yellow</span>
                                    <span v-if="row.red" class="card-tag card-tag--red">{{ row.red }} red</span>
                                    <template v-if="!row.yellow && !row.red">—</template>
                                </td>
                                <td v-if="isLead">
                                    <button type="button" class="star-remove" :title="`Unstar ${row.teamNumber}`"
                                        @click="removeStar(row.teamNumber)">✕</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="Prescouting">
                <p>{{ prescoutStats.scoutedTeams }} / {{ prescoutStats.totalTeams }} teams pre-scouted
                    ({{ prescoutStats.percent }}%).</p>
                <div class="legend">
                    <span class="legend-item"><span class="status-dot status-scouted"></span> Pre-scouted</span>
                    <span class="legend-item"><span class="status-dot status-missing"></span> Not yet pre-scouted</span>
                </div>

                <p v-if="teams.length === 0">No teams loaded for this event yet.</p>

                <div v-else class="pit-status-grid">
                    <div v-for="team in teams" :key="team.team_number" class="pit-status-cell"
                        :class="prescoutedTeams[team.team_number] ? 'cell-scouted' : 'cell-missing'">
                        <RouterLink :to="`/team/${team.team_number}`" class="pit-status-link">
                            <span class="status-dot"
                                :class="prescoutedTeams[team.team_number] ? 'status-scouted' : 'status-missing'"></span>
                            {{ team.team_number }}
                        </RouterLink>
                        <button v-if="isLead && prescoutedTeams[team.team_number]" type="button" class="edit-pencil"
                            title="Edit pre-scouting submission" @click="goToPrescoutEdit(team.team_number)">✎</button>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="Pit Scouting">
                <p>{{ pitStats.scoutedTeams }} / {{ pitStats.totalTeams }} teams pit scouted
                    ({{ pitStats.percent }}%).</p>
                <div class="legend">
                    <span class="legend-item"><span class="status-dot status-scouted"></span> Pit scouted</span>
                    <span class="legend-item"><span class="status-dot status-missing"></span> Not yet pit scouted</span>
                </div>

                <p v-if="teams.length === 0">No teams loaded for this event yet.</p>

                <div v-else class="pit-status-grid">
                    <div v-for="team in teams" :key="team.team_number" class="pit-status-cell"
                        :class="pitScoutedTeams[team.team_number] ? 'cell-scouted' : 'cell-missing'">
                        <RouterLink :to="`/team/${team.team_number}`" class="pit-status-link">
                            <span class="status-dot"
                                :class="pitScoutedTeams[team.team_number] ? 'status-scouted' : 'status-missing'"></span>
                            {{ team.team_number }}
                        </RouterLink>
                        <button v-if="isLead && pitScoutedTeams[team.team_number]" type="button" class="edit-pencil"
                            title="Edit pit scouting submission" @click="goToPitEdit(team.team_number)">✎</button>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="Match Scouting">
                <p>{{ completionStats.scoutedSlots }} / {{ completionStats.totalSlots }} team-match slots scouted
                    ({{ completionStats.percent }}%) across {{ qualMatches.length }} qualification matches.</p>
                <div class="legend">
                    <span class="legend-item"><span class="status-dot status-scouted"></span> Scouted</span>
                    <span class="legend-item"><span class="status-dot status-noshow"></span> No-show recorded</span>
                    <span class="legend-item"><span class="status-dot status-missing"></span> Not yet scouted</span>
                    <span class="legend-item"><span class="card-mark card-mark--yellow"></span> Yellow card</span>
                    <span class="legend-item"><span class="card-mark card-mark--red"></span> Red card</span>
                </div>
                <p class="hint">Only qualification matches are shown — match numbers repeat across playoff levels,
                    so scouting entries can't be matched back to a specific playoff match.</p>

                <p v-if="qualMatches.length === 0">No qualification schedule loaded for this event yet.</p>

                <div v-else class="schedule-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Match</th>
                                <th class="red-header">Red 1</th>
                                <th class="red-header">Red 2</th>
                                <th class="red-header">Red 3</th>
                                <th class="blue-header">Blue 1</th>
                                <th class="blue-header">Blue 2</th>
                                <th class="blue-header">Blue 3</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="match in qualMatches" :key="match.key">
                                <td>Q{{ match.match_number }}</td>
                                <td v-for="slotKey in slotKeys" :key="slotKey" :class="cellClass(match, slotKey)">
                                    <template v-if="match[slotKey]">
                                        <RouterLink :to="`/team/${match[slotKey]}`" class="team-link">
                                            <span class="status-dot" :class="statusDotClass(match.match_number, match[slotKey])"></span>
                                            {{ match[slotKey] }}
                                            <span v-if="cardFor(match, slotKey)" class="card-mark"
                                                :class="`card-mark--${cardFor(match, slotKey)}`"
                                                :title="cardFor(match, slotKey) === 'red' ? 'Red card' : 'Yellow card'"></span>
                                        </RouterLink>
                                        <button v-if="isLead && scoutedEntryFor(match, slotKey)" type="button" class="edit-pencil"
                                            title="Edit match submission" @click="goToMatchEdit(match, slotKey)">✎</button>
                                    </template>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </CollapsibleSection>
        </div>
    </div>
</template>

<script lang="ts">
const SLOT_KEYS = ['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3'];

export default {
    components: { CollapsibleSection, SearchableDropdown },
    data() {
        return {
            eventStore: null,
            authStore: null,
            watchlistStore: null,
            starError: '',
            // team_number -> { scouted, noShows, yellow, red, otherMatches },
            // counted over every match entry for the team (issue #123).
            teamTotals: {},
            loaded: false,
            schedule: [],
            teams: [],
            // `${match_number}|${team_number}` -> { count, noShow, card, id } (qualification matches)
            scoutedByKey: {},
            // team_number -> { id }
            pitScoutedTeams: {},
            // team_number -> { id }
            prescoutedTeams: {},
            slotKeys: SLOT_KEYS
        }
    },
    computed: {
        isLead() {
            return this.authStore?.isLead ?? false;
        },
        qualMatches() {
            return this.schedule.filter(m => m.comp_level === 'qm');
        },
        // One row per starred team: what's been collected on it so far.
        starredRows() {
            const names = {};
            this.teams.forEach((team) => { names[team.team_number] = team.name; });

            const scheduled = {};
            this.qualMatches.forEach((match) => {
                SLOT_KEYS.forEach((slotKey) => {
                    const teamNumber = match[slotKey];
                    if (teamNumber) scheduled[teamNumber] = (scheduled[teamNumber] ?? 0) + 1;
                });
            });

            // A starred team that has since dropped out of the event isn't shown.
            const atEvent = new Set(this.teams.map((team) => team.team_number));
            return [...(this.watchlistStore?.watchedTeamNumbers ?? [])]
                .filter((teamNumber) => atEvent.size === 0 || atEvent.has(teamNumber))
                .sort((a, b) => a - b)
                .map((teamNumber) => {
                    const totals = this.teamTotals[teamNumber] ?? { scouted: 0, noShows: 0, yellow: 0, red: 0, otherMatches: 0 };
                    return {
                        teamNumber,
                        name: names[teamNumber] ?? '',
                        prescouted: !!this.prescoutedTeams[teamNumber],
                        pitScouted: !!this.pitScoutedTeams[teamNumber],
                        scheduled: scheduled[teamNumber] ?? 0,
                        ...totals
                    };
                });
        },
        // Teams that can still be starred.
        starChoices() {
            const starred = new Set(this.watchlistStore?.watchedTeamNumbers ?? []);
            return this.teams
                .filter((team) => !starred.has(team.team_number))
                .map((team) => ({ key: team.team_number, text: `${team.team_number}${team.name ? ' - ' + team.name : ''}` }));
        },
        completionStats() {
            let totalSlots = 0;
            let scoutedSlots = 0;

            this.qualMatches.forEach(match => {
                SLOT_KEYS.forEach(slotKey => {
                    const teamNumber = match[slotKey];
                    if (!teamNumber) return;
                    totalSlots++;
                    if (this.scoutedByKey[`${match.match_number}|${teamNumber}`]) scoutedSlots++;
                });
            });

            const percent = totalSlots > 0 ? Math.round((scoutedSlots / totalSlots) * 100) : 0;
            return { totalSlots, scoutedSlots, percent };
        },
        pitStats() {
            const totalTeams = this.teams.length;
            const scoutedTeams = this.teams.filter(team => this.pitScoutedTeams[team.team_number]).length;
            const percent = totalTeams > 0 ? Math.round((scoutedTeams / totalTeams) * 100) : 0;
            return { totalTeams, scoutedTeams, percent };
        },
        prescoutStats() {
            const totalTeams = this.teams.length;
            const scoutedTeams = this.teams.filter(team => this.prescoutedTeams[team.team_number]).length;
            const percent = totalTeams > 0 ? Math.round((scoutedTeams / totalTeams) * 100) : 0;
            return { totalTeams, scoutedTeams, percent };
        }
    },
    methods: {
        async loadData() {
            this.loaded = false;

            await this.eventStore.updateEvent();
            const eventId = this.eventStore.eventId;

            const [schedule, matchData, pitData, prescoutData, teams] = await Promise.all([
                queryEventMatchSchedule(eventId),
                queryEventData(eventId),
                queryEventPitData(eventId),
                queryEventPrescoutData(eventId),
                queryTeamNumbers(eventId),
                this.watchlistStore.loadWatchlist(eventId)
            ]);

            this.schedule = schedule;

            this.teams = [...teams].sort((a, b) => a.team_number - b.team_number);

            this.scoutedByKey = {};
            this.teamTotals = {};
            matchData.forEach((row) => {
                // Practice and playoff entries reuse qualification match
                // numbers, so they stay out of the qualification grid; rows
                // from before the match type existed are qualifications.
                const isQual = !row.prematch_match_type || row.prematch_match_type === 'qual';

                const key = `${row[matchNumberColumn]}|${row[teamNumberColumn]}`;
                const isFirstForSlot = isQual && !this.scoutedByKey[key];

                const totals = this.teamTotals[row[teamNumberColumn]]
                    ?? (this.teamTotals[row[teamNumberColumn]] = { scouted: 0, noShows: 0, yellow: 0, red: 0, otherMatches: 0 });
                if (isFirstForSlot) totals.scouted += 1;
                if (!isQual) totals.otherMatches += 1;
                if (row.prematch_noshow) totals.noShows += 1;
                if (row.postmatch_cards === 'yellow') totals.yellow += 1;
                if (row.postmatch_cards === 'red') totals.red += 1;

                if (!isQual) return;

                if (!this.scoutedByKey[key]) {
                    this.scoutedByKey[key] = { count: 0, noShow: false, card: null, id: row.id, createdAt: row.created_at };
                }
                const entry = this.scoutedByKey[key];
                entry.count += 1;
                entry.noShow = entry.noShow || !!row.prematch_noshow;
                if (row.postmatch_cards === 'red') entry.card = 'red';
                else if (row.postmatch_cards === 'yellow' && entry.card !== 'red') entry.card = 'yellow';
                // If a slot somehow has more than one submission, edit links
                // should point at the most recent one.
                if (row.created_at > entry.createdAt) {
                    entry.id = row.id;
                    entry.createdAt = row.created_at;
                }
            });

            this.pitScoutedTeams = {};
            pitData.forEach((row) => {
                const existing = this.pitScoutedTeams[row.pit_team_number];
                if (!existing || row.created_at > existing.createdAt) {
                    this.pitScoutedTeams[row.pit_team_number] = { id: row.id, createdAt: row.created_at };
                }
            });

            this.prescoutedTeams = {};
            prescoutData.forEach((row) => {
                const existing = this.prescoutedTeams[row.prescout_team_number];
                if (!existing || row.created_at > existing.createdAt) {
                    this.prescoutedTeams[row.prescout_team_number] = { id: row.id, createdAt: row.created_at };
                }
            });

            this.loaded = true;
        },
        statusFor(matchNumber, teamNumber) {
            const entry = this.scoutedByKey[`${matchNumber}|${teamNumber}`];
            if (!entry) return 'missing';
            return entry.noShow ? 'noshow' : 'scouted';
        },
        statusDotClass(matchNumber, teamNumber) {
            return `status-${this.statusFor(matchNumber, teamNumber)}`;
        },
        cellClass(match, slotKey) {
            const teamNumber = match[slotKey];
            const alliance = slotKey.startsWith('red') ? 'red-cell' : 'blue-cell';
            if (!teamNumber) return [alliance];
            return [alliance, `cell-${this.statusFor(match.match_number, teamNumber)}`];
        },
        // The card recorded for a team in a match, if any (issue #123).
        cardFor(match, slotKey) {
            return this.scoutedByKey[`${match.match_number}|${match[slotKey]}`]?.card ?? null;
        },
        // Starring is shared with the pick list and match scouting (the
        // watchlist), and is for leads and admins.
        async addStar(teamNumber) {
            if (!teamNumber || !this.isLead) return;
            this.starError = '';
            const error = await this.watchlistStore.toggleWatch(this.eventStore.eventId, Number(teamNumber));
            if (error) this.starError = `Couldn't star ${teamNumber}: ${error.message ?? 'unknown error'}`;
        },
        async removeStar(teamNumber) {
            if (!this.isLead) return;
            this.starError = '';
            const error = await this.watchlistStore.toggleWatch(this.eventStore.eventId, Number(teamNumber));
            if (error) this.starError = `Couldn't unstar ${teamNumber}: ${error.message ?? 'unknown error'}`;
        },
        // Leads/admins clicking an already-scouted slot go straight to
        // editing that submission (issue #31); everyone else, and unscouted
        // slots, keep the original team-analysis link.
        // The scouted submission entry (with its row id) for a match slot,
        // or undefined if that slot hasn't been scouted — used to decide
        // whether the lead-only edit pencil shows, and where it goes.
        scoutedEntryFor(match, slotKey) {
            return this.scoutedByKey[`${match.match_number}|${match[slotKey]}`];
        },
        // Edit pencil handlers (issue #31) — separate from the team link
        // itself, which always goes to Team Analysis.
        goToMatchEdit(match, slotKey) {
            const entry = this.scoutedEntryFor(match, slotKey);
            if (entry) this.$router.push(`/match/edit/${entry.id}`);
        },
        // Pit scouting reuses the existing Pit Scouting page (auto-opened to
        // this team, in edit mode) rather than a dedicated page.
        goToPitEdit(teamNumber) {
            this.$router.push(`/pit?team=${teamNumber}&editPit=1`);
        },
        // Same idea for pre-scouting (issue #51) — reuses the Prescout page.
        goToPrescoutEdit(teamNumber) {
            this.$router.push(`/prescout?team=${teamNumber}&editPrescout=1`);
        }
    },
    created() {
        this.eventStore = useEventStore();
        this.authStore = useAuthStore();
        this.watchlistStore = useWatchlistStore();
        this.authStore.checkUser();
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

.legend {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin: 8px 0;
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
}

.hint {
    font-size: 0.85em;
    opacity: 0.75;
}

.status-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}

.status-scouted {
    background-color: #3ab83a;
}

.status-noshow {
    background-color: #e0a020;
}

.status-missing {
    background-color: #e05050;
}

/* A card recorded for a team in a match (issue #123): a small card shape. */
.card-mark {
    display: inline-block;
    width: 9px;
    height: 13px;
    border-radius: 2px;
    flex-shrink: 0;
    border: 1px solid rgba(0, 0, 0, 0.35);
}

.card-mark--yellow,
.card-tag--yellow {
    background-color: #f5c518;
    color: #1a1a1a;
}

.card-mark--red,
.card-tag--red {
    background-color: #d32f2f;
    color: #fff;
}

.card-tag {
    display: inline-block;
    font-size: 0.8em;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 6px;
    margin-right: 4px;
    white-space: nowrap;
}

/* ── Starred teams ── */
.star-add {
    max-width: 320px;
    margin: 8px 0;
}

.star-error {
    color: #d32f2f;
}

.star-mark {
    color: #f5c518;
}

.star-team-name {
    opacity: 0.7;
    font-weight: 400;
}

.starred-table td {
    white-space: nowrap;
}

.star-remove {
    background: none;
    border: none;
    font: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    color: rgba(128, 128, 128, 0.8);
    border-radius: 6px;
    min-width: 44px;
    min-height: 44px;
}

.star-remove:hover {
    color: #d32f2f;
    background: rgba(211, 47, 47, 0.12);
}

.schedule-table-wrap {
    overflow-x: auto;
    max-width: 100%;
}

/* Both the pit-status-grid cells and the match-table team cells are now
   RouterLinks (issue #46) — undo the browser's default link styling so
   they still read as plain status cells, not blue underlined text. */
.pit-status-link,
.team-link {
    color: inherit;
    text-decoration: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.pit-status-link:hover,
.team-link:hover {
    text-decoration: underline;
}

/* Leads/admins edit shortcut (issue #31) — a separate button next to the
   team link, rather than repurposing the link itself, so clicking the link
   always goes to Team Analysis. */
.edit-pencil {
    background: none;
    border: none;
    margin-left: 4px;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    color: rgba(128, 128, 128, 0.7);
    border-radius: 6px;
    flex-shrink: 0;
    /* A proper touch target (roughly 44x44, the standard minimum tap size)
       so the pencil is easy to hit with a finger, not just a mouse. */
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.edit-pencil:hover {
    color: #b05703;
    background: rgba(176, 87, 3, 0.12);
}

.red-header {
    background-color: rgba(224, 0, 0, 0.15);
}

.blue-header {
    background-color: rgba(0, 0, 224, 0.15);
}

.pit-status-grid {
    display: grid;
    /* Cells only show the team number now (no name), so a narrower min width
       fits more per row than when this had to fit "9999 - Team Name". */
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 8px;
    width: 100%;
}

.pit-status-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 0.9em;
}

.pit-status-link {
    flex: 1;
    min-width: 0;
}

.pit-status-cell.cell-scouted {
    background-color: rgba(58, 184, 58, 0.12);
}

.pit-status-cell.cell-missing {
    background-color: rgba(224, 80, 80, 0.12);
}
</style>
