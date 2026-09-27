<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import Chart from './charts/Chart.vue';
import FilterableChart from './charts/FilterableChart.vue';


import '@material/web/icon/icon';
</script>

<template>
    <div class="tile-container">
        <div v-if="canDrag" class="drag-indicator handle">
            <md-icon slot="icon">drag_indicator</md-icon>
        </div>
        <div v-if="isChartTile" class="tile-body">
            <h1 v-if="title">{{ title }}</h1>
            <Chart :chart-type="model.options.type" :data="model.data" :chart-style="model.style" :options="model.options">
            </Chart>
        </div>
        <div v-if="isFilterableChartTile" class="tile-body">
            <h1 v-if="title">{{ title }}</h1>
            <FilterableChart :chart-models="model.models" :choices="model.choices">
            </FilterableChart>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        type: {
            default: "chart"
        },
        model: {
            default: {}
        },
        title: {
            default: null
        },
        canDrag: {
            default: false
        }
    },
    computed: {
        isChartTile() {
            return this.type == "chart";
        },
        isFilterableChartTile() {
            return this.type == "filterable-chart";
        }
    }
}
</script>

<style scoped>
.drag-indicator {
    text-align: left;
    cursor: move;
}
</style>