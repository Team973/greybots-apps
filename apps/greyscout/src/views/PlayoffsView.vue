<script setup lang="ts">
// @ts-nocheck
import { ref, reactive, computed, nextTick, onMounted } from 'vue';
import draggable from 'vuedraggable';
import { usePlayoffsStore } from '@/stores/playoffs-store';
import { useAuthStore } from '@/stores/auth-store';
import { useEventStore } from '@/stores/event-store';
import { useDragAutoscroll } from '@greybots/common/lib/drag-autoscroll';
import { ALLIANCE_SIZE, ALLIANCE_COUNT } from '@/lib/playoffs-bracket';
import { loadPreferences, savePreferences, allianceEntryChoices } from '@/lib/preferences';
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
// 'team' is the real alliance selection; 'personal' is this user's own
// prediction, which doesn't mark anyone picked (issue #123).
const isPersonal = computed(() => playoffsStore.mode === 'personal');
// The real alliances are edited by leads/admins; a prediction by whoever
// owns it. Either way only for the current event — a past event is a
// read-only look back, the same as the pick list's prior-event filter.
const isEditable = computed(() =>
    !isViewingPastEvent.value && !playoffsStore.loadError
    && (isPersonal.value ? authStore.hasAccess : authStore.isLead)
);

const displayEventName = computed(() => {
    if (!isViewingPastEvent.value) return eventStore.eventName;
    return playoffsStore.pastEvents.find((e) => e.event_id === playoffsStore.eventId)?.name ?? playoffsStore.eventId;
});

// ─── Preferences (issue #123) ──────────────────────────────────────────────────
// How teams are entered (dragging, or typing team numbers) and how the pool
// is ordered are remembered per device; the entry method can also be set on
// the Account page.

const preferences = loadPreferences();
const entryMode = ref(preferences.allianceEntry);
const useDrag = computed(() => isEditable.value && entryMode.value === 'drag');
const useTyping = computed(() => isEditable.value && entryMode.value === 'type');

function setEntryMode(mode: string) {
    entryMode.value = mode === 'type' ? 'type' : 'drag';
    savePreferences({ allianceEntry: entryMode.value });
}

const picklistLabel = computed(() => (playoffsStore.picklistSource === 'team' ? 'Team pick list' : 'My pick list'));

// The pick-list orders need a pick list: leads/admins use the team list,
// members their own, and observers have neither.
const poolOrderChoices = computed(() => {
    const choices = [{ key: 'tba', text: 'TBA ranking' }];
    if (playoffsStore.picklistSource) {
        choices.push({ key: 'picklist', text: picklistLabel.value });
        choices.push({ key: 'smart', text: 'Smart (captains, then pick list)' });
    }
    return choices;
});

const poolOrder = computed(() => (playoffsStore.picklistSource ? playoffsStore.poolOrder : 'tba'));

function setPoolOrder(order: string) {
    playoffsStore.setPoolOrder(order);
    savePreferences({ alliancePoolOrder: order });
}

const poolOrderHint = computed(() => {
    if (poolOrder.value === 'picklist') return `${picklistLabel.value} order (Scorer), then TBA rank for teams not on it.`;
    if (poolOrder.value === 'smart') {
        return `Teams in line to be alliance captains first, then ${picklistLabel.value.toLowerCase()} order (Scorer).`;
    }
    return 'Current TBA qualification ranking.';
});

const rankingsStatus = computed(() => {
    if (playoffsStore.rankingsError) return `Couldn't refresh TBA rankings: ${playoffsStore.rankingsError}`;
    if (!playoffsStore.hasRankings) return 'TBA has no rankings for this event yet, so teams are in team-number order.';
    if (!playoffsStore.rankingsFetchedAt) return '';
    const time = new Date(playoffsStore.rankingsFetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `TBA rankings as of ${time}.`;
});

const captainSet = computed(() => new Set(playoffsStore.captainEligible));

function isCaptain(teamNumber: number) {
    return poolOrder.value === 'smart' && captainSet.value.has(teamNumber);
}

// The corner label on a pool tile: the team's TBA rank, or its pick-list
// position when the pool is ordered by the pick list.
function poolBadge(teamNumber: number) {
    const rank = playoffsStore.rankings[teamNumber];
    const position = playoffsStore.picklistPosition[teamNumber];
    if (poolOrder.value === 'tba' || isCaptain(teamNumber)) return rank != null ? `#${rank}` : '';
    if (position != null) return `P${position}`;
    return rank != null ? `#${rank}` : '';
}

// ─── Loading ───────────────────────────────────────────────────────────────────

// Everything the pool is ordered by, for whichever event is on screen.
async function loadPoolOrdering() {
    await Promise.all([
        playoffsStore.loadPicklistOrder(authStore.currentUserId, authStore.isLead, authStore.isMember),
        playoffsStore.refreshRankings()
    ]);
}

onMounted(async () => {
    await authStore.checkUser();
    await eventStore.updateEvent();
    playoffsStore.poolOrder = preferences.alliancePoolOrder;
    await playoffsStore.load(eventStore.eventId, 'team', authStore.currentUserId);
    await Promise.all([playoffsStore.loadPastEvents(eventStore.eventId), loadPoolOrdering()]);
});

// Reloads the alliances/results and pulls the current TBA rankings and pick
// list again, in either mode.
const isRefreshing = ref(false);
async function refresh() {
    isRefreshing.value = true;
    await playoffsStore.load(playoffsStore.eventId);
    await loadPoolOrdering();
    isRefreshing.value = false;
}

async function setMode(mode: string) {
    if (playoffsStore.mode === mode) return;
    confirmingReset.value = false;
    await playoffsStore.load(playoffsStore.eventId, mode, authStore.currentUserId);
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
        await loadPoolOrdering();
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
    playoffsStore.sortPool();
    if (alliancesChanged.value) saveNow();
}

// An alliance only accepts a new team while it has an open slot; moving a
// team around within its own alliance is always allowed.
function allianceGroup(alliance: number[]) {
    return { name: 'playoff-teams', put: () => alliance.length < ALLIANCE_SIZE };
}

// ─── Typing team numbers (issue #123) ──────────────────────────────────────────
// The other way to fill alliances: click an open spot (Captain, Pick 1, …),
// type a team number, and press Enter. An alliance is an ordered list with
// no gaps, so the team takes the alliance's first open spot, and the cursor
// moves on to the next one. Each alliance has its own error.

// Keyed by `${alliance number}-${slot index}`.
const typedNumber = reactive<Record<string, string>>({});
const typedError = reactive<Record<number, string>>({});

function slotInput(allianceNumber: number, slotIndex: number) {
    return document.getElementById(`alliance-${allianceNumber}-slot-${slotIndex}`) as HTMLInputElement | null;
}

async function addTypedTeam(allianceNumber: number, slotIndex: number, focusNext = true) {
    const key = `${allianceNumber}-${slotIndex}`;
    const raw = String(typedNumber[key] ?? '').trim();
    if (!raw) return;
    const error = /^\d+$/.test(raw) ? playoffsStore.addTeamToAlliance(allianceNumber, Number(raw)) : 'Enter a team number.';
    typedError[allianceNumber] = error ?? '';
    if (error) return;
    typedNumber[key] = '';

    // Carry on in this alliance's next open spot, if it has one.
    if (focusNext) {
        await nextTick();
        slotInput(allianceNumber, playoffsStore.alliances[allianceNumber - 1].length)?.focus();
    }
    await saveNow();
}

// Tapping away from a spot enters what was typed, the same as Enter (a
// phone keyboard doesn't always send one). If it can't be entered, the
// error stays and the box is cleared, so it never looks like a team that
// isn't there.
async function leaveSlot(allianceNumber: number, slotIndex: number) {
    await addTypedTeam(allianceNumber, slotIndex, false);
    typedNumber[`${allianceNumber}-${slotIndex}`] = '';
}

async function removeTeam(teamNumber: number) {
    Object.keys(typedError).forEach((key) => { typedError[key] = ''; });
    playoffsStore.removeTeam(teamNumber);
    await saveNow();
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
                    title="Reload alliances and results, and pull the current TBA rankings" @click="refresh">
                    {{ isRefreshing ? 'Refreshing…' : '↻ Refresh' }}
                </button>
            </div>

            <div class="playoffs-mode" role="tablist" aria-label="Whose alliances">
                <button id="playoffs-mode-team" type="button" class="playoffs-mode-tab"
                    :class="{ 'playoffs-mode-tab--active': !isPersonal }" role="tab" :aria-selected="!isPersonal"
                    @click="setMode('team')">Team</button>
                <button id="playoffs-mode-personal" type="button" class="playoffs-mode-tab"
                    :class="{ 'playoffs-mode-tab--active': isPersonal }" role="tab" :aria-selected="isPersonal"
                    @click="setMode('personal')">My prediction</button>
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
                <span v-if="isViewingPastEvent && isPersonal">Your prediction for {{ displayEventName }} (read-only).</span>
                <span v-else-if="isViewingPastEvent">{{ displayEventName }}'s alliances and bracket (read-only).</span>
                <span v-else-if="isPersonal">Your own prediction of the alliances and bracket. Only you see it, and it
                    doesn't mark any team as picked. Changes save automatically.</span>
                <span v-else-if="isEditable">{{ useTyping ? 'Click a spot on an alliance, type a team number, and press Enter' : 'Drag teams by their ⠿ handle from the pool into alliances' }},
                    then click an alliance in the bracket to record who won. Changes save automatically, and teams placed on an
                    alliance are marked picked on the pick list.</span>
                <span v-else>Alliances and bracket results for the current event (read-only — leads and admins can edit).</span>
            </div>

            <div v-if="playoffsStore.loading && !playoffsStore.loaded" class="playoffs-loading">
                <div class="playoffs-spinner"></div>
                <span>Loading playoffs…</span>
            </div>

            <template v-else>
                <div v-if="playoffsStore.loadError" class="playoffs-banner playoffs-banner--err">
                    ⚠ Couldn't load {{ isPersonal ? 'your saved prediction' : 'the saved playoffs' }} for this event, so
                    editing is disabled to avoid overwriting anything. Try refreshing.
                </div>

                <div v-if="isEditable" class="playoffs-save-bar">
                    <label class="playoffs-option">
                        <span class="playoffs-filter-label">Enter teams by</span>
                        <select id="playoffs-entry-mode" class="playoffs-select" :value="entryMode"
                            @change="setEntryMode($event.target.value)">
                            <option v-for="choice in allianceEntryChoices" :key="choice.key" :value="choice.key">{{ choice.text }}</option>
                        </select>
                    </label>
                    <template v-if="!confirmingReset">
                        <button id="btn-reset-playoffs" type="button" class="playoffs-btn playoffs-btn--danger"
                            :title="isPersonal ? 'Clear your prediction' : 'Clear every alliance and bracket result'"
                            @click="confirmingReset = true">
                            ✕ {{ isPersonal ? 'Reset My Prediction' : 'Reset Playoffs' }}
                        </button>
                    </template>
                    <template v-else>
                        <span class="playoffs-confirm-text">{{ isPersonal ? 'Clear your whole prediction?' : 'Clear all alliances and results?' }}</span>
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
                        <h2>{{ isPersonal ? 'Predicted alliances' : 'Alliances' }}</h2>
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
                                    <div v-if="!useTyping" class="alliance-slot-bgs">
                                        <div v-for="(label, i) in SLOT_LABELS" :key="i" class="alliance-slot-bg">{{ label }}</div>
                                    </div>

                                    <draggable v-if="useDrag" :list="playoffsStore.alliances[number - 1]"
                                        :group="allianceGroup(playoffsStore.alliances[number - 1])"
                                        :item-key="(el) => el" animation="200" ghost-class="alliance-ghost"
                                        :force-fallback="true" :scroll="false" :handle="DRAG_HANDLE" class="alliance-slot-list"
                                        @start="startAutoscroll" @end="onDragEnd">
                                        <template #item="{ element: teamNumber }">
                                            <PlayoffsTeamChip :team-number="teamNumber"
                                                :team="playoffsStore.teamMap[teamNumber]" variant="slot" draggable />
                                        </template>
                                    </draggable>
                                    <!-- Typing: every open spot is its own box. -->
                                    <div v-else-if="useTyping" class="alliance-slot-list">
                                        <template v-for="(label, i) in SLOT_LABELS" :key="i">
                                            <PlayoffsTeamChip v-if="playoffsStore.alliances[number - 1][i] != null"
                                                :team-number="playoffsStore.alliances[number - 1][i]"
                                                :team="playoffsStore.teamMap[playoffsStore.alliances[number - 1][i]]"
                                                variant="slot" removable
                                                @remove="removeTeam(playoffsStore.alliances[number - 1][i])" />
                                            <input v-else :id="`alliance-${number}-slot-${i}`" v-model="typedNumber[`${number}-${i}`]"
                                                type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done"
                                                class="alliance-slot-input" :placeholder="label" autocomplete="off"
                                                :aria-label="`Team number for Alliance ${number}, ${label}`"
                                                @input="typedError[number] = ''" @keydown.enter.prevent="addTypedTeam(number, i)"
                                                @blur="leaveSlot(number, i)" />
                                        </template>
                                    </div>
                                    <div v-else class="alliance-slot-list">
                                        <PlayoffsTeamChip v-for="teamNumber in playoffsStore.alliances[number - 1]"
                                            :key="teamNumber" :team-number="teamNumber"
                                            :team="playoffsStore.teamMap[teamNumber]" variant="slot" />
                                    </div>
                                </div>

                                <p v-if="useTyping && typedError[number]" class="alliance-type-error">{{ typedError[number] }}</p>
                            </div>
                        </div>
                    </section>

                    <!-- Unpicked pool -->
                    <section class="playoffs-pool-section">
                        <h2>Available Teams <span class="playoffs-count">{{ playoffsStore.pool.length }}</span></h2>
                        <label class="playoffs-option playoffs-option--block">
                            <span class="playoffs-filter-label">Order by</span>
                            <select id="playoffs-pool-order" class="playoffs-select" :value="poolOrder"
                                @change="setPoolOrder($event.target.value)">
                                <option v-for="choice in poolOrderChoices" :key="choice.key" :value="choice.key">{{ choice.text }}</option>
                            </select>
                        </label>
                        <p class="playoffs-pool-hint">{{ poolOrderHint }} {{ rankingsStatus }}</p>
                        <input v-model="poolSearch" type="search" class="playoffs-search" placeholder="Search team # or name…"
                            aria-label="Search available teams" />

                        <draggable v-if="useDrag" :list="playoffsStore.pool" group="playoff-teams" :sort="false"
                            :item-key="(el) => el" animation="200" ghost-class="alliance-ghost" :force-fallback="true"
                            :scroll="false" :handle="DRAG_HANDLE" class="playoffs-pool" id="playoffs-pool" @start="startAutoscroll"
                            @end="onDragEnd">
                            <template #item="{ element: teamNumber }">
                                <PlayoffsTeamChip v-show="matchesSearch(teamNumber)" :team-number="teamNumber"
                                    :team="playoffsStore.teamMap[teamNumber]" variant="tile" draggable
                                    :badge="poolBadge(teamNumber)" :captain="isCaptain(teamNumber)" />
                            </template>
                        </draggable>
                        <div v-else class="playoffs-pool">
                            <PlayoffsTeamChip v-for="teamNumber in playoffsStore.pool" v-show="matchesSearch(teamNumber)"
                                :key="teamNumber" :team-number="teamNumber" :team="playoffsStore.teamMap[teamNumber]"
                                variant="tile" :badge="poolBadge(teamNumber)" :captain="isCaptain(teamNumber)" />
                        </div>

                        <div v-if="playoffsStore.pool.length === 0" class="playoffs-pool-empty">
                            {{ playoffsStore.teams.length === 0 ? 'No teams found for this event.' : 'Every team has been placed on an alliance.' }}
                        </div>
                    </section>
                </div>

                <!-- Bracket -->
                <section class="playoffs-bracket-section">
                    <h2>{{ isPersonal ? 'Predicted bracket' : 'Bracket' }}</h2>
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

/* ── Team / My prediction (issue #123) ── */
.playoffs-mode {
    display: inline-flex;
    margin: 8px 0 2px;
    border-radius: 10px;
    overflow: hidden;
    border: 1.5px solid rgba(128, 128, 128, 0.35);
}

.playoffs-mode-tab {
    background: transparent;
    border: none;
    padding: 9px 18px;
    min-height: 44px;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--primary-text-color);
    cursor: pointer;
}

.playoffs-mode-tab + .playoffs-mode-tab {
    border-left: 1.5px solid rgba(128, 128, 128, 0.35);
}

.playoffs-mode-tab--active {
    background: #b05703;
    color: #fff;
}

/* ── Options: entry method and pool order ── */
.playoffs-option {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    margin-right: auto;
}

.playoffs-option--block {
    display: flex;
    margin: 0 0 6px;
}

.playoffs-select {
    padding: 7px 10px;
    min-height: 36px;
    border-radius: 8px;
    border: 1.5px solid rgba(128, 128, 128, 0.35);
    background: var(--tile-background-color);
    color: var(--primary-text-color);
    font: inherit;
    font-size: 13px;
    max-width: 100%;
}

.playoffs-option--block .playoffs-select {
    flex: 1;
    min-width: 0;
}

.playoffs-pool-hint {
    font-size: 12px;
    color: rgba(128, 128, 128, 0.85);
    margin: 0 0 8px;
}

/* ── Typing team numbers into an alliance: an open spot is a text box that
   looks like the dashed empty slot, with its name as the placeholder. ── */
.alliance-slot-input {
    width: 100%;
    height: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 0 10px;
    border: 1.5px dashed rgba(128, 128, 128, 0.4);
    border-radius: 8px;
    background: transparent;
    color: var(--primary-text-color);
    font: inherit;
    font-size: 16px;
    font-weight: 700;
    cursor: text;
}

.alliance-slot-input::placeholder {
    font-size: 11px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(128, 128, 128, 0.7);
}

.alliance-slot-input:hover {
    border-color: rgba(176, 87, 3, 0.6);
}

.alliance-slot-input:focus {
    outline: none;
    border-style: solid;
    border-color: #b05703;
}

.alliance-type-error {
    margin: 6px 0 0;
    font-size: 12px;
    color: #d32f2f;
}
</style>
