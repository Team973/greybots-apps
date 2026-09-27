<script setup lang="ts">
// @ts-nocheck
import PreScoutForm from "@/components/PreScoutForm.vue";
import TextAreaInput from "@greybots/common/components/TextAreaInput.vue";

import { useEventStore } from "@/stores/event-store";
import { useAuthStore } from "@/stores/auth-store";
import { useOfflineQueueStore } from "@/stores/offline-queue-store";
import { fetchTeamPreScoutData, fetchTeamPreScoutComments } from "@/lib/prescout-query";
import { submitScoutData, updateScoutData } from "@/lib/data-submission";
import { preScoutCommentTable } from "@/lib/constants";

import "@material/web/button/filled-button";
</script>

<template>
    <div class="prescout-section">
        <h1>Pre-Scouting</h1>

        <PreScoutForm v-if="prescoutFormMode !== 'view'" :team-number="teamNumber"
            :pre-scout-data-id="prescoutFormMode === 'edit' ? teamPrescoutData?.id : null" @saved="onPrescoutFormSaved"
            @cancel="onPrescoutFormCancel">
        </PreScoutForm>

        <template v-else>
            <div v-if="prescoutSaveMessage" class="data-tile notification-tile prescout-save-message">{{ prescoutSaveMessage }}</div>

            <div v-if="!teamPrescoutDataLoaded">Loading pre-scouting data…</div>
            <div v-else-if="!teamPrescoutData" class="no-comments">
                <p>No pre-scouting data yet.</p>
                <md-filled-button v-if="isUserWriteAccess" v-on:click="startAddPrescout">Pre-Scout This
                    Team</md-filled-button>
            </div>
            <template v-else>
                <div class="prescout-actions" v-if="isUserWriteAccess">
                    <md-filled-button v-on:click="startEditPrescout">Edit</md-filled-button>
                </div>
                <div class="prescout-card">
                    <div class="prescout-stats-grid">
                        <div class="prescout-stat">
                            <div class="prescout-stat-label">Pre-Event EPA</div>
                            <div class="prescout-stat-value">{{ teamPrescoutData.epa ?? '—' }}</div>
                        </div>
                        <div class="prescout-stat">
                            <div class="prescout-stat-label">Archetype</div>
                            <div class="prescout-stat-value">{{ formatArchetype(teamPrescoutData.archetype) }}</div>
                        </div>
                        <div class="prescout-stat">
                            <div class="prescout-stat-label">Scoring Tier</div>
                            <div class="prescout-stat-value">{{ teamPrescoutData.scoringTier ?? '—' }}</div>
                        </div>
                        <div class="prescout-stat">
                            <div class="prescout-stat-label">Driving Tier</div>
                            <div class="prescout-stat-value">{{ teamPrescoutData.drivingTier ?? '—' }}</div>
                        </div>
                        <div class="prescout-stat">
                            <div class="prescout-stat-label">Defense Tier</div>
                            <div class="prescout-stat-value">{{ teamPrescoutData.defenseTier ?? '—' }}</div>
                        </div>
                    </div>
                    <div class="prescout-author">Scouted by {{ teamPrescoutData.author }}</div>
                </div>
            </template>

            <div class="prescout-comments-section">
                <h2>Notes</h2>

                <div v-if="!teamPrescoutCommentsLoaded">Loading notes…</div>
                <template v-else>
                    <ul v-if="teamPrescoutComments.length > 0" class="prescout-comment-list">
                        <li v-for="entry in teamPrescoutComments" :key="entry.id" class="prescout-comment-card">
                            <p class="prescout-comments">{{ entry.comment }}</p>
                            <div class="prescout-author">{{ entry.author }}</div>
                        </li>
                    </ul>
                    <p v-else class="no-comments">No notes yet.</p>

                    <div v-if="isUserWriteAccess && commentMode === 'view'" class="prescout-actions">
                        <md-filled-button v-on:click="startEditMyComment">{{ myComment ? 'Edit My Note' : 'Add My Note' }}</md-filled-button>
                    </div>

                    <div v-else-if="isUserWriteAccess" class="prescout-comment-form">
                        <TextAreaInput v-model="commentDraft" label="My note" :rows="4"></TextAreaInput>
                        <div v-if="commentError" class="data-tile error-tile">{{ commentError }}</div>
                        <div class="button-container">
                            <md-filled-button v-on:click="cancelCommentEdit" class="cancel-button" :disabled="commentSubmitting">CANCEL</md-filled-button>
                            <md-filled-button v-on:click="saveComment" :disabled="commentSubmitting">SAVE</md-filled-button>
                        </div>
                    </div>
                </template>
            </div>
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
        // Auto-opens the edit form for this team's pre-scouting data once
        // loaded — used by Data Status's lead-only edit shortcut (issue
        // #51, mirroring PitScoutingSection.vue's autoEdit from #31).
        autoEdit: {
            type: Boolean,
            default: false
        }
    },
    data() {
        return {
            eventStore: null,
            authStore: null,
            queueStore: null,
            teamPrescoutData: null,
            teamPrescoutDataLoaded: false,
            prescoutFormMode: 'view',
            prescoutSaveMessage: '',
            prescoutSaveMessageTimeout: null,
            teamPrescoutComments: [],
            teamPrescoutCommentsLoaded: false,
            commentMode: 'view',
            commentDraft: '',
            commentSubmitting: false,
            commentError: ''
        }
    },
    methods: {
        async loadTeamPrescoutData() {
            if (this.teamNumber < 0) {
                this.teamPrescoutData = null;
                this.teamPrescoutDataLoaded = true;
                return;
            }

            this.teamPrescoutDataLoaded = false;
            this.teamPrescoutData = await fetchTeamPreScoutData(this.teamNumber, this.eventStore.eventId);
            this.teamPrescoutDataLoaded = true;

            if (this.autoEdit && this.teamPrescoutData && this.isUserWriteAccess) {
                this.startEditPrescout();
            }
        },
        async loadTeamPrescoutComments() {
            if (this.teamNumber < 0) {
                this.teamPrescoutComments = [];
                this.teamPrescoutCommentsLoaded = true;
                return;
            }

            this.teamPrescoutCommentsLoaded = false;
            this.teamPrescoutComments = await fetchTeamPreScoutComments(this.teamNumber, this.eventStore.eventId);
            this.teamPrescoutCommentsLoaded = true;
        },
        startAddPrescout() {
            this.prescoutFormMode = 'add';
        },
        startEditPrescout() {
            this.prescoutFormMode = 'edit';
        },
        onPrescoutFormCancel() {
            // Reached via Data Status's edit shortcut — cancelling returns
            // there rather than falling back to this team's view mode.
            if (this.autoEdit) {
                this.$router.push('/data-status');
                return;
            }
            this.prescoutFormMode = 'view';
        },
        async onPrescoutFormSaved({ queuedOffline }: { queuedOffline: boolean }) {
            if (this.autoEdit) {
                this.$router.push('/data-status');
                return;
            }

            this.prescoutFormMode = 'view';
            this.showSaveMessage(queuedOffline);
            await this.loadTeamPrescoutData();
        },
        startEditMyComment() {
            this.commentDraft = this.myComment?.comment ?? '';
            this.commentError = '';
            this.commentMode = 'edit';
        },
        cancelCommentEdit() {
            this.commentMode = 'view';
            this.commentDraft = '';
            this.commentError = '';
        },
        async saveComment() {
            const comment = this.commentDraft.trim();
            if (!comment) {
                this.commentError = 'Note cannot be empty.';
                return;
            }

            this.commentSubmitting = true;
            this.commentError = '';

            const existing = this.myComment;
            const data = existing
                ? { comment }
                : { comment, event: this.eventStore.eventId, prescout_team_number: this.teamNumber };

            const error = existing
                ? await updateScoutData(existing.id, data, preScoutCommentTable)
                : await submitScoutData(data, preScoutCommentTable);

            if (error) {
                console.log(error);
                this.queueStore.enqueue(
                    'scout_data',
                    { table: preScoutCommentTable, data, id: existing?.id ?? null },
                    error.message ?? String(error)
                );

                this.commentSubmitting = false;
                this.commentMode = 'view';
                this.showSaveMessage(true);
                return;
            }

            this.commentSubmitting = false;
            this.commentMode = 'view';
            this.showSaveMessage(false);
            await this.loadTeamPrescoutComments();
        },
        showSaveMessage(queuedOffline: boolean) {
            if (this.prescoutSaveMessageTimeout) {
                clearTimeout(this.prescoutSaveMessageTimeout);
            }
            this.prescoutSaveMessage = queuedOffline ? "Couldn't save — queued for sync." : "Saved!";
            this.prescoutSaveMessageTimeout = setTimeout(() => {
                this.prescoutSaveMessage = '';
            }, 4000);
        },
        formatArchetype(key) {
            const labels = { turret: 'Turret', dumper: 'Dumper', defense: 'Defense' };
            return labels[key] ?? key ?? '—';
        }
    },
    computed: {
        isUserWriteAccess() {
            return this.authStore.isWriteAuthorized;
        },
        myComment() {
            return this.teamPrescoutComments.find(c => c.scoutedBy === this.authStore.currentUserId) ?? null;
        }
    },
    watch: {
        teamNumber() {
            this.prescoutFormMode = 'view';
            this.commentMode = 'view';
            this.loadTeamPrescoutData();
            this.loadTeamPrescoutComments();
        }
    },
    created() {
        this.eventStore = useEventStore();
        this.authStore = useAuthStore();
        this.queueStore = useOfflineQueueStore();
        this.authStore.checkUser();
        this.loadTeamPrescoutData();
        this.loadTeamPrescoutComments();
    }
}
</script>

<style scoped>
.prescout-section {
    margin-top: 24px;
}

.prescout-actions {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
}

.prescout-save-message {
    margin-bottom: 14px;
}

.prescout-comments-section {
    margin-top: 24px;
}

.prescout-comment-list {
    list-style: none;
    padding: 0;
    margin: 0 0 10px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.prescout-comment-card {
    background: var(--tile-background-color);
    border: 1px solid rgba(128, 128, 128, 0.2);
    border-radius: 10px;
    padding: 12px 14px;
}

.prescout-comment-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.prescout-card {
    background: var(--tile-background-color);
    border: 1px solid rgba(128, 128, 128, 0.2);
    border-radius: 10px;
    padding: 12px 14px;
}

.prescout-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
}

.prescout-stat-label {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.75);
    margin-bottom: 2px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.prescout-stat-value {
    font-size: 15px;
    font-weight: 700;
    color: var(--primary-text-color);
}

.prescout-comments {
    margin-top: 0;
    font-size: 13px;
    color: var(--primary-text-color);
    line-height: 1.5;
    white-space: pre-wrap;
}

.prescout-author {
    margin-top: 10px;
    font-size: 11px;
    color: rgba(128, 128, 128, 0.6);
}

.no-comments {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.7);
    font-style: italic;
}

.button-container {
    display: flex;
    justify-content: safe center;
    align-items: safe center;
    width: 100%;
}

md-filled-button.cancel-button {
    --md-filled-button-container-color: rgba(128, 128, 128, 0.4);
}
</style>
