<script setup lang="ts">
// @ts-nocheck
import StrategyCanvas from "@/components/StrategyCanvas.vue";
import Dropdown from "@greybots/common/components/Dropdown.vue";
import { useEventStore } from "@/stores/event-store";
import { useOfflineQueueStore } from "@/stores/offline-queue-store";
import { strategyBoardTable } from "@/lib/constants";
import { fetchStrategyBoard } from "@/lib/strategy-query";
import { submitScoutData, updateScoutData } from "@/lib/data-submission";

import "@material/web/button/filled-button";
</script>

<template>
    <div class="strategy-board-content">
        <p v-if="!matchNumber" class="scratch-board-note">No match number: this board is kept on this device
            only. Enter a match number above to save it to that match.</p>
        <div class="autopath-preview-selectors">
            <div class="autopath-preview-selector">
                <span class="autopath-preview-swatch" :style="{ backgroundColor: slotColor(activeSlot) }"></span>
                Drawing For:
                <Dropdown :choices="slotChoices" v-model="activeSlot"></Dropdown>
            </div>
        </div>
        <div class="whiteboard-toolbar">
            <div class="tool-toggle">
                <md-filled-button type="button" v-on:click="tool = 'draw'"
                    :class="{ 'mode-inactive': tool !== 'draw' }">Draw</md-filled-button>
                <md-filled-button type="button" v-on:click="tool = 'erase'"
                    :class="{ 'mode-inactive': tool !== 'erase' }">Erase</md-filled-button>
            </div>
            <md-filled-button type="button" v-on:click="undo" :disabled="undoStack.length === 0"
                class="reset-button">Undo</md-filled-button>
            <md-filled-button type="button" v-on:click="clearActiveSlot" :disabled="!activeSlotHasStrokes"
                class="reset-button">
                Clear {{ activeTeamLabel }}'s Strokes
            </md-filled-button>
            <md-filled-button type="button" v-on:click="clearAllStrokes" :disabled="phaseBoard.length === 0"
                class="reset-button">Clear All Strokes</md-filled-button>
            <span v-if="saveStatus" class="confirm-text">{{ saveStatus }}</span>
        </div>
        <StrategyCanvas :board="phaseBoard" :active-slot="activeSlot" :slot-color="slotColor" :tool="tool"
            @update:board="onBoardUpdate" @stroke-start="pushHistory"></StrategyCanvas>
    </div>
</template>

<script lang="ts">
const MAX_UNDO_STEPS = 50;

// Boards saved before the page had a whiteboard per phase (issue #126) have
// no phase on their entries; they show under this one.
const LEGACY_PHASE = 'active';
const phaseOf = (entry) => entry.phase ?? LEGACY_PHASE;

const SLOT_LABELS = ['Red 1', 'Red 2', 'Red 3', 'Blue 1', 'Blue 2', 'Blue 3'];

// With no match number the board is a scratch board: there is no match to
// save it under, so it's kept in this browser, one per event.
const scratchBoardKey = (eventId) => `greyscout-scratch-strategy-board:${eventId}`;

function loadScratchBoard(eventId) {
    try {
        const board = JSON.parse(localStorage.getItem(scratchBoardKey(eventId)));
        return Array.isArray(board) ? board : [];
    } catch (e) {
        return [];
    }
}

function saveScratchBoard(eventId, board) {
    try {
        localStorage.setItem(scratchBoardKey(eventId), JSON.stringify(board));
        return true;
    } catch (e) {
        return false;
    }
}

export default {
    props: {
        matchNumber: {
            type: [Number, String],
            default: null
        },
        teamNumbers: {
            type: Array,
            required: true
        },
        teamFilters: {
            type: Array,
            required: true
        },
        slotColor: {
            type: Function,
            required: true
        },
        // Which whiteboard is on screen: 'transition', 'active', or
        // 'inactive'. A match has one of each, all kept in the same
        // StrategyBoard row — every board entry is tagged with its phase.
        phase: {
            type: String,
            default: LEGACY_PHASE
        }
    },
    data() {
        return {
            eventStore: null,
            queueStore: null,
            boardId: null,
            // Every phase's entries for this match: [{ slot, phase, strokes }].
            board: [],
            activeSlot: 0,
            // 'draw' or 'erase' — passed straight through to StrategyCanvas.
            tool: 'draw',
            // Snapshots of `board` taken right before each destructive action
            // (a new stroke/erase drag, or a clear), so Undo can pop back to
            // them. Capped so a long whiteboard session can't grow this
            // unbounded.
            undoStack: [],
            saveStatus: '',
            saveTimer: null,
            statusTimer: null
        };
    },
    computed: {
        slotChoices() {
            return [0, 1, 2, 3, 4, 5].map((slot) => ({
                key: slot,
                text: `${SLOT_LABELS[slot]} —${this.teamFilters.find((t) => t.key === this.teamNumbers[slot])?.text ?? 'Unassigned'}`
            }));
        },
        activeTeamLabel() {
            return this.teamFilters.find((t) => t.key === this.teamNumbers[this.activeSlot])?.text
                ?? SLOT_LABELS[this.activeSlot];
        },
        // Just the phase on screen — what the canvas draws and edits.
        phaseBoard() {
            return this.board.filter((entry) => phaseOf(entry) === this.phase);
        },
        activeSlotHasStrokes() {
            return this.phaseBoard.some((entry) => entry.slot === this.activeSlot && entry.strokes.length > 0);
        }
    },
    watch: {
        async matchNumber(_next, previous) {
            // Strokes still waiting to save belong to the board being left,
            // not the one about to load.
            if (this.saveTimer != null) {
                clearTimeout(this.saveTimer);
                this.saveTimer = null;
                await this.save(previous);
            }
            // Going from no match number to a match: what's been drawn comes
            // along if that match has nothing yet.
            await this.loadBoard(previous ? [] : this.board);
        },
        // Undo steps belong to the whiteboard they were made on: undoing on
        // one phase must never silently change another.
        phase() {
            this.undoStack = [];
        }
    },
    methods: {
        // `carried` is the scratch board on screen when a match number was
        // just entered. It becomes the match's board if the match has no
        // strokes of its own, so entering the number never wipes the drawing;
        // otherwise it stays behind as the scratch board.
        async loadBoard(carried = []) {
            // A freshly loaded board is a new editing session — old undo
            // steps would refer to a different match's strokes.
            this.undoStack = [];

            if (!this.matchNumber) {
                this.board = loadScratchBoard(this.eventStore.eventId);
                this.boardId = null;
                return;
            }

            const result = await fetchStrategyBoard(this.eventStore.eventId, Number(this.matchNumber));
            this.boardId = result.id;
            this.board = result.board;

            const hasStrokes = (board) => board.some((entry) => entry.strokes.length > 0);
            if (hasStrokes(carried) && !hasStrokes(this.board)) {
                this.board = carried;
                saveScratchBoard(this.eventStore.eventId, []);
                await this.save();
            }
        },
        // The canvas hands back the on-screen phase's entries; the other
        // phases' entries are kept as they are.
        onBoardUpdate(newPhaseBoard) {
            this.board = [
                ...this.board.filter((entry) => phaseOf(entry) !== this.phase),
                ...newPhaseBoard.map((entry) => ({ ...entry, phase: this.phase }))
            ];
            this.scheduleSave();
        },
        // Snapshots the current board onto the undo stack — called right
        // before any destructive change (a new draw/erase drag, or a clear)
        // so that change can be undone as one step.
        pushHistory() {
            this.undoStack.push(JSON.parse(JSON.stringify(this.board)));
            if (this.undoStack.length > MAX_UNDO_STEPS) this.undoStack.shift();
        },
        undo() {
            if (this.undoStack.length === 0) return;
            this.board = this.undoStack.pop();
            this.scheduleSave();
        },
        clearActiveSlot() {
            this.pushHistory();
            this.board = this.board.filter((entry) => phaseOf(entry) !== this.phase || entry.slot !== this.activeSlot);
            this.scheduleSave();
        },
        clearAllStrokes() {
            this.pushHistory();
            this.board = this.board.filter((entry) => phaseOf(entry) !== this.phase);
            this.scheduleSave();
        },
        scheduleSave() {
            clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => {
                this.saveTimer = null;
                this.save();
            }, 800);
        },
        async save(matchNumber = this.matchNumber) {
            if (!matchNumber) {
                const kept = saveScratchBoard(this.eventStore.eventId, this.board);
                clearTimeout(this.statusTimer);
                this.saveStatus = kept ? 'Kept on this device' : "Couldn't keep this board on this device.";
                this.statusTimer = setTimeout(() => { this.saveStatus = ''; }, 2000);
                return;
            }

            const data = { event: this.eventStore.eventId, match_number: Number(matchNumber), board: this.board };

            let error;
            if (this.boardId != null) {
                error = await updateScoutData(this.boardId, data, strategyBoardTable);
            } else {
                error = await submitScoutData(data, strategyBoardTable);
                if (!error) {
                    const result = await fetchStrategyBoard(this.eventStore.eventId, Number(matchNumber));
                    this.boardId = result.id;
                }
            }

            clearTimeout(this.statusTimer);
            if (error) {
                console.log(error);
                this.queueStore.enqueue(
                    'strategy_board',
                    { table: strategyBoardTable, data, id: this.boardId },
                    error.message ?? String(error)
                );
                this.saveStatus = "Couldn't save — queued for sync.";
            } else {
                this.saveStatus = 'Saved';
            }
            this.statusTimer = setTimeout(() => { this.saveStatus = ''; }, 2000);
        }
    },
    beforeUnmount() {
        clearTimeout(this.saveTimer);
        clearTimeout(this.statusTimer);
    },
    created() {
        this.eventStore = useEventStore();
        this.queueStore = useOfflineQueueStore();
        this.loadBoard();
    }
};
</script>
