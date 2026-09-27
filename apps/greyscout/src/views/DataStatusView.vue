<script setup lang="ts">
// @ts-nocheck

import { RouterLink } from 'vue-router';
import CollapsibleSection from "@greybots/common/components/CollapsibleSection.vue";

import { useEventStore } from "@/stores/event-store";
import { useAuthStore } from "@/stores/auth-store";
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
    components: { CollapsibleSection },
    data() {
        return {
            eventStore: null,
            authStore: null,
            loaded: false,
            schedule: [],
            teams: [],
            // `${match_number}|${team_number}` -> { count, noShow, id }
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
                queryTeamNumbers(eventId)
            ]);

            this.schedule = schedule;

            this.teams = [...teams].sort((a, b) => a.team_number - b.team_number);

            this.scoutedByKey = {};
            matchData.forEach((row) => {
                const key = `${row[matchNumberColumn]}|${row[teamNumberColumn]}`;
                if (!this.scoutedByKey[key]) {
                    this.scoutedByKey[key] = { count: 0, noShow: false, id: row.id, createdAt: row.created_at };
                }
                const entry = this.scoutedByKey[key];
                entry.count += 1;
                entry.noShow = entry.noShow || !!row.prematch_noshow;
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
