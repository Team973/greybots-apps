<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { useEventStore } from "@/stores/event-store";
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';


import "@material/web/button/filled-button";
import "@material/web/chips/chip-set";
import "@material/web/chips/filter-chip";

import Dropdown from "@greybots/common/components/Dropdown.vue";
import SearchableDropdown from "@greybots/common/components/SearchableDropdown.vue";
import ResizableList from "@greybots/common/components/ResizableList.vue";
import Chart from "@greybots/common/components/charts/Chart.vue";


import { getChartModel } from "@/lib/chart-model";
import type { QueryInputs, ChartInputs } from "@/lib/chart-model";
import { queryTeamMatchData, queryTeamNumbers, queryEventData } from "@/lib/data-query";
import { defaultTeamNumber, minWidthForDesktop, teamNumberColumn, matchNumberColumn } from "@/lib/constants";

</script>

<template>
    <div class="main-content">
        <h1>Custom Data Visualization Editor</h1>
        <div>
            Plot: <Dropdown :choices="chartTypes" v-model="activeChartTypeIndex" @update:modelValue="setChartType">
            </Dropdown>
        </div>
        <div>
            Query: <Dropdown :choices="queryTypes" v-model="activeQueryTypeIndex" @update:modelValue="setQueryType">
            </Dropdown>
        </div>
        <div>
            Aggregation: <Dropdown :choices="aggregationTypes" v-model="activeAggregationTypeIndex"
                @update:modelValue="setAggregationType">
            </Dropdown>
        </div>
        <div>
            <div v-if="isTeamNumbersReady && isTeamNumberRequired">
                Team: <SearchableDropdown :choices="teamNumbers" v-model="activeTeamNumber" placeholder="Search team…"
                    @update:modelValue="setTeamNumber"></SearchableDropdown>
            </div>

            Independent: <Dropdown :choices="independentColumns" v-model="activeIndependentColumnIndex"
                @update:modelValue="setLabelColumn">
            </Dropdown>

            <div v-if="activeChartType == 'scatter'">
                <div>
                    X: <Dropdown :choices="dataColumns" v-model="activeDataXColumnIndex"
                        @update:modelValue="setDataColumnX">
                    </Dropdown>
                </div>
                <div>
                    Y: <Dropdown :choices="dataColumns" v-model="activeDataYColumnIndex"
                        @update:modelValue="setDataColumnY">
                    </Dropdown>
                </div>
            </div>
            <div v-else-if="activeChartType == 'stacked-bar'">
                Series:
                <ResizableList :item-list="seriesDropdownList" item-type-name="series"
                    @item-added="addSeriesDropdownListItem()" @item-removed="removeSeriesDropdownListItem">
                    <template v-slot:item-content="{ index }">
                        <Dropdown :choices="dataColumns" v-model="seriesDropdownList[index]['series']"
                            @update:modelValue="setSeriesDropdownValue($event, index)">
                        </Dropdown>
                        <Dropdown :choices="colorOptions" v-model="seriesDropdownList[index]['color']"
                            @update:modelValue="setSeriesColorDropdownValue($event, index)">
                        </Dropdown>
                    </template>
                </ResizableList>
            </div>
            <div v-else-if="activeChartType == 'radar'">
                Comparisons:
                <ResizableList :item-list="radarDropdownList" :item-type-name="activeIndependentColumnText"
                    @item-added="addRadarListDropdownListItem()" @item-removed="removeRadarListDropdownListItem">
                    <template v-slot:item-content="{ index }">
                        <Dropdown :choices="activeIndependentColumnChoices" v-model="radarDropdownList[index]['comp']"
                            @update:modelValue="setRadarListDropdownValue($event, index)">
                        </Dropdown>
                    </template>
                </ResizableList>
                Dimensions:
                <ResizableList :item-list="seriesDropdownList" item-type-name="series"
                    @item-added="addSeriesDropdownListItem()" @item-removed="removeSeriesDropdownListItem">
                    <template v-slot:item-content="{ index }">
                        <Dropdown :choices="dataColumns" v-model="seriesDropdownList[index]['series']"
                            @update:modelValue="setSeriesDropdownValue($event, index)">
                        </Dropdown>
                    </template>
                </ResizableList>
            </div>
            <div v-else>
                Y: <Dropdown :choices="dataColumns" v-model="activeDataYColumnIndex" @update:modelValue="setDataColumnY">
                </Dropdown>
            </div>

            <md-chip-set class="horizontal-chip-set">
                <md-filter-chip v-for="chip, idx in filterChips" :label="chip.label" @click="toggleChip(idx)"
                    v-bind:selected="chip.value" v-bind:disabled="chip.isDisabled"
                    class="horizontal-chip-set-chip"></md-filter-chip>
            </md-chip-set>

        </div>

        <div>
            <Chart :chart-type="activeChartType" :data="activeChartData" :chart-style="activeChartStyle"
                :options="activeChartOptions">
            </Chart>
        </div>
        <div>
            <md-filled-button v-on:click="copyChartModelInputs()" class="load-button">{{ copyButtonText
            }}</md-filled-button>
            <pre>
                {{ chartModelInputText }}
            </pre>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            chartTypes: [
                { key: "bar", text: "Bar Graph" },
                { key: "line", text: "Line Graph" },
                { key: "scatter", text: "Scatter Plot" },
                { key: "boxplot", text: "Box Plot" },
                { key: "stacked-bar", text: "Stacked Bar Graph" },
                { key: "radar", text: "Radar" },
                { key: "pie", text: "Pie Chart" }
            ],
            activeChartTypeIndex: 0,
            queryTypes: [
                { key: "team_query", text: "Team" },
                { key: "event_query", text: "Event" }
            ],
            activeQueryTypeIndex: 0,
            aggregationTypes: [
                { key: "none", text: "None" },
                { key: "mean", text: "Mean" },
                { key: "count", text: "Count" }
            ],
            activeAggregationTypeIndex: 0,
            teamNumbers: [],
            matchNumbers: [],
            activeTeamNumber: defaultTeamNumber,
            independentColumns: [
                { key: matchNumberColumn, text: "Match Number" },
                { key: teamNumberColumn, text: "Team Number" }
            ],
            activeIndependentColumnIndex: 0,
            dataColumns: [
                { key: "auto_coral", text: "Auto Coral" },
                { key: "auto_leave", text: "Auto Leave" },
                { key: "teleop_coral", text: "Teleop Coral" },
                { key: "teleop_net", text: "Net" },
                { key: "teleop_processor", text: "Processor" },
                { key: "endgame_climb", text: "Climb" },
                { key: "postmatch_defense", text: "Defense" },
                { key: "postmatch_died", text: "Died" }
            ],
            activeDataYColumnIndex: 0,
            activeDataXColumnIndex: 0,
            seriesDropdownList: [],
            radarDropdownList: [],
            chips: [
                { key: "isSorted", label: "Sorted?", value: false, isDisabled: false },
                { key: "isNormalized", label: "Normalized?", value: false, isDisabled: false },
                { key: "isHorizontal", label: "Horizontal?", value: false, isDisabled: false }
            ],
            chartOptions: {
                isSorted: false,
                isNormalized: false,
                isHorizontal: false,
                maxDataPoints: null,
                xRange: null,
                yRange: null,
                height: null,
                heightRatio: 0.5,
            },
            activeData: {},
            chartModel: {
                data: [],
                style: []
            },
            chartModelInputs: {
                queryInputs: {},
                chartInputs: {}
            },
            copyButtonText: "Copy",
            isDataLoaded: false,
            isTeamNumbersReady: false,
            colorOptions: [
                { key: "default", text: "Default" },
                { key: "red", text: "Red" },
                { key: "orange", text: "Orange" },
                { key: "yellow", text: "Yellow" },
                { key: "green", text: "Green" },
                { key: "blue", text: "Blue" },
                { key: "purple", text: "Purple" },
                { key: "pink", text: "Pink" },
            ],
            yColorIndex: 0,
            eventStore: null,
            viewMode: null
        }
    },
    methods: {
        setChartType(index: int) {
            this.activeChartTypeIndex = index;
            this.loadNewData();
        },
        setLabelColumn(index: int) {
            this.activeIndependentColumnIndex = index;
            this.loadNewData();
        },
        setDataColumnY(index: int) {
            this.activeDataYColumnIndex = index;
            this.loadNewData();
        },
        setDataColumnX(index: int) {
            this.activeDataXColumnIndex = index;
            this.loadNewData();
        },
        setQueryType(index: int) {
            this.activeQueryTypeIndex = index;
            this.loadNewData();
        },
        setAggregationType(index: int) {
            this.activeAggregationTypeIndex = index;
            this.loadNewData();
        },
        setTeamNumber(teamNumber) {
            this.activeTeamNumber = teamNumber;
            this.loadNewData();
        },
        toggleChip(index: int) {
            this.chips[index].value = !this.chips[index].value;
            const key = this.chips[index].key;
            this.chartOptions[key] = this.chips[index].value;
            this.loadNewData();
        },
        async copyChartModelInputs() {
            try {
                await navigator.clipboard.writeText(this.chartModelInputText);
                this.copyButtonText = "Copied!";
            } catch (err) {
                this.copyButtonText = "Failed :(";
                console.log(err);
            }

            setTimeout(() => {
                this.copyButtonText = "Copy";
            }, 2000);
        },

        // Expanding dropdown lists.
        setSeriesDropdownValue(index: number, dropdownIndex: number) {
            this.seriesDropdownList[dropdownIndex]['series'] = index;
            this.loadNewData();
        },
        setSeriesColorDropdownValue(index: number, dropdownIndex: number) {
            this.seriesDropdownList[dropdownIndex]['color'] = index;
            this.loadNewData();
        },
        addSeriesDropdownListItem() {
            const defaultItem = { 'series': 0, color: 0 };
            this.seriesDropdownList.push(defaultItem);
            this.loadNewData();
        },
        removeSeriesDropdownListItem(index: number) {
            this.seriesDropdownList.splice(index, 1);
            this.loadNewData();
        },
        setRadarListDropdownValue(index: number, dropdownIndex: number) {
            this.radarDropdownList[dropdownIndex]['comp'] = index;
            this.loadNewData();
        },
        addRadarListDropdownListItem() {
            const defaultItem = { 'comp': 0, 'color': 0 };
            this.radarDropdownList.push(defaultItem);
            this.loadNewData();
        },
        removeRadarListDropdownListItem(index: number) {
            this.radarDropdownList.splice(index, 1);
            this.loadNewData();
        },


        async initializePage() {
            this.eventStore.updateEvent();

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


            this.teamNumbers = [];
            Object.keys(teamMap).forEach(element => {
                this.teamNumbers.push(teamMap[element])
            });
            if (!this.teamNumbers.some(t => t.key === this.activeTeamNumber)) {
                this.activeTeamNumber = this.teamNumbers[0]?.key ?? defaultTeamNumber;
            }
            this.isTeamNumbersReady = true;

            this.loadNewData();
        },
        async loadNewData() {
            let matchNums = [];
            if (this.activeQuery == "team_query") {
                let data = await queryTeamMatchData(this.teamNumber, this.eventStore.eventId);
                data.forEach(row => {
                    matchNums.push({ key: row[matchNumberColumn], text: "Match " + row[matchNumberColumn] });
                });
            } else {
                let data = await queryEventData(this.eventStore.eventId);
                let matchMap = {}
                for (var i = 0; i < data.length; i++) {
                    const row = data[i];
                    const matchNum = String(row[matchNumberColumn]);

                    if (!Object.keys(matchMap).includes(matchNum)) {
                        matchNums.push({ key: matchNum, text: "Match " + matchNum });
                        matchMap[matchNum] = 1;
                    }
                }
            }
            this.matchNumbers = matchNums;


            let comparisonItems = this.radarDropdownList.map(item => this.activeIndependentColumnChoices[item['comp']]?.key);
            let dimensions = this.seriesDropdownList.map(item => ({
                name: this.dataColumns[item['series']].key,
                color: this.colorOptions[item['color']].key
            }));

            let queryInputs: QueryInputs = {
                type: this.activeQuery,
                teamNumber: this.teamNumber,
                eventId: this.eventStore.eventId,
                aggregationFn: this.activeAggregationType
            };
            this.chartModelInputs.queryInputs = queryInputs;

            let chartInputs: ChartInputs = {
                type: this.activeChartType,
                independentColumn: this.activeIndependentColumn,
                ySeries: this.activeSeriesY,
                xSeries: this.activeSeriesX,
                dimensions: dimensions,
                comparisonItems: comparisonItems,
                options: this.chartOptions
            };
            this.chartModelInputs.chartInputs = chartInputs;

            this.chartModel = await getChartModel(this.chartModelInputs.queryInputs, this.chartModelInputs.chartInputs);
            this.isDataLoaded = true;
        }
    },
    computed: {
        chartModelInputText() {
            // Pretty print the chart model inputs so they can be used in the relevant page layouts.
            return JSON.stringify(this.chartModelInputs, null, 4);
        },

        // View options
        activeChartType() {
            return this.chartTypes[this.activeChartTypeIndex]?.key;
        },
        isTeamNumberRequired() {
            return this.activeQuery == "team_query";
        },
        filterChips() {
            return this.chips;
        },

        // Data
        activeIndependentColumn() {
            return { name: this.independentColumns[this.activeIndependentColumnIndex].key };
        },
        activeIndependentColumnText() {
            return this.independentColumns[this.activeIndependentColumnIndex].text;
        },
        activeSeriesY() {
            return { name: this.dataColumns[this.activeDataYColumnIndex].key };
        },
        activeSeriesX() {
            return { name: this.dataColumns[this.activeDataXColumnIndex].key };
        },
        activeChartData() {
            if (!this.isDataLoaded) {
                return [];
            }
            return this.chartModel.data;
        },
        activeChartStyle() {
            return this.chartModel?.style;
        },
        activeChartOptions() {
            return this.chartModel?.options;
        },
        activeQuery() {
            return this.queryTypes[this.activeQueryTypeIndex].key;
        },
        activeAggregationType() {
            return this.aggregationTypes[this.activeAggregationTypeIndex].key;
        },
        activeIndependentColumnChoices() {
            if (this.activeIndependentColumn.name == teamNumberColumn) {
                return this.teamNumbers;
            } else if (this.activeIndependentColumn.name == matchNumberColumn) {
                return this.matchNumbers;
            }

            return [];
        },

        // Other data
        teamNumber() {
            if (!this.isTeamNumbersReady) {
                return defaultTeamNumber;
            }
            return this.activeTeamNumber ?? defaultTeamNumber;
        }

    },
    created() {
        this.eventStore = useEventStore();
        this.viewMode = useViewModeStore();

        this.initializePage();

        this.viewMode.$subscribe((mutation, state) => {
            const isScreenWidth = mutation?.events?.key == 'screenWidth';
            const isOldWidthMobile = mutation?.events?.oldValue <= minWidthForDesktop;
            const isNewWidthMobile = mutation?.events?.newValue <= minWidthForDesktop;
            const didCrossMobileThreshold = isScreenWidth && (isOldWidthMobile != isNewWidthMobile);

            if (mutation?.events.key == 'darkMode' || didCrossMobileThreshold) {
                this.loadNewData();
            }
        })
    }
}
</script>

<style scoped></style>