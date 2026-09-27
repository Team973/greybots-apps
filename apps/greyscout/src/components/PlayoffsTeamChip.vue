<script setup lang="ts">
// @ts-nocheck
import type { TeamEntry } from '@/stores/picklist-store';

// `team` can be undefined for a team number that's on an alliance but isn't
// in this event's team list — it still renders (number only, no photo).
defineProps<{
    teamNumber: number;
    team?: TeamEntry;
    // 'slot' = wide row that fills an alliance slot; 'tile' = square card for the pool.
    variant: 'slot' | 'tile';
    // Shows the grab handle. The chip is dragged by its handle only (the
    // parent's draggable uses handle=".team-chip-handle"), so swiping
    // anywhere else on the chip still scrolls the page on touch screens.
    draggable?: boolean;
}>();

// Keep this template to a single root node: a comment (or second element)
// before the root compiles to a fragment, which breaks vuedraggable — it
// would capture the fragment anchor instead of the real element.
</script>

<template>
    <div class="team-chip" :class="`team-chip--${variant}`"
        :title="team?.name ? `${teamNumber} — ${team.name}` : String(teamNumber)">
        <div class="team-chip-photo">
            <img v-if="team?.photo_url" :src="team.photo_url" :alt="`Team ${teamNumber} robot`" loading="lazy"
                draggable="false" />
            <span v-else class="team-chip-placeholder">🤖</span>
        </div>
        <div class="team-chip-number">{{ teamNumber }}</div>
        <div v-if="draggable" class="team-chip-handle" title="Drag to move" @contextmenu.prevent>⠿</div>
    </div>
</template>

<style scoped>
.team-chip {
    position: relative;
    display: flex;
    background: var(--tile-background-color);
    color: var(--primary-text-color);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
}

.team-chip-photo {
    background: rgba(128, 128, 128, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
}

.team-chip-photo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.team-chip-number {
    font-weight: 700;
}

/* The grab handle — the only part that starts a drag. touch-action: none
   keeps the browser from panning the page when a finger drags from it. */
.team-chip-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.85);
    background: rgba(0, 0, 0, 0.5);
    font-size: 16px;
    line-height: 1;
    cursor: grab;
    touch-action: none;
}

/* ── Alliance slot: photo thumbnail + number in one row, handle on the right ── */
.team-chip--slot {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    height: 100%;
    border-radius: 8px;
    box-shadow: 0 0 0 1.5px rgba(176, 87, 3, 0.55);
}

.team-chip--slot .team-chip-photo {
    height: 100%;
    aspect-ratio: 1;
    flex-shrink: 0;
}

.team-chip--slot .team-chip-number {
    flex: 1;
    min-width: 0;
    font-size: 15px;
}

.team-chip--slot .team-chip-placeholder {
    font-size: 20px;
}

.team-chip--slot .team-chip-handle {
    align-self: stretch;
    width: 28px;
    flex-shrink: 0;
}

/* ── Pool tile: photo over number, handle in the top-left corner ── */
.team-chip--tile {
    flex-direction: column;
    width: 92px;
    aspect-ratio: 1;
    border-radius: 10px;
}

.team-chip--tile .team-chip-photo {
    flex: 1;
    min-height: 0;
}

.team-chip--tile .team-chip-number {
    text-align: center;
    font-size: 14px;
    padding: 4px;
}

.team-chip--tile .team-chip-placeholder {
    font-size: 26px;
}

.team-chip--tile .team-chip-handle {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 28px;
    height: 28px;
    border-radius: 6px;
}
</style>
