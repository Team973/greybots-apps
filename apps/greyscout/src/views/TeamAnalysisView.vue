<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { uploadFile, updatePhoto } from "@/lib/data-submission";
import { useEventStore } from "@/stores/event-store";
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import { useAuthStore } from "@/stores/auth-store";
import { useWatchlistStore } from "@/stores/watchlist-store";
import { robotPhotoTable, robotPhotoBucket } from "@/lib/constants";

import '@material/web/select/outlined-select';
import '@material/web/select/select-option';
import "@material/web/button/filled-button";
import draggable from 'vuedraggable'
import SearchableDropdown from "@greybots/common/components/SearchableDropdown.vue";
import Tile from "@greybots/common/components/Tile.vue";
import PitScoutingSection from "@/components/PitScoutingSection.vue";
import PreScoutSection from "@/components/PreScoutSection.vue";
import AutoPathEditor from "@/components/AutoPathEditor.vue";
import AutoPathCard from "@/components/AutoPathCard.vue";

import { supabase, supabaseProjectId } from "@greybots/common/supabase/client";
import { getTeamAnalysisLayout } from "@/lib/2026/team-analysis-layout";
import { processLayout } from "@/lib/process-layout";
import { queryTeamNumbers } from "@/lib/data-query";
import { fetchTeamComments } from "@/lib/picklist-query";
import { fetchTeamAutoPaths, setAutoPathDefault } from "@/lib/auto-path-query";
import { getTeamTbaStats, refreshTbaStats } from "@/lib/tba-cache";
import { minWidthForDesktop } from "@/lib/constants";

</script>

<template>
    <div class="main-content">
        <h1>Team Analysis</h1>
        <div v-if="teamLoaded && isDataAvailable">
            <!-- Only show this if the team data is loaded. -->
            <div class="team-select-row">
                <SearchableDropdown :choices="teamFilters" :model-value="currentTeamNumber" placeholder="Search team…"
                    @update:modelValue="setTeam"></SearchableDropdown>
                <button v-if="isTeamWatched || isUserLead" type="button" class="watch-star"
                    :class="{ 'watch-star--active': isTeamWatched, 'watch-star--readonly': !isUserLead }"
                    :disabled="!isUserLead" @click="toggleTeamWatch"
                    :title="isUserLead ? (isTeamWatched ? 'Remove from watchlist' : 'Add to watchlist') : 'On the watchlist'">
                    ★
                </button>
            </div>

            <div>
                <div class="analysis-row-tile">
                    <input ref="file" type="file" v-on:change="uploadImage" hidden>
                    <div class="image-tile" v-if="isRobotPhotoAvailable">
                        <h1>Robot Photo</h1>
                        <img :src="getRobotPhotoUrl" class="robot-photo" loading="lazy" />
                        <div v-if="isUserWriteAccess">
                            <md-filled-button v-on:click="chooseFiles"
                                v-if="!teamPhotoUploading && isUserWriteAccess">Upload a
                                Different
                                Image</md-filled-button>
                            <md-filled-button v-on:click="chooseFiles" disabled v-else>Uploading...</md-filled-button>
                        </div>
                    </div>
                    <div class="file-upload-tile" v-else>
                        <h1>No robot photo available</h1>
                        <div v-if="isUserWriteAccess">
                            <md-filled-button v-on:click="chooseFiles" v-if="!teamPhotoUploading">Upload
                                Image</md-filled-button>
                            <md-filled-button v-on:click="chooseFiles" disabled v-else>Uploading...</md-filled-button>
                        </div>
                    </div>
                </div>

                <div class="tba-stats-section">
                    <div class="tba-stats-header">
                        <h1>TBA Stats</h1>
                        <button type="button" class="tba-refresh-button" :disabled="tbaStatsRefreshing"
                            @click="refreshTbaStatsForTeam">
                            {{ tbaStatsRefreshing ? 'Refreshing…' : '↻ Refresh TBA Stats' }}
                        </button>
                    </div>
                    <p v-if="tbaStatsError" class="tba-stats-error">{{ tbaStatsError }}</p>
                    <div v-if="tbaStats" class="tba-stats-grid">
                        <div v-if="tbaStats.opr != null" class="tba-stat-card">
                            <div class="stat-label">OPR</div>
                            <div class="stat-avg">{{ tbaStats.opr.toFixed(1) }}</div>
                        </div>
                        <div v-if="tbaStats.dpr != null" class="tba-stat-card">
                            <div class="stat-label">DPR</div>
                            <div class="stat-avg">{{ tbaStats.dpr.toFixed(1) }}</div>
                        </div>
                    </div>
                    <p v-else class="no-comments">No TBA stats cached for this event yet — tap Refresh TBA Stats.</p>
                </div>

                <div v-if="teamLoaded">
                    <!-- <div v-for="tile in tileModels">
                        <Tile :type="tile.type" :model="tile.model" :title="tile.title">
                        </Tile>
                    </div> -->
                    <draggable v-model="tileModelList" group="graphs" item-key="id" @end="updateLayout" handle=".handle"
                        :key="teamNumber">
                        <template #item="{ element }">
                            <Tile :type="element.type" :model="element.model" :title="element.title" class="draggable-tile"
                                can-drag="true">
                            </Tile>
                        </template>
                    </draggable>
                </div>

                <div class="comments-section">
                    <h1>Scout Comments</h1>
                    <div v-if="!teamCommentsLoaded">Loading comments…</div>
                    <div v-else-if="teamComments.length === 0" class="no-comments">No comments from scouts yet.</div>
                    <ul v-else class="comments-list">
                        <li v-for="(comment, idx) in teamComments" :key="idx" class="comment-card">
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

                <PitScoutingSection :team-number="teamNumber"></PitScoutingSection>

                <PreScoutSection :team-number="teamNumber"></PreScoutSection>

                <div class="autopath-section">
                    <h1>Auto Paths</h1>

                    <AutoPathEditor v-if="autoPathFormMode !== 'view'" :team-number="teamNumber"
                        :auto-path-id="autoPathFormMode === 'edit' ? autoPathEditId : null" @saved="onAutoPathFormSaved"
                        @deleted="onAutoPathFormDeleted" @cancel="onAutoPathFormCancel">
                    </AutoPathEditor>

                    <template v-else>
                        <div v-if="autoPathSaveMessage" class="data-tile notification-tile autopath-save-message">
                            {{ autoPathSaveMessage }}</div>

                        <div v-if="!teamAutoPathsLoaded">Loading auto paths…</div>
                        <div v-else-if="teamAutoPaths.length === 0" class="no-comments">
                            <p>No auto paths recorded yet.</p>
                            <md-filled-button v-if="isUserWriteAccess" v-on:click="startAddAutoPath">Add Auto
                                Path</md-filled-button>
                        </div>
                        <template v-else>
                            <div class="pit-actions" v-if="isUserWriteAccess">
                                <md-filled-button v-on:click="startAddAutoPath">Add Auto Path</md-filled-button>
                            </div>
                            <ul class="autopath-list">
                                <AutoPathCard v-for="(path, idx) in teamAutoPaths" :key="path.id" :path="path"
                                    :team-number="teamNumber" :can-edit="isUserWriteAccess"
                                    :card-color="autoPathColor(idx)" :is-only-path="teamAutoPaths.length === 1"
                                    @edit="startEditAutoPath" @set-default="setAutoPathAsDefault">
                                </AutoPathCard>
                            </ul>
                        </template>
                    </template>
                </div>
            </div>
        </div>
        <div v-else-if="teamLoaded">
            <h2>No Data Available</h2>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            viewMode: null,
            eventStore: null,
            authStore: null,
            watchlistStore: null,
            teamLoaded: false,
            teamPhotoLoaded: false,
            teamPhotoAvailable: false,
            teamPhotoUrl: "",
            // Only set right after this session uploads a new photo, so the browser can
            // otherwise cache robot photos normally instead of re-fetching on every view.
            photoCacheBust: 0,
            teamPhotoUploading: false,
            teamFilters: [],
            currentTeamNumber: null,
            currentLayout: [],
            tileModelList: [],
            teamComments: [],
            teamCommentsLoaded: false,
            teamAutoPaths: [],
            teamAutoPathsLoaded: false,
            autoPathFormMode: 'view',
            autoPathEditId: null,
            autoPathSaveMessage: '',
            autoPathSaveMessageTimeout: null,
            autoPathColors: ['#ff8c00', '#2f7de1', '#8a3fd1', '#1eae7a', '#d13f6a'],
            tbaStats: null,
            tbaStatsRefreshing: false,
            tbaStatsError: ''
        }
    },
    methods: {
        async loadLayout() {
            // Note: do this to avoid stale data on page refresh.
            await this.eventStore.updateEvent();

            // Load all the team numbers for the event.
            await this.loadTeamNumbers();

            // Load all the charts.
            await this.refreshTiles();

            // Load the robot photo.
            this.getRobotPhoto();

            // Load scout comments.
            this.loadTeamComments();

            // Load auto paths.
            this.loadTeamAutoPaths();

            // Load the watchlist (event-wide, not per team).
            this.watchlistStore.loadWatchlist(this.eventStore.eventId);

            // Read cached TBA OPR/DPR (issue #26) — never fetched implicitly,
            // only via the explicit "Refresh TBA Stats" action below.
            this.loadTbaStats();
        },
        loadTbaStats() {
            const teamNumber = this.getTeamNumber();
            this.tbaStats = teamNumber < 0 ? null : getTeamTbaStats(this.eventStore.eventId, teamNumber);
        },
        async refreshTbaStatsForTeam() {
            this.tbaStatsRefreshing = true;
            this.tbaStatsError = '';
            try {
                await refreshTbaStats(this.eventStore.eventId);
            } catch (e) {
                this.tbaStatsError = e.message ?? String(e);
            }
            this.tbaStatsRefreshing = false;
            this.loadTbaStats();
        },
        async toggleTeamWatch() {
            if (!this.isUserLead) return;
            const teamNumber = this.getTeamNumber();
            if (teamNumber < 0) return;
            await this.watchlistStore.toggleWatch(this.eventStore.eventId, teamNumber);
        },
        async loadTeamAutoPaths() {
            const teamNumber = this.getTeamNumber();
            if (teamNumber < 0) {
                this.teamAutoPaths = [];
                this.teamAutoPathsLoaded = true;
                return;
            }

            this.teamAutoPathsLoaded = false;
            this.teamAutoPaths = await fetchTeamAutoPaths(teamNumber, this.eventStore.eventId);
            this.teamAutoPathsLoaded = true;
        },
        autoPathColor(idx) {
            return this.autoPathColors[idx % this.autoPathColors.length];
        },
        async setAutoPathAsDefault(id) {
            const error = await setAutoPathDefault(this.teamNumber, this.eventStore.eventId, id);
            if (error) {
                console.log(error);
                return;
            }
            await this.loadTeamAutoPaths();
        },
        startAddAutoPath() {
            this.autoPathFormMode = 'add';
            this.autoPathEditId = null;
        },
        startEditAutoPath(id) {
            this.autoPathFormMode = 'edit';
            this.autoPathEditId = id;
        },
        onAutoPathFormCancel() {
            this.autoPathFormMode = 'view';
            this.autoPathEditId = null;
        },
        async onAutoPathFormSaved({ queuedOffline }) {
            this.autoPathFormMode = 'view';
            this.autoPathEditId = null;

            if (this.autoPathSaveMessageTimeout) {
                clearTimeout(this.autoPathSaveMessageTimeout);
            }
            this.autoPathSaveMessage = queuedOffline ? "Couldn't save — queued for sync." : "Saved!";
            this.autoPathSaveMessageTimeout = setTimeout(() => {
                this.autoPathSaveMessage = '';
            }, 4000);

            await this.loadTeamAutoPaths();
        },
        async onAutoPathFormDeleted() {
            this.autoPathFormMode = 'view';
            this.autoPathEditId = null;
            await this.loadTeamAutoPaths();
        },
        async loadTeamComments() {
            const teamNumber = this.getTeamNumber();
            if (teamNumber < 0) {
                this.teamComments = [];
                this.teamCommentsLoaded = true;
                return;
            }

            this.teamCommentsLoaded = false;
            this.teamComments = await fetchTeamComments(teamNumber, this.eventStore.eventId);
            this.teamCommentsLoaded = true;
        },
        async loadTeamNumbers() {
            const teamNumbersRows = await queryTeamNumbers(this.eventStore.eventId);

            // Put the teams in a dictionary first in order to sort them by team number.
            let teamMap = {};
            teamNumbersRows.forEach(element => {
                teamMap[element['team_number']] = (
                    {
                        "key": element['team_number'],
                        "text": element['team_number'] + " - " + element['name']
                    }
                );
            });

            this.teamFilters = [];
            Object.keys(teamMap).forEach(element => {
                this.teamFilters.push(teamMap[element])
            });

            if (!this.teamFilters.some(t => t.key === this.currentTeamNumber)) {
                // Falls back to the first team if currentTeamNumber wasn't
                // seeded from the URL (or the URL named a team not in this
                // event) — see created()'s parseRouteTeamNumber() call.
                this.currentTeamNumber = this.teamFilters[0]?.key ?? null;
            }

            this.getRobotPhoto();
        },
        // Reads the optional :teamNumber route param (issue #46) — null if
        // absent or not a real number, in which case the usual "first team"
        // default in loadTeamNumbers() applies instead.
        parseRouteTeamNumber() {
            const raw = this.$route.params.teamNumber;
            if (raw == null) return null;
            const num = Number(raw);
            return Number.isFinite(num) ? num : null;
        },
        async refreshTiles() {
            this.teamLoaded = false;
            this.currentLayout = getTeamAnalysisLayout(this.getTeamNumber(), this.eventStore.eventId);

            // Only show the top chart items if this is on a phone (for applicable chart types).
            const maxItems = this.viewMode.isMobile ? 6 : null;
            this.currentLayout.forEach(model => {
                if (model.type == 'chart') {
                    model.inputs.chartInputs.options.maxDataPoints = maxItems;
                } else if (model.type == 'filterable-chart') {
                    model.inputs.chartInputs.forEach(chartInput => {
                        chartInput.chartInputs.options.maxDataPoints = maxItems;
                    });
                }
            });

            this.tileModelList = await processLayout(this.currentLayout);
            this.teamLoaded = true;
        },
        async getRobotPhoto() {
            // This function can only work once teams are loaded due to the dependence on getTeamNumber.
            const teamNumber = this.getTeamNumber();

            // If the team number is negative, this function has been called before the teams are loaded.
            if (teamNumber < 0) {
                this.teamPhotoAvailable = false;
                this.teamPhotoLoaded = true;
                return;
            }

            // get the team photo URL
            const { data, error } = await supabase.from(robotPhotoTable).select("*").eq("team_number", teamNumber);

            if (error) {
                console.log(error);

                // Even if there is an error, mark the photo as loaded to indicate that we tried to load it and failed (via the lack of photo availability).
                this.teamPhotoLoaded = true;
                this.teamPhotoAvailable = false;
                return;
            } else if (data.length == 0) {
                // Even if there is no photo, mark the photo as loaded to indicate that we tried to load it and failed (via the lack of photo availability).
                this.teamPhotoLoaded = true;
                this.teamPhotoAvailable = false;
                return;
            }

            this.teamPhotoUrl = data[0].photo_url;
            this.teamPhotoAvailable = true;

            this.teamPhotoLoaded = true;
        },
        updateLayout() {
            let newLayout = [];
            this.tileModelList.forEach(model => {
                const tile = this.currentLayout[model.id];
                newLayout.push(tile);
            });
            this.currentLayout = newLayout;
        },
        getTeamNumber() {
            return this.currentTeamNumber ?? -1;
        },
        setTeam(teamNumber) {
            this.currentTeamNumber = teamNumber;
            this.photoCacheBust = 0;

            // Switching teams always drops any in-progress auto-path form back to view mode.
            this.autoPathFormMode = 'view';
            this.autoPathEditId = null;

            // Reload team data.
            this.refreshTiles();
            this.getRobotPhoto();
            this.loadTeamComments();
            this.loadTeamAutoPaths();
            this.loadTbaStats();

            // Keep the URL in sync (issue #46) so this team's page is
            // directly linkable/bookmarkable — replace, not push, so
            // switching teams via the dropdown doesn't spam browser history.
            if (this.$route.params.teamNumber !== String(teamNumber)) {
                this.$router.replace({ path: `/team/${teamNumber}` });
            }
        },
        chooseFiles() {
            let fileInputElement = this.$refs.file;
            fileInputElement.click();
        },
        async uploadImage() {
            await this.authStore.checkUser();
            if (!this.authStore.isWriteAuthorized) {
                console.log("Error: user not authorized to upload images!")
                // Early exit if the user is not authorized to upload images.
                return;
            }

            let fileInputElement = this.$refs.file;
            if (fileInputElement.files.length > 0 && fileInputElement.files[0]) {
                let selectedFile = fileInputElement.files[0];
                const teamNumber = this.getTeamNumber();

                this.teamPhotoUploading = true;
                const fileResult = await uploadFile(selectedFile, robotPhotoBucket, String(teamNumber) + "_photo");
                this.teamPhotoUploading = false;

                if (fileResult) {
                    const data = {
                        team_number: Number(teamNumber),
                        photo_url: "https://" + supabaseProjectId + ".supabase.co/storage/v1/object/public/" + robotPhotoBucket + "/" + fileResult
                    };
                    updatePhoto(data, robotPhotoTable);
                    // this.teamPhotoAvailable = true;
                    this.teamPhotoLoaded = false;
                    this.teamPhotoUrl = "";
                    this.photoCacheBust = Date.now();

                    // Refresh the robot photo.
                    this.getRobotPhoto();
                }
            }
        }
    },
    computed: {
        tileModels() {
            return this.tileModelList;
        },
        isDataAvailable() {
            return this.teamFilters.length > 0;
        },
        isRobotPhotoAvailable() {
            return this.teamPhotoAvailable;
        },
        getRobotPhotoUrl() {
            if (!this.teamPhotoLoaded || !this.teamPhotoUrl) {
                return "";
            }
            return this.photoCacheBust ? `${this.teamPhotoUrl}?v=${this.photoCacheBust}` : this.teamPhotoUrl;
        },
        getCurrentTeam() {
            return this.teamFilters.find((t) => t.key === this.currentTeamNumber) ?? {};
        },
        isUserWriteAccess() {
            // Robot photo upload and auto-path add/edit are Member+, same as
            // pit scouting data on this page (PitScoutingSection gates its
            // own edits at Member+ independently).
            return this.authStore.isWriteAuthorized;
        },
        isUserLead() {
            return this.authStore.isLead;
        },
        isTeamWatched() {
            const teamNumber = this.getTeamNumber();
            if (teamNumber < 0) return false;
            return this.watchlistStore.isWatched(teamNumber);
        },
        teamNumber() {
            return this.currentTeamNumber ?? -1;
        }
    },
    watch: {
        // Reacts to the :teamNumber route param changing out from under us —
        // e.g. a link from Data Status to a different team while this page
        // is already open, or the browser back/forward buttons — since
        // created() only runs once and won't otherwise pick this up.
        '$route.params.teamNumber'() {
            const num = this.parseRouteTeamNumber();
            if (num != null && num !== this.currentTeamNumber && this.teamFilters.some(t => t.key === num)) {
                this.setTeam(num);
            }
        }
    },
    created() {
        this.viewMode = useViewModeStore();
        this.eventStore = useEventStore();
        this.authStore = useAuthStore();
        this.watchlistStore = useWatchlistStore();
        this.authStore.checkUser();

        // Seeds currentTeamNumber from the URL, if any, before
        // loadTeamNumbers() validates it against the real team list (and
        // falls back to the first team if it's missing or invalid).
        this.currentTeamNumber = this.parseRouteTeamNumber();

        this.loadLayout();

        // Do this to handle color scheme changes in charts when switching light/dark mode.
        this.viewMode.$subscribe((mutation, state) => {
            const isScreenWidth = mutation?.events?.key == 'screenWidth';
            const isOldWidthMobile = mutation?.events?.oldValue <= minWidthForDesktop;
            const isNewWidthMobile = mutation?.events?.newValue <= minWidthForDesktop;
            const didCrossMobileThreshold = isScreenWidth && (isOldWidthMobile != isNewWidthMobile);

            if (mutation?.events.key == 'darkMode' || didCrossMobileThreshold) {
                this.refreshTiles();
            }
        })
    }
}
</script>

<style scoped>
.team-select-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.watch-star {
    background: none;
    border: none;
    padding: 2px 6px;
    font-size: 26px;
    line-height: 1;
    cursor: pointer;
    color: rgba(128, 128, 128, 0.35);
    transition: color 0.15s ease, transform 0.1s ease;
}

.watch-star:not(:disabled):hover {
    color: #e0b400;
    transform: scale(1.1);
}

.watch-star--active {
    color: #e0b400;
}

.watch-star--readonly {
    cursor: default;
}

.robot-photo {
    display: block;
    width: 100%;
    max-width: 320px;
    height: auto;
    border-radius: 8px;
}

.pit-actions {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
}

.tba-stats-section {
    margin-top: 24px;
}

.tba-stats-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
}

.tba-refresh-button {
    background: none;
    color: #b05703;
    border: 1.5px solid #b05703;
    border-radius: 8px;
    padding: 7.5px 16px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
}

.tba-refresh-button:hover:not(:disabled) {
    background: rgba(176, 87, 3, 0.1);
}

.tba-refresh-button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.tba-stats-error {
    color: #d32f2f;
    font-size: 13px;
}

.tba-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    max-width: 320px;
}

.tba-stat-card {
    background: rgba(176, 87, 3, 0.08);
    border: 1px solid rgba(176, 87, 3, 0.2);
    border-radius: 10px;
    padding: 10px 12px;
    text-align: center;
}

.tba-stat-card .stat-label {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.75);
    margin-bottom: 4px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.tba-stat-card .stat-avg {
    font-size: 22px;
    font-weight: 700;
    color: #b05703;
    line-height: 1.1;
}

.autopath-section {
    margin-top: 24px;
}

.autopath-save-message {
    margin-bottom: 14px;
}

.autopath-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.comments-section {
    margin-top: 24px;
}

.no-comments {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.7);
    font-style: italic;
}

.comments-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.comment-card {
    background: var(--tile-background-color);
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
</style>
