<script setup lang="ts">
// @ts-nocheck
import AutoPathCanvas from "@/components/AutoPathCanvas.vue";
import Dropdown from "@greybots/common/components/Dropdown.vue";
import FullscreenTile from "@greybots/common/components/FullscreenTile.vue";

import { ALLIANCE_CHOICES, SIDE_CHOICES, transformPath } from "@/lib/2026/auto-path-field";

import "@material/web/button/filled-button";
</script>

<template>
    <li class="autopath-card">
        <FullscreenTile>
            <div class="autopath-card-header">
                <span class="autopath-name">{{ path.name }}</span>
                <span v-if="isEffectivelyDefault" class="autopath-default-badge">★ Default</span>
                <span class="autopath-author">by {{ path.author }}</span>
            </div>

            <AutoPathCanvas :points="displayPoints" :display-alliance="viewAlliance" :editable="false" large="true"
                :color="cardColor" :playing="isPlaying" :robot-photo-url="robotPhotoUrl"
                @finished="isPlaying = false"></AutoPathCanvas>

            <div class="autopath-view-controls">
                <span class="autopath-view-label">View as:</span>
                <Dropdown :choices="ALLIANCE_CHOICES" v-model="viewAllianceIndex"></Dropdown>
                <Dropdown :choices="SIDE_CHOICES" v-model="viewSideIndex"></Dropdown>
                <md-filled-button v-on:click="togglePlay" class="play-button">
                    {{ isPlaying ? "■ STOP" : "▶ PLAY" }}
                </md-filled-button>
            </div>

            <div class="autopath-card-actions" v-if="canEdit">
                <md-filled-button v-if="!isEffectivelyDefault" v-on:click="$emit('set-default', path.id)"
                    class="default-button">SET AS DEFAULT</md-filled-button>
                <md-filled-button v-on:click="$emit('edit', path.id)">EDIT</md-filled-button>
            </div>
        </FullscreenTile>
    </li>
</template>

<script lang="ts">
import { allianceRed, sideLeft } from "@/lib/constants";
import { fetchRobotPhotoUrl } from "@/lib/robot-photo-query";

export default {
    props: {
        path: {
            type: Object,
            required: true
        },
        teamNumber: {
            type: Number,
            required: true
        },
        canEdit: {
            type: Boolean,
            default: false
        },
        cardColor: {
            type: String,
            default: "#ff8c00"
        },
        // True when this is the only saved auto path for the team — treated
        // as the default even if is_default was never explicitly set.
        isOnlyPath: {
            type: Boolean,
            default: false
        }
    },
    emits: ["edit", "set-default"],
    data() {
        return {
            viewAllianceIndex: 0,
            viewSideIndex: 0,
            isPlaying: false,
            robotPhotoUrl: null,
            ALLIANCE_CHOICES,
            SIDE_CHOICES
        };
    },
    methods: {
        togglePlay() {
            this.isPlaying = !this.isPlaying;
        }
    },
    computed: {
        viewAlliance() {
            return ALLIANCE_CHOICES[this.viewAllianceIndex]?.key ?? allianceRed;
        },
        viewSide() {
            return SIDE_CHOICES[this.viewSideIndex]?.key ?? sideLeft;
        },
        displayPoints() {
            return transformPath(this.path.points, this.path.side, this.viewSide);
        },
        isEffectivelyDefault() {
            return this.path.isDefault || this.isOnlyPath;
        }
    },
    async created() {
        this.viewAllianceIndex = ALLIANCE_CHOICES.findIndex((c) => c.key === this.path.alliance);
        if (this.viewAllianceIndex < 0) this.viewAllianceIndex = 0;
        this.viewSideIndex = SIDE_CHOICES.findIndex((c) => c.key === this.path.side);
        if (this.viewSideIndex < 0) this.viewSideIndex = 0;
        this.robotPhotoUrl = await fetchRobotPhotoUrl(this.teamNumber);
    }
};
</script>

<style scoped>
.autopath-card {
    background: var(--tile-background-color);
    border: 1px solid rgba(128, 128, 128, 0.2);
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.autopath-card-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px;
}

.autopath-name {
    font-weight: 700;
    font-size: 14px;
    color: var(--primary-text-color);
}

.autopath-author {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.7);
}

.autopath-default-badge {
    font-size: 11px;
    font-weight: 700;
    color: #b05703;
}

.autopath-view-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.autopath-view-label {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.75);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.autopath-card-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}

.default-button {
    --md-filled-button-container-color: rgba(128, 128, 128, 0.4);
}

.play-button {
    margin-left: auto;
}
</style>
