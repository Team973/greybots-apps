<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import BarChart from './BarChart.vue';
import LineChart from './LineChart.vue';
import ScatterChart from './ScatterChart.vue';
import StackedBarChart from './StackedBarChart.vue';
import BoxPlot from './BoxPlot.vue';
import RadarChart from './RadarChart.vue';

// Needed so the chart reloads if light/dark mode is changed.
import { getThemeColors } from '../../lib/theme';
import PieChart from "./PieChart.vue";

</script>

<template>
    <div class="graph-container">
        <!-- Set :key in order to force remount. This needs to happen since box plot rendering is done in mounted() rather 
            than dynamically, and because dark/light mode switching requires data refresh. -->
        <!-- Show the relevant chart based on the data being shown -->
        <BarChart :key="uniqueKey(0)" :data="chartData" :height="chartHeight" :is-horizontal="options.isHorizontal"
            :x-range="options.xRange" :y-range="options.yRange" v-if="isBarChartView">
        </BarChart>

        <LineChart :key="uniqueKey(1)" :data="chartData" v-else-if="isLineChartView">
        </LineChart>

        <ScatterChart :key="uniqueKey(2)" :data="chartData" :height="chartHeight" v-else-if="isScatterChartView">
        </ScatterChart>

        <BoxPlot :key="uniqueKey(3)" :data="chartData" :height="chartHeight" :max-labels="options.maxLabels"
            :is-horizontal="options.isHorizontal" :x-range="options.xRange" :y-range="options.yRange"
            v-else-if="isBoxPlotView">
        </BoxPlot>

        <StackedBarChart :key="uniqueKey(4)" :data="chartData" :chart-style="chartStyle" :height="chartHeight"
            :is-horizontal="options.isHorizontal" v-else-if="isStackedBarChartView">
        </StackedBarChart>

        <RadarChart :key="uniqueKey(5)" :data="chartData" :chart-style="chartStyle" :height="chartHeight"
            v-else-if="isRadarChartView"></RadarChart>

        <PieChart :key="uniqueKey(6)" :data="chartData" :chart-style="chartStyle" :height="chartHeight"
            v-else-if="isPieChartView"></PieChart>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {}
    },
    props: {
        chartType: {
            default: "bar"
        },
        data: {
            default: []
        },
        chartStyle: {
            default: []
        },
        options: {
            default: {
                height: null,
                heightRatio: 0.5,
                isHorizontal: false,
                xRange: {},
                yRange: {},
                maxLabels: null
            },
        },
    },
    methods: {
        uniqueKey(id) {
            // Some charts still depend on the theme rather than the data 
            // to do colors for things like labels, so must be manually reloaded 
            // at this level of abstraction for now.

            // TODO: make this better. This is a hack to ensure plots reload if data or filters change.
            const key = JSON.stringify(this.chartType)
                + JSON.stringify(this.chartStyle)
                + JSON.stringify(this.data)
                + JSON.stringify(this.options)
                + JSON.stringify(getThemeColors())
                + id;
            return key;
        },
        activeChartTypeKey() {
            return this.chartType;
        }
    },
    computed: {
        // Chart view options
        isBarChartView() {
            return this.activeChartTypeKey() == "bar";
        },
        isScatterChartView() {
            return this.activeChartTypeKey() == "scatter";
        },
        isLineChartView() {
            return this.activeChartTypeKey() == "line";
        },
        isStackedBarChartView() {
            return this.activeChartTypeKey() == "stacked-bar";
        },
        isBoxPlotView() {
            return this.activeChartTypeKey() == "boxplot";
        },
        isRadarChartView() {
            return this.activeChartTypeKey() == "radar";
        },
        isPieChartView() {
            return this.activeChartTypeKey() == "pie";
        },

        // Chart parameters
        chartData() {
            return this.data;
        },
        chartHeight() {
            if (this.options.height) {
                return this.options.height;
            }

            return this.options.heightRatio * window.innerHeight;
        }
    }
}
</script>

<style scoped>
.graph-container {
    display: flex;
    width: 100%;
    height: 100%;
    flex: 1 1 auto;
    justify-content: center;
}
</style>