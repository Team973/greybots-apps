<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { dataPointColorTranslucent, getThemeColors } from '../../lib/theme';
import { discreteDataSeriesToChartJSDatasets } from '../../lib/chart-data';

import { Pie } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, ArcElement, CategoryScale, LinearScale } from 'chart.js'
import ChartJSPluginDatalabels from 'chartjs-plugin-datalabels'

ChartJS.register(Title, Tooltip, Legend, ArcElement, CategoryScale, LinearScale, ChartJSPluginDatalabels)

</script>

<template>
    <div :style="chartCssStyle">
        <Pie :options="chartOptions" :data="chartData" :key="uniqueKey" />
    </div>
</template>

<script lang="ts">
export default {
    props: {
        data: Array,
        chartStyle: Array,
        height: {
            default: 500
        }
    },
    computed: {
        uniqueKey() {
            return JSON.stringify(this.data);// + JSON.stringify(getThemeColors());
        },
        chartData() {
            if (!this.data || this.data.length == 0 || !this.data[0].y || this.data[0].y.length == 0 || !this.chartStyle || this.chartStyle?.length != this.data[0].y.length) {
                return {
                    labels: [],
                    datasets: []
                };
            }

            const labels = this.data[0].labels;

            let datasets = discreteDataSeriesToChartJSDatasets(this.data)
            datasets[0].backgroundColor = [];
            for (let i = 0; i < this.data[0].y.length; i++) {
                datasets[0].backgroundColor.push(this.chartStyle[i].color);
            }


            // Build the chart based on the processing above.
            const chart = {
                labels: labels,
                datasets: datasets
            };
            return chart;
        },
        chartOptions() {
            let options = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    datalabels: {
                        color: getThemeColors().text.dataLabels,
                        offset: 8,
                        font: {
                            weight: 'bold'
                        },
                        formatter: function (value, context) {
                            const roundedValue = Math.round(value * 100) / 100;
                            return roundedValue;
                        }
                    },
                    legend: {
                        labels: {
                            color: getThemeColors().text.legend
                        }
                    }
                },
            };

            return options;
        },
        chartCssStyle() {
            return {
                "display": "flex",
                "height": this.height + "px",
                "width": "100%",
                "align-items": "safe center",
                "justify-content": "safe center"
            }
        }
    }
}
</script>
