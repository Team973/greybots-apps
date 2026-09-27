<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { useEventStore } from "@/stores/event-store";
import { useViewModeStore } from "@greybots/common/stores/view-mode-store";

import '@material/web/select/outlined-select';
import '@material/web/select/select-option';
import draggable from 'vuedraggable'

import Tile from "@greybots/common/components/Tile.vue";

import { getEventAnalysisLayout } from "@/lib/2026/event-analysis-layout";
import { processLayout } from "@/lib/process-layout";
import { minWidthForDesktop } from "@/lib/constants";
</script>

<template>
    <div class="main-content">
        <h1>Event Analysis</h1>
        <h2>Graph View</h2>

        <!-- <div v-if="eventDataLoaded">
            <div v-for="tile in tileModels">
                <Tile :type="tile.type" :model="tile.model" :title="tile.title">
                </Tile>
            </div>
        </div> -->

        <div v-if="eventDataLoaded">
            <draggable v-model="tileModelList" group="graphs" item-key="id" @end="updateLayout" handle=".handle">
                <template #item="{ element }">
                    <Tile :type="element.type" :model="element.model" :title="element.title" class="draggable-tile"
                        can-drag="true">
                    </Tile>
                </template>
            </draggable>
        </div>

        <!-- <h2>Table View</h2>
        <div class="table-container" v-if="eventDataLoaded">
            <VTable :data="tableData">
                <template #head>
                    <tr>
                        <VTh v-for="header in tableHeaders" :sortKey="header.key">
                            {{ header.name }}
                        </VTh>
                    </tr>
                </template>
                <template #body="{ rows }">
                    <tr v-for="row in rows">
                        <td v-for="col in row">{{ col }}</td>
                    </tr>
                </template>
            </VTable>
        </div> -->
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            eventStore: null,
            viewMode: null,
            eventDataLoaded: false,
            tileModelList: [],
            currentLayout: [],
            currentFromIndex: 0
        }
    },
    methods: {
        async loadLayout() {
            // Note: do this to avoid stale data on page refresh.
            await this.eventStore.updateEvent();
            this.currentLayout = getEventAnalysisLayout(this.eventStore.eventId);

            await this.refreshTiles();

            // Mark the table as loaded.
            this.eventDataLoaded = true;
        },
        async refreshTiles() {
            // Only show the top chart items if this is on a phone (for applicable chart types).
            const maxItems = this.viewMode.isMobile ? 6 : null;
            this.currentLayout.forEach(model => {
                if (model.type == 'chart') {
                    model.inputs.chartInputs.options.maxDataPoints = maxItems;
                } else if (model.type == 'filterable-chart') {
                    model.inputs.chartInputs.forEach(chartInput => {
                        chartInput.options.maxDataPoints = maxItems;
                    });
                }
            });

            this.tileModelList = await processLayout(this.currentLayout);
        },
        updateLayout() {
            let newLayout = [];
            this.tileModelList.forEach(model => {
                const tile = this.currentLayout[model.id];
                newLayout.push(tile);
            });
            this.currentLayout = newLayout;
        }
    },
    computed: {
        tileModels() {
            return this.tileModelList;
        },
        maxDataPoints() {
            // Only show the top 6 bar graph items if this is on a phone.
            if (this.viewMode.isMobile) {
                return 6;
            }
            return null;
        }
    },
    created() {
        this.eventStore = useEventStore();
        this.viewMode = useViewModeStore();
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
.table-container {
    display: flex;
    overflow: auto;
    justify-content: safe center;
    margin: auto;
}
</style>
  