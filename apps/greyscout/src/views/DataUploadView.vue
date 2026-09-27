<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { useEventStore } from "@/stores/event-store";
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import { useAuthStore } from "@/stores/auth-store";
import { matchScoutTable, teamNumberColumn, matchNumberColumn } from "@/lib/constants";

import '@material/web/select/outlined-select';
import '@material/web/select/select-option';
import "@material/web/button/filled-button";
import Dropdown from "@greybots/common/components/Dropdown.vue";

import Papa from 'papaparse';
import { supabase } from "@greybots/common/supabase/client";

</script>

<template>
    <div class="main-content">
        <h1>Data Upload</h1>
        <div v-if="authStore.isWriteAuthorized">
            <div>
                <div class="analysis-row-tile">
                    <input ref="file" type="file" v-on:change="handleFileSelection" hidden>
                    <div class="file-upload-tile">
                        <div class="tile-item" v-if="isUserWriteAccess">
                            Source:
                            <Dropdown :choices="sourceList" v-model="currentSourceIndex"
                                @update:modelValue="setSourceIndex">
                            </Dropdown>
                        </div>
                        <div class="tile-item" v-if="isUserWriteAccess">
                            <md-filled-button v-on:click="chooseFiles" v-if="!dataUploading">Upload
                                Data</md-filled-button>
                            <md-filled-button v-on:click="chooseFiles" disabled v-else>Uploading...</md-filled-button>
                        </div>
                    </div>
                </div>

                <div class="data-tile error-tile" v-if="uploadFailed">
                    <h1>Data upload failed</h1>
                    <p>
                        {{ errorText }}
                    </p>
                </div>
                <div class="data-tile success-tile" v-if="uploadSuccess">
                    <h1>Data uploaded successfully!</h1>
                </div>
            </div>
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
            dataUploading: false,
            csvData: {},
            sourceList: [
                { key: "973", text: "973 - Greybots" }
            ],
            currentSourceIndex: 0,
            uploadFailed: false,
            uploadSuccess: false,
            errorText: ""
        }
    },
    methods: {
        async loadLayout() {
            // Note: do this to avoid stale data on page refresh.
            await this.eventStore.updateEvent();
        },
        chooseFiles() {
            let fileInputElement = this.$refs.file;
            fileInputElement.click();
        },
        async handleFileSelection() {
            await this.authStore.checkUser();
            if (!this.authStore.isWriteAuthorized) {
                // Early exit if the user is not authorized to upload images.
                return;
            }

            let fileInputElement = this.$refs.file;
            if (fileInputElement.files.length > 0 && fileInputElement.files[0]) {
                let selectedFile = fileInputElement.files[0];

                this.dataUploading = true;
                this.uploadFailed = false;
                this.uploadSuccess = false;

                if (selectedFile) {
                    Papa.parse(selectedFile, {
                        header: true, // Use the first row as headers
                        skipEmptyLines: true, // Avoid a trailing blank line producing a null-filled row
                        complete: (results) => {
                            this.csvData.value = results.data;
                            this.uploadData();
                        },
                        error: (error) => {
                            this.uploadFailed = true;
                            this.uploadSuccess = false;
                            console.error('Error parsing CSV:', error);
                        }
                    });
                }
            }
        },
        async uploadData() {
            let rows = [];
            for (var i = 0; i < this.csvData.value.length; i++) {
                let row = JSON.parse(JSON.stringify(this.csvData.value[i]));
                const key = row[teamNumberColumn] + "_" + this.eventStore.eventId + "_match" + row[matchNumberColumn] + "_source" + this.currentSource;
                row['key'] = key;
                row['source'] = this.currentSource;

                rows.push(row);
            }

            const { error } = await supabase.from(matchScoutTable).upsert(rows, { ignoreDuplicates: true, onConflict: "key" });
            if (error) {
                console.log(error);
                this.errorText = error;
                this.uploadFailed = true;
                this.uploadSuccess = false;
            } else {
                this.uploadFailed = false;
                this.uploadSuccess = true;
            }

            this.dataUploading = false;
        },
        setSourceIndex(index) {
            this.currentSourceIndex = index;
        }
    },
    computed: {
        isUserWriteAccess() {
            return this.authStore.isWriteAuthorized;
        },
        currentSource() {
            return this.sourceList[this.currentSourceIndex].key;
        }
    },
    created() {
        this.viewMode = useViewModeStore();
        this.eventStore = useEventStore();
        this.authStore = useAuthStore();
        this.authStore.checkUser();

        this.loadLayout();

        // Do this to handle color scheme changes in charts when switching light/dark mode.
        // this.viewMode.$subscribe((mutation, state) => {
        //     const isScreenWidth = mutation?.events?.key == 'screenWidth';
        //     const isOldWidthMobile = mutation?.events?.oldValue <= minWidthForDesktop;
        //     const isNewWidthMobile = mutation?.events?.newValue <= minWidthForDesktop;
        //     const didCrossMobileThreshold = isScreenWidth && (isOldWidthMobile != isNewWidthMobile);

        //     if (mutation?.events.key == 'darkMode' || didCrossMobileThreshold) {
        //         this.refreshTiles();
        //     }
        // })
    }
}
</script>

<style scoped></style>
