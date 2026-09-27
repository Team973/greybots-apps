<script setup lang="ts">
// @ts-nocheck
import { ref, computed, onMounted } from 'vue';
import draggable from 'vuedraggable';
import { usePlayoffsStore } from '@/stores/playoffs-store';
import { useAuthStore } from '@/stores/auth-store';
import { useEventStore } from '@/stores/event-store';
import { useDragAutoscroll } from '@greybots/common/lib/drag-autoscroll';
import { ALLIANCE_SIZE, ALLIANCE_COUNT } from '@/lib/playoffs-bracket';
import PlayoffsTeamChip from '@/components/PlayoffsTeamChip.vue';
import PlayoffsBracket from '@/components/PlayoffsBracket.vue';
import SearchableDropdown from '@greybots/common/components/SearchableDropdown.vue';

const playoffsStore = usePlayoffsStore();
const authStore = useAuthStore();
const eventStore = useEventStore();
// Same proportional autoscroll as the pick list; the pool is also a scroll
// container on desktop, so it scrolls itself when the pointer nears its edge.
const { startAutoscroll, stopAutoscroll } = useDragAutoscroll({ nestedScrollSelector: '.playoffs-pool' });

// Teams are dragged by their grab handle only (see PlayoffsTeamChip.vue), so
// swiping anywhere else over the team pool scrolls the page on touch screens
// and a drag starts immediately from the handle.
const DRAG_HANDLE = '.team-chip-handle';

const SLOT_LABELS = ['Captain', 'Pick 1', 'Pick 2', 'Backup'];

const currentEventId = computed(() => eventStore.eventId);
const isViewingPastEvent = computed(() => playoffsStore.eventId != null && playoffsStore.eventId !== currentEventId.value);
// Only leads/admins edit, and only the current event — a past event is a
// read-only look back, the same as the pick list's prior-event filter.
const isEditable = computed(() => authStore.isLead && !isViewingPastEvent.value && !playoffsStore.loadError);

const displayEventName = computed(() => {
    if (!isViewingPastEvent.value) return eventStore.eventName;
    return playoffsStore.pastEvents.find((e) => e.event_id === playoffsStore.eventId)?.name ?? playoffsStore.eventId;
});

// ─── Loading ───────────────────────────────────────────────────────────────────

onMounted(async () => {
    await authStore.checkUser();
    await eventStore.updateEvent();
    await playoffsStore.load(eventStore.eventId);
    await playoffsStore.loadPastEvents(eventStore.eventId);
});

const isRefreshing = ref(false);
async function refresh() {
    isRefreshing.value = true;
    await playoffsStore.load(playoffsStore.eventId);
    isRefreshing.value = false;
}

// ─── Past events ───────────────────────────────────────────────────────────────

const pastEventChoices = computed(() => [
    { key: '', text: 'Current Event' },
    ...playoffsStore.pastEvents.map((e) => ({ key: e.event_id, text: e.name }))
]);

const selectedEventId = computed({
    get: () => (isViewingPastEvent.value ? playoffsStore.eventId : ''),
    set: async (eventId: string) => {
        await playoffsStore.load(eventId || currentEventId.value);
    }
});

// ─── Saving ────────────────────────────────────────────────────────────────────

// Every edit saves immediately (no separate Save button) — this is a live
// at-event tool, and the bracket needs to update for everyone else quickly.
async function saveNow() {
    if (!isEditable.value) return;
    await playoffsStore.save(true);
}

// ─── Drag and drop ─────────────────────────────────────────────────────────────

const alliancesChanged = computed(() =>
    JSON.stringify(playoffsStore.alliances) !== JSON.stringify(playoffsStore.savedAlliances)
);

function onDragEnd() {
    stopAutoscroll();
    playoffsStore.pool.sort((a, b) => a - b);
    if (alliancesChanged.value) saveNow();
}

// An alliance only accepts a new team while it has an open slot; moving a
// team around within its own alliance is always allowed.
function allianceGroup(alliance: number[]) {
    return { name: 'playoff-teams', put: () => alliance.length < ALLIANCE_SIZE };
}

// ─── Team pool search ──────────────────────────────────────────────────────────

const poolSearch = ref('');

function matchesSearch(teamNumber: number) {
    const query = poolSearch.value.trim().toLowerCase();
    if (!query) return true;
    const team = playoffsStore.teamMap[teamNumber];
    return String(teamNumber).includes(query) || (team?.name ?? '').toLowerCase().includes(query);
}

// ─── Bracket ───────────────────────────────────────────────────────────────────

async function pickWinner(match: number, alliance: number) {
    if (!isEditable.value) return;
    playoffsStore.setWinner(match, alliance);
    await saveNow();
}

// ─── Reset ─────────────────────────────────────────────────────────────────────

const confirmingReset = ref(false);
async function resetPlayoffs() {
    confirmingReset.value = false;
    playoffsStore.resetAll();
    await saveNow();
}

function allianceStatus(number: number) {
    if (playoffsStore.champion === number) return 'champion';
    if (playoffsStore.eliminated.has(number)) return 'eliminated';
    return null;
}
</script>

<template>
    <div class="main-content">
        <div class="playoffs-page">
            <div class="playoffs-header">
                <h1>Playoffs</h1>
                <div class="playoffs-event-name">{{ displayEventName }}</div>
                <button type="button" class="playoffs-btn playoffs-refresh-btn" :disabled="isRefreshing || playoffsStore.loading"
                    title="Reload alliances and results" @click="refresh">
                    {{ isRefreshing ? 'Refreshing…' : '↻ Refresh' }}
                </button>
            </div>

            <div class="playoffs-filter">
                <span class="playoffs-filter-label">View prior event:</span>
                <SearchableDropdown :choices="pastEventChoices" :model-value="selectedEventId"
                    placeholder="Search events…" @update:modelValue="selectedEventId = $event"></SearchableDropdown>
                <button v-if="isViewingPastEvent" id="btn-clear-past-event" type="button" class="playoffs-btn"
                    title="Return to the current event" @click="selectedEventId = ''">
                    ✕ Clear Filter
                </button>
            </div>

            <div class="playoffs-description">
                <span v-if="isViewingPastEvent">{{ displayEventName }}'s alliances and bracket (read-only).</span>
                <span v-else-if="isEditable">Drag teams by their ⠿ handle from the pool into alliances, then click an
                    alliance in the bracket to record who won. Changes save automatically, and teams placed on an alliance are marked
                    picked on the pick list.</span>
                <span v-else>Alliances and bracket results for the current event (read-only — leads and admins can edit).</span>
            </div>

            <div v-if="playoffsStore.loading && !playoffsStore.loaded" class="playoffs-loading">
                <div class="playoffs-spinner"></div>
                <span>Loading playoffs…</span>
            </div>

            <template v-else>
                <div v-if="playoffsStore.loadError" class="playoffs-banner playoffs-banner--err">
                    ⚠ Couldn't load the saved playoffs for this event, so editing is disabled to avoid overwriting
                    anything. Try refreshing.
                </div>

                <div v-if="isEditable" class="playoffs-save-bar">
                    <template v-if="!confirmingReset">
                        <button id="btn-reset-playoffs" type="button" class="playoffs-btn playoffs-btn--danger"
                            title="Clear every alliance and bracket result" @click="confirmingReset = true">
                            ✕ Reset Playoffs
                        </button>
                    </template>
                    <template v-else>
                        <span class="playoffs-confirm-text">Clear all alliances and results?</span>
                        <button id="btn-cancel-reset-playoffs" type="button" class="playoffs-btn"
                            @click="confirmingReset = false">Cancel</button>
                        <button id="btn-confirm-reset-playoffs" type="button" class="playoffs-btn playoffs-btn--danger"
                            @click="resetPlayoffs">Yes, Clear It</button>
                    </template>
                    <span v-if="playoffsStore.isSaving" class="save-status">Saving…</span>
                    <span v-else-if="playoffsStore.lastSaveSuccess" class="save-status save-status--ok">✓ Saved</span>
                    <template v-else-if="playoffsStore.lastSaveError">
                        <span class="save-status save-status--err">⚠ Save failed: {{ playoffsStore.lastSaveError }}</span>
                        <button id="btn-retry-save-playoffs" type="button" class="playoffs-btn" @click="saveNow">Retry</button>
                    </template>
                </div>

                <div class="playoffs-columns">
                    <!-- Alliances -->
                    <section class="playoffs-alliances-section">
                        <h2>Alliances</h2>
                        <div class="alliance-grid">
                            <div v-for="number in ALLIANCE_COUNT" :key="number" class="alliance-card"
                                :class="{
                                    'alliance-card--eliminated': allianceStatus(number) === 'eliminated',
                                    'alliance-card--champion': allianceStatus(number) === 'champion'
                                }" :id="`alliance-${number}`">
                                <div class="alliance-card-header">
                                    <span class="alliance-card-name">Alliance {{ number }}</span>
                                    <span v-if="allianceStatus(number) === 'champion'"
                                        class="alliance-card-badge alliance-card-badge--champion">🏆 Champion</span>
                                    <span v-else-if="allianceStatus(number) === 'eliminated'"
                                        class="alliance-card-badge">Eliminated</span>
                                </div>

                                <div class="alliance-slots">
                                    <div class="alliance-slot-bgs">
                                        <div v-for="(label, i) in SLOT_LABELS" :key="i" class="alliance-slot-bg">{{ label }}</div>
                                    </div>

                                    <draggable v-if="isEditable" :list="playoffsStore.alliances[number - 1]"
                                        :group="allianceGroup(playoffsStore.alliances[number - 1])"
                                        :item-key="(el) => el" animation="200" ghost-class="alliance-ghost"
                                        :force-fallback="true" :scroll="false" :handle="DRAG_HANDLE" class="alliance-slot-list"
                                        @start="startAutoscroll" @end="onDragEnd">
                                        <template #item="{ element: teamNumber }">
                                            <PlayoffsTeamChip :team-number="teamNumber"
                                                :team="playoffsStore.teamMap[teamNumber]" variant="slot" draggable />
                                        </template>
                                    </draggable>
                                    <div v-else class="alliance-slot-list">
                                        <PlayoffsTeamChip v-for="teamNumber in playoffsStore.alliances[number - 1]"
                                            :key="teamNumber" :team-number="teamNumber"
                                            :team="playoffsStore.teamMap[teamNumber]" variant="slot" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- Unpicked pool -->
                    <section class="playoffs-pool-section">
                        <h2>Available Teams <span class="playoffs-count">{{ playoffsStore.pool.length }}</span></h2>
                        <input v-model="poolSearch" type="search" class="playoffs-search" placeholder="Search team # or name…"
                            aria-label="Search available teams" />

                        <draggable v-if="isEditable" :list="playoffsStore.pool" group="playoff-teams" :sort="false"
                            :item-key="(el) => el" animation="200" ghost-class="alliance-ghost" :force-fallback="true"
                            :scroll="false" :handle="DRAG_HANDLE" class="playoffs-pool" id="playoffs-pool" @start="startAutoscroll"
                            @end="onDragEnd">
                            <template #item="{ element: teamNumber }">
                                <PlayoffsTeamChip v-show="matchesSearch(teamNumber)" :team-number="teamNumber"
                                    :team="playoffsStore.teamMap[teamNumber]" variant="tile" draggable />
                            </template>
                        </draggable>
                        <div v-else class="playoffs-pool">
                            <PlayoffsTeamChip v-for="teamNumber in playoffsStore.pool" v-show="matchesSearch(teamNumber)"
                                :key="teamNumber" :team-number="teamNumber" :team="playoffsStore.teamMap[teamNumber]"
                                variant="tile" />
                        </div>

                        <div v-if="playoffsStore.pool.length === 0" class="playoffs-pool-empty">
                            {{ playoffsStore.teams.length === 0 ? 'No teams found for this event.' : 'Every team has been placed on an alliance.' }}
                        </div>
                    </section>
                </div>

                <!-- Bracket -->
                <section class="playoffs-bracket-section">
                    <h2>Bracket</h2>
                    <PlayoffsBracket :matches="playoffsStore.resolvedMatches" :alliances="playoffsStore.alliances"
                        :editable="isEditable" @pick-winner="pickWinner" />
                </section>
            </template>
        </div>
    </div>
</template>

<style scoped>
.playoffs-page {
    max-width: 860px;
    margin: 0 auto;
}

@media (min-width: 1000px) {
    .playoffs-page {
        max-width: 1180px;
    }
}

/* ── Header ── */
.playoffs-header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    margin-bottom: 4px;
    flex-wrap: wrap;
}

.playoffs-event-name {
    font-size: 14px;
    color: rgba(128, 128, 128, 0.8);
    font-style: italic;
}

.playoffs-refresh-btn {
    margin-left: auto;
}

.playoffs-filter {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 0;
    font-size: 13px;
    flex-wrap: wrap;
}

.playoffs-filter-label {
    color: rgba(128, 128, 128, 0.85);
    font-weight: 600;
}

.playoffs-description {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.75);
    margin-bottom: 16px;
}

.playoffs-btn {
    background: rgba(128, 128, 128, 0.12);
    border: 1.5px solid transparent;
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text-color);
    cursor: pointer;
}

.playoffs-btn:hover:not(:disabled) {
    border-color: rgba(176, 87, 3, 0.5);
}

.playoffs-btn:disabled {
    opacity: 0.5;
    cursor: default;
}

.playoffs-btn--danger {
    color: #d32f2f;
}

/* ── Loading / banners ── */
.playoffs-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 60px 0;
    color: rgba(128, 128, 128, 0.8);
    font-size: 15px;
}

.playoffs-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(176, 87, 3, 0.2);
    border-top-color: #b05703;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.playoffs-banner {
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 13px;
    margin-bottom: 12px;
}

.playoffs-banner--err {
    background: rgba(211, 47, 47, 0.14);
    color: #d32f2f;
}

/* ── Save bar ── */
.playoffs-save-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    margin-bottom: 12px;
    flex-wrap: wrap;
}

.playoffs-confirm-text {
    font-size: 13px;
    color: var(--primary-text-color);
}

.save-status {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.9);
}

.save-status--ok {
    color: #2e7d32;
}

.save-status--err {
    color: #d32f2f;
}

/* ── Layout: alliances + pool side by side on desktop ── */
h2 {
    font-size: 16px;
    margin: 0 0 10px;
}

.playoffs-columns {
    display: flex;
    flex-direction: column;
    gap: 24px;
    margin-bottom: 28px;
}

@media (min-width: 1000px) {
    .playoffs-columns {
        flex-direction: row;
        align-items: flex-start;
    }

    .playoffs-alliances-section {
        flex: 1;
        min-width: 0;
    }

    .playoffs-pool-section {
        width: 340px;
        flex-shrink: 0;
        position: sticky;
        top: 76px;
    }
}

/* ── Alliances ── */
.alliance-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
}

.alliance-card {
    --slot-height: 50px;
    --slot-gap: 6px;
    background: var(--tile-background-color);
    border-radius: 12px;
    padding: 10px;
    box-shadow: 0 1px 4px hsla(230, 13%, 9%, 0.12);
}

.alliance-card--eliminated {
    opacity: 0.55;
}

.alliance-card--champion {
    box-shadow: 0 0 0 2px #b05703, 0 4px 16px hsla(230, 13%, 9%, 0.14);
}

.alliance-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    color: var(--primary-text-color);
}

.alliance-card-name {
    font-weight: 700;
    font-size: 15px;
}

.alliance-card-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 10px;
    background: rgba(128, 128, 128, 0.2);
    color: rgba(128, 128, 128, 0.95);
}

.alliance-card-badge--champion {
    background: rgba(176, 87, 3, 0.2);
    color: #b05703;
}

/* The slot outlines and the list of teams share the same grid geometry, so
   however many teams are placed they sit exactly over the first N outlines,
   and the whole 4-slot area stays a drop target when the list is empty. */
.alliance-slots {
    position: relative;
}

.alliance-slot-bgs,
.alliance-slot-list {
    display: grid;
    grid-template-rows: repeat(4, var(--slot-height));
    grid-auto-rows: var(--slot-height);
    gap: var(--slot-gap);
}

.alliance-slot-bgs {
    position: absolute;
    inset: 0;
}

.alliance-slot-list {
    position: relative;
    min-height: calc(4 * var(--slot-height) + 3 * var(--slot-gap));
    align-content: start;
}

.alliance-slot-bg {
    display: flex;
    align-items: center;
    padding-left: 10px;
    border: 1.5px dashed rgba(128, 128, 128, 0.4);
    border-radius: 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(128, 128, 128, 0.7);
}

.alliance-ghost {
    opacity: 0.45;
}

/* ── Pool ── */
.playoffs-count {
    font-size: 12px;
    font-weight: 600;
    color: rgba(128, 128, 128, 0.85);
    margin-left: 4px;
}

.playoffs-search {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    margin-bottom: 10px;
    border-radius: 8px;
    border: 1.5px solid rgba(128, 128, 128, 0.35);
    background: transparent;
    color: var(--primary-text-color);
    font-size: 14px;
}

.playoffs-pool {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 100px;
    padding: 4px;
}

@media (min-width: 1000px) {
    .playoffs-pool {
        max-height: 70vh;
        overflow-y: auto;
    }
}

.playoffs-pool-empty {
    text-align: center;
    font-size: 13px;
    color: rgba(128, 128, 128, 0.8);
    padding: 12px 0;
}

/* ── Bracket ── */
.playoffs-bracket-section {
    margin-bottom: 40px;
}
</style>
