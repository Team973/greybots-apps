<script setup lang="ts">
// @ts-nocheck

import CollapsibleSection from "@greybots/common/components/CollapsibleSection.vue";
import SearchableDropdown from "@greybots/common/components/SearchableDropdown.vue";

import { useEventStore } from "@/stores/event-store";
import { useAuthStore } from "@/stores/auth-store";
import { queryEventMatchSchedule, queryAllEvents } from "@/lib/data-query";
import { fetchAllUsers } from "@greybots/common/lib/user-roles";
import { queryScoutAssignments, queryScoutAssignmentsForUser, assignScout, assignScoutToSlots } from "@/lib/scout-assignment-query";
</script>

<template>
    <div class="main-content">
        <div class="page-header">
            <h1>Schedule</h1>
            <button type="button" class="refresh-button" @click="loadData" :disabled="!loaded">
                {{ loaded ? 'Refresh' : 'Loading…' }}
            </button>
        </div>

        <div v-if="!loaded" class="data-tile">
            <p>Loading your schedule…</p>
        </div>

        <template v-else>
            <div v-if="currentAssignments.length === 0" class="data-tile">
                <p>You don't have any scouting assignments yet for <strong>{{ eventStore.eventName }}</strong>.
                    A lead assigns scouts to matches from this page — check back once the schedule has
                    been set.</p>
                <p v-if="pastGroups.length > 0" class="hint">You do have assignments from a previous
                    event — see "Past Assignments" below.</p>
            </div>

            <div v-else class="schedule-table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Match</th>
                            <th>Alliance</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="assignment in currentAssignments" :key="`${assignment.match_number}|${assignment.alliance}${assignment.slot_index}`">
                            <td>Q{{ assignment.match_number }}</td>
                            <td :class="allianceClass(assignment.alliance)">
                                {{ allianceLabel(assignment.alliance) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <CollapsibleSection v-if="authStore?.isLead" title="Manage Scout Schedule">
                <p>Assign up to 3 scouts to each alliance per qualification match. Assignments are by
                    station, not by team, so they carry over automatically as the actual teams rotate
                    through matches. Drag the small square in a cell's corner across other cells to
                    copy that scout to all of them at once, like an Excel fill handle.</p>

                <div class="scout-legend" v-if="assignableUsers.length > 0">
                    <span v-for="person in assignableUsers" :key="person.user_id" class="scout-legend-item">
                        <span class="scout-legend-swatch" :style="{ backgroundColor: colorForUser(person.user_id) }"></span>
                        {{ person.name || 'Unnamed user' }}
                    </span>
                </div>

                <p v-if="qualMatches.length === 0">No qualification schedule loaded for this event yet.</p>

                <div v-else class="schedule-table-wrap">
                    <table class="assignment-table" :class="{ 'is-filling': fillDrag.active }">
                        <thead>
                            <tr>
                                <th>Match</th>
                                <th class="red-header" colspan="3">Red</th>
                                <th class="blue-header" colspan="3">Blue</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(match, rowIndex) in qualMatches" :key="match.key">
                                <td>Q{{ match.match_number }}</td>
                                <td v-for="(slotKey, colIndex) in slotKeys" :key="slotKey" class="assignment-cell"
                                    :class="[slotKey.startsWith('red') ? 'red-cell' : 'blue-cell', cellInFillRange(rowIndex, colIndex) ? 'fill-range' : '']"
                                    :data-row="rowIndex" :data-col="colIndex"
                                    @mouseover="onFillDragEnter(rowIndex, colIndex)">
                                    <SearchableDropdown class="assignment-select"
                                        :class="{ 'assignment-select--filled': !!adminScoutFor(match.match_number, slotKey) }"
                                        :style="scoutSelectStyle(adminScoutFor(match.match_number, slotKey))"
                                        :choices="scoutChoices" :model-value="adminScoutFor(match.match_number, slotKey)"
                                        @update:modelValue="onAdminAssignChange(match.match_number, slotKey, $event)">
                                    </SearchableDropdown>
                                    <div class="fill-handle" @mousedown="startFillDrag(rowIndex, colIndex, $event)"></div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-if="assignmentError" class="form-error">{{ assignmentError }}</p>
            </CollapsibleSection>

            <CollapsibleSection v-if="pastGroups.length > 0" title="Past Assignments"
                :default-open="currentAssignments.length === 0">
                <div v-for="group in pastGroups" :key="group.eventId" class="past-event-group">
                    <h2 class="past-event-title">{{ group.eventName }}</h2>
                    <div class="schedule-table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Match</th>
                                    <th>Alliance</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="assignment in group.assignments" :key="`${assignment.match_number}|${assignment.alliance}${assignment.slot_index}`">
                                    <td>Q{{ assignment.match_number }}</td>
                                    <td :class="allianceClass(assignment.alliance)">
                                        {{ allianceLabel(assignment.alliance) }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </CollapsibleSection>
        </template>
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
            currentAssignments: [],
            pastGroups: [],
            slotKeys: SLOT_KEYS,
            // Admin (lead/admin) scheduling state.
            people: [],
            // `${match_number}|${alliance}${slot_index}` -> scout_user_id
            assignedScoutByKey: {},
            assignmentError: "",
            // Excel-style fill-handle drag state for the admin grid.
            fillDrag: {
                active: false,
                startRow: -1,
                startCol: -1,
                endRow: -1,
                endCol: -1,
                sourceValue: ''
            }
        }
    },
    computed: {
        qualMatches() {
            return this.schedule.filter((m) => m.comp_level === 'qm');
        },
        assignableUsers() {
            return this.people
                .filter((person) => person.role !== 'observer')
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        },
        // Includes the "Unassigned" option as a real choice (key '', matching
        // adminScoutFor's empty-string default) rather than a placeholder, so
        // it displays and searches like any other choice.
        scoutChoices() {
            return [
                { key: '', text: 'Unassigned' },
                ...this.assignableUsers.map((person) => ({ key: person.user_id, text: person.name || 'Unnamed user' }))
            ];
        }
    },
    methods: {
        allianceLabel(alliance) {
            if (alliance === 'red') return 'Red';
            if (alliance === 'blue') return 'Blue';
            return '—';
        },
        allianceClass(alliance) {
            if (alliance === 'red') return 'red-cell';
            if (alliance === 'blue') return 'blue-cell';
            return '';
        },
        sortAssignments(assignments) {
            return [...assignments].sort((a, b) => a.match_number - b.match_number);
        },
        adminScoutFor(matchNumber, slotKey) {
            return this.assignedScoutByKey[`${matchNumber}|${slotKey}`] || '';
        },
        // Deterministic per-scout color (same user always gets the same
        // hue) so a lead can spot who's assigned where at a glance. Spread
        // evenly around the full ROYGBIV wheel by position in the sorted
        // roster, rather than hashing, so neighboring scouts in a small
        // team don't end up with two hard-to-tell-apart hues.
        colorForUser(userId) {
            const index = this.assignableUsers.findIndex((person) => person.user_id === userId);
            const count = this.assignableUsers.length || 1;
            const hue = index >= 0 ? Math.round((index / count) * 360) : 0;
            return `hsl(${hue}, 45%, 28%)`;
        },
        scoutSelectStyle(scoutUserId) {
            if (!scoutUserId) return {};
            return { backgroundColor: this.colorForUser(scoutUserId), color: '#fff' };
        },
        async onAdminAssignChange(matchNumber, slotKey, newScoutUserId) {
            this.assignmentError = "";
            const key = `${matchNumber}|${slotKey}`;
            const previousScoutUserId = this.assignedScoutByKey[key] || '';
            this.assignedScoutByKey[key] = newScoutUserId || null;

            const alliance = slotKey.slice(0, -1);
            const slotIndex = parseInt(slotKey.slice(-1), 10);

            const error = await assignScout(this.eventStore.eventId, matchNumber, alliance, slotIndex, newScoutUserId || null);

            if (error) {
                this.assignmentError = error.message ?? 'Unable to save scout assignment.';
                this.assignedScoutByKey[key] = previousScoutUserId;
            }
        },
        cellInFillRange(rowIndex, colIndex) {
            if (!this.fillDrag.active) return false;
            const minRow = Math.min(this.fillDrag.startRow, this.fillDrag.endRow);
            const maxRow = Math.max(this.fillDrag.startRow, this.fillDrag.endRow);
            const minCol = Math.min(this.fillDrag.startCol, this.fillDrag.endCol);
            const maxCol = Math.max(this.fillDrag.startCol, this.fillDrag.endCol);
            return rowIndex >= minRow && rowIndex <= maxRow && colIndex >= minCol && colIndex <= maxCol;
        },
        startFillDrag(rowIndex, colIndex, event) {
            event.preventDefault();
            const match = this.qualMatches[rowIndex];
            const slotKey = this.slotKeys[colIndex];

            this.fillDrag = {
                active: true,
                startRow: rowIndex,
                startCol: colIndex,
                endRow: rowIndex,
                endCol: colIndex,
                sourceValue: this.adminScoutFor(match.match_number, slotKey)
            };

            window.addEventListener('mouseup', this.endFillDrag);
            window.addEventListener('mousemove', this.onFillDragMove);
        },
        onFillDragEnter(rowIndex, colIndex) {
            if (!this.fillDrag.active) return;
            this.fillDrag.endRow = rowIndex;
            this.fillDrag.endCol = colIndex;
        },
        // Belt-and-suspenders alongside the per-cell @mouseover: follows the
        // cursor directly so a fast drag can't skip a cell and leave the
        // fill range stuck short of where the mouse actually is.
        onFillDragMove(event) {
            if (!this.fillDrag.active) return;
            const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('td.assignment-cell');
            if (!cell) return;
            this.fillDrag.endRow = parseInt(cell.dataset.row, 10);
            this.fillDrag.endCol = parseInt(cell.dataset.col, 10);
        },
        async endFillDrag() {
            if (!this.fillDrag.active) return;
            window.removeEventListener('mouseup', this.endFillDrag);
            window.removeEventListener('mousemove', this.onFillDragMove);

            const { startRow, startCol, endRow, endCol, sourceValue } = this.fillDrag;
            this.fillDrag.active = false;

            const minRow = Math.min(startRow, endRow);
            const maxRow = Math.max(startRow, endRow);
            const minCol = Math.min(startCol, endCol);
            const maxCol = Math.max(startCol, endCol);

            // A plain click with no drag — nothing to copy.
            if (minRow === maxRow && minCol === maxCol) return;

            const targets = [];
            for (let row = minRow; row <= maxRow; row++) {
                for (let col = minCol; col <= maxCol; col++) {
                    if (row === startRow && col === startCol) continue;
                    targets.push({ matchNumber: this.qualMatches[row].match_number, slotKey: this.slotKeys[col] });
                }
            }

            this.assignmentError = "";
            targets.forEach(({ matchNumber, slotKey }) => {
                this.assignedScoutByKey[`${matchNumber}|${slotKey}`] = sourceValue || null;
            });

            const error = await assignScoutToSlots(
                this.eventStore.eventId,
                targets.map(({ matchNumber, slotKey }) => ({
                    matchNumber,
                    alliance: slotKey.slice(0, -1),
                    slotIndex: parseInt(slotKey.slice(-1), 10)
                })),
                sourceValue || null
            );

            if (error) {
                this.assignmentError = error.message ?? `Unable to save ${targets.length} scout assignment(s).`;
                // Reload the grid from the server so the failed optimistic
                // update doesn't leave stale values on screen.
                this.loadData();
            }
        },
        async loadData() {
            this.loaded = false;

            await this.eventStore.updateEvent();
            const currentEventId = this.eventStore.eventId;
            const myUserId = this.authStore.currentUserId;

            const [schedule, allAssignments, events] = await Promise.all([
                queryEventMatchSchedule(currentEventId),
                queryScoutAssignmentsForUser(myUserId),
                queryAllEvents()
            ]);

            this.schedule = schedule;

            this.currentAssignments = this.sortAssignments(
                allAssignments.filter((assignment) => assignment.event_id === currentEventId)
            );

            // Group any assignments from other events by event, so a scout
            // can still find them even after the app's active event moves on.
            const pastAssignmentsByEvent = {};
            allAssignments
                .filter((assignment) => assignment.event_id !== currentEventId)
                .forEach((assignment) => {
                    if (!pastAssignmentsByEvent[assignment.event_id]) pastAssignmentsByEvent[assignment.event_id] = [];
                    pastAssignmentsByEvent[assignment.event_id].push(assignment);
                });

            // `events` is already ordered newest-first, so filtering it keeps
            // the past groups in that same order.
            this.pastGroups = events
                .filter((event) => pastAssignmentsByEvent[event.event_id])
                .map((event) => ({
                    eventId: event.event_id,
                    eventName: event.name,
                    assignments: this.sortAssignments(pastAssignmentsByEvent[event.event_id])
                }));

            if (this.authStore.isLead) {
                const [people, eventAssignments] = await Promise.all([
                    fetchAllUsers().catch(() => []),
                    queryScoutAssignments(currentEventId)
                ]);

                this.people = people;

                this.assignedScoutByKey = {};
                eventAssignments.forEach((row) => {
                    this.assignedScoutByKey[`${row.match_number}|${row.alliance}${row.slot_index}`] = row.scout_user_id;
                });
            }

            this.loaded = true;
        }
    },
    created() {
        this.eventStore = useEventStore();
        this.authStore = useAuthStore();
        this.authStore.checkUser().then(() => this.loadData());
    },
    beforeUnmount() {
        window.removeEventListener('mouseup', this.endFillDrag);
        window.removeEventListener('mousemove', this.onFillDragMove);
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

.schedule-table-wrap {
    overflow-x: auto;
    max-width: 100%;
}

.red-cell {
    background-color: rgba(224, 0, 0, 0.15);
}

.blue-cell {
    background-color: rgba(0, 0, 224, 0.15);
}

.red-header {
    background-color: rgba(224, 0, 0, 0.15);
}

.blue-header {
    background-color: rgba(0, 0, 224, 0.15);
}

.hint {
    font-size: 0.9em;
    opacity: 0.8;
}

.past-event-group {
    margin-bottom: 20px;
}

.past-event-group:last-child {
    margin-bottom: 0;
}

.past-event-title {
    font-size: 1.1em;
    margin: 0 0 8px;
}

.scout-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 12px;
}

.scout-legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9em;
}

.scout-legend-swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex-shrink: 0;
}

/* scoutSelectStyle() sets this wrapper's background inline (falls through to
   the SearchableDropdown component's root element); the input itself stays
   transparent (see SearchableDropdown.vue) so that color shows through. */
.assignment-select {
    display: block;
    border-radius: 6px;
}

.assignment-select :deep(.searchable-dropdown-input) {
    padding: 10px 8px;
    font-size: 1rem;
}

/* When a scout is assigned, scoutSelectStyle() also sets white text — the
   input's own explicit `color` declaration would otherwise win over the
   inherited color from this wrapper. */
.assignment-select--filled :deep(.searchable-dropdown-input) {
    color: #fff;
}

.assignment-cell {
    position: relative;
}

.assignment-table.is-filling {
    user-select: none;
}

.fill-handle {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 9px;
    height: 9px;
    background-color: var(--md-sys-color-primary);
    border: 1px solid var(--tile-background-color);
    border-radius: 1px;
    cursor: crosshair;
    opacity: 0;
}

.assignment-cell:hover .fill-handle {
    opacity: 1;
}

.fill-range {
    outline: 2px dashed var(--md-sys-color-primary);
    outline-offset: -2px;
}

.form-error {
    color: #c0392b;
}
</style>
