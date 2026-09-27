<script setup lang="ts">
// @ts-nocheck
import type { TeamEntry } from '@/stores/picklist-store';
import { computeBasicStats, computeFlagStats } from '@/lib/picklist-stats';

defineProps<{
    rowId: string;
    team: TeamEntry;
    watched: boolean;
    canToggleWatch: boolean;
    expanded: boolean;
    expandedData: { stats: unknown[]; comments: unknown[] } | null;
    expandedLoading: boolean;
}>();

const emit = defineEmits(['toggle-watch', 'toggle-expand']);

// A template-level HTML comment placed before the root element compiles to
// a fragment root (comment node + div), which breaks vuedraggable — it
// captures the fragment anchor as the card's DOM element instead of the
// real div, so `__draggable_context` never attaches. Keep this component's
// template to a single root node; put comments here instead.
</script>

<template>
    <div class="unranked-card" :class="{ 'unranked-card--expanded': expanded }" :id="rowId"
        @click="emit('toggle-expand')">
        <div class="unranked-card-handle" @click.stop title="Drag to reorder">⠿</div>
        <button v-if="watched || canToggleWatch" type="button" class="unranked-card-watch"
            :class="{ 'unranked-card-watch--active': watched }" :disabled="!canToggleWatch"
            @click.stop="canToggleWatch && emit('toggle-watch')"
            :title="canToggleWatch ? (watched ? 'Remove from watchlist' : 'Add to watchlist') : 'On the watchlist'">
            ★
        </button>

        <template v-if="!expanded">
            <div class="unranked-card-photo">
                <img v-if="team.photo_url" :src="team.photo_url" :alt="`Team ${team.team_number} robot`" loading="lazy"
                    draggable="false" />
                <div v-else class="unranked-card-placeholder">
                    <span>🤖</span>
                </div>
            </div>
            <div class="unranked-card-number">{{ team.team_number }}</div>
        </template>

        <template v-else>
            <div class="unranked-card-expanded-header">
                <div class="unranked-card-photo-lg">
                    <img v-if="team.photo_url" :src="team.photo_url" :alt="`Team ${team.team_number} robot`"
                        draggable="false" />
                    <div v-else class="unranked-card-placeholder">
                        <span>🤖</span>
                    </div>
                </div>
                <div class="unranked-card-number-lg">{{ team.team_number }}</div>
                <div class="unranked-card-name-lg">{{ team.name }}</div>
            </div>

            <div v-if="expandedLoading" class="unranked-card-detail-loading">
                <div class="unranked-card-spinner"></div> Loading data…
            </div>
            <div v-else-if="expandedData" class="unranked-card-detail-content" @click.stop>
                <div v-if="expandedData.stats.length > 0" class="unranked-card-stats-grid">
                    <div v-for="stat in computeFlagStats(expandedData.stats)" :key="stat.label"
                        class="unranked-card-stat">
                        <div class="stat-label">{{ stat.label }}</div>
                        <div class="stat-avg">{{ stat.pct }}%</div>
                    </div>
                    <div v-for="stat in computeBasicStats(expandedData.stats)" :key="stat.label"
                        class="unranked-card-stat">
                        <div class="stat-label">{{ stat.label }}</div>
                        <div class="stat-avg">{{ stat.avg }}</div>
                    </div>
                </div>
                <div v-else class="unranked-card-no-data">No match data available.</div>

                <ul v-if="expandedData.comments.length > 0" class="unranked-card-comments">
                    <li v-for="(comment, idx) in expandedData.comments" :key="idx" class="unranked-card-comment">
                        <div class="comment-meta">
                            <span class="comment-author">{{ comment.author }}</span>
                            <span class="comment-source-badge">{{ comment.source }}</span>
                        </div>
                        <p class="comment-text">{{ comment.comment }}</p>
                    </li>
                </ul>
            </div>
        </template>
    </div>
</template>

<style scoped>
.unranked-card {
    position: relative;
    /* Self-contained fallback size — PicklistView.vue's own
       `.unranked-grid > .unranked-card` rule normally overrides this
       (higher specificity) to give exactly 3 per row. But SortableJS
       temporarily re-parents the actual dragged element into whichever
       list it's currently hovering over (that's how the live drop-position
       preview works for a cross-list drag, not just a visual clone) — the
       moment it leaves .unranked-grid, that parent-scoped rule stops
       matching. Without an intrinsic width of its own here, the card then
       defaults to stretching to fill the much wider ranked-tier column
       (a flex-direction: column list, whose children stretch to full
       width by default), and aspect-ratio: 1 blows the height up to
       match — a real bug (seen as the photo rendering huge and stretched
       mid-drag), not just an automation-testing artifact.
       See docs/picklist.md's "Unranked Teams" section. */
    max-width: 140px;
    aspect-ratio: 1;
    display: flex;
    flex-direction: column;
    background: var(--tile-background-color);
    border-radius: 12px;
    overflow: hidden;
    user-select: none;
    cursor: pointer;
    box-shadow:
        inset 0 0 0.5px 1px hsla(0, 0%, 100%, 0.07),
        0 1px 4px hsla(230, 13%, 9%, 0.07),
        0 2px 10px hsla(230, 13%, 9%, 0.06);
    transition: box-shadow 0.2s ease;
}

/* Roughly a 3x3-card footprint: full row width instead of 1/3, and a
   generous min-height instead of the collapsed aspect-ratio: 1 square, so
   the photo/stats/comments below have room. */
.unranked-card--expanded {
    max-width: 100%;
    flex: 1 1 100%;
    aspect-ratio: auto;
    min-height: 380px;
    cursor: default;
    padding: 14px;
    gap: 10px;
    box-shadow:
        0 0 0 2px #b05703,
        0 4px 20px hsla(230, 13%, 9%, 0.14);
}

.unranked-card--ghost {
    opacity: 0.45;
}

.unranked-card:hover {
    box-shadow:
        inset 0 0 0.5px 1px hsla(0, 0%, 100%, 0.1),
        0 2px 8px hsla(230, 13%, 9%, 0.12),
        0 4px 16px hsla(230, 13%, 9%, 0.1);
}

.unranked-card-handle {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 1;
    color: rgba(255, 255, 255, 0.75);
    background: rgba(0, 0, 0, 0.45);
    border-radius: 6px;
    padding: 1px 4px;
    font-size: 13px;
    line-height: 1.4;
    cursor: grab;
}

.unranked-card-photo {
    flex: 1;
    min-height: 0;
    background: rgba(128, 128, 128, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
}

.unranked-card-photo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.unranked-card-placeholder {
    font-size: 32px;
}

.unranked-card-number {
    flex-shrink: 0;
    text-align: center;
    font-size: 15px;
    font-weight: 700;
    color: var(--primary-text-color);
    padding: 6px 4px;
}

.unranked-card-watch {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1;
    background: rgba(0, 0, 0, 0.45);
    border: none;
    border-radius: 6px;
    padding: 2px 5px;
    font-size: 16px;
    line-height: 1.2;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: color 0.15s ease, transform 0.1s ease;
}

.unranked-card-watch:not(:disabled):hover {
    color: #e0b400;
    transform: scale(1.1);
}

.unranked-card-watch--active {
    color: #e0b400;
}

.unranked-card-watch:disabled {
    cursor: default;
}

/* ── Expanded content ── */
.unranked-card-expanded-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding-top: 22px;
}

.unranked-card-photo-lg {
    width: 100%;
    max-width: 220px;
    aspect-ratio: 4 / 3;
    border-radius: 10px;
    overflow: hidden;
    background: rgba(128, 128, 128, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
}

.unranked-card-photo-lg img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.unranked-card-number-lg {
    font-size: 20px;
    font-weight: 800;
    color: var(--primary-text-color);
    margin-top: 8px;
}

.unranked-card-name-lg {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.8);
}

.unranked-card-detail-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 13px;
    color: rgba(128, 128, 128, 0.7);
    padding: 8px 0;
}

.unranked-card-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(176, 87, 3, 0.2);
    border-top-color: #b05703;
    border-radius: 50%;
    animation: unranked-card-spin 0.8s linear infinite;
}

@keyframes unranked-card-spin {
    to {
        transform: rotate(360deg);
    }
}

.unranked-card-detail-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: default;
}

.unranked-card-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 8px;
}

.unranked-card-stat {
    background: rgba(176, 87, 3, 0.08);
    border: 1px solid rgba(176, 87, 3, 0.2);
    border-radius: 8px;
    padding: 6px 8px;
    text-align: center;
}

.stat-label {
    font-size: 10px;
    color: rgba(128, 128, 128, 0.75);
    margin-bottom: 2px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.stat-avg {
    font-size: 16px;
    font-weight: 700;
    color: #b05703;
    line-height: 1.1;
}

.unranked-card-no-data {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.6);
    font-style: italic;
}

.unranked-card-comments {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.unranked-card-comment {
    border: 1px solid rgba(128, 128, 128, 0.2);
    border-radius: 8px;
    padding: 8px 10px;
}

.comment-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    flex-wrap: wrap;
}

.comment-author {
    font-weight: 700;
    font-size: 12px;
    color: var(--primary-text-color);
}

.comment-source-badge {
    font-size: 9px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 20px;
    background: rgba(176, 87, 3, 0.15);
    color: #b05703;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.comment-text {
    font-size: 12px;
    color: var(--primary-text-color);
    line-height: 1.5;
    margin: 0;
}
</style>
