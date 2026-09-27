<script setup lang="ts">
// @ts-nocheck
import AutoPathCanvas from "@/components/AutoPathCanvas.vue";
import AutoPathTimeline from "@/components/AutoPathTimeline.vue";
import TextInput from "@greybots/common/components/TextInput.vue";
import Dropdown from "@greybots/common/components/Dropdown.vue";
import FullscreenTile from "@greybots/common/components/FullscreenTile.vue";

import { autoPathTable, allianceRed, sideLeft } from "@/lib/constants";
import { ALLIANCE_CHOICES, SIDE_CHOICES } from "@/lib/2026/auto-path-field";
import { submitScoutData, updateScoutData } from "@/lib/data-submission";
import { fetchAutoPathById, deleteAutoPath } from "@/lib/auto-path-query";
import { fetchRobotPhotoUrl } from "@/lib/robot-photo-query";
import { useEventStore } from "@/stores/event-store";
import { useOfflineQueueStore } from "@/stores/offline-queue-store";

import "@material/web/button/filled-button";
</script>

<template>
    <div class="autopath-editor">
        <div v-if="!loaded">Loading…</div>
        <FullscreenTile v-else>
            <div class="autopath-form-row">
                <TextInput v-model="name" label="Path Name" :required="true" :error="nameError"></TextInput>
            </div>

            <div class="autopath-form-row autopath-selectors">
                <div class="autopath-selector">
                    <label>Alliance</label>
                    <Dropdown :choices="ALLIANCE_CHOICES" v-model="allianceIndex"></Dropdown>
                </div>
                <div class="autopath-selector">
                    <label>Side</label>
                    <Dropdown :choices="SIDE_CHOICES" v-model="sideIndex"></Dropdown>
                </div>
            </div>

            <AutoPathCanvas :points="points" :display-alliance="alliance" editable="true" large="true"
                time-gradient="true" :playing="isPlaying" :preview-progress="canvasPreviewProgress"
                :robot-photo-url="robotPhotoUrl" @update:points="onPointsUpdate" @finished="isPlaying = false"
                @progress="scrubProgress = $event"></AutoPathCanvas>

            <div class="autopath-preview-controls" v-if="points.length > 1">
                <md-filled-button v-on:click="togglePlay" class="play-button">
                    {{ isPlaying ? "■ STOP" : "▶ PLAY" }}
                </md-filled-button>
            </div>

            <AutoPathTimeline v-if="points.length > 2" :points="points" :disabled="isPlaying"
                v-model:scrub-progress="scrubProgress" @update:points="onPointsUpdate"></AutoPathTimeline>

            <div v-if="pathError" class="data-tile error-tile">Draw at least a couple of points before saving.</div>

            <div class="autopath-actions">
                <md-filled-button v-on:click="resetPath" class="reset-button">RESET</md-filled-button>
                <md-filled-button v-if="autoPathId != null && !confirmingDelete" v-on:click="confirmingDelete = true"
                    class="delete-button">DELETE</md-filled-button>
                <template v-if="confirmingDelete">
                    <span class="confirm-text">Delete this path?</span>
                    <md-filled-button v-on:click="confirmingDelete = false" class="cancel-button">NO</md-filled-button>
                    <md-filled-button v-on:click="doDelete" class="delete-button">YES, DELETE</md-filled-button>
                </template>
            </div>

            <div class="autopath-actions" v-if="!isSubmitting">
                <md-filled-button v-on:click="cancel" class="cancel-button">CANCEL</md-filled-button>
                <md-filled-button v-on:click="save" class="submit-button">SAVE</md-filled-button>
            </div>
        </FullscreenTile>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        teamNumber: {
            type: Number,
            required: true
        },
        autoPathId: {
            type: Number,
            default: null
        }
    },
    emits: ["saved", "deleted", "cancel"],
    data() {
        return {
            eventStore: null,
            queueStore: null,
            loaded: false,
            name: "",
            allianceIndex: 0,
            sideIndex: 0,
            points: [],
            scrubProgress: 0,
            isPlaying: false,
            autoPlayTimer: null,
            robotPhotoUrl: null,
            nameError: false,
            pathError: false,
            isSubmitting: false,
            confirmingDelete: false,
            ALLIANCE_CHOICES,
            SIDE_CHOICES
        };
    },
    computed: {
        alliance() {
            return this.ALLIANCE_CHOICES[this.allianceIndex]?.key ?? allianceRed;
        },
        side() {
            return this.SIDE_CHOICES[this.sideIndex]?.key ?? sideLeft;
        },
        // The scrub thumb only drives the marker while nothing is playing —
        // otherwise it would permanently pin the marker at the scrub
        // position (AutoPathCanvas treats any non-null previewProgress as
        // taking priority over the play animation).
        canvasPreviewProgress() {
            return this.isPlaying ? null : this.scrubProgress;
        }
    },
    watch: {
        // Auto-play a short idle period after the most recent point is
        // drawn — there's no explicit "done drawing" signal in the data
        // model (pointer-up is deliberately just a pause, not completion,
        // per the continuous-path drawing design), so idle time after the
        // last edit is the practical stand-in for "fully drawn." Only
        // reschedules when points actually change, so it won't re-fire just
        // because the scout manually stopped playback while idle.
        points() {
            clearTimeout(this.autoPlayTimer);
            if (this.points.length > 1) {
                this.autoPlayTimer = setTimeout(() => {
                    if (!this.isPlaying) this.isPlaying = true;
                }, 1200);
            }
        }
    },
    beforeUnmount() {
        clearTimeout(this.autoPlayTimer);
    },
    methods: {
        async load() {
            this.loaded = false;

            if (this.autoPathId != null) {
                const existing = await fetchAutoPathById(this.autoPathId);
                if (existing) {
                    this.name = existing.name ?? "";
                    this.allianceIndex = ALLIANCE_CHOICES.findIndex((c) => c.key === existing.alliance);
                    if (this.allianceIndex < 0) this.allianceIndex = 0;
                    this.sideIndex = SIDE_CHOICES.findIndex((c) => c.key === existing.side);
                    if (this.sideIndex < 0) this.sideIndex = 0;
                    this.points = existing.path ?? [];
                }
            }

            this.robotPhotoUrl = await fetchRobotPhotoUrl(this.teamNumber);
            this.loaded = true;
        },
        onPointsUpdate(newPoints) {
            this.points = newPoints;
        },
        resetPath() {
            clearTimeout(this.autoPlayTimer);
            this.points = [];
            this.scrubProgress = 0;
            this.isPlaying = false;
        },
        togglePlay() {
            this.isPlaying = !this.isPlaying;
        },
        async save() {
            this.isSubmitting = true;
            this.nameError = this.name.trim() === "";
            this.pathError = this.points.length < 2;

            if (this.nameError || this.pathError) {
                this.isSubmitting = false;
                return;
            }

            const data = {
                team_number: this.teamNumber,
                name: this.name.trim(),
                alliance: this.alliance,
                side: this.side,
                path: this.points,
                event: this.eventStore.eventId
            };

            const error = this.autoPathId != null
                ? await updateScoutData(this.autoPathId, data, autoPathTable)
                : await submitScoutData(data, autoPathTable);

            if (error) {
                console.log(error);
                this.queueStore.enqueue(
                    'scout_data',
                    { table: autoPathTable, data, id: this.autoPathId },
                    error.message ?? String(error)
                );

                this.isSubmitting = false;
                this.$emit('saved', { queuedOffline: true });
                return;
            }

            this.isSubmitting = false;
            this.$emit('saved', { queuedOffline: false });
        },
        async doDelete() {
            if (this.autoPathId == null) return;

            const error = await deleteAutoPath(this.autoPathId);
            if (error) {
                console.log(error);
                return;
            }

            this.$emit('deleted');
        },
        cancel() {
            this.$emit('cancel');
        }
    },
    created() {
        this.eventStore = useEventStore();
        this.queueStore = useOfflineQueueStore();
        this.load();
    }
};
</script>

<style scoped>
.autopath-editor {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.autopath-selectors {
    display: flex;
    gap: 20px;
}

.autopath-selector {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.autopath-selector label {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.75);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.autopath-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.autopath-preview-controls {
    display: flex;
    justify-content: flex-end;
}

.confirm-text {
    font-size: 13px;
    color: var(--primary-text-color);
}

md-filled-button.cancel-button {
    --md-filled-button-container-color: rgba(128, 128, 128, 0.4);
}

md-filled-button.delete-button {
    --md-filled-button-container-color: #b03030;
}
</style>
