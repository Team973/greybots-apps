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
        <div class="autopath-preview-heading">
            <h3>Whiteboard</h3>
            <span v-if="saveStatus" class="confirm-text">{{ saveStatus }}</span>
        </div>
        <p v-if="!matchNumber">Enter a match number above to load or start a strategy board.</p>
        <template v-else>
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
                <md-filled-button type="button" v-on:click="clearAllStrokes" :disabled="board.length === 0"
                    class="reset-button">Clear All Strokes</md-filled-button>
            </div>
            <StrategyCanvas :board="board" :active-slot="activeSlot" :slot-color="slotColor" :tool="tool"
                @update:board="onBoardUpdate" @stroke-start="pushHistory"></StrategyCanvas>
        </template>
    </div>
</template>

<script lang="ts">
const MAX_UNDO_STEPS = 50;

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
        }
    },
    data() {
        return {
            eventStore: null,
            queueStore: null,
            boardId: null,
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
            const labels = ['Red 1', 'Red 2', 'Red 3', 'Blue 1', 'Blue 2', 'Blue 3'];
            return [0, 1, 2, 3, 4, 5].map((slot) => ({
                key: slot,
                text: `${labels[slot]} — ${this.teamFilters.find((t) => t.key === this.teamNumbers[slot])?.text ?? 'Unassigned'}`
            }));
        },
        activeTeamLabel() {
            return this.teamFilters.find((t) => t.key === this.teamNumbers[this.activeSlot])?.text ?? 'Team';
        },
        activeSlotHasStrokes() {
            return this.board.some((entry) => entry.slot === this.activeSlot && entry.strokes.length > 0);
        }
    },
    watch: {
        matchNumber() {
            this.loadBoard();
        }
    },
    methods: {
        async loadBoard() {
            // A freshly loaded board is a new editing session — old undo
            // steps would refer to a different match's strokes.
            this.undoStack = [];

            if (!this.matchNumber) {
                this.board = [];
                this.boardId = null;
                return;
            }

            const result = await fetchStrategyBoard(this.eventStore.eventId, Number(this.matchNumber));
            this.boardId = result.id;
            this.board = result.board;
        },
        onBoardUpdate(newBoard) {
            this.board = newBoard;
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
            this.board = this.board.filter((entry) => entry.slot !== this.activeSlot);
            this.scheduleSave();
        },
        clearAllStrokes() {
            this.pushHistory();
            this.board = [];
            this.scheduleSave();
        },
        scheduleSave() {
            clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => this.save(), 800);
        },
        async save() {
            if (!this.matchNumber) return;

            const data = { event: this.eventStore.eventId, match_number: Number(this.matchNumber), board: this.board };

            let error;
            if (this.boardId != null) {
                error = await updateScoutData(this.boardId, data, strategyBoardTable);
            } else {
                error = await submitScoutData(data, strategyBoardTable);
                if (!error) {
                    const result = await fetchStrategyBoard(this.eventStore.eventId, Number(this.matchNumber));
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
