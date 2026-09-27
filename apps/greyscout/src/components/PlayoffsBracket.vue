<script setup lang="ts">
// @ts-nocheck
import { computed } from 'vue';
import { FINALS_MATCH, describeSource } from '@/lib/playoffs-bracket';

const props = defineProps<{
    matches: ReturnType<typeof import('@/lib/playoffs-bracket').resolveBracket>;
    alliances: number[][];
    editable: boolean;
}>();

const emit = defineEmits(['pick-winner']);

// ─── Layout ────────────────────────────────────────────────────────────────────
// Laid out like the official FIRST bracket graphic: five round columns plus
// the finals, upper bracket on top and lower bracket below, with a line from
// each match to the one its winner advances to (losers are just labeled,
// e.g. "Loser of M8", as in the graphic). Everything is absolutely positioned
// on a fixed grid so the connector lines can be plain SVG paths.
const CARD_W = 200;
const CARD_H = 84;
const COL_GAP = 50;
const HEADER_H = 30;
const LABEL_W = 34;
const DIVIDER_Y = 410;
const TOTAL_H = 710;

const ROUND_NAMES = ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5', 'Finals'];

// [column, y] of each match's top-left corner, below the round header.
const POSITIONS = {
    1: [0, 0], 2: [0, 100], 3: [0, 200], 4: [0, 300],
    7: [1, 50], 8: [1, 250],
    11: [3, 150],
    5: [1, 470], 6: [1, 610],
    10: [2, 440], 9: [2, 580],
    12: [3, 510],
    13: [4, 510],
    [FINALS_MATCH]: [5, 330]
};

// Winner-advances connectors: [from match, to match].
const CONNECTORS = [
    [1, 7], [2, 7], [3, 8], [4, 8], [7, 11], [8, 11],
    [5, 10], [6, 9], [10, 12], [9, 12], [12, 13],
    [11, FINALS_MATCH], [13, FINALS_MATCH]
];

const colX = (col: number) => LABEL_W + col * (CARD_W + COL_GAP);
const TOTAL_W = colX(ROUND_NAMES.length - 1) + CARD_W;

const matchByNumber = computed(() => {
    const map = {};
    props.matches.forEach((m) => { map[m.match] = m; });
    return map;
});

const cards = computed(() =>
    Object.entries(POSITIONS).map(([number, [col, y]]) => ({
        number: Number(number),
        style: { left: `${colX(col)}px`, top: `${HEADER_H + y}px`, width: `${CARD_W}px`, height: `${CARD_H}px` }
    }))
);

const columns = ROUND_NAMES.map((name, col) => ({
    name,
    style: { left: `${colX(col)}px`, width: `${CARD_W}px` }
}));

const lines = computed(() =>
    CONNECTORS.map(([from, to]) => {
        const [fromCol, fromY] = POSITIONS[from];
        const [toCol, toY] = POSITIONS[to];
        const x1 = colX(fromCol) + CARD_W;
        const y1 = HEADER_H + fromY + CARD_H / 2;
        const x2 = colX(toCol);
        const y2 = HEADER_H + toY + CARD_H / 2;
        const xm = x2 - COL_GAP / 2;
        return `M ${x1} ${y1} H ${xm} V ${y2} H ${x2}`;
    })
);

// ─── Match display ─────────────────────────────────────────────────────────────

function teamsLabel(alliance: number | null) {
    if (alliance == null) return '';
    const teams = props.alliances[alliance - 1] ?? [];
    return teams.length > 0 ? teams.join(' · ') : 'No teams yet';
}

function sides(match) {
    return [
        { color: 'red', letter: 'R', alliance: match.redAlliance, source: match.red },
        { color: 'blue', letter: 'B', alliance: match.blueAlliance, source: match.blue }
    ];
}

function sideState(match, alliance: number | null) {
    if (alliance == null || match.winner == null) return 'open';
    return match.winner === alliance ? 'win' : 'loss';
}

function canPick(match, alliance: number | null) {
    return props.editable && alliance != null && match.redAlliance != null && match.blueAlliance != null;
}

function pick(match, alliance: number | null) {
    if (canPick(match, alliance)) emit('pick-winner', match.match, alliance);
}

function matchTitle(number: number) {
    return number === FINALS_MATCH ? 'Best 2 out of 3' : `Match ${number} (M${number})`;
}
</script>

<template>
    <div class="bracket-scroll">
        <div class="bracket" :style="{ width: `${TOTAL_W}px`, height: `${HEADER_H + TOTAL_H}px` }">
            <!-- Round column bands + names -->
            <div v-for="col in columns" :key="col.name" class="bracket-col" :style="col.style">
                <div class="bracket-col-name">{{ col.name }}</div>
            </div>

            <!-- Upper / lower bracket labels and divider -->
            <div class="bracket-half-label" :style="{ top: `${HEADER_H}px`, height: `${DIVIDER_Y}px` }">Upper Bracket</div>
            <div class="bracket-half-label" :style="{ top: `${HEADER_H + DIVIDER_Y}px`, height: `${TOTAL_H - DIVIDER_Y}px` }">Lower Bracket</div>
            <div class="bracket-divider" :style="{ top: `${HEADER_H + DIVIDER_Y}px`, left: `${LABEL_W}px` }"></div>

            <svg class="bracket-lines" :width="TOTAL_W" :height="HEADER_H + TOTAL_H" aria-hidden="true">
                <path v-for="(d, i) in lines" :key="i" :d="d" />
            </svg>

            <div v-for="card in cards" :key="card.number" class="bracket-match"
                :class="{ 'bracket-match--finals': card.number === FINALS_MATCH }" :style="card.style"
                :id="`playoff-match-${card.number}`">
                <template v-for="(side, i) in sides(matchByNumber[card.number])" :key="side.color">
                    <!-- Match name sits between the red and blue rows, as in the graphic -->
                    <div v-if="i === 1" class="bracket-match-title">{{ matchTitle(card.number) }}</div>

                    <button type="button" class="bracket-side" :class="[
                        `bracket-side--${side.color}`,
                        `bracket-side--${sideState(matchByNumber[card.number], side.alliance)}`,
                        { 'bracket-side--pickable': canPick(matchByNumber[card.number], side.alliance) }
                    ]" :disabled="!canPick(matchByNumber[card.number], side.alliance)" :title="canPick(matchByNumber[card.number], side.alliance)
                        ? (matchByNumber[card.number].winner === side.alliance ? 'Click to clear this result' : 'Click to mark as the winner')
                        : ''" @click="pick(matchByNumber[card.number], side.alliance)">
                        <span class="bracket-side-chip">{{ side.letter }}</span>
                        <span class="bracket-side-body">
                            <template v-if="side.alliance != null">
                                <span class="bracket-side-name">
                                    Alliance {{ side.alliance }}
                                    <span v-if="sideState(matchByNumber[card.number], side.alliance) === 'win'"> ✓</span>
                                </span>
                                <span class="bracket-side-teams">{{ teamsLabel(side.alliance) }}</span>
                            </template>
                            <span v-else class="bracket-side-name bracket-side-pending">{{ describeSource(side.source) }}</span>
                        </span>
                    </button>
                </template>

                <div v-if="card.number === FINALS_MATCH" class="bracket-champion" :class="{ 'bracket-champion--won': matchByNumber[card.number].winner != null }">
                    <span class="bracket-trophy">🏆</span>
                    <span v-if="matchByNumber[card.number].winner != null">Alliance {{ matchByNumber[card.number].winner }}</span>
                    <span v-else>Winner</span>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.bracket-scroll {
    overflow-x: auto;
    padding-bottom: 8px;
}

.bracket {
    position: relative;
}

/* ── Round columns ── */
.bracket-col {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(128, 128, 128, 0.12);
    border-radius: 6px;
}

.bracket-col-name {
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--primary-text-color);
}

/* ── Upper / lower labels ── */
.bracket-half-label {
    position: absolute;
    left: 0;
    width: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 15px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(128, 128, 128, 0.85);
}

.bracket-divider {
    position: absolute;
    right: 0;
    border-top: 1px solid rgba(128, 128, 128, 0.5);
}

/* ── Connector lines ── */
.bracket-lines {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
}

.bracket-lines path {
    fill: none;
    stroke: rgba(128, 128, 128, 0.8);
    stroke-width: 1.5;
}

/* ── Match card ── */
.bracket-match {
    position: absolute;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
}

.bracket-match--finals {
    background: var(--tile-background-color);
    border: 2px solid rgba(128, 128, 128, 0.6);
    border-radius: 12px;
    padding: 6px 8px;
    height: auto !important;
    /* Same 84px of rows as every other card, plus room for the trophy line. */
    min-height: 84px;
}

.bracket-match-title {
    height: 16px;
    line-height: 16px;
    text-align: center;
    font-size: 10px;
    font-style: italic;
    font-weight: 600;
    color: var(--primary-text-color);
    white-space: nowrap;
}

/* ── Red / blue rows ── */
.bracket-side {
    display: flex;
    align-items: stretch;
    height: 34px;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    color: #1a1a1a;
    cursor: default;
}

.bracket-side-chip {
    width: 22px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #15171c;
    font-size: 14px;
    font-weight: 800;
    border-radius: 3px 0 0 3px;
}

.bracket-side--red .bracket-side-chip {
    color: #f0685a;
}

.bracket-side--blue .bracket-side-chip {
    color: #4aa3e8;
}

/* Arrow-shaped end, like the graphic's banners. */
.bracket-side-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 16px 0 8px;
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%);
}

.bracket-side--red .bracket-side-body {
    background: #f4897d;
}

.bracket-side--blue .bracket-side-body {
    background: #6fb6ee;
}

.bracket-side-name {
    font-size: 12px;
    font-weight: 700;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.bracket-side-teams {
    font-size: 10px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.bracket-side-pending {
    font-style: italic;
    font-weight: 600;
}

.bracket-side:disabled {
    opacity: 1;
    color: #1a1a1a;
}

.bracket-side--pickable {
    cursor: pointer;
}

.bracket-side--pickable:hover .bracket-side-body {
    filter: brightness(1.12);
}

.bracket-side--win .bracket-side-chip {
    background: #2e7d32;
    color: #fff;
}

.bracket-side--win .bracket-side-body {
    filter: saturate(1.3) brightness(0.95);
}

.bracket-side--loss {
    opacity: 0.45;
}

/* ── Finals trophy ── */
.bracket-champion {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 12px;
    font-weight: 700;
    color: rgba(128, 128, 128, 0.95);
}

.bracket-champion--won {
    color: #b05703;
}

.bracket-trophy {
    font-size: 18px;
}
</style>
