<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { useViewModeStore } from '../../stores/view-mode-store';

import Chart from './Chart.vue';
import Dropdown from '../Dropdown.vue';

import '@material/web/select/outlined-select';
import '@material/web/select/select-option';
</script>

<template>
    <div>
        <Dropdown :choices="choices" v-model="activeChoiceIndex" @update:modelValue="setChoiceIndex"></Dropdown>
    </div>
    <div class="graph-container">
        <Chart :chart-type="activeChartModel.options.type" :data="activeChartModel.data"
            :chart-style="activeChartModel.style" :options="activeChartModel.options"></Chart>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        chartModels: {
            default: []
        },
        choices: {
            default: []
        },
    },
    data() {
        return {
            activeChoiceIndex: 0,
            viewMode: null,
        }
    },
    methods: {
        setChoiceIndex(index: int) {
            this.activeChoiceIndex = index;
        },
    },
    computed: {
        activeChartModel() {
            return this.chartModels[this.activeChoiceIndex];
        },
        activeGraphFilter() {
            return this.choices[this.activeChoiceIndex];
        },
    },
    created() {
        this.viewMode = useViewModeStore();
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