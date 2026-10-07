<script setup lang="ts">
// @ts-nocheck
import MatchTeamRow from "@/components/MatchTeamRow.vue";
import Dropdown from "@greybots/common/components/Dropdown.vue";
import NumberInput from "@greybots/common/components/Number.vue";
import Switch from "@greybots/common/components/Switch.vue";

import { matchScoutTable, matchTypes, defaultMatchType } from "@/lib/constants";
import { buildTeamRowSchema } from "@/lib/2026/match-scouting-form";
import { validateForm, parseScoutData, submitScoutData, getTeamInputElement } from "@/lib/data-submission";
import { queryMatchTeams, queryPlayoffMatchTeams } from "@/lib/data-query";
import { useEventStore } from "@/stores/event-store";
import { useOfflineQueueStore } from "@/stores/offline-queue-store";
import { useWatchlistStore } from "@/stores/watchlist-store";

import "@material/web/button/filled-button";
</script>

<template>
    <div class="main-content">
        <h1>Match Scouting</h1>

        <div v-if="formLoaded" class="data-tile">
            <div class="match-type-toggle" role="radiogroup" aria-label="Match type">
                <button v-for="type in matchTypes" :key="type.key" type="button" class="match-type-option"
                    :class="{ 'match-type-option--active': matchType === type.key }" role="radio"
                    :aria-checked="matchType === type.key" @click="onMatchTypeChange(type.key)">
                    {{ type.text }}
                </button>
            </div>
            <div class="match-controls">
                <div class="match-control">
                    {{ matchNumberLabel }}:
                    <NumberInput :model-value="matchNumber" @update:modelValue="onMatchNumberChange" label="">
                    </NumberInput>
                </div>
                <div v-if="matchType !== 'practice'" class="match-control">
                    Manual Team Entry:
                    <Switch :model-value="manualEntry" @update:modelValue="onManualEntryChange"></Switch>
                </div>
            </div>
            <p v-if="matchType === 'practice'">Practice matches have no schedule — assign teams below.</p>
            <p v-else-if="scheduleLookupFailed && !manualEntry">No {{ matchType === 'playoff' ? 'playoff' : 'qualification' }}
                schedule found for that match — assign teams manually below.</p>
            <p v-if="matchType === 'playoff'" class="match-type-hint">Playoff matches are numbered in the order they're
                played: 1 is the first playoff match, and the finals carry on from the bracket.</p>
        </div>

        <div v-if="formLoaded && showManualPicker" class="data-tile manual-assign-tile">
            <h3>Team Assignment</h3>
            <div class="manual-assign-grid">
                <div v-for="(slot, idx) in slots" :key="slot.key" class="manual-assign-row">
                    <span class="manual-assign-label" :class="`manual-assign-label--${slot.allianceColor}`">{{ slot.label
                        }}</span>
                    <Dropdown :choices="allTeamChoices" :model-value="manualTeamIndices[idx]"
                        @update:modelValue="onManualTeamChange(idx, $event)"></Dropdown>
                </div>
            </div>
        </div>

        <div v-if="formLoaded" class="match-rows">
            <MatchTeamRow v-for="(slot, idx) in slots" :key="slot.key + '-' + (slot.teamNumber ?? 'unassigned')"
                :slot-label="slot.label" :team-number="slot.teamNumber"
                :team-name="slot.teamNumber ? (teamNameByNumber[slot.teamNumber] ?? '') : ''"
                :alliance-color="slot.allianceColor" :schema="rows[idx].schema" :expanded="rows[idx].expanded"
                :dirty="rows[idx].dirty" :included="rows[idx].included"
                :watched="slot.teamNumber ? watchlistStore.isWatched(slot.teamNumber) : false"
                :form-invalid="rows[idx].formInvalid" @toggle-expand="toggleExpand(idx)"
                @toggle-included="toggleIncluded(idx)" @form-update="onRowFormUpdate(idx)">
            </MatchTeamRow>
        </div>

        <div class="data-tile error-tile" v-if="formInvalid">
            <h1>^^^ Form is invalid. Please check the highlighted teams for errors ^^^</h1>
        </div>
        <div class="data-tile success-tile" v-if="submitSuccess">
            <h1>Submitted successfully!</h1>
        </div>
        <div class="data-tile notification-tile" v-if="resetSuccess">
            <h1>Reset form successfully!</h1>
        </div>

        <div class="data-tile notification-tile" v-if="queuedOffline">
            <h1>Couldn't submit some teams — saved locally</h1>
            <p>Those entries have been queued and will sync automatically once you're back online. You can keep
                scouting in the meantime.</p>
        </div>

        <div class="button-container" v-if="formLoaded && !isSubmitting">
            <md-filled-button v-on:click="resetMatch" class="reset-button">RESET</md-filled-button>

            <md-filled-button v-on:click="submitForm" class="submit-button" :disabled="!hasDirtyIncludedRow">
                SUBMIT
            </md-filled-button>
        </div>
    </div>
</template>

<script lang="ts">
// Slot order/labels/alliance are fixed by position — red1-3 are always Red,
// blue1-3 are always Blue — unlike the old single-team form where alliance
// was a scout-entered switch.
const SLOT_DEFS = [
    { key: "red1", label: "Red 1", allianceColor: "red" },
    { key: "red2", label: "Red 2", allianceColor: "red" },
    { key: "red3", label: "Red 3", allianceColor: "red" },
    { key: "blue1", label: "Blue 1", allianceColor: "blue" },
    { key: "blue2", label: "Blue 2", allianceColor: "blue" },
    { key: "blue3", label: "Blue 3", allianceColor: "blue" },
];

export default {
    data() {
        return {
            eventStore: null,
            queueStore: null,
            watchlistStore: null,
            formLoaded: false,
            matchNumber: null,
            // Practice / qualification / playoff (issue #123).
            matchTypes,
            matchType: defaultMatchType,
            manualEntry: false,
            scheduleLookupFailed: false,
            allTeamChoices: [],
            teamNameByNumber: {},
            slots: SLOT_DEFS.map((def) => ({ ...def, teamNumber: null })),
            manualTeamIndices: [0, 0, 0, 0, 0, 0],
            rows: SLOT_DEFS.map(() => this.buildRow()),
            lastMatchSyncKey: null,
            submitData: {},
            queuedOffline: false,
            submitSuccess: false,
            formInvalid: false,
            isSubmitting: false,
            resetSuccess: false,
        }
    },
    methods: {
        buildRow() {
            return {
                schema: buildTeamRowSchema(),
                expanded: false,
                dirty: false,
                included: true,
                formInvalid: false
            };
        },
        async loadScoutForm() {
            this.formLoaded = false;

            const teamComp = await getTeamInputElement();
            this.allTeamChoices = teamComp?.options?.choices ?? [];
            this.teamNameByNumber = {};
            this.allTeamChoices.forEach((choice) => {
                if (choice.key === 'none') return;
                const [, name] = String(choice.text).split(': ');
                if (name) this.teamNameByNumber[choice.key] = name;
            });

            this.formLoaded = true;
        },
        toggleExpand(idx) {
            this.rows[idx].expanded = !this.rows[idx].expanded;
        },
        toggleIncluded(idx) {
            this.rows[idx].included = !this.rows[idx].included;
        },
        onRowFormUpdate(idx) {
            this.rows[idx].dirty = true;
            this.submitSuccess = false;
            this.resetSuccess = false;

            // Re-validate this row live so a previously-flagged error clears
            // as soon as the scout fixes it.
            if (this.rows[idx].formInvalid) {
                const { data, valid } = validateForm(this.rows[idx].schema);
                this.rows[idx].schema = data;
                this.rows[idx].formInvalid = !valid;
                if (valid) this.formInvalid = this.rows.some((r) => r.formInvalid);
            }
        },
        onManualTeamChange(idx, choiceIdx) {
            this.manualTeamIndices[idx] = choiceIdx;
            const choice = this.allTeamChoices[choiceIdx];
            this.setSlotTeam(idx, choice && choice.key !== 'none' ? Number(choice.key) : null);
        },
        setSlotTeam(idx, teamNumber) {
            if (this.slots[idx].teamNumber === teamNumber) return;
            this.slots[idx].teamNumber = teamNumber;
            this.rows[idx] = this.buildRow();
        },
        async syncMatchTeams() {
            // Starting a new match context — any leftover submit banner from
            // the previous match no longer applies.
            this.queuedOffline = false;
            this.submitSuccess = false;
            this.resetSuccess = false;
            this.formInvalid = false;

            const syncKey = `${this.matchType}|${this.matchNumber}|${this.manualEntry}`;
            if (syncKey === this.lastMatchSyncKey) return;
            this.lastMatchSyncKey = syncKey;

            // Practice matches aren't on any schedule, so their teams are
            // always entered by hand.
            if (this.manualEntry || !this.matchNumber || this.matchType === 'practice') {
                this.scheduleLookupFailed = false;
                this.slots.forEach((_, idx) => this.setSlotTeam(idx, null));
                this.manualTeamIndices = [0, 0, 0, 0, 0, 0];
                return;
            }

            const matchTeams = this.matchType === 'playoff'
                ? await queryPlayoffMatchTeams(this.eventStore.eventId, Number(this.matchNumber))
                : await queryMatchTeams(this.eventStore.eventId, Number(this.matchNumber));
            // The scout moved on (another match or type) while this was loading.
            if (syncKey !== this.lastMatchSyncKey) return;
            if (matchTeams) {
                this.scheduleLookupFailed = false;
                SLOT_DEFS.forEach((def, idx) => this.setSlotTeam(idx, matchTeams[def.key] ?? null));
            } else {
                this.scheduleLookupFailed = true;
                this.slots.forEach((_, idx) => this.setSlotTeam(idx, null));
                this.manualTeamIndices = [0, 0, 0, 0, 0, 0];
            }
        },
        onMatchNumberChange(value) {
            this.matchNumber = value;
            this.syncMatchTeams();
        },
        onMatchTypeChange(value) {
            if (this.matchType === value) return;
            this.matchType = value;
            this.syncMatchTeams();
        },
        onManualEntryChange(value) {
            this.manualEntry = value;
            this.syncMatchTeams();
        },
        async submitForm() {
            this.queuedOffline = false;
            this.submitSuccess = false;
            this.resetSuccess = false;
            this.formInvalid = false;
            this.isSubmitting = true;

            const toSubmit = [];
            let anyInvalid = false;

            this.rows.forEach((row, idx) => {
                if (!row.dirty || !row.included) return;

                const { data, valid } = validateForm(row.schema);
                row.schema = data;
                row.formInvalid = !valid;

                if (!valid) {
                    anyInvalid = true;
                    row.expanded = true;
                } else {
                    toSubmit.push(idx);
                }
            });

            if (anyInvalid) {
                this.formInvalid = true;
                this.isSubmitting = false;
                return;
            }

            let anyQueuedOffline = false;

            for (const idx of toSubmit) {
                const row = this.rows[idx];
                const slot = this.slots[idx];

                const dbData = parseScoutData(row.schema, this.eventStore.eventId);
                dbData.prematch_team_number = slot.teamNumber;
                dbData.prematch_match_number = this.matchNumber;
                dbData.prematch_alliance = slot.allianceColor === 'blue' ? 'Blue' : 'Red';
                // Qualification is the column's default, so it's only sent
                // for the other types.
                if (this.matchType !== defaultMatchType) dbData.prematch_match_type = this.matchType;

                const error = await submitScoutData(dbData, matchScoutTable);

                if (error) {
                    console.log(error);
                    this.queueStore.enqueue('scout_data', { table: matchScoutTable, data: dbData }, error.message ?? String(error));
                    anyQueuedOffline = true;
                }
            }

            this.advanceToNextMatch();

            this.queuedOffline = anyQueuedOffline;
            this.submitSuccess = !anyQueuedOffline;
            this.isSubmitting = false;
        },
        advanceToNextMatch() {
            this.matchNumber = this.matchNumber ? this.matchNumber + 1 : this.matchNumber;
            this.lastMatchSyncKey = null;
            this.syncMatchTeams();
        },
        resetMatch() {
            this.slots.forEach((_, idx) => { this.rows[idx] = this.buildRow(); });

            this.queuedOffline = false;
            this.formInvalid = false;
            this.submitSuccess = false;
            this.resetSuccess = true;
        }
    },
    computed: {
        showManualPicker() {
            return this.manualEntry || this.scheduleLookupFailed || this.matchType === 'practice';
        },
        matchNumberLabel() {
            if (this.matchType === 'practice') return 'Practice Match Number';
            if (this.matchType === 'playoff') return 'Playoff Match Number';
            return 'Match Number';
        },
        hasDirtyIncludedRow() {
            return this.rows.some((row) => row.dirty && row.included);
        }
    },
    created() {
        this.eventStore = useEventStore();
        this.queueStore = useOfflineQueueStore();
        this.watchlistStore = useWatchlistStore();
        this.loadScoutForm();

        this.eventStore.updateEvent().then(() => {
            this.watchlistStore.loadWatchlist(this.eventStore.eventId);
        });
    },
}
</script>

<style scoped>
.button-container {
    display: flex;
    justify-content: safe center;
    align-items: safe center;
    width: 100%;
}

md-filled-button {
    margin: 10px;
}

p {
    overflow-wrap: anywhere;
}

.error-tile {
    background-color: red;
    color: white;
}

.success-tile {
    background-color: green;
    color: white;
}

.notification-tile {
    background-color: rgb(88, 88, 232);
    color: white
}

/* Practice / Qualification / Playoff (issue #123). */
.match-type-toggle {
    display: inline-flex;
    margin-bottom: 14px;
    border-radius: 10px;
    overflow: hidden;
    border: 1.5px solid rgba(128, 128, 128, 0.35);
}

.match-type-option {
    background: transparent;
    border: none;
    padding: 10px 16px;
    min-height: 44px;
    font: inherit;
    font-weight: 600;
    color: var(--primary-text-color);
    cursor: pointer;
}

.match-type-option + .match-type-option {
    border-left: 1.5px solid rgba(128, 128, 128, 0.35);
}

.match-type-option--active {
    background: #b05703;
    color: #fff;
}

.match-type-hint {
    font-size: 0.85em;
    opacity: 0.75;
}

.match-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    justify-content: safe center;
}

.match-control {
    display: flex;
    align-items: center;
    gap: 8px;
}

.manual-assign-tile {
    text-align: left;
}

.manual-assign-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.manual-assign-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.manual-assign-label {
    font-size: 13px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 6px;
    min-width: 56px;
    text-align: center;
}

.manual-assign-label--red {
    background: rgba(255, 0, 0, 0.15);
    color: #d32f2f;
}

.manual-assign-label--blue {
    background: rgba(0, 0, 255, 0.15);
    color: #1a5fd3;
}

.match-rows {
    margin-top: 16px;
}
</style>
