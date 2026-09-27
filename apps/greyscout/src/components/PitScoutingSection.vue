<script setup lang="ts">
// @ts-nocheck
import PitScoutingForm from "@/components/PitScoutingForm.vue";

import { useEventStore } from "@/stores/event-store";
import { useAuthStore } from "@/stores/auth-store";
import { fetchTeamPitData } from "@/lib/picklist-query";

import "@material/web/button/filled-button";
</script>

<template>
    <div class="pit-section">
        <h1>Pit Scouting</h1>

        <PitScoutingForm v-if="pitFormMode !== 'view'" :team-number="teamNumber"
            :pit-data-id="pitFormMode === 'edit' ? pitFormEditId : null" @saved="onPitFormSaved"
            @cancel="onPitFormCancel">
        </PitScoutingForm>

        <template v-else>
            <div v-if="pitSaveMessage" class="data-tile notification-tile pit-save-message">{{ pitSaveMessage }}</div>

            <div v-if="!teamPitDataLoaded">Loading pit scouting data…</div>
            <div v-else-if="teamPitData.length === 0" class="no-comments">
                <p>No pit scouting data yet.</p>
                <md-filled-button v-if="isUserWriteAccess" v-on:click="startAddPit">Pit Scout This
                    Team</md-filled-button>
            </div>
            <template v-else>
                <div class="pit-actions" v-if="isUserWriteAccess">
                    <md-filled-button v-on:click="startEditPit(teamPitData[0].id)">Edit</md-filled-button>
                </div>
                <ul class="pit-list">
                    <li v-for="(pit, idx) in teamPitData" :key="idx" class="pit-card">
                        <div class="pit-stats-grid">
                            <div class="pit-stat">
                                <div class="pit-stat-label">Drivetrain</div>
                                <div class="pit-stat-value">{{ formatDrivetrain(pit.drivetrain) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Drive Motor</div>
                                <div class="pit-stat-value">{{ formatMotorType(pit.driveMotorType) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Dimensions</div>
                                <div class="pit-stat-value">{{ formatDimensions(pit.length, pit.width) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Weight</div>
                                <div class="pit-stat-value">{{ pit.weight != null ? pit.weight + ' lbs' : '—' }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Archetype</div>
                                <div class="pit-stat-value">{{ formatArchetype(pit.archetype) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Language</div>
                                <div class="pit-stat-value">{{ formatLanguage(pit.language) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Batteries</div>
                                <div class="pit-stat-value">{{ pit.numBatteries ?? '—' }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Chargers</div>
                                <div class="pit-stat-value">{{ pit.numChargers ?? '—' }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Traverse</div>
                                <div class="pit-stat-value">{{ formatTraverse(pit) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Outpost Fuel</div>
                                <div class="pit-stat-value">{{ formatBool(pit.outpostFuel) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Shoot From</div>
                                <div class="pit-stat-value">{{ formatShootLocations(pit) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Climb</div>
                                <div class="pit-stat-value">{{ formatClimb(pit.climb) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Climb in Auto</div>
                                <div class="pit-stat-value">{{ formatBool(pit.climbAuto) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Auto Strategy</div>
                                <div class="pit-stat-value">{{ pit.autoStrategy || '—' }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Balls Per Second</div>
                                <div class="pit-stat-value">{{ pit.cycleRate != null ? pit.cycleRate + '/s' : '—' }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Defense</div>
                                <div class="pit-stat-value">{{ formatBool(pit.defense) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">New Driver</div>
                                <div class="pit-stat-value">{{ formatBool(pit.driverNew) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">System Check</div>
                                <div class="pit-stat-value">{{ formatSystemCheck(pit.systemCheck) }}</div>
                            </div>
                            <div class="pit-stat">
                                <div class="pit-stat-label">Vibe Check</div>
                                <div class="pit-stat-value">{{ pit.vibe_check != null ? pit.vibe_check + ' / 5' : '—' }}</div>
                            </div>
                        </div>
                        <div class="pit-author">Scouted by {{ pit.author }}</div>
                    </li>
                </ul>
            </template>
        </template>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        teamNumber: {
            type: Number,
            required: true
        },
        // Auto-opens the edit form for this team's newest pit submission
        // once loaded — used by Data Status's lead-only edit shortcut
        // (issue #31).
        autoEdit: {
            type: Boolean,
            default: false
        }
    },
    data() {
        return {
            eventStore: null,
            authStore: null,
            teamPitData: [],
            teamPitDataLoaded: false,
            pitFormMode: 'view',
            pitFormEditId: null,
            pitSaveMessage: '',
            pitSaveMessageTimeout: null
        }
    },
    methods: {
        async loadTeamPitData() {
            if (this.teamNumber < 0) {
                this.teamPitData = [];
                this.teamPitDataLoaded = true;
                return;
            }

            this.teamPitDataLoaded = false;
            this.teamPitData = await fetchTeamPitData(this.teamNumber, this.eventStore.eventId);
            this.teamPitDataLoaded = true;

            if (this.autoEdit && this.teamPitData.length > 0 && this.isUserWriteAccess) {
                this.startEditPit(this.teamPitData[0].id);
            }
        },
        startAddPit() {
            this.pitFormMode = 'add';
            this.pitFormEditId = null;
        },
        startEditPit(id: number) {
            this.pitFormMode = 'edit';
            this.pitFormEditId = id;
        },
        onPitFormCancel() {
            // Reached via Data Status's edit shortcut (issue #31) — cancelling
            // returns there rather than falling back to this team's view mode.
            if (this.autoEdit) {
                this.$router.push('/data-status');
                return;
            }
            this.pitFormMode = 'view';
            this.pitFormEditId = null;
        },
        async onPitFormSaved({ queuedOffline }: { queuedOffline: boolean }) {
            if (this.autoEdit) {
                this.$router.push('/data-status');
                return;
            }

            this.pitFormMode = 'view';
            this.pitFormEditId = null;

            if (this.pitSaveMessageTimeout) {
                clearTimeout(this.pitSaveMessageTimeout);
            }
            this.pitSaveMessage = queuedOffline ? "Couldn't save — queued for sync." : "Saved!";
            this.pitSaveMessageTimeout = setTimeout(() => {
                this.pitSaveMessage = '';
            }, 4000);

            await this.loadTeamPitData();
        },
        formatDrivetrain(key) {
            const labels = { swerve: 'Swerve', not_swerve: 'Not Swerve' };
            return labels[key] ?? key ?? '—';
        },
        formatMotorType(key) {
            const labels = { kraken: 'Kraken', falcon: 'Falcon', neo: 'NEO', other: 'Other' };
            return labels[key] ?? key ?? '—';
        },
        formatArchetype(key) {
            const labels = { dumper_fixed: 'Dumper/Fixed', turret: 'Turret' };
            return labels[key] ?? key ?? '—';
        },
        formatClimb(key) {
            const labels = { no_climb: 'No Climb', l1: 'L1', l2: 'L2', l3: 'L3' };
            return labels[key] ?? key ?? '—';
        },
        formatLanguage(key) {
            const labels = { java: 'Java', cpp: 'C++', python: 'Python', other: 'Other' };
            return labels[key] ?? key ?? '—';
        },
        formatSystemCheck(key) {
            const labels = {
                before_every_match: 'Before Every Match',
                before_most_matches: 'Before Most Matches',
                sometimes_before_match: 'Sometimes Before a Match',
                once_or_twice: 'Once or Twice',
                never: 'Never'
            };
            return labels[key] ?? key ?? '—';
        },
        formatDimensions(length, width) {
            if (length == null || width == null) return '—';
            return `${length}" x ${width}"`;
        },
        formatBool(value) {
            if (value == null) return '—';
            return value ? 'Yes' : 'No';
        },
        formatTraverse(pit) {
            const parts = [];
            if (pit.traverseBump) parts.push('Bump');
            if (pit.traverseTrench) parts.push('Trench');
            return parts.length > 0 ? parts.join(', ') : 'None';
        },
        formatShootLocations(pit) {
            const parts = [];
            if (pit.shootClose) parts.push('Close');
            if (pit.shootTower) parts.push('Tower');
            if (pit.shootCorner) parts.push('Corner');
            if (pit.shootTrench) parts.push('Trench');
            return parts.length > 0 ? parts.join(', ') : 'None';
        }
    },
    computed: {
        isUserWriteAccess() {
            return this.authStore.isWriteAuthorized;
        }
    },
    watch: {
        teamNumber() {
            this.pitFormMode = 'view';
            this.pitFormEditId = null;
            this.loadTeamPitData();
        }
    },
    created() {
        this.eventStore = useEventStore();
        this.authStore = useAuthStore();
        this.authStore.checkUser();
        this.loadTeamPitData();
    }
}
</script>

<style scoped>
.pit-section {
    margin-top: 24px;
}

.pit-actions {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
}

.pit-save-message {
    margin-bottom: 14px;
}

.pit-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.pit-card {
    background: var(--tile-background-color);
    border: 1px solid rgba(128, 128, 128, 0.2);
    border-radius: 10px;
    padding: 12px 14px;
}

.pit-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
}

.pit-stat-label {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.75);
    margin-bottom: 2px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.pit-stat-value {
    font-size: 15px;
    font-weight: 700;
    color: var(--primary-text-color);
}

.pit-author {
    margin-top: 10px;
    font-size: 11px;
    color: rgba(128, 128, 128, 0.6);
}

.no-comments {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.7);
    font-style: italic;
}
</style>
