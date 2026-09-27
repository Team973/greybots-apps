<script setup lang="ts">
// @ts-nocheck
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { RouterLink } from 'vue-router';
import { usePicklistStore } from '@/stores/picklist-store';
import { useAuthStore } from '@/stores/auth-store';
import { useEventStore } from '@/stores/event-store';
import { useOfflineQueueStore } from '@/stores/offline-queue-store';
import { computeBasicStats, computeFlagStats, computeTbaStats } from '@/lib/picklist-stats';
import { createPickemSession } from '@/lib/pickem-session';
import type { PickemSession } from '@/lib/pickem-session';
import PitScoutingSection from '@/components/PitScoutingSection.vue';

const picklistStore = usePicklistStore();
const authStore = useAuthStore();
const eventStore = useEventStore();
const queueStore = useOfflineQueueStore();

const userId = computed(() => authStore.currentUserId);
const eventId = computed(() => eventStore.eventId);

// Scorer/Defender toggle (issue #27), shared with the Pick List page.
const activeArchetype = computed({
    get: () => picklistStore.activeArchetype,
    set: (v) => picklistStore.setArchetype(v)
});

const teamsLoaded = ref(false);

// Leads and admins can skip a matchup they can't decide (issue #68).
const canSkip = computed(() => authStore.isLead);

// The matchup engine (src/lib/pickem-session.ts) decides which two teams to
// show and how the answers place teams; these refs just mirror its state.
let session: PickemSession | null = null;

// The team currently being placed (or the upper-ranked team of a refinement pair).
const candidate = ref<number | null>(null);
// The team it's being compared against.
const compareAgainst = ref<number | null>(null);
// Whether to show the two teams in swapped order, randomized per matchup.
const flipSides = ref(false);

const totalToPlace = ref(0);
const placedCount = ref(0);

// Once every team has been placed at least once, pick'em doesn't stop —
// rankings drift as more matches are played, so it keeps presenting
// nearby pairs from the current order for continuous re-evaluation.
// 'insufficient' only applies if the event has fewer than 2 teams total.
const phase = ref<'placing' | 'refining' | 'insufficient'>('placing');
const refinementCount = ref(0);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function syncFromSession() {
    if (!session) return;
    const state = session.getState();
    phase.value = state.phase;
    candidate.value = state.candidate;
    compareAgainst.value = state.opponent;
    flipSides.value = state.flip;
    totalToPlace.value = state.totalToPlace;
    placedCount.value = state.placedCount;
    refinementCount.value = state.refinementCount;
}

// ─── Loading ───────────────────────────────────────────────────────────────────

// (Re)builds the placement session for whichever archetype is currently
// active — called on initial load and whenever the Scorer/Defender toggle
// changes, so each archetype gets its own independent placement session.
// Defender's pool is pre-filtered to likely defenders (defense% over the
// threshold); Scorer sees every unranked team.
async function loadArchetypeSession() {
    const archetype = activeArchetype.value;
    await picklistStore.loadPersonalList(userId.value, eventId.value, archetype);

    let pool = [...picklistStore.personalTierSections[archetype].Unranked];
    if (archetype === 'defender') {
        pool = pool.filter((teamNumber) => picklistStore.isLikelyDefender(teamNumber));
    }

    session = createPickemSession({
        getRanked: () => picklistStore.personalRankedFlatOrder(archetype),
        placeAt: (teamNumber, flatIndex) => {
            picklistStore.placeTeamAtFlatIndex(archetype, teamNumber, flatIndex);
            scheduleSave();
        },
        random: Math.random
    });
    // The engine shuffles the pool, so placement order doesn't always start
    // with the lowest team number.
    session.start(pool);
    syncFromSession();
}

onMounted(async () => {
    await authStore.checkUser();
    await eventStore.updateEvent();
    await picklistStore.loadTeams(eventId.value);
    await picklistStore.loadTeamMatchSummaries(eventId.value);
    teamsLoaded.value = true;

    await loadArchetypeSession();
});

// Switching the archetype toggle starts an independent session for the
// other archetype — flush any pending save first so it isn't lost.
watch(activeArchetype, async () => {
    if (!teamsLoaded.value) return;
    await flushSave();
    await loadArchetypeSession();
});

onUnmounted(() => {
    flushSave();
});

// ─── Answering ─────────────────────────────────────────────────────────────────

function pickWinner(winner: number) {
    if (!session) return;
    session.choose(winner);
    syncFromSession();
}

// Throws the matchup away and shows two different teams; both teams sit out
// for the next few matchups (issue #68).
function skipMatchup() {
    if (!session || !canSkip.value) return;
    session.skip();
    syncFromSession();
}

// ─── Saving ─────────────────────────────────────────────────────────────────────
// Which archetype a scheduled save applies to, captured at schedule time —
// NOT re-read from activeArchetype at flush time, since the archetype
// toggle explicitly flushes before switching (see the watcher above) and by
// then activeArchetype has already moved on to the new value.
let pendingSaveArchetype: 'scorer' | 'defender' | null = null;

function scheduleSave() {
    pendingSaveArchetype = activeArchetype.value;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 800);
}

async function flushSave() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (!userId.value || pendingSaveArchetype == null) return;

    const archetype = pendingSaveArchetype;
    pendingSaveArchetype = null;
    const success = await picklistStore.savePersonalList(userId.value, eventId.value, archetype);
    if (!success) {
        queueStore.enqueue('picklist_personal', {
            userId: userId.value,
            eventId: eventId.value,
            archetype,
            teamNumbers: picklistStore.personalFlatOrder(archetype),
            teamTiers: picklistStore.personalTiersMap(archetype)
        }, picklistStore.lastSaveError ?? undefined);
    }
}

// ─── Display helpers ─────────────────────────────────────────────────────────────

const candidateTeam = computed(() => candidate.value != null ? picklistStore.teamMap[candidate.value] : null);
const compareTeam = computed(() => compareAgainst.value != null ? picklistStore.teamMap[compareAgainst.value] : null);

// ─── Per-team match stats/comments (picklistStore.getTeamData caches per
// team number, so re-showing a team already seen this session is free) ──────────

const candidateData = ref(null);
const compareData = ref(null);

watch(candidate, async (teamNumber) => {
    candidateData.value = null;
    if (teamNumber == null) return;
    candidateData.value = await picklistStore.getTeamData(teamNumber, eventId.value);
});
watch(compareAgainst, async (teamNumber) => {
    compareData.value = null;
    if (teamNumber == null) return;
    compareData.value = await picklistStore.getTeamData(teamNumber, eventId.value);
});

// One entry per matchup side, so the template renders both with a single
// v-for instead of duplicating the card/comments/pit markup twice. The order
// is randomly flipped per matchup (flipSides) so the team being placed isn't
// always on the same side; `key` says which side an entry really is.
const matchupSides = computed(() => {
    const sides = [
        { key: 'candidate' as const, teamNumber: candidate.value, team: candidateTeam.value, data: candidateData.value },
        { key: 'compare' as const, teamNumber: compareAgainst.value, team: compareTeam.value, data: compareData.value }
    ];
    return flipSides.value ? sides.reverse() : sides;
});

// ─── Per-team "More Info" modal ────────────────────────────────────────────
// Stats/comments/pit data live behind this modal (rather than always
// inline) specifically so the two picker cards above stay short enough to
// both fit on screen at once on mobile without scrolling — see issue #45
// follow-up. It shows one team at a time (a side-by-side comparison layout
// doesn't have room to work on a narrow screen), opened via a "More Info"
// button under whichever card the user taps.

const infoModalSide = ref<'candidate' | 'compare' | null>(null);

// Close automatically when a winner is picked (or the matchup is skipped) and
// a new matchup loads — otherwise the modal would keep showing a team that's
// no longer on screen. Watches both teams since either can change alone.
watch([candidate, compareAgainst], () => { infoModalSide.value = null; });

const infoModalTeam = computed(() => infoModalSide.value === 'candidate' ? candidateTeam.value : compareTeam.value);
const infoModalData = computed(() => infoModalSide.value === 'candidate' ? candidateData.value : compareData.value);
const infoModalTeamNumber = computed(() => infoModalSide.value === 'candidate' ? candidate.value : compareAgainst.value);
</script>

<template>
    <div class="main-content">
        <h1>Pick'em</h1>
        <p class="pickem-subtitle">Pick the team you'd rather have — we'll slot it into your Pick List for you.</p>

        <!-- Archetype toggle (issue #27) — shared with the Pick List's super tabs -->
        <div class="pickem-archetype-tabs" role="tablist">
            <button id="pickem-archetype-scorer" class="pickem-archetype-tab"
                :class="{ 'pickem-archetype-tab--active': activeArchetype === 'scorer' }" role="tab"
                :aria-selected="activeArchetype === 'scorer'" @click="activeArchetype = 'scorer'">
                Scorer
            </button>
            <button id="pickem-archetype-defender" class="pickem-archetype-tab"
                :class="{ 'pickem-archetype-tab--active': activeArchetype === 'defender' }" role="tab"
                :aria-selected="activeArchetype === 'defender'" @click="activeArchetype = 'defender'">
                Defender
            </button>
        </div>

        <div v-if="!teamsLoaded" class="data-tile pickem-status">Loading teams…</div>

        <div v-else-if="phase === 'insufficient'" class="data-tile pickem-status">
            Add at least 2 teams to your Pick List to start comparing.
        </div>

        <template v-else-if="candidateTeam && compareTeam">
            <div class="pickem-progress">
                <template v-if="phase === 'placing'">{{ placedCount }} of {{ totalToPlace }} teams placed</template>
                <template v-else>
                    Every team's ranked — keep comparing to refine as you see more matches
                    ({{ refinementCount }} so far this session).
                    <RouterLink to="/picklist" class="pickem-cta">View your Pick List</RouterLink>
                </template>
            </div>
            <div class="pickem-matchup">
                <template v-for="(side, idx) in matchupSides" :key="side.teamNumber">
                    <div class="pickem-column">
                        <button type="button" class="pickem-card" @click="pickWinner(side.teamNumber)">
                            <div class="pickem-card-photo">
                                <img v-if="side.team.photo_url" :src="side.team.photo_url"
                                    :alt="`Team ${side.team.team_number} robot`" loading="lazy" />
                                <div v-else class="pickem-card-placeholder"><span>🤖</span></div>
                            </div>
                            <div class="pickem-card-number">{{ side.team.team_number }}</div>
                            <div class="pickem-card-name">{{ side.team.name }}</div>
                        </button>
                        <button type="button" class="pickem-more-info-button" :disabled="!side.data"
                            @click="infoModalSide = side.key">
                            More Info
                        </button>
                    </div>

                    <div v-if="idx === 0" class="pickem-vs">VS</div>
                </template>
            </div>

            <!-- Leads and admins only (issue #68): can't decide? Skip to see two
                 different teams; these two sit out for the next few matchups. -->
            <div v-if="canSkip" class="pickem-skip">
                <button id="btn-pickem-skip" type="button" class="pickem-skip-button"
                    title="Can't decide? Skip to see two different teams" @click="skipMatchup">
                    Skip matchup
                </button>
            </div>
        </template>

        <div v-if="infoModalSide" class="pickem-modal-overlay" @click.self="infoModalSide = null">
            <div class="pickem-modal" role="dialog" aria-modal="true"
                :aria-label="`Team ${infoModalTeamNumber} info`">
                <div class="pickem-modal-header">
                    <h2>{{ infoModalTeam?.team_number }} - {{ infoModalTeam?.name }}</h2>
                    <button type="button" class="pickem-modal-close" @click="infoModalSide = null"
                        aria-label="Close">✕</button>
                </div>

                <div class="pickem-modal-body">
                    <!-- Same expanded-detail data summary as the ranked Pick List rows
                         (PicklistRow.vue) — full photo, per-match-count stat cards, and
                         comments with their match number — so a team looks the same
                         whether you're reviewing it here or on the Pick List. -->
                    <div class="pickem-detail-photo" v-if="infoModalTeam?.photo_url">
                        <img :src="infoModalTeam.photo_url" :alt="`Team ${infoModalTeamNumber} robot (full)`"
                            class="pickem-full-photo" />
                    </div>

                    <!-- TBA OPR/DPR — independent of scouted match data, so shown whenever cached (issue #26) -->
                    <div class="pickem-detail-section" v-if="computeTbaStats(eventId, infoModalTeamNumber).length > 0">
                        <h3 class="pickem-detail-heading">TBA Stats</h3>
                        <div class="pickem-stats-grid">
                            <div v-for="stat in computeTbaStats(eventId, infoModalTeamNumber)" :key="stat.label"
                                class="pickem-stat">
                                <div class="stat-label">{{ stat.label }}</div>
                                <div class="stat-avg">{{ stat.avg }}</div>
                                <div class="stat-sub">{{ stat.sub }}</div>
                            </div>
                        </div>
                    </div>

                    <div class="pickem-detail-section" v-if="infoModalData?.stats.length > 0">
                        <h3 class="pickem-detail-heading">Match Stats ({{ infoModalData.stats.length }} matches)</h3>
                        <div class="pickem-stats-grid">
                            <div v-for="stat in computeFlagStats(infoModalData.stats)" :key="stat.label"
                                class="pickem-stat">
                                <div class="stat-label">{{ stat.label }}</div>
                                <div class="stat-avg">{{ stat.pct }}%</div>
                                <div class="stat-sub">{{ stat.count }} / {{ stat.total }} matches</div>
                            </div>
                            <div v-for="stat in computeBasicStats(infoModalData.stats)" :key="stat.label"
                                class="pickem-stat">
                                <div class="stat-label">{{ stat.label }}</div>
                                <div class="stat-avg">{{ stat.avg }}</div>
                                <div class="stat-sub">avg &nbsp;|&nbsp; max {{ stat.max }}</div>
                            </div>
                        </div>
                    </div>
                    <p v-else class="pickem-no-data">No match data available.</p>

                    <div class="pickem-detail-section" v-if="infoModalData?.comments.length > 0">
                        <h3 class="pickem-detail-heading">Scout Comments</h3>
                        <ul class="pickem-comments">
                            <li v-for="(comment, cIdx) in infoModalData.comments" :key="cIdx" class="pickem-comment">
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
                    <p v-else-if="infoModalData?.stats.length === 0" class="pickem-no-data">
                        No scouting data available for this team.
                    </p>

                    <PitScoutingSection :team-number="infoModalTeamNumber"></PitScoutingSection>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.pickem-subtitle {
    color: rgba(128, 128, 128, 0.9);
    margin-top: -8px;
    margin-bottom: 20px;
}

.pickem-archetype-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
}

.pickem-archetype-tab {
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

.pickem-archetype-tab:hover {
    border-color: rgba(176, 87, 3, 0.4);
}

.pickem-archetype-tab--active {
    background: #b05703;
    border-color: #b05703;
    color: #fff;
}

.pickem-status {
    text-align: center;
    padding: 60px 20px;
}

.pickem-cta {
    margin-left: 6px;
    color: #b05703;
    font-weight: 600;
    text-decoration: none;
}

.pickem-cta:hover {
    text-decoration: underline;
}

.pickem-progress {
    text-align: center;
    color: rgba(128, 128, 128, 0.9);
    margin-bottom: 16px;
}

.pickem-matchup {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 24px;
    flex-wrap: wrap;
}

.pickem-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 320px;
    max-width: 90vw;
    gap: 16px;
}

.pickem-skip {
    display: flex;
    justify-content: center;
    margin-top: 24px;
}

.pickem-skip-button {
    padding: 8px 24px;
    border-radius: 20px;
    border: 1.5px solid rgba(128, 128, 128, 0.5);
    background: transparent;
    color: var(--primary-text-color);
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    transition: border-color 0.15s ease, color 0.15s ease;
}

.pickem-skip-button:hover {
    border-color: #b05703;
    color: #b05703;
}

.pickem-vs {
    font-size: 22px;
    font-weight: 800;
    color: rgba(128, 128, 128, 0.7);
    margin-top: 60px;
}

.pickem-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    padding: 20px;
    background: var(--tile-background-color);
    border: 2px solid transparent;
    border-radius: 14px;
    cursor: pointer;
    font: inherit;
    color: var(--primary-text-color);
    transition: border-color 0.15s ease, transform 0.1s ease;
}

.pickem-card:hover {
    border-color: #b05703;
    transform: translateY(-2px);
}

.pickem-card-photo {
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: 10px;
    overflow: hidden;
    background: rgba(128, 128, 128, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
}

.pickem-card-photo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.pickem-card-placeholder {
    font-size: 40px;
}

.pickem-card-number {
    font-size: 24px;
    font-weight: 800;
    margin-top: 12px;
}

.pickem-card-name {
    font-size: 14px;
    color: rgba(128, 128, 128, 0.9);
    text-align: center;
}

.pickem-no-data {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.6);
    font-style: italic;
}

.pickem-more-info-button {
    width: 100%;
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background-color: var(--accent-color);
    color: var(--primary-text-color);
    cursor: pointer;
    font: inherit;
    font-weight: 600;
}

.pickem-more-info-button:hover:not(:disabled) {
    background-color: var(--header-hover-color);
}

.pickem-more-info-button:disabled {
    opacity: 0.6;
    cursor: default;
}

.pickem-modal-overlay {
    position: fixed;
    inset: 0;
    /* Above NavBar.vue's fixed header (z-index: 9999) so the modal's own
       header/close button never end up hidden underneath it. */
    z-index: 10000;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
}

.pickem-modal {
    width: 100%;
    max-width: 640px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    background: var(--tile-background-color);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.pickem-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}

.pickem-modal-header h2 {
    margin: 0;
    font-size: 18px;
}

.pickem-modal-close {
    border: none;
    background: transparent;
    color: var(--primary-text-color);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 4px 8px;
}

.pickem-modal-body {
    padding: 16px 20px 20px;
    overflow-y: auto;
}

.pickem-detail-photo {
    display: flex;
    justify-content: center;
    margin-bottom: 18px;
}

.pickem-full-photo {
    max-width: 340px;
    width: 100%;
    border-radius: 10px;
    object-fit: cover;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.pickem-detail-section {
    margin-bottom: 18px;
}

.pickem-detail-heading {
    font-size: 14px;
    font-weight: 700;
    color: #b05703;
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.pickem-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
}

.pickem-stat {
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
    font-size: 20px;
    font-weight: 700;
    color: #b05703;
    line-height: 1.1;
}

.stat-sub {
    font-size: 10px;
    color: rgba(128, 128, 128, 0.6);
    margin-top: 2px;
}

.pickem-comments {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.pickem-comment {
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

.comment-match {
    font-size: 10px;
    color: rgba(128, 128, 128, 0.6);
    margin-left: auto;
}

.comment-text {
    font-size: 12px;
    color: var(--primary-text-color);
    line-height: 1.5;
    margin: 0;
}

@media (max-width: 700px) {
    /* Both cards need to stay in view together without scrolling, so they
       stay side-by-side (never stacked) and shrink to fit instead — the
       heavier stats/comments/pit content that used to sit inline under each
       card now lives behind the per-team More Info modal for exactly this
       reason. */
    .pickem-matchup {
        flex-wrap: nowrap;
        gap: 10px;
    }

    .pickem-column {
        width: auto;
        max-width: none;
        flex: 1 1 0;
        min-width: 0;
        gap: 8px;
    }

    .pickem-vs {
        flex-shrink: 0;
        margin-top: 40px;
        font-size: 16px;
    }

    .pickem-card {
        padding: 10px;
    }

    .pickem-card-number {
        font-size: 18px;
        margin-top: 8px;
    }

    .pickem-card-name {
        font-size: 12px;
    }

    .pickem-more-info-button {
        padding: 8px 10px;
        font-size: 0.85em;
    }
}
</style>
