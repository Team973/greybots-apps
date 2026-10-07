<script setup lang="ts">
// @ts-nocheck
import { ref, computed, watch, onMounted } from 'vue';
import draggable from 'vuedraggable';
import Papa from 'papaparse';
import { usePicklistStore } from '@/stores/picklist-store';
import { useAuthStore } from '@/stores/auth-store';
import { useEventStore } from '@/stores/event-store';
import { useOfflineQueueStore } from '@/stores/offline-queue-store';
import { useWatchlistStore } from '@/stores/watchlist-store';
import { TIERS, TIER_GROUPS } from '@/lib/picklist-query';
import { refreshTbaStats } from '@/lib/tba-cache';
import { useDragAutoscroll } from '@greybots/common/lib/drag-autoscroll';
import PicklistRow from '@/components/PicklistRow.vue';
import PicklistUnrankedCard from '@/components/PicklistUnrankedCard.vue';
import SearchableDropdown from '@greybots/common/components/SearchableDropdown.vue';

const picklistStore = usePicklistStore();
const authStore = useAuthStore();
const eventStore = useEventStore();
const queueStore = useOfflineQueueStore();
const watchlistStore = useWatchlistStore();

// Which row is expanded
const expandedTeam = ref<number | null>(null);
const expandedData = ref<{ stats: unknown[]; comments: unknown[] } | null>(null);
const expandedLoading = ref(false);

const isOnline = ref(navigator.onLine);
window.addEventListener('online', () => { isOnline.value = true; });
window.addEventListener('offline', () => { isOnline.value = false; });

// ─── Drag autoscroll ────────────────────────────────────────────────────────────
// Sortable's built-in autoscroll is unreliable in this app (the whole SPA
// scrolls inside #app, not the window), so a shared self-contained loop drives
// it off the @start/@end drag events instead — see src/lib/drag-autoscroll.ts
// for the full write-up, including why it scrolls instantly at a fixed
// fraction of the nominal speed rather than calling a smooth scrollBy per
// frame (Chrome and Safari crawl at a flat ~180 px/s that way). Speed is
// proportional to how far into the 80px edge zone the pointer is.
const { startAutoscroll: onDragStart, stopAutoscroll: onDragEnd } = useDragAutoscroll();

// ─── Computed helpers ──────────────────────────────────────────────────────────

const isLead = computed(() => authStore.isLead);
const isAdmin = computed(() => authStore.isAdmin);
const isObserver = computed(() => authStore.isObserver);
const userId = computed(() => authStore.currentUserId);
const eventId = computed(() => eventStore.eventId);

const activeTab = computed({
    get: () => picklistStore.activeTab,
    set: (v) => picklistStore.setTab(v)
});

// Scorer/Defender "super tab" (issue #27) — an independent ranking axis
// alongside My/Democratic/Team List.
const activeArchetype = computed({
    get: () => picklistStore.activeArchetype,
    set: (v) => picklistStore.setArchetype(v)
});

const isEditable = computed(() =>
    !picklistStore.viewingPastEventId && (
        (activeTab.value === 'personal' && !picklistStore.viewingScoutUserId) ||
        (activeTab.value === 'team' && isLead.value)
    )
);

// Whichever event's data is actually being displayed — the current event,
// unless a lead/admin has selected a prior event to view read-only (issue
// #58), which only applies to the Democratic/Team List tabs.
const displayEventId = computed(() =>
    (picklistStore.viewingPastEventId && activeTab.value !== 'personal')
        ? picklistStore.viewingPastEventId
        : eventId.value
);

// An expanded row's stats/comments are fetched once, on click, for whichever
// event was active at that moment (see toggleExpand) — they don't
// auto-refresh. Collapse on any change of displayEventId (e.g. switching
// into/out of the Team List's prior-event filter) so a still-expanded row
// can never keep showing a different event's data under the new context.
watch(displayEventId, () => {
    expandedTeam.value = null;
    expandedData.value = null;
});

// Vote (tier) stats are only meaningful once more than one person's ranking
// is in play — shown on the Team tab (leads deciding) and the Democratic tab.
const showVoteStats = computed(() => activeTab.value !== 'personal');

// The picked checkbox reflects real-world alliance selection. It's only
// shown (and only ever editable) on the official Team tab — not on a
// scout's own personal draft ranking, and not on the read-only Democratic
// aggregate.
const showPickedCheckbox = computed(() => activeTab.value === 'team' && !picklistStore.viewingPastEventId);

const hasDemocraticVotes = computed(() => {
    if (picklistStore.viewingPastEventId && activeTab.value !== 'personal') {
        return Object.keys(picklistStore.viewedPastEventTierStats).length > 0;
    }
    return Object.keys(picklistStore.teamTierStats[activeArchetype.value]).length > 0;
});

// ─── Loading ───────────────────────────────────────────────────────────────────

onMounted(async () => {
    await authStore.checkUser();
    if (isObserver.value) return;
    await eventStore.updateEvent();
    await picklistStore.loadAll(eventId.value, userId.value, isLead.value);
    await watchlistStore.loadWatchlist(eventId.value);
    if (isAdmin.value) {
        await picklistStore.loadScoutRoster(userId.value);
    }
    if (isLead.value) {
        await picklistStore.loadPastEvents(eventId.value);
    }
});

// ─── Admin scout filter (issue #56) ────────────────────────────────────────────
// Lets an admin pull up a read-only view of one scout's personal pick list.
// Kept out of personalTierSections entirely (see viewScoutList) so it can
// never be saved over the viewing admin's own list.

const scoutFilterChoices = computed(() => [
    { key: '', text: 'My List' },
    ...picklistStore.scoutRoster.map((s) => ({ key: s.user_id, text: s.name }))
]);

const selectedScoutId = computed({
    get: () => picklistStore.viewingScoutUserId ?? '',
    set: async (scoutUserId: string) => {
        if (!scoutUserId) {
            picklistStore.clearScoutFilter();
            return;
        }
        const scout = picklistStore.scoutRoster.find((s) => s.user_id === scoutUserId);
        await picklistStore.viewScoutList(scoutUserId, scout?.name ?? 'Unknown', eventId.value, activeArchetype.value);
    }
});

function clearScoutFilter() {
    picklistStore.clearScoutFilter();
}

// The Scorer/Defender archetype tabs apply to the filtered scout's list too
// — a personal picklist is stored per archetype, so switching archetype
// while a filter is active has to re-fetch that scout's other list.
watch(activeArchetype, async (archetype) => {
    if (!picklistStore.viewingScoutUserId) return;
    await picklistStore.viewScoutList(
        picklistStore.viewingScoutUserId, picklistStore.viewingScoutName, eventId.value, archetype
    );
});

// ─── Lead/admin prior-event filter (issue #58) ─────────────────────────────────
// Lets a lead/admin pull up a read-only view of a past event's Democratic or
// Team List — only on those two tabs, since a personal list is per-user
// (issue #56's scout filter already covers that) rather than a "team" record
// worth reviewing historically.

const pastEventChoices = computed(() => [
    { key: '', text: 'Current Event' },
    ...picklistStore.pastEvents.map((e) => ({ key: e.event_id, text: e.name }))
]);

const selectedPastEventId = computed({
    get: () => picklistStore.viewingPastEventId ?? '',
    set: async (pastEventId: string) => {
        if (!pastEventId) {
            picklistStore.clearPastEventFilter();
            return;
        }
        const event = picklistStore.pastEvents.find((e) => e.event_id === pastEventId);
        const tab = activeTab.value === 'team' ? 'team' : 'democratic';
        await picklistStore.viewPastEvent(pastEventId, event?.name ?? pastEventId, tab, activeArchetype.value);
    }
});

function clearPastEventFilter() {
    picklistStore.clearPastEventFilter();
}

// Re-fetch the viewed past event's data whenever the tab (Democratic <->
// Team List) or archetype changes while the filter is active — both change
// which saved list/stats apply.
watch(activeTab, async (tab) => {
    if (!picklistStore.viewingPastEventId) return;
    if (tab !== 'democratic' && tab !== 'team') return;
    await picklistStore.loadViewedPastEventData(tab, activeArchetype.value);
});

watch(activeArchetype, async (archetype) => {
    if (!picklistStore.viewingPastEventId) return;
    if (activeTab.value !== 'democratic' && activeTab.value !== 'team') return;
    await picklistStore.loadViewedPastEventData(activeTab.value, archetype);
});

// ─── Expand / collapse row ────────────────────────────────────────────────────

async function toggleExpand(teamNumber: number) {
    if (expandedTeam.value === teamNumber) {
        expandedTeam.value = null;
        expandedData.value = null;
        return;
    }
    expandedTeam.value = teamNumber;
    expandedData.value = null;
    expandedLoading.value = true;

    expandedData.value = await picklistStore.getTeamData(teamNumber, displayEventId.value);
    expandedLoading.value = false;
}

// ─── Picked toggle ─────────────────────────────────────────────────────────────

async function togglePicked(teamNumber: number) {
    if (!isLead.value || picklistStore.viewingPastEventId) return;
    await picklistStore.togglePicked(eventId.value, teamNumber);
}

// ─── Watchlist toggle ──────────────────────────────────────────────────────────

async function toggleWatch(teamNumber: number) {
    if (!isLead.value || picklistStore.viewingPastEventId) return;
    await watchlistStore.toggleWatch(eventId.value, teamNumber);
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function saveList() {
    let success = false;

    if (activeTab.value === 'personal' && userId.value) {
        success = await picklistStore.savePersonalList(userId.value, eventId.value, activeArchetype.value);
        if (!success) {
            // Enqueue for later
            queueStore.enqueue('picklist_personal', {
                userId: userId.value,
                eventId: eventId.value,
                archetype: activeArchetype.value,
                teamNumbers: picklistStore.personalFlatOrder(activeArchetype.value),
                teamTiers: picklistStore.personalTiersMap(activeArchetype.value)
            }, picklistStore.lastSaveError ?? undefined);
        }
    } else if (activeTab.value === 'team' && isLead.value) {
        success = await picklistStore.saveTeamList(eventId.value, activeArchetype.value);
        if (!success) {
            queueStore.enqueue('picklist_team', {
                eventId: eventId.value,
                archetype: activeArchetype.value,
                teamNumbers: picklistStore.teamFlatOrder(activeArchetype.value),
                teamTiers: picklistStore.teamTiersMap(activeArchetype.value)
            }, picklistStore.lastSaveError ?? undefined);
        }
    }
}

// ─── Refresh Democratic ───────────────────────────────────────────────────────

const isRefreshingDemocratic = ref(false);
async function refreshDemocratic() {
    isRefreshingDemocratic.value = true;
    if (picklistStore.viewingPastEventId) {
        await picklistStore.loadViewedPastEventData('democratic', activeArchetype.value);
    } else {
        await picklistStore.loadDemocraticList(eventId.value, activeArchetype.value);
    }
    isRefreshingDemocratic.value = false;
}

// ─── Refresh TBA Stats (issue #26) ────────────────────────────────────────────
// Read-only pull (no DB write), so available to everyone, not just leads.

const isRefreshingTbaStats = ref(false);
// Bumped after a refresh: the stats come from localStorage, which isn't
// reactive, so the rows are re-keyed on this to pick up the new numbers.
const tbaStatsVersion = ref(0);
const tbaStatsError = ref('');

async function refreshTbaStatsForEvent() {
    isRefreshingTbaStats.value = true;
    tbaStatsError.value = '';
    try {
        await refreshTbaStats(eventId.value);
        tbaStatsVersion.value += 1;
    } catch (e) {
        tbaStatsError.value = e.message ?? String(e);
    }
    isRefreshingTbaStats.value = false;
}

// ─── Reset Team List from Democratic ──────────────────────────────────────────

async function resetTeamFromDemocratic() {
    picklistStore.resetTeamListFromDemocratic(activeArchetype.value);
    await saveList();
}

// ─── Reset Team List to empty ─────────────────────────────────────────────────

const confirmingTeamReset = ref(false);
async function resetTeamListEmpty() {
    picklistStore.resetTeamList(activeArchetype.value);
    confirmingTeamReset.value = false;
    await saveList();
}

// ─── Reset My List to empty ────────────────────────────────────────────────────

const confirmingPersonalReset = ref(false);
async function resetPersonalListEmpty() {
    picklistStore.resetPersonalList(activeArchetype.value);
    confirmingPersonalReset.value = false;
    await saveList();
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportTeamListCsv() {
    const rows: Record<string, unknown>[] = [];
    let rank = 0;
    TIER_GROUPS.forEach((group) => {
        (picklistStore.teamTierSections[activeArchetype.value][group] ?? []).forEach((teamNumber) => {
            const team = picklistStore.teamMap[teamNumber];
            if (!team) return;
            rank += 1;
            rows.push({
                rank,
                tier: group,
                team_number: team.team_number,
                name: team.name,
                picked: picklistStore.isTeamPicked(teamNumber)
            });
        });
    });

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `team-picklist-${eventId.value}-${activeArchetype.value}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ─── Tier stats (Democratic / Team tabs) ──────────────────────────────────────

function tierStatsFor(teamNumber: number) {
    return picklistStore.activeTierStatsFor(teamNumber);
}

function tierGroupLabel(group: string) {
    return group === 'Unranked' ? 'Unranked' : group;
}

// The orange number is the overall rank across the whole list, not a
// per-tier count — so it keeps climbing across tier section boundaries.
function groupRankOffset(group: string) {
    const sections = picklistStore.activeSections;
    let offset = 0;
    for (const g of TIER_GROUPS) {
        if (g === group) break;
        offset += (sections[g] ?? []).length;
    }
    return offset;
}

// ─── Inline stats (issue #123) ─────────────────────────────────────────────────
// Shows each ranked team's stats on its collapsed row, so teams can be
// compared at a glance instead of expanding them one at a time. Remembered
// per device.
const inlineStatsKey = 'greyscout_picklist_inline_stats';

function loadInlineStatsPreference() {
    try {
        return localStorage.getItem(inlineStatsKey) === '1';
    } catch {
        return false;
    }
}

const showInlineStats = ref(loadInlineStatsPreference());

function toggleInlineStats() {
    showInlineStats.value = !showInlineStats.value;
    try {
        localStorage.setItem(inlineStatsKey, showInlineStats.value ? '1' : '0');
    } catch {
        // Private browsing or blocked storage: the switch still works for this visit.
    }
}

// ─── Collapsible tier sections ─────────────────────────────────────────────────
// Collapsing tiers you're not actively sorting shortens the page, which makes
// dragging a team from "Unranked" into a tier near the top much less of a
// scroll marathon as the list fills in.
const collapsedTiers = ref<Set<string>>(new Set());

function isTierCollapsed(group: string) {
    return collapsedTiers.value.has(group);
}

function toggleTierCollapse(group: string) {
    const next = new Set(collapsedTiers.value);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    collapsedTiers.value = next;
}
</script>

<template>
    <div class="main-content">
        <div class="picklist-page" v-if="isObserver">
            <div class="picklist-empty">
                <div class="picklist-empty-icon">🔒</div>
                <h2>Not available</h2>
                <p>Observers do not have access to the pick list.</p>
            </div>
        </div>
        <div class="picklist-page" v-else>
            <!-- Page header -->
            <div class="picklist-header">
                <h1>Pick List</h1>
                <div class="picklist-event-name">{{ eventStore.eventName }}</div>
                <button type="button" class="picklist-reset-btn picklist-tba-refresh-btn" :disabled="isRefreshingTbaStats"
                    title="Re-pull OPR/DPR from The Blue Alliance for this event" @click="refreshTbaStatsForEvent">
                    {{ isRefreshingTbaStats ? 'Refreshing TBA Stats…' : '↻ Refresh TBA Stats' }}
                </button>
            </div>
            <p v-if="tbaStatsError" class="picklist-tba-error">{{ tbaStatsError }}</p>

            <!-- Archetype super tabs (issue #27) — Scorer/Defender are independent rankings -->
            <div class="picklist-archetype-tabs" role="tablist">
                <button id="archetype-scorer" class="picklist-archetype-tab"
                    :class="{ 'picklist-archetype-tab--active': activeArchetype === 'scorer' }" role="tab"
                    :aria-selected="activeArchetype === 'scorer'" @click="activeArchetype = 'scorer'">
                    Scorer
                </button>
                <button id="archetype-defender" class="picklist-archetype-tab"
                    :class="{ 'picklist-archetype-tab--active': activeArchetype === 'defender' }" role="tab"
                    :aria-selected="activeArchetype === 'defender'" @click="activeArchetype = 'defender'">
                    Defender
                </button>
            </div>

            <!-- Tab bar, with the inline stats toggle on its right -->
            <div class="picklist-tab-bar">
                <div class="picklist-tabs" role="tablist">
                    <button id="tab-personal" class="picklist-tab" :class="{ 'picklist-tab--active': activeTab === 'personal' }"
                        role="tab" :aria-selected="activeTab === 'personal'" @click="activeTab = 'personal'">
                        My List
                    </button>
                    <button v-if="isLead" id="tab-democratic" class="picklist-tab"
                        :class="{ 'picklist-tab--active': activeTab === 'democratic' }" role="tab"
                        :aria-selected="activeTab === 'democratic'" @click="activeTab = 'democratic'">
                        Democratic
                    </button>
                    <button v-if="isLead" id="tab-team" class="picklist-tab"
                        :class="{ 'picklist-tab--active': activeTab === 'team' }" role="tab"
                        :aria-selected="activeTab === 'team'" @click="activeTab = 'team'">
                        Team List
                    </button>
                </div>
                <label class="picklist-inline-toggle" title="Show each ranked team's stats on its row, without expanding it">
                    <input id="toggle-inline-stats" type="checkbox" role="switch" :checked="showInlineStats"
                        @change="toggleInlineStats" />
                    Show stats on each team
                </label>
            </div>

            <!-- Admin scout filter (issue #56) — pull up a read-only view of one
                 scout's personal list, only on the My List tab. -->
            <div v-if="isAdmin && activeTab === 'personal'" class="picklist-scout-filter">
                <span class="picklist-scout-filter-label">View scout's list:</span>
                <SearchableDropdown :choices="scoutFilterChoices" :model-value="selectedScoutId"
                    placeholder="Search scouts…" @update:modelValue="selectedScoutId = $event"></SearchableDropdown>
                <button v-if="picklistStore.viewingScoutUserId" id="btn-clear-scout-filter" type="button"
                    class="picklist-reset-btn" title="Return to your own editable list" @click="clearScoutFilter">
                    ✕ Clear Filter
                </button>
            </div>

            <!-- Lead/admin prior-event filter (issue #58) — pull up a
                 read-only view of a past event's Democratic or Team List. -->
            <div v-if="isLead && (activeTab === 'democratic' || activeTab === 'team')" class="picklist-scout-filter">
                <span class="picklist-scout-filter-label">View prior event:</span>
                <SearchableDropdown :choices="pastEventChoices" :model-value="selectedPastEventId"
                    placeholder="Search events…" @update:modelValue="selectedPastEventId = $event"></SearchableDropdown>
                <button v-if="picklistStore.viewingPastEventId" id="btn-clear-past-event-filter" type="button"
                    class="picklist-reset-btn" title="Return to the current event" @click="clearPastEventFilter">
                    ✕ Clear Filter
                </button>
            </div>

            <!-- Tab description -->
            <div class="picklist-tab-description">
                <span v-if="activeTab === 'personal' && picklistStore.viewingScoutUserId">
                    {{ picklistStore.viewingScoutName }}'s personal tier ranking (read-only).</span>
                <span v-else-if="activeTab === 'personal'">Your personal tier ranking. Drag rows between tiers or reorder
                    within a tier, then save.</span>
                <span v-else-if="picklistStore.viewingPastEventId">{{ picklistStore.viewingPastEventName }}'s
                    {{ activeTab === 'team' ? 'team pick list' : 'democratic ranking' }} (read-only).</span>
                <span v-else-if="activeTab === 'democratic'">Aggregated tier ranking from all scouts' personal lists
                    (read-only).</span>
                <span v-else>Official team pick list — only leads can edit. Drag between tiers, then save.</span>
            </div>

            <!-- Loading state -->
            <div v-if="!picklistStore.teamsLoaded || (picklistStore.viewingScoutUserId && picklistStore.viewedScoutListLoading) || (picklistStore.viewingPastEventId && picklistStore.viewedPastEventListLoading)"
                class="picklist-loading">
                <div class="picklist-spinner"></div>
                <span>Loading teams…</span>
            </div>

            <!-- Empty state -->
            <div v-else-if="(picklistStore.viewingPastEventId ? picklistStore.viewedPastEventTeams : picklistStore.allTeams).length === 0"
                class="picklist-empty">
                <div class="picklist-empty-icon">🤖</div>
                <h2>No teams found</h2>
                <p>No team data is available for {{ picklistStore.viewingPastEventId ? 'that event' : 'the current event' }}.</p>
            </div>

            <!-- List -->
            <div v-else class="picklist-list-wrapper">
                <!-- Save / status bar -->
                <div class="picklist-save-bar" v-if="isEditable">
                    <button v-if="activeTab === 'team'" id="btn-reset-democratic" class="picklist-reset-btn"
                        :disabled="picklistStore.isSaving || !hasDemocraticVotes"
                        title="Overwrite the team list with the current democratic tier grouping" @click="resetTeamFromDemocratic">
                        ↺ Reset from Democratic
                    </button>
                    <button v-if="activeTab === 'team'" id="btn-export-team-csv" class="picklist-reset-btn"
                        title="Download the current team pick list as a CSV" @click="exportTeamListCsv">
                        ⬇ Export CSV
                    </button>
                    <template v-if="activeTab === 'team' && !confirmingTeamReset">
                        <button id="btn-reset-team-list" class="picklist-reset-btn picklist-reset-btn--danger"
                            title="Clear the entire team pick list" @click="confirmingTeamReset = true">
                            ✕ Reset Team List
                        </button>
                    </template>
                    <template v-else-if="activeTab === 'team'">
                        <span class="picklist-confirm-text">Clear the entire team list?</span>
                        <button id="btn-cancel-team-reset" class="picklist-reset-btn" @click="confirmingTeamReset = false">
                            Cancel
                        </button>
                        <button id="btn-confirm-team-reset" class="picklist-reset-btn picklist-reset-btn--danger"
                            @click="resetTeamListEmpty">
                            Yes, Clear It
                        </button>
                    </template>
                    <template v-if="activeTab === 'personal' && !confirmingPersonalReset">
                        <button id="btn-reset-personal-list" class="picklist-reset-btn picklist-reset-btn--danger"
                            title="Unrank every team on your personal list" @click="confirmingPersonalReset = true">
                            ✕ Reset My List
                        </button>
                    </template>
                    <template v-else-if="activeTab === 'personal'">
                        <span class="picklist-confirm-text">Unrank every team on your list?</span>
                        <button id="btn-cancel-personal-reset" class="picklist-reset-btn"
                            @click="confirmingPersonalReset = false">
                            Cancel
                        </button>
                        <button id="btn-confirm-personal-reset" class="picklist-reset-btn picklist-reset-btn--danger"
                            @click="resetPersonalListEmpty">
                            Yes, Clear It
                        </button>
                    </template>
                    <transition name="fade">
                        <span v-if="picklistStore.lastSaveSuccess" class="save-status save-status--ok">
                            ✓ Saved
                        </span>
                        <span v-else-if="picklistStore.lastSaveError" class="save-status save-status--err">
                            ⚠ Save failed — queued for retry
                        </span>
                    </transition>
                    <button id="btn-save-picklist" class="picklist-save-btn" :disabled="picklistStore.isSaving"
                        @click="saveList">
                        {{ picklistStore.isSaving ? 'Saving…' : 'Save List' }}
                    </button>
                </div>

                <!-- Democratic bar -->
                <div class="picklist-save-bar" v-else-if="activeTab === 'democratic'">
                    <button id="btn-refresh-democratic" class="picklist-save-btn" :disabled="isRefreshingDemocratic"
                        @click="refreshDemocratic">
                        <span v-if="isRefreshingDemocratic">Refreshing…</span>
                        <span v-else>↻ Refresh</span>
                    </button>
                </div>

                <!-- Democratic hint -->
                <div v-if="activeTab === 'democratic' && !hasDemocraticVotes" class="picklist-empty">
                    <p>No personal lists have been submitted yet — submit yours on the "My List" tab first.</p>
                </div>

                <!-- Tier-grouped sections: ranked tiers on the left, the
                     Unranked pool (bigger grid squares — photo/number/watch
                     only) on the right on desktop, stacked below on mobile. -->
                <div v-else class="picklist-columns" :key="tbaStatsVersion">
                    <div class="tier-sections-ranked">
                        <div v-for="group in TIERS" :key="group" class="tier-section">
                            <div class="tier-section-header" :class="`tier-section-header--${group}`"
                                @click="toggleTierCollapse(group)">
                                <span class="tier-section-collapse-icon"
                                    :class="{ 'tier-section-collapse-icon--collapsed': isTierCollapsed(group) }">▾</span>
                                <span class="tier-section-name">{{ tierGroupLabel(group) }}</span>
                                <span class="tier-section-count">{{ (picklistStore.activeSections[group] || []).length }}</span>
                            </div>

                            <!-- Editable: draggable within and across tier sections -->
                            <draggable v-if="isEditable" v-show="!isTierCollapsed(group)" :list="picklistStore.activeSections[group]"
                                group="picklist" :item-key="(el) => el" handle=".picklist-drag-handle" animation="200"
                                ghost-class="picklist-row--ghost" :force-fallback="true" :scroll="false"
                                class="tier-section-body" @start="onDragStart" @end="onDragEnd" @change="saveList">
                                <template #item="{ element: teamNumber, index }">
                                    <PicklistRow :row-id="`picklist-team-${teamNumber}`" :team="picklistStore.activeTeamMap[teamNumber]"
                                        :event-id="displayEventId"
                                        :position="groupRankOffset(group) + index + 1" :show-drag-handle="true" :show-vote-stats="showVoteStats"
                                        :tier-stats="tierStatsFor(teamNumber)" :show-picked="showPickedCheckbox"
                                        :is-picked="picklistStore.isTeamPicked(teamNumber)"
                                        :can-toggle-picked="isLead && !picklistStore.viewingPastEventId" :card-status="picklistStore.activeCardStatusFor(teamNumber)"
                                        :watched="watchlistStore.isWatched(teamNumber)"
                                        :can-toggle-watch="isLead && !picklistStore.viewingPastEventId" :expanded="expandedTeam === teamNumber"
                                        :expanded-data="expandedData" :expanded-loading="expandedLoading" :pit-summary="picklistStore.activePitSummaryFor(teamNumber)" :match-summary="picklistStore.activeMatchSummaryFor(teamNumber)" :show-inline-stats="showInlineStats"
                                        @toggle-expand="toggleExpand(teamNumber)" @toggle-picked="togglePicked(teamNumber)"
                                        @toggle-watch="toggleWatch(teamNumber)" />
                                </template>
                            </draggable>

                            <!-- Read-only (democratic tab) -->
                            <div v-else v-show="!isTierCollapsed(group)" class="tier-section-body tier-section-body--static">
                                <PicklistRow v-for="(teamNumber, index) in picklistStore.activeSections[group]" :key="teamNumber"
                                    :row-id="`picklist-team-demo-${teamNumber}`" :team="picklistStore.activeTeamMap[teamNumber]"
                                    :event-id="displayEventId"
                                    :position="groupRankOffset(group) + index + 1" :show-drag-handle="false" :show-vote-stats="showVoteStats"
                                    :tier-stats="tierStatsFor(teamNumber)" :show-picked="showPickedCheckbox"
                                    :is-picked="picklistStore.isTeamPicked(teamNumber)"
                                    :can-toggle-picked="isLead && !picklistStore.viewingPastEventId" :card-status="picklistStore.activeCardStatusFor(teamNumber)"
                                    :watched="watchlistStore.isWatched(teamNumber)"
                                    :can-toggle-watch="isLead && !picklistStore.viewingPastEventId" :expanded="expandedTeam === teamNumber"
                                    :expanded-data="expandedData" :expanded-loading="expandedLoading" :pit-summary="picklistStore.activePitSummaryFor(teamNumber)" :match-summary="picklistStore.activeMatchSummaryFor(teamNumber)" :show-inline-stats="showInlineStats"
                                    @toggle-expand="toggleExpand(teamNumber)" @toggle-picked="togglePicked(teamNumber)"
                                    @toggle-watch="toggleWatch(teamNumber)" />
                            </div>

                            <div v-if="!isTierCollapsed(group) && (picklistStore.activeSections[group] || []).length === 0"
                                class="tier-section-empty">
                                {{ isEditable ? 'Drag teams here' : 'No teams in this tier' }}
                            </div>
                        </div>
                    </div>

                    <div class="tier-section tier-section-unranked">
                        <div class="tier-section-header tier-section-header--Unranked" @click="toggleTierCollapse('Unranked')">
                            <span class="tier-section-collapse-icon"
                                :class="{ 'tier-section-collapse-icon--collapsed': isTierCollapsed('Unranked') }">▾</span>
                            <span class="tier-section-name">Unranked</span>
                            <span class="tier-section-count">{{ (picklistStore.activeSections['Unranked'] || []).length }}</span>
                        </div>

                        <!-- Editable: same cross-tier drag group as the ranked
                             lists above, so a team can be dragged either way
                             between here and a ranked tier. Uses a real
                             `handle`, same as every ranked tier's draggable —
                             see PicklistUnrankedCard.vue for why relying on
                             whole-card-drag + a `filter` exclusion instead
                             broke both the move itself and every other list's
                             dragging afterward. -->
                        <draggable v-if="isEditable" v-show="!isTierCollapsed('Unranked')" :list="picklistStore.activeSections['Unranked']"
                            group="picklist" :item-key="(el) => el" handle=".unranked-card-handle" animation="200"
                            ghost-class="unranked-card--ghost" :force-fallback="true" :scroll="false"
                            class="unranked-grid" @start="onDragStart" @end="onDragEnd" @change="saveList">
                            <template #item="{ element: teamNumber }">
                                <PicklistUnrankedCard :row-id="`picklist-unranked-${teamNumber}`" :team="picklistStore.activeTeamMap[teamNumber]"
                                    :watched="watchlistStore.isWatched(teamNumber)" :can-toggle-watch="isLead && !picklistStore.viewingPastEventId"
                                    :expanded="expandedTeam === teamNumber" :expanded-data="expandedData"
                                    :expanded-loading="expandedLoading" :pit-summary="picklistStore.activePitSummaryFor(teamNumber)" @toggle-expand="toggleExpand(teamNumber)"
                                    @toggle-watch="toggleWatch(teamNumber)" />
                            </template>
                        </draggable>

                        <!-- Read-only (democratic tab) -->
                        <div v-else v-show="!isTierCollapsed('Unranked')" class="unranked-grid">
                            <PicklistUnrankedCard v-for="teamNumber in picklistStore.activeSections['Unranked']" :key="teamNumber"
                                :row-id="`picklist-unranked-demo-${teamNumber}`" :team="picklistStore.activeTeamMap[teamNumber]"
                                :watched="watchlistStore.isWatched(teamNumber)" :can-toggle-watch="isLead && !picklistStore.viewingPastEventId"
                                :expanded="expandedTeam === teamNumber" :expanded-data="expandedData"
                                :expanded-loading="expandedLoading" :pit-summary="picklistStore.activePitSummaryFor(teamNumber)" @toggle-expand="toggleExpand(teamNumber)"
                                @toggle-watch="toggleWatch(teamNumber)" />
                        </div>

                        <div v-if="!isTierCollapsed('Unranked') && (picklistStore.activeSections['Unranked'] || []).length === 0"
                            class="tier-section-empty">
                            {{ isEditable ? 'Drag teams here' : 'No unranked teams' }}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.picklist-page {
    max-width: 860px;
    margin: 0 auto;
}

@media (min-width: 1000px) {
    .picklist-page {
        max-width: 1180px;
    }
}

/* ── Header ── */
.picklist-header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    margin-bottom: 4px;
    flex-wrap: wrap;
}

.picklist-event-name {
    font-size: 14px;
    color: rgba(128, 128, 128, 0.8);
    font-style: italic;
}

.picklist-tba-refresh-btn {
    margin-left: auto;
}

.picklist-inline-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    padding: 0 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text-color);
    cursor: pointer;
    user-select: none;
}

.picklist-inline-toggle input {
    width: 18px;
    height: 18px;
    accent-color: #b05703;
    cursor: pointer;
}

.picklist-tba-error {
    color: #d32f2f;
    font-size: 13px;
    margin: 4px 0 0;
}

/* ── Tabs ── */
.picklist-archetype-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
}

.picklist-archetype-tab {
    background: rgba(128, 128, 128, 0.1);
    border: 1.5px solid transparent;
    border-radius: 20px;
    padding: 7px 18px;
    font-size: 14px;
    font-weight: 700;
    color: var(--primary-text-color);
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.picklist-archetype-tab:hover {
    border-color: rgba(176, 87, 3, 0.4);
}

.picklist-archetype-tab--active {
    background: #b05703;
    border-color: #b05703;
    color: #fff;
}

.picklist-tab-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    border-bottom: 2px solid rgba(128, 128, 128, 0.2);
    margin-bottom: 4px;
}

.picklist-tabs {
    display: flex;
    gap: 4px;
}

.picklist-tab {
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    padding: 10px 20px;
    font-size: 15px;
    font-weight: 500;
    color: var(--primary-text-color);
    cursor: pointer;
    border-radius: 6px 6px 0 0;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.picklist-tab:hover {
    background: rgba(176, 87, 3, 0.1);
    color: #b05703;
}

.picklist-tab--active {
    border-bottom-color: #b05703;
    color: #b05703;
    font-weight: 700;
}

.picklist-tab-description {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.75);
    min-height: 20px;
    margin-bottom: 16px;
}

/* ── Admin scout filter (issue #56) ── */
.picklist-scout-filter {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 0;
    font-size: 13px;
}

.picklist-scout-filter-label {
    color: rgba(128, 128, 128, 0.85);
    font-weight: 600;
}

/* ── Loading ── */
.picklist-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 60px 0;
    color: rgba(128, 128, 128, 0.8);
    font-size: 15px;
}

.picklist-spinner {
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

/* ── Empty ── */
.picklist-empty {
    text-align: center;
    padding: 60px 0;
    color: rgba(128, 128, 128, 0.8);
}

.picklist-empty-icon {
    font-size: 52px;
    margin-bottom: 12px;
}

/* ── Save bar ── */
.picklist-save-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-bottom: 12px;
}

.save-status {
    font-size: 13px;
    font-weight: 600;
}

.save-status--ok {
    color: #3a9e3a;
}

.save-status--err {
    color: #b05703;
}

.picklist-save-btn {
    background: #b05703;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 9px 22px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
    box-shadow: 0 2px 8px rgba(176, 87, 3, 0.3);
}

.picklist-save-btn:hover:not(:disabled) {
    background: #cd8900;
    transform: translateY(-1px);
}

.picklist-save-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none;
}

.picklist-reset-btn {
    background: none;
    color: #b05703;
    border: 1.5px solid #b05703;
    border-radius: 8px;
    padding: 7.5px 16px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    margin-right: auto;
}

.picklist-reset-btn:hover:not(:disabled) {
    background: rgba(176, 87, 3, 0.1);
}

.picklist-reset-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.picklist-reset-btn--danger {
    color: #d32f2f;
    border-color: #d32f2f;
}

.picklist-reset-btn--danger:hover:not(:disabled) {
    background: rgba(211, 47, 47, 0.1);
}

.picklist-confirm-text {
    font-size: 14px;
    color: var(--primary-text-color);
    margin-right: auto;
}

/* ── Tier sections ── */
/* Ranked tiers stack on the left, Unranked pool on the right — on desktop
   only (issue #34); both columns stack vertically on narrower viewports,
   Unranked last. */
.picklist-columns {
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.tier-sections-ranked {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
}

@media (min-width: 1000px) {
    .picklist-columns {
        flex-direction: row;
        align-items: flex-start;
    }

    .tier-sections-ranked {
        flex: 1;
    }

    .tier-section-unranked {
        width: 360px;
        flex-shrink: 0;
    }
}

/* flex-wrap, not CSS grid: SortableJS's index/swap math is unreliable
   inside a `display: grid` container (well-documented upstream issue —
   its direction-detection heuristics assume flex/block flow), which is
   what made drag-and-drop into/out of this section fail in practice. Each
   card gets a fixed one-third width instead, giving exactly 3 per row. */
.unranked-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    min-height: 50px;
}

.unranked-grid > .unranked-card {
    flex: 0 0 calc((100% - 20px) / 3);
    max-width: calc((100% - 20px) / 3);
}

/* An expanded card takes the full row (~3 columns) instead of 1/3 — needs
   equal-specificity + later source order to beat the rule above, since
   PicklistUnrankedCard.vue's own `.unranked-card--expanded` sizing (lower
   specificity than this parent-scoped selector) can't override it alone. */
.unranked-grid > .unranked-card--expanded {
    flex: 1 1 100%;
    max-width: 100%;
}

.tier-section {
    display: flex;
    flex-direction: column;
}

.tier-section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    margin-bottom: 8px;
    border-left: 4px solid rgba(128, 128, 128, 0.4);
    cursor: pointer;
    user-select: none;
}

.tier-section-collapse-icon {
    font-size: 12px;
    color: rgba(128, 128, 128, 0.6);
    transition: transform 0.2s ease;
    line-height: 1;
    flex-shrink: 0;
}

.tier-section-collapse-icon--collapsed {
    transform: rotate(-90deg);
}

.tier-section-name {
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: var(--primary-text-color);
}

.tier-section-count {
    font-size: 12px;
    font-weight: 600;
    color: rgba(128, 128, 128, 0.7);
    background: rgba(128, 128, 128, 0.12);
    border-radius: 20px;
    padding: 1px 8px;
}

.tier-section-header--S {
    border-left-color: #d4a017;
}

.tier-section-header--A {
    border-left-color: #3a9e3a;
}

.tier-section-header--B {
    border-left-color: #3a78c8;
}

.tier-section-header--C {
    border-left-color: #8c64c8;
}

.tier-section-header--D {
    border-left-color: #b05703;
}

.tier-section-header--DNP {
    border-left-color: #c83c3c;
}

.tier-section-header--Unranked {
    border-left-color: rgba(128, 128, 128, 0.4);
}

.tier-section-body {
    display: flex;
    flex-direction: column;
    min-height: 50px;
}

.tier-section-empty {
    font-size: 12px;
    color: rgba(128, 128, 128, 0.55);
    font-style: italic;
    text-align: center;
    padding: 10px;
    border: 1.5px dashed rgba(128, 128, 128, 0.25);
    border-radius: 10px;
    margin-top: -4px;
}

/* ── Transitions ── */
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
