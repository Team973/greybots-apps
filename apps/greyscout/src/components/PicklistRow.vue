<script setup lang="ts">
// @ts-nocheck
import type { TeamEntry } from '@/stores/picklist-store';
import type { TeamTierStats } from '@/lib/picklist-query';
import { computeBasicStats, computeFlagStats, computeTbaStats } from '@/lib/picklist-stats';

defineProps<{
    rowId: string;
    team: TeamEntry;
    eventId: string;
    position: number;
    showDragHandle: boolean;
    showVoteStats: boolean;
    tierStats: TeamTierStats | null;
    showPicked: boolean;
    isPicked: boolean;
    canTogglePicked: boolean;
    cardStatus: 'red' | 'yellow' | null;
    watched: boolean;
    canToggleWatch: boolean;
    expanded: boolean;
    expandedData: { stats: unknown[]; comments: unknown[] } | null;
    expandedLoading: boolean;
}>();

const emit = defineEmits(['toggle-expand', 'toggle-picked', 'toggle-watch']);

function formatAvgRank(avgRank: number) {
    return avgRank.toFixed(1);
}
</script>

<template>
    <div class="picklist-row" :class="{ 'picklist-row--expanded': expanded, 'picklist-row--picked': isPicked }"
        :id="rowId">
        <!-- Collapsed row -->
        <div class="picklist-row-collapsed" @click="emit('toggle-expand')">
            <div v-if="showDragHandle" class="picklist-drag-handle" @click.stop title="Drag to reorder">
                <span class="drag-dots">⠿</span>
            </div>
            <div class="picklist-position">{{ position }}</div>
            <div class="picklist-thumb-wrapper">
                <img v-if="team.photo_url" :src="team.photo_url" :alt="`Team ${team.team_number} robot`"
                    class="picklist-thumb" loading="lazy" />
                <div v-else class="picklist-thumb-placeholder">
                    <span>🤖</span>
                </div>
            </div>
            <div class="picklist-team-info">
                <span class="picklist-team-number">
                    {{ team.team_number }}
                    <span v-if="cardStatus" class="picklist-card-indicator" :class="`picklist-card-indicator--${cardStatus}`"
                        :title="cardStatus === 'red' ? 'Received a red card this event' : 'Received a yellow card this event'">
                    </span>
                </span>
                <span class="picklist-team-name">{{ team.name }}</span>
            </div>
            <div v-if="showVoteStats" class="picklist-vote-badge" @click.stop>
                <template v-if="tierStats">
                    <span class="vote-tier-chip" :class="`tier-chip--${tierStats.tier}`">{{ tierStats.tier }}</span>
                    <span class="vote-avg" title="Average overall rank across scouts who tiered this team">
                        avg #{{ formatAvgRank(tierStats.avgRank) }}
                    </span>
                    <span class="vote-count">{{ tierStats.votes }} vote{{ tierStats.votes === 1 ? '' : 's' }}</span>
                </template>
                <span v-else class="picklist-vote-empty">No picks yet</span>
            </div>
            <label v-if="showPicked" class="picklist-picked-check" @click.stop
                :title="canTogglePicked ? 'Mark as picked' : 'Picked status (leads only)'">
                <input type="checkbox" :checked="isPicked" :disabled="!canTogglePicked"
                    @change="emit('toggle-picked')" />
            </label>
            <button v-if="watched || canToggleWatch" type="button" class="picklist-watch-star"
                :class="{ 'picklist-watch-star--active': watched, 'picklist-watch-star--readonly': !canToggleWatch }"
                :disabled="!canToggleWatch" @click.stop="canToggleWatch && emit('toggle-watch')"
                :title="canToggleWatch ? (watched ? 'Remove from watchlist' : 'Add to watchlist') : 'On the watchlist'">
                ★
            </button>
            <div class="picklist-expand-chevron" :class="{ 'picklist-expand-chevron--open': expanded }">
                ›
            </div>
        </div>

        <!-- Expanded detail -->
        <transition name="expand">
            <div v-if="expanded" class="picklist-row-detail">
                <div v-if="expandedLoading" class="picklist-detail-loading">
                    <div class="picklist-spinner picklist-spinner--sm"></div> Loading data…
                </div>
                <div v-else-if="expandedData" class="picklist-detail-content">
                    <!-- Full robot image -->
                    <div class="picklist-detail-photo" v-if="team.photo_url">
                        <img :src="team.photo_url" :alt="`Team ${team.team_number} robot (full)`"
                            class="picklist-full-photo" />
                    </div>

                    <!-- TBA OPR/DPR — independent of scouted match data, so shown whenever cached (issue #26) -->
                    <div class="picklist-detail-section" v-if="computeTbaStats(eventId, team.team_number).length > 0">
                        <h3 class="picklist-detail-heading">TBA Stats</h3>
                        <div class="picklist-stats-grid">
                            <div v-for="stat in computeTbaStats(eventId, team.team_number)" :key="stat.label"
                                class="picklist-stat-card">
                                <div class="stat-label">{{ stat.label }}</div>
                                <div class="stat-avg">{{ stat.avg }}</div>
                                <div class="stat-sub">{{ stat.sub }}</div>
                            </div>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="picklist-detail-section" v-if="expandedData.stats.length > 0">
                        <h3 class="picklist-detail-heading">Match Stats ({{ expandedData.stats.length }}
                            matches)</h3>
                        <div class="picklist-stats-grid">
                            <div v-for="stat in computeFlagStats(expandedData.stats)" :key="stat.label"
                                class="picklist-stat-card">
                                <div class="stat-label">{{ stat.label }}</div>
                                <div class="stat-avg">{{ stat.pct }}%</div>
                                <div class="stat-sub">{{ stat.count }} / {{ stat.total }} matches</div>
                            </div>
                            <div v-for="stat in computeBasicStats(expandedData.stats)" :key="stat.label"
                                class="picklist-stat-card">
                                <div class="stat-label">{{ stat.label }}</div>
                                <div class="stat-avg">{{ stat.avg }}</div>
                                <div class="stat-sub">avg &nbsp;|&nbsp; max {{ stat.max }}</div>
                            </div>
                        </div>
                    </div>
                    <div v-else class="picklist-no-data">No match data available.</div>

                    <!-- Comments -->
                    <div class="picklist-detail-section" v-if="expandedData.comments.length > 0">
                        <h3 class="picklist-detail-heading">Scout Comments</h3>
                        <ul class="picklist-comments-list">
                            <li v-for="(comment, idx) in expandedData.comments" :key="idx" class="picklist-comment">
                                <div class="comment-meta">
                                    <span class="comment-author">{{ comment.author }}</span>
                                    <span class="comment-source-badge">{{ comment.source }}</span>
                                    <span class="comment-match" v-if="comment.match_number != null">Match
                                        {{ comment.match_number }}</span>
                                </div>
                                <p class="comment-text">{{ comment.comment }}</p>
                            </li>
                        </ul>
                    </div>
                    <div v-else-if="expandedData.stats.length === 0" class="picklist-no-data">
                        No scouting data available for this team.
                    </div>
                </div>
            </div>
        </transition>
    </div>
</template>

<style scoped>
/* ── Row ── */
.picklist-row {
    background: var(--tile-background-color);
    border-radius: 12px;
    margin-bottom: 8px;
    overflow: hidden;
    box-shadow:
        inset 0 0 0.5px 1px hsla(0, 0%, 100%, 0.07),
        0 1px 4px hsla(230, 13%, 9%, 0.07),
        0 2px 10px hsla(230, 13%, 9%, 0.06);
    transition: box-shadow 0.2s ease, opacity 0.2s ease;
}

.picklist-row:hover {
    box-shadow:
        inset 0 0 0.5px 1px hsla(0, 0%, 100%, 0.1),
        0 2px 8px hsla(230, 13%, 9%, 0.12),
        0 4px 16px hsla(230, 13%, 9%, 0.1);
}

.picklist-row--expanded {
    box-shadow:
        0 0 0 2px #b05703,
        0 4px 20px hsla(230, 13%, 9%, 0.14);
}

.picklist-row--ghost {
    opacity: 0.45;
}

/* Picked rows are grayed out — dimmed row + desaturated thumbnail — but the
   checkbox itself stays fully visible so its state is never ambiguous. */
.picklist-row--picked {
    opacity: 0.55;
}

.picklist-row--picked .picklist-thumb {
    filter: grayscale(85%);
}

.picklist-row--picked .picklist-picked-check {
    opacity: 1;
}

/* Collapsed row layout */
.picklist-row-collapsed {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    cursor: pointer;
    gap: 12px;
    min-height: 68px;
    user-select: none;
}

.picklist-drag-handle {
    color: rgba(128, 128, 128, 0.5);
    cursor: grab;
    font-size: 20px;
    padding: 4px;
    flex-shrink: 0;
    transition: color 0.15s;
    line-height: 1;
}

.picklist-drag-handle:hover {
    color: #b05703;
}

.picklist-position {
    font-size: 15px;
    font-weight: 700;
    color: #b05703;
    min-width: 22px;
    text-align: center;
    flex-shrink: 0;
}

.picklist-thumb-wrapper {
    width: 52px;
    height: 52px;
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
    background: rgba(128, 128, 128, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
}

.picklist-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: filter 0.2s ease;
}

.picklist-thumb-placeholder {
    font-size: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
}

.picklist-team-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

.picklist-team-number {
    font-size: 16px;
    font-weight: 700;
    color: var(--primary-text-color);
    line-height: 1.2;
}

.picklist-team-name {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* ── Card status indicator ── */
.picklist-card-indicator {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    margin-left: 6px;
    vertical-align: middle;
}

.picklist-card-indicator--yellow {
    background: #e0b400;
}

.picklist-card-indicator--red {
    background: #c83c3c;
}

.picklist-expand-chevron {
    font-size: 24px;
    font-weight: 300;
    color: rgba(128, 128, 128, 0.5);
    transition: transform 0.22s ease, color 0.15s ease;
    flex-shrink: 0;
    line-height: 1;
    padding-left: 4px;
}

.picklist-expand-chevron--open {
    transform: rotate(90deg);
    color: #b05703;
}

/* ── Vote badge (Democratic / Team rows) ── */
.picklist-vote-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    cursor: default;
}

.vote-tier-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 5px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 800;
}

.vote-avg,
.vote-count {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.7);
    white-space: nowrap;
}

.picklist-vote-empty {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.6);
    font-style: italic;
    white-space: nowrap;
}

/* ── Picked checkbox ── */
.picklist-picked-check {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    cursor: pointer;
    padding-left: 2px;
}

.picklist-picked-check input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: #b05703;
    cursor: pointer;
}

.picklist-picked-check input[type="checkbox"]:disabled {
    cursor: default;
    opacity: 0.6;
}

/* ── Watchlist star ── */
.picklist-watch-star {
    background: none;
    border: none;
    padding: 2px;
    margin-left: 2px;
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
    cursor: pointer;
    color: rgba(128, 128, 128, 0.35);
    transition: color 0.15s ease, transform 0.1s ease;
}

.picklist-watch-star:not(:disabled):hover {
    color: #e0b400;
    transform: scale(1.1);
}

.picklist-watch-star--active {
    color: #e0b400;
}

.picklist-watch-star--readonly {
    cursor: default;
}

/* ── Detail section ── */
.picklist-row-detail {
    border-top: 1px solid rgba(128, 128, 128, 0.15);
    padding: 16px 14px 20px;
    overflow: hidden;
}

.picklist-detail-loading {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: rgba(128, 128, 128, 0.7);
    padding: 8px 0;
}

.picklist-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(176, 87, 3, 0.2);
    border-top-color: #b05703;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

.picklist-spinner--sm {
    width: 20px;
    height: 20px;
    border-width: 2px;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.picklist-detail-content {
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.picklist-detail-photo {
    display: flex;
    justify-content: center;
}

.picklist-full-photo {
    max-width: 340px;
    width: 100%;
    border-radius: 10px;
    object-fit: cover;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.picklist-detail-heading {
    font-size: 14px;
    font-weight: 700;
    color: #b05703;
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.picklist-detail-section {
    display: flex;
    flex-direction: column;
}

/* Stats grid */
.picklist-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
}

.picklist-stat-card {
    background: rgba(176, 87, 3, 0.08);
    border: 1px solid rgba(176, 87, 3, 0.2);
    border-radius: 10px;
    padding: 10px 12px;
    text-align: center;
}

.stat-label {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.75);
    margin-bottom: 4px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.stat-avg {
    font-size: 22px;
    font-weight: 700;
    color: #b05703;
    line-height: 1.1;
}

.stat-sub {
    font-size: 10px;
    color: rgba(128, 128, 128, 0.6);
    margin-top: 2px;
}

/* Comments */
.picklist-comments-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.picklist-comment {
    border: 1px solid rgba(128, 128, 128, 0.2);
    border-radius: 10px;
    padding: 10px 14px;
}

.comment-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    flex-wrap: wrap;
}

.comment-author {
    font-weight: 700;
    font-size: 13px;
    color: var(--primary-text-color);
}

.comment-source-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 20px;
    background: rgba(176, 87, 3, 0.15);
    color: #b05703;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.comment-match {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.6);
    margin-left: auto;
}

.comment-text {
    font-size: 13px;
    color: var(--primary-text-color);
    line-height: 1.55;
    margin: 0;
}

.picklist-no-data {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.6);
    font-style: italic;
    padding: 4px 0;
}

/* Tier chip colors — S best (gold) to DNP worst (red) */
.tier-chip--S {
    background: rgba(212, 160, 23, 0.22);
    color: #b3860f;
}

.tier-chip--A {
    background: rgba(58, 158, 58, 0.2);
    color: #2f8a2f;
}

.tier-chip--B {
    background: rgba(58, 120, 200, 0.2);
    color: #2f6bb0;
}

.tier-chip--C {
    background: rgba(140, 100, 200, 0.2);
    color: #7c53b8;
}

.tier-chip--D {
    background: rgba(176, 87, 3, 0.18);
    color: #b05703;
}

.tier-chip--DNP {
    background: rgba(200, 60, 60, 0.2);
    color: #c33c3c;
}

/* ── Transitions ── */
.expand-enter-active,
.expand-leave-active {
    transition: max-height 0.28s ease, opacity 0.22s ease;
    max-height: 1200px;
    overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
    max-height: 0;
    opacity: 0;
}
</style>
