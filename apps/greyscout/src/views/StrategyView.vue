<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { useEventStore } from "@/stores/event-store";
import { useAuthStore } from "@/stores/auth-store";
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import { useOfflineQueueStore } from "@/stores/offline-queue-store";
import { teamInfoTable, autoPathTable, allianceRed, allianceBlue } from "@/lib/constants";
import { fetchTeamAutoPaths } from "@/lib/auto-path-query";
import { fetchRobotPhotoUrl } from "@/lib/robot-photo-query";
import { submitScoutData } from "@/lib/data-submission";
import { queryMatchTeams } from "@/lib/data-query";
import { fetchStrategyBoard, saveAutoSelections } from "@/lib/strategy-query";
import { SIDE_CHOICES, transformPath } from "@/lib/2026/auto-path-field";

import '@material/web/select/outlined-select';
import '@material/web/select/select-option';
import Dropdown from "@greybots/common/components/Dropdown.vue";
import SearchableDropdown from "@greybots/common/components/SearchableDropdown.vue";
import NumberInput from "@greybots/common/components/Number.vue";
import TextInput from "@greybots/common/components/TextInput.vue";
import Switch from "@greybots/common/components/Switch.vue";
import AutoPathCanvas from "@/components/AutoPathCanvas.vue";
import StrategyBoard from "@/components/StrategyBoard.vue";
import FullscreenTile from "@greybots/common/components/FullscreenTile.vue";
import ColorSwatchPicker from "@greybots/common/components/ColorSwatchPicker.vue";
import { supabase } from "@greybots/common/supabase/client";

import "@material/web/button/filled-button";
</script>

<template>
    <div class="main-content">
        <h1>Strategy</h1>
        <div v-if="!isLead" class="strategy-locked">
            <div class="strategy-locked-icon">🔒</div>
            <h2>Not available</h2>
            <p>Strategy is only available to leads and admins.</p>
        </div>
        <div v-else-if="teamsLoaded && isDataAvailable">
            <!-- Only show this if the team data is loaded. -->
            <div class="data-tile">
                <div class="autopath-preview-selector">
                    Match Number:
                    <NumberInput :model-value="matchNumber" @update:modelValue="onMatchNumberChange" label=""></NumberInput>
                </div>
                <div class="autopath-preview-selector">
                    Manual Team Selection:
                    <Switch :model-value="manualTeamSelection" @update:modelValue="onManualToggle"></Switch>
                </div>
                <p v-if="matchLookupFailed && !manualTeamSelection">No qualification schedule found for that match —
                    turn on Manual Team Selection to pick teams yourself.</p>
            </div>

            <p class="color-hint">💡 Click a team's color swatch to choose a different color.</p>

            <h2>Red Alliance</h2>
            <div class="data-tile red-alliance">
                <div class="autopath-preview-selectors">
                    <div v-for="(slot, i) in [0, 1, 2]" :key="slot" class="autopath-preview-selector alliance-slot-row">
                        <span class="alliance-slot-label">Red {{ i + 1 }}:</span>
                        <ColorSwatchPicker :choices="COLOR_CHOICES" v-model="slotColorIndex[slot]" label-prefix="Team color"></ColorSwatchPicker>
                        <SearchableDropdown v-if="manualTeamSelection" :choices="teamFilters"
                            :model-value="teamNumbers[slot]" placeholder="Search team…"
                            @update:modelValue="setTeam(slot, $event)"></SearchableDropdown>
                        <span v-else class="assigned-team">{{ teamAtSlot(slot)?.text ?? 'Unassigned' }}</span>
                    </div>
                </div>
            </div>

            <h2>Blue Alliance</h2>
            <div class="data-tile blue-alliance">
                <div class="autopath-preview-selectors">
                    <div v-for="(slot, i) in [3, 4, 5]" :key="slot" class="autopath-preview-selector alliance-slot-row">
                        <span class="alliance-slot-label">Blue {{ i + 1 }}:</span>
                        <ColorSwatchPicker :choices="COLOR_CHOICES" v-model="slotColorIndex[slot]" label-prefix="Team color"></ColorSwatchPicker>
                        <SearchableDropdown v-if="manualTeamSelection" :choices="teamFilters"
                            :model-value="teamNumbers[slot]" placeholder="Search team…"
                            @update:modelValue="setTeam(slot, $event)"></SearchableDropdown>
                        <span v-else class="assigned-team">{{ teamAtSlot(slot)?.text ?? 'Unassigned' }}</span>
                    </div>
                </div>
            </div>

            <!-- The four phases of a match, like the paper strategy sheets
                 (issue #126): AUTO is the auto-path preview and editor, and
                 TRANSITION / ACTIVE / INACTIVE are each their own whiteboard.
                 All of it lives in this one tile, so switching never means
                 scrolling away from the field, and fullscreen (via
                 FullscreenTile) covers the title and every control. Swiping
                 sideways anywhere but on the field moves between phases. -->
            <FullscreenTile class="data-tile strategy-main-tile" @touchstart.passive="onSwipeStart"
                @touchend.passive="onSwipeEnd" @touchcancel.passive="swipeStart = null">
                <div class="strategy-tab-header">
                    <div class="strategy-tabs" role="tablist" aria-label="Match phase">
                        <button v-for="tab in STRATEGY_TABS" :key="tab.key" :id="`strategy-tab-${tab.key}`" type="button"
                            class="strategy-tab" :class="{ 'strategy-tab--active': strategyTab === tab.key }" role="tab"
                            :aria-selected="strategyTab === tab.key" @click="strategyTab = tab.key">{{ tab.title }}</button>
                    </div>
                    <div class="strategy-tab-title-row">
                        <button type="button" class="strategy-tab-arrow" :disabled="strategyTabIndex === 0"
                            aria-label="Previous phase" @click="stepStrategyTab(-1)">‹</button>
                        <h2 class="strategy-tab-title" aria-live="polite">{{ strategyTabTitle }}</h2>
                        <button type="button" class="strategy-tab-arrow"
                            :disabled="strategyTabIndex === STRATEGY_TABS.length - 1" aria-label="Next phase"
                            @click="stepStrategyTab(1)">›</button>
                    </div>
                </div>

                <template v-if="strategyTab === 'auto'">
                    <div class="strategy-mode-toggle">
                        <md-filled-button v-on:click="strategyMode = 'preview'"
                            :class="{ 'mode-inactive': strategyMode !== 'preview' }">Preview</md-filled-button>
                        <md-filled-button v-on:click="strategyMode = 'autoEdit'"
                            :class="{ 'mode-inactive': strategyMode !== 'autoEdit' }">Auto Edit</md-filled-button>
                    </div>

                    <template v-if="strategyMode === 'autoEdit'">
                        <div class="autopath-form-row autopath-selectors">
                            <div class="autopath-selector">
                                <label>Drawing For</label>
                                <Dropdown :choices="slotChoices" v-model="autoEditSlot"
                                    @update:modelValue="onAutoEditSlotChange"></Dropdown>
                            </div>
                            <div class="autopath-selector">
                                <label>Side</label>
                                <Dropdown :choices="SIDE_CHOICES" v-model="autoEditSideIndex"></Dropdown>
                            </div>
                        </div>
                        <div class="autopath-form-row">
                            <TextInput v-model="autoEditName" label="Path Name" :required="true"
                                :error="autoEditNameError"></TextInput>
                        </div>
                    </template>

                    <div class="autopath-canvas-full">
                        <AutoPathCanvas :layers="combinedLayers" :editable="strategyMode === 'autoEdit'"
                            :points="strategyMode === 'autoEdit' ? autoEditPoints : []"
                            :display-alliance="autoEditAlliance" :time-gradient="strategyMode === 'autoEdit'"
                            :robot-photo-url="strategyMode === 'autoEdit' ? robotPhotoUrls[autoEditSlot] : null"
                            :station-labels="stationLabels" large="true" :playing="isPlaying"
                            @update:points="autoEditPoints = $event" @finished="isPlaying = false"></AutoPathCanvas>
                    </div>

                    <div class="autopath-bottom-controls">
                        <span>Show Red</span>
                        <Switch :model-value="showRedPaths" @update:modelValue="showRedPaths = $event"></Switch>
                        <span>Show Blue</span>
                        <Switch :model-value="showBluePaths" @update:modelValue="showBluePaths = $event"></Switch>
                        <md-filled-button v-on:click="isPlaying = !isPlaying" class="play-button">
                            {{ isPlaying ? "■ STOP" : "▶ PLAY" }}
                        </md-filled-button>
                    </div>

                    <template v-if="strategyMode === 'autoEdit'">
                        <div v-if="autoEditPathError" class="data-tile error-tile">Draw at least a couple of points
                            before saving.</div>
                        <div class="autopath-actions">
                            <md-filled-button v-on:click="autoEditPoints = []" class="reset-button">RESET</md-filled-button>
                            <md-filled-button v-on:click="saveAutoEditPath" class="submit-button">SAVE PATH</md-filled-button>
                            <span v-if="autoEditSavedMessage" class="confirm-text">{{ autoEditSavedMessage }}</span>
                        </div>
                    </template>

                    <!-- Per-slot controls sit in two columns below the (now
                         full-width) field, red on the left / blue on the
                         right so they still line up with their alliance. -->
                    <div class="autopath-side-by-side">
                        <div class="autopath-side-column">
                            <div v-for="slot in [0, 1, 2]" :key="slot" class="autopath-slot-controls">
                                <div class="autopath-slot-header">
                                    <span class="autopath-preview-swatch" :style="{ backgroundColor: slotColor(slot) }"></span>
                                    <span class="autopath-slot-team">{{ teamAtSlot(slot)?.text ?? 'Unassigned' }}</span>
                                </div>
                                <Dropdown :choices="autoPathChoices[slot] ?? []" :model-value="selectedAutoPathIndex[slot]"
                                    @update:modelValue="onAutoPathChoiceChange(slot, $event)"></Dropdown>
                                <Dropdown :choices="SIDE_CHOICES" :model-value="selectedSideIndex[slot]"
                                    @update:modelValue="onSideChange(slot, $event)"></Dropdown>
                                <NumberInput :model-value="selectedDelaySeconds[slot]"
                                    @update:modelValue="selectedDelaySeconds[slot] = $event" label="Delay (s)"></NumberInput>
                            </div>
                        </div>

                        <div class="autopath-side-column">
                            <div v-for="slot in [3, 4, 5]" :key="slot" class="autopath-slot-controls">
                                <div class="autopath-slot-header">
                                    <span class="autopath-preview-swatch" :style="{ backgroundColor: slotColor(slot) }"></span>
                                    <span class="autopath-slot-team">{{ teamAtSlot(slot)?.text ?? 'Unassigned' }}</span>
                                </div>
                                <Dropdown :choices="autoPathChoices[slot] ?? []" :model-value="selectedAutoPathIndex[slot]"
                                    @update:modelValue="onAutoPathChoiceChange(slot, $event)"></Dropdown>
                                <Dropdown :choices="SIDE_CHOICES" :model-value="selectedSideIndex[slot]"
                                    @update:modelValue="onSideChange(slot, $event)"></Dropdown>
                                <NumberInput :model-value="selectedDelaySeconds[slot]"
                                    @update:modelValue="selectedDelaySeconds[slot] = $event" label="Delay (s)"></NumberInput>
                            </div>
                        </div>
                    </div>
                </template>

                <!-- Kept mounted while AUTO is showing (v-show, not v-if), so
                     going to AUTO and back never drops strokes that are
                     still waiting to save. -->
                <StrategyBoard v-show="strategyTab !== 'auto'" :phase="whiteboardPhase" :match-number="matchNumber"
                    :team-numbers="teamNumbers" :team-filters="teamFilters" :slot-color="slotColor"></StrategyBoard>
            </FullscreenTile>
        </div>
        <div v-else-if="teamsLoaded">
            <h2>No Data Available</h2>
        </div>
    </div>
</template>

<script lang="ts">
// The phases of a match, in order — the tabs of the strategy tile. AUTO is
// the auto-path preview/editor; the rest are whiteboards.
const STRATEGY_TABS = [
    { key: 'auto', title: 'AUTO' },
    { key: 'transition', title: 'TRANSITION' },
    { key: 'active', title: 'ACTIVE' },
    { key: 'inactive', title: 'INACTIVE' }
];

// A sideways swipe has to travel this far, and be clearly more sideways
// than up-and-down, to change phase.
const SWIPE_MIN_PX = 60;
// Swipes that start on these don't count: the field is for drawing, and the
// rest have their own drag or scroll behavior.
const SWIPE_IGNORE = 'svg, input, textarea, select, md-outlined-select, .searchable-dropdown, .color-swatch-picker';

// Fixed palette a team's color can be chosen from (issue #32 feedback) —
// at least 6 distinct colors, with 2 extras (magenta/white) for the rare
// case all 6 defaults collide with a scout's preference. Declared here
// (not in <script setup>) so it's plain module scope reachable from both
// this Options block's methods and, via data() below, the template.
const COLOR_CHOICES = [
    { key: 'red', text: 'Red', hex: '#e5383b' },
    { key: 'orange', text: 'Orange', hex: '#e08a1e' },
    { key: 'yellow', text: 'Yellow', hex: '#f2c14e' },
    { key: 'green', text: 'Green', hex: '#1eae7a' },
    { key: 'blue', text: 'Blue', hex: '#2f7de1' },
    { key: 'purple', text: 'Purple', hex: '#8a3fd1' },
    { key: 'magenta', text: 'Hot Pink', hex: '#ff69b4' },
    { key: 'white', text: 'White', hex: '#f2f2f2' }
];

export default {
    data() {
        return {
            deviceViewMode: null,
            eventStore: null,
            authStore: null,
            queueStore: null,
            teamsLoaded: false,
            teamFilters: [],
            // Values, not indices — a team-number key (string, matching
            // teamFilters[i].key) or null for an unassigned slot, since an
            // index can't survive SearchableDropdown's live-filtered list.
            teamNumbers: [null, null, null, null, null, null],
            matchNumber: null,
            matchLookupFailed: false,
            // Default is schedule-driven auto-assignment; flip on to hand-pick
            // teams instead (e.g. the schedule hasn't been synced yet).
            manualTeamSelection: false,
            // Which phase tab is showing (see STRATEGY_TABS).
            strategyTab: 'auto',
            // The whiteboard phase last shown, so the board keeps a valid
            // phase while the AUTO tab is up.
            whiteboardPhase: 'transition',
            // Where a touch that might be a swipe started.
            swipeStart: null,
            // Within the AUTO tab: looking at the chosen paths, or drawing a
            // new one in place.
            strategyMode: 'preview',
            // Per-slot dropdown choices ({key, text, path}) of that slot's team's saved auto paths,
            // plus a leading "None" option. Index aligns with teamNumbers (0-2 red, 3-5 blue).
            autoPathChoices: [[], [], [], [], [], []],
            selectedAutoPathIndex: [0, 0, 0, 0, 0, 0],
            // Which side (left/right) to preview each slot's chosen path as — defaults to
            // the path's own recorded side, but can be flipped independently per slot.
            selectedSideIndex: [0, 0, 0, 0, 0, 0],
            // Visualization-only playback delay per slot, in seconds — not
            // persisted, just staggers when each marker starts moving.
            selectedDelaySeconds: [0, 0, 0, 0, 0, 0],
            // slot -> { autoPathId, side } for the current match, as last
            // saved (by anyone, on any device) via saveAutoSelectionsNow()
            // below — "what we're planning to run" needs to survive a
            // reload and show the same thing to every device, not just
            // live locally. Re-fetched whenever the match number changes.
            savedAutoSelections: {},
            autoSelectionsSaveTimer: null,
            // Per-slot robot photo URL (or null), used by the combined
            // canvas's per-layer marker and by the Auto Edit active marker.
            robotPhotoUrls: [null, null, null, null, null, null],
            showRedPaths: true,
            showBluePaths: true,
            // Index into COLOR_CHOICES per slot — user-selectable team color
            // (issue #32 feedback), defaulting to 6 distinct colors so every
            // slot starts visually unique; magenta/white are extra choices.
            slotColorIndex: [0, 1, 2, 3, 4, 5],
            isPlaying: false,
            // Auto Edit mode state — drawing a brand-new path in place,
            // auto-named "Match N Path" by default.
            autoEditSlot: 0,
            autoEditName: '',
            // The default name last auto-applied — used to tell "the scout
            // hasn't touched the name yet" apart from "the scout typed
            // something," so a later match-number change can keep the
            // default in sync without clobbering a manual edit.
            previousAutoEditDefault: '',
            autoEditSideIndex: 0,
            autoEditPoints: [],
            autoEditNameError: false,
            autoEditPathError: false,
            autoEditSavedMessage: '',
            SIDE_CHOICES,
            COLOR_CHOICES,
            STRATEGY_TABS
        }
    },
    watch: {
        strategyTab(tab) {
            if (tab !== 'auto') this.whiteboardPhase = tab;
        },
        matchNumber() {
            this.refreshAutoEditDefaultName();
        },
        manualTeamSelection() {
            this.refreshAutoEditDefaultName();
        }
    },
    methods: {
        stepStrategyTab(step: int) {
            const next = this.strategyTabIndex + step;
            if (next < 0 || next >= STRATEGY_TABS.length) return;
            this.strategyTab = STRATEGY_TABS[next].key;
        },
        onSwipeStart(event) {
            const touch = event.touches.length === 1 ? event.touches[0] : null;
            this.swipeStart = touch && !event.target.closest?.(SWIPE_IGNORE)
                ? { x: touch.clientX, y: touch.clientY }
                : null;
        },
        onSwipeEnd(event) {
            const start = this.swipeStart;
            this.swipeStart = null;
            const touch = event.changedTouches[0];
            if (!start || !touch) return;

            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 2 * Math.abs(dy)) return;
            // Swiping left brings in the next phase, like turning a page.
            this.stepStrategyTab(dx < 0 ? 1 : -1);
        },
        async loadTeamsData() {
            // Note: do this to avoid stale data on page refresh.
            await this.eventStore.updateEvent();

            const { data, error } = await supabase.from(teamInfoTable).select("*").eq("event_id", this.eventStore.eventId);
            let teamTextMap = {};
            if (error) {
                console.log(error);
            } else {
                for (var team of data) {
                    teamTextMap[team.team_number] = String(team.team_number) + " - " + String(team.name);
                }
            }

            this.teamFilters = [];
            Object.keys(teamTextMap).forEach(element => {
                let teamText = String(element);
                if (Object.keys(teamTextMap).includes(element)) {
                    teamText = teamTextMap[element];
                }
                this.teamFilters.push({ key: element, text: teamText });
            })

            // Mark the data as ready for the view to display.
            this.teamsLoaded = true;

            // Load auto path choices for whichever team currently occupies each slot.
            for (var slot = 0; slot < this.teamNumbers.length; slot++) {
                this.loadAutoPathChoices(slot);
            }
        },
        teamAtSlot(slot: int) {
            return this.teamFilters.find((t) => t.key === this.teamNumbers[slot]);
        },
        async loadAutoPathChoices(slot: int) {
            this.selectedAutoPathIndex[slot] = 0;
            this.selectedSideIndex[slot] = 0;
            this.robotPhotoUrls[slot] = null;

            const teamKey = this.teamNumbers[slot];
            if (slot >= this.teamNumbers.length || !teamKey) {
                this.autoPathChoices[slot] = [{ key: 'none', text: 'No Auto Selected', path: null }];
                return;
            }

            const teamNumber = Number(teamKey);
            const paths = await fetchTeamAutoPaths(teamNumber, this.eventStore.eventId);
            fetchRobotPhotoUrl(teamNumber).then((url) => { this.robotPhotoUrls[slot] = url; });

            // A lone path is treated as the default even if is_default was never
            // explicitly set — matches AutoPathCard's isOnlyPath rule. With
            // several paths and none explicitly marked default either, fall
            // back to the first saved path rather than leaving the slot on
            // "None" — a team with real saved paths should never silently
            // show as if it had none.
            const defaultId = paths.length === 1
                ? paths[0].id
                : (paths.find((p) => p.isDefault)?.id ?? paths[0]?.id);

            this.autoPathChoices[slot] = [
                { key: 'none', text: 'No Auto Selected', path: null },
                ...paths.map((p) => ({
                    key: String(p.id),
                    text: `${teamNumber} - ${p.name}${p.id === defaultId ? ' (default)' : ''}`,
                    path: p
                }))
            ];

            // A match-specific selection saved earlier (by anyone, on any
            // device — see saveAutoSelectionsNow()) takes priority over the
            // team's own "is_default" auto: that's what this event's leads
            // actually decided to run, not just a reasonable guess. Set
            // directly (not via onAutoPathChoiceChange) so the saved side
            // is used as-is instead of being reset to the path's own
            // recorded side. Falls through to the usual default-auto
            // behavior if the saved pick no longer resolves (e.g. that path
            // was deleted since).
            const saved = this.savedAutoSelections[slot];
            if (saved) {
                // autoPathId is null for an explicit "No Auto Selected" save
                // (see saveAutoSelectionsNow()) — that decision is just as
                // real as picking an actual path and needs to stick, not
                // fall through to the team's default-auto behavior below.
                if (saved.autoPathId == null) {
                    this.selectedAutoPathIndex[slot] = 0;
                    this.selectedSideIndex[slot] = 0;
                    return;
                }

                const savedChoiceIdx = this.autoPathChoices[slot].findIndex((c) => c.key === saved.autoPathId);
                if (savedChoiceIdx > 0) {
                    this.selectedAutoPathIndex[slot] = savedChoiceIdx;
                    const sideIdx = SIDE_CHOICES.findIndex((c) => c.key === saved.side);
                    this.selectedSideIndex[slot] = sideIdx >= 0 ? sideIdx : 0;
                    return;
                }
                // Saved path no longer exists (e.g. deleted since) — fall
                // through to the default-auto behavior below.
            }

            // Default to the team's marked-default auto instead of "None" — or,
            // with only one saved path, that path is the default by definition.
            const defaultChoiceIdx = this.autoPathChoices[slot].findIndex((c) => c.key === String(defaultId));
            if (defaultChoiceIdx > 0) {
                this.onAutoPathChoiceChange(slot, defaultChoiceIdx);
            }
        },
        slotColor(slot: int) {
            const choice = COLOR_CHOICES[this.slotColorIndex[slot]];
            if (!choice) return '#ff8c00';
            // 'white' is unusable against light mode's white/near-white
            // canvas and field backgrounds — draw it as black there instead,
            // matching ColorSwatchPicker's swatch-only override so what the
            // picker shows is also what actually gets drawn.
            if (choice.key === 'white' && !this.deviceViewMode?.darkMode) return '#000000';
            return choice.hex;
        },
        onAutoPathChoiceChange(slot: int, choiceIdx: int) {
            this.selectedAutoPathIndex[slot] = choiceIdx;

            // Default the side selector to whatever the newly-picked path was
            // actually recorded as, rather than leaving a stale choice in place.
            const choice = this.autoPathChoices[slot]?.[choiceIdx];
            const side = choice?.path?.side;
            const sideIdx = SIDE_CHOICES.findIndex((c) => c.key === side);
            this.selectedSideIndex[slot] = sideIdx >= 0 ? sideIdx : 0;

            this.scheduleAutoSelectionsSave();
        },
        // A manual side flip (e.g. running a path mirrored) is just as much
        // "what we're planning to run" as the auto-path choice itself, so it
        // gets saved too — unlike onAutoPathChoiceChange, it never touches
        // selectedAutoPathIndex.
        onSideChange(slot: int, sideIdx: int) {
            this.selectedSideIndex[slot] = sideIdx;
            this.scheduleAutoSelectionsSave();
        },
        setTeam(idx: int, teamKey) {
            this.teamNumbers[idx] = teamKey;
            this.loadAutoPathChoices(idx);
        },
        async onMatchNumberChange(value) {
            this.matchNumber = value;
            await this.loadAutoSelections();

            // In manual mode the match number is just informational context —
            // it doesn't overwrite the scout's hand-picked teams. Still
            // re-derive each slot's auto-path pick against whichever team is
            // already there, though, so a saved selection for this match
            // shows up even without touching the team pickers.
            if (this.manualTeamSelection) {
                [0, 1, 2, 3, 4, 5].forEach((slot) => this.loadAutoPathChoices(slot));
                return;
            }

            await this.applyScheduleTeams();
        },
        // Loads which auto path (and side) each slot last had saved for the
        // current match — see saveAutoSelectionsNow(). loadAutoPathChoices()
        // consults this once it's populated.
        async loadAutoSelections() {
            if (!this.matchNumber) {
                this.savedAutoSelections = {};
                return;
            }

            const result = await fetchStrategyBoard(this.eventStore.eventId, Number(this.matchNumber));
            const map = {};
            (result.autoSelections ?? []).forEach((entry) => { map[entry.slot] = entry; });
            this.savedAutoSelections = map;
        },
        scheduleAutoSelectionsSave() {
            clearTimeout(this.autoSelectionsSaveTimer);
            this.autoSelectionsSaveTimer = setTimeout(() => this.saveAutoSelectionsNow(), 800);
        },
        async saveAutoSelectionsNow() {
            if (!this.matchNumber) return;

            const entries = [];
            [0, 1, 2, 3, 4, 5].forEach((slot) => {
                // Only slots with a team actually assigned have a meaningful
                // "planning to run" state — an empty slot's implicit "none"
                // isn't worth saving, and would otherwise wrongly stick once
                // a real team gets assigned to it later.
                if (!this.teamNumbers[slot]) return;
                const choice = this.autoPathChoices[slot]?.[this.selectedAutoPathIndex[slot]];
                if (!choice) return;

                // "No Auto Selected" is itself an explicit, real choice — it
                // needs to be saved (as autoPathId: null) just like a real
                // pick, or reloading would silently re-apply the team's own
                // default auto over it. See loadAutoPathChoices().
                entries.push({
                    slot,
                    autoPathId: choice.key === 'none' ? null : choice.key,
                    side: choice.key === 'none' ? null : (SIDE_CHOICES[this.selectedSideIndex[slot]]?.key ?? null)
                });
            });

            const eventId = this.eventStore.eventId;
            const matchNumber = Number(this.matchNumber);
            const error = await saveAutoSelections(eventId, matchNumber, entries);

            if (error) {
                console.log(error);
                this.queueStore.enqueue(
                    'strategy_auto_selections',
                    { eventId, matchNumber, autoSelections: entries },
                    error.message ?? String(error)
                );
            }
        },
        async applyScheduleTeams() {
            this.matchLookupFailed = false;

            if (!this.matchNumber) return;

            const matchTeams = await queryMatchTeams(this.eventStore.eventId, Number(this.matchNumber));
            if (!matchTeams) {
                this.matchLookupFailed = true;
                return;
            }

            // Slot order matches teamNumbers: 0-2 red, 3-5 blue (see template).
            const slots = [matchTeams.red1, matchTeams.red2, matchTeams.red3, matchTeams.blue1, matchTeams.blue2, matchTeams.blue3];
            slots.forEach((teamNumber, slot) => {
                if (!teamNumber) return;
                const teamKey = this.teamFilters.find((t) => Number(t.key) === teamNumber)?.key;
                if (teamKey !== undefined) this.setTeam(slot, teamKey);
            });
        },
        onManualToggle(value) {
            this.manualTeamSelection = value;

            // Switching back to auto mode: re-derive teams from the schedule
            // rather than leaving whatever was last manually picked.
            if (!value) this.applyScheduleTeams();
        },
        onAutoEditSlotChange() {
            this.autoEditPoints = [];
            this.autoEditSideIndex = 0;
            this.autoEditName = this.autoEditDefaultName();
            this.previousAutoEditDefault = this.autoEditName;
        },
        // Auto-named from the match number by default. When teams are
        // manually selected, the match number may not correspond to a real
        // scheduled match, so auto-naming from it would be misleading —
        // leave the name blank instead and let the scout type their own.
        autoEditDefaultName() {
            if (this.manualTeamSelection) return '';
            return this.matchNumber ? `Match ${this.matchNumber} Path` : '';
        },
        // Keeps the auto-generated name in sync as the match number (or
        // manual-selection toggle) changes — but only while the scout
        // hasn't typed their own name over the last auto-applied default.
        refreshAutoEditDefaultName() {
            const nextDefault = this.autoEditDefaultName();
            if (this.autoEditName === this.previousAutoEditDefault) {
                this.autoEditName = nextDefault;
            }
            this.previousAutoEditDefault = nextDefault;
        },
        async saveAutoEditPath() {
            this.autoEditNameError = this.autoEditName.trim() === '';
            this.autoEditPathError = this.autoEditPoints.length < 2;
            if (this.autoEditNameError || this.autoEditPathError) return;

            const teamNumber = Number(this.teamNumbers[this.autoEditSlot]);
            const data = {
                team_number: teamNumber,
                name: this.autoEditName.trim(),
                alliance: this.autoEditAlliance,
                side: SIDE_CHOICES[this.autoEditSideIndex]?.key,
                path: this.autoEditPoints,
                event: this.eventStore.eventId
            };

            const error = await submitScoutData(data, autoPathTable);
            if (error) {
                console.log(error);
                this.queueStore.enqueue('scout_data', { table: autoPathTable, data, id: null }, error.message ?? String(error));
                this.autoEditSavedMessage = "Couldn't save — queued for sync.";
            } else {
                this.autoEditSavedMessage = 'Saved!';
            }

            this.autoEditPoints = [];
            await this.loadAutoPathChoices(this.autoEditSlot);
            setTimeout(() => { this.autoEditSavedMessage = ''; }, 4000);
        }
    },
    computed: {
        strategyTabIndex() {
            return STRATEGY_TABS.findIndex((tab) => tab.key === this.strategyTab);
        },
        strategyTabTitle() {
            return STRATEGY_TABS[this.strategyTabIndex]?.title ?? '';
        },
        isLead() {
            return this.authStore?.isLead;
        },
        isDataAvailable() {
            return this.teamFilters.length > 0;
        },
        // Builds every slot with a selected path into one set of layers for
        // a single combined canvas — each layer carries its own alliance so
        // red and blue render together (see AutoPathCanvas's per-layer
        // alliance support), filtered by the show/hide alliance toggles.
        // display-alliance stays out of this entirely: alliance-based
        // placement is driven per-layer now, not by a canvas-wide prop (see
        // auto-path-field.ts's file header for why that placement must stay
        // centralized in AutoPathCanvas's toView). Side, unlike alliance, is
        // a real mirror within the stored frame, so it's applied here via
        // transformPath before handing points to the canvas.
        combinedLayers() {
            const layers = [];

            [0, 1, 2, 3, 4, 5].forEach((slot) => {
                const alliance = slot < 3 ? allianceRed : allianceBlue;
                if (alliance === allianceRed && !this.showRedPaths) return;
                if (alliance === allianceBlue && !this.showBluePaths) return;

                const choiceIdx = this.selectedAutoPathIndex[slot];
                const choice = this.autoPathChoices[slot]?.[choiceIdx];
                if (!choice || !choice.path) return;

                const targetSide = SIDE_CHOICES[this.selectedSideIndex[slot]]?.key ?? choice.path.side;
                const points = transformPath(choice.path.points, choice.path.side, targetSide);
                const delaySeconds = Number(this.selectedDelaySeconds[slot]) || 0;

                layers.push({
                    key: `slot-${slot}`,
                    points,
                    color: this.slotColor(slot),
                    alliance,
                    photoUrl: this.robotPhotoUrls[slot] ?? null,
                    delayFraction: delaySeconds > 0 ? (delaySeconds * 1000) / 20000 : 0
                });
            });

            return layers;
        },
        slotChoices() {
            const labels = ['Red 1', 'Red 2', 'Red 3', 'Blue 1', 'Blue 2', 'Blue 3'];
            return [0, 1, 2, 3, 4, 5].map((slot) => ({
                key: slot,
                text: `${labels[slot]} — ${this.teamAtSlot(slot)?.text ?? 'Unassigned'}`
            }));
        },
        // Big on-field driver-station labels (see AutoPathCanvas's
        // stationLabels prop) — skips unassigned slots so an empty alliance
        // spot doesn't clutter the field with a placeholder.
        stationLabels() {
            return [0, 1, 2, 3, 4, 5]
                .filter((slot) => this.teamNumbers[slot])
                .map((slot) => ({
                    slot,
                    text: String(this.teamNumbers[slot]),
                    color: this.slotColor(slot)
                }));
        },
        autoEditAlliance() {
            return this.autoEditSlot < 3 ? allianceRed : allianceBlue;
        }
    },
    beforeUnmount() {
        clearTimeout(this.autoSelectionsSaveTimer);
    },
    created() {
        this.deviceViewMode = useViewModeStore();
        this.eventStore = useEventStore();
        this.authStore = useAuthStore();
        this.queueStore = useOfflineQueueStore();
        this.autoEditName = this.autoEditDefaultName();
        this.previousAutoEditDefault = this.autoEditName;
        if (!this.authStore.isLead) return;
        this.loadTeamsData();
    }
}
</script>

<style>
.strategy-locked {
    text-align: center;
    padding: 60px 0;
    color: rgba(128, 128, 128, 0.8);
}

.strategy-locked-icon {
    font-size: 52px;
    margin-bottom: 12px;
}

.red-alliance {
    border: 2px solid red;
}

.blue-alliance {
    border: 2px solid blue;
}

/* The global .data-tile class sets overflow: auto, which would otherwise
   clip (and add a scrollbar around) ColorSwatchPicker's expanded palette
   popup — these two tiles only ever hold that picker plus a couple of
   dropdowns, nothing that actually needs to scroll. */
.data-tile.red-alliance,
.data-tile.blue-alliance {
    overflow: visible;
}

.autopath-preview-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 16px;
}

.autopath-preview-selectors {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    margin-bottom: 12px;
}

.autopath-preview-selector {
    display: flex;
    align-items: center;
    gap: 10px;
}

.alliance-slot-row {
    padding: 6px 0;
}

.alliance-slot-label {
    font-weight: 600;
    min-width: 52px;
}

.autopath-preview-swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
}

.assigned-team {
    font-weight: bold;
}

.color-hint {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.85);
    margin: -4px 0 12px;
}

/* ── Phase tabs and title (issue #126) ── */
.strategy-tab-header {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-bottom: 18px;
    /* Room for FullscreenTile's toggle in the top-right corner. */
    padding: 0 36px;
}

/* In fullscreen the tile scrolls, so the title stays pinned to the top. */
.fullscreen-tile:fullscreen .strategy-tab-header {
    position: sticky;
    top: -20px;
    z-index: 4;
    margin-top: -20px;
    padding-top: 20px;
    padding-bottom: 10px;
    background: var(--tile-background-color, #1b1b1b);
}

.strategy-tabs {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    border-radius: 10px;
    overflow: hidden;
    border: 1.5px solid rgba(128, 128, 128, 0.35);
}

.strategy-tab {
    background: transparent;
    border: none;
    padding: 10px 14px;
    min-height: 44px;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--primary-text-color);
    cursor: pointer;
}

.strategy-tab + .strategy-tab {
    border-left: 1.5px solid rgba(128, 128, 128, 0.35);
}

.strategy-tab--active {
    background: #b05703;
    color: #fff;
}

.strategy-tab-title-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    width: 100%;
}

.strategy-tab-title {
    margin: 0;
    font-size: clamp(30px, 8vw, 56px);
    font-weight: 800;
    letter-spacing: 0.08em;
    line-height: 1.05;
    text-transform: uppercase;
    text-align: center;
}

.strategy-tab-arrow {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border: none;
    border-radius: 50%;
    background: rgba(128, 128, 128, 0.15);
    color: var(--primary-text-color);
    font: inherit;
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
}

.strategy-tab-arrow:disabled {
    opacity: 0.3;
    cursor: default;
}

.strategy-mode-toggle {
    display: flex;
    gap: 10px;
    margin-bottom: 24px;
}

.strategy-mode-toggle md-filled-button.mode-inactive,
.tool-toggle md-filled-button.mode-inactive {
    --md-filled-button-container-color: rgba(128, 128, 128, 0.4);
}

.whiteboard-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    margin-bottom: 20px;
}

.tool-toggle {
    display: flex;
    gap: 8px;
}

.autopath-form-row {
    margin-bottom: 20px;
}

.autopath-selectors {
    display: flex;
    gap: 28px;
}

.autopath-selector {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.autopath-selector label {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.75);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

/* The field fills the full width of the tile; per-slot controls sit in two
   columns below it (red left, blue right) instead of narrowing the canvas
   by flanking it. The shared .data-tile class is a centered flex column
   (align-items: center), which shrink-wraps block children to their
   content width by default — align-self: stretch opts these specific
   sections back into filling the tile's full width. */
.autopath-canvas-full {
    align-self: stretch;
    margin-bottom: 20px;
}

.autopath-bottom-controls {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
    margin-bottom: 20px;
}

.autopath-side-by-side {
    align-self: stretch;
    display: flex;
    gap: 32px;
    margin-top: 28px;
}

.autopath-side-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-width: 0;
}

.autopath-slot-controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.autopath-slot-header {
    display: flex;
    align-items: center;
    gap: 8px;
}

.autopath-slot-team {
    font-weight: 600;
}

@media (max-width: 1000px) {
    .autopath-side-by-side {
        flex-direction: column;
        gap: 24px;
    }
}

.autopath-actions {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 16px;
    margin-bottom: 8px;
}

.confirm-text {
    font-size: 13px;
    color: var(--primary-text-color);
}

.strategy-board-content {
    align-self: stretch;
    width: 100%;
}

.strategy-board-content .autopath-preview-selectors {
    margin-bottom: 20px;
}
</style>
