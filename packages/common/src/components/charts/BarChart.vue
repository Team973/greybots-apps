<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { dataPointColorTranslucent, getThemeColors } from '../../lib/theme';
import { discreteDataSeriesToChartJSDatasets } from '../../lib/chart-data';

import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js'
import ChartJSPluginDatalabels from 'chartjs-plugin-datalabels'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ChartJSPluginDatalabels)

</script>

<template>
    <div :style="chartStyle">
        <Bar :options="chartOptions" :data="chartData" :key="uniqueKey" />
    </div>
</template>

<script lang="ts">
export default {
    props: {
        data: Array,
        barColor: {
            default: dataPointColorTranslucent
        },
        height: {
            default: 100
        },
        isHorizontal: {
            default: false
        },
        xRange: {
            default: {}
        },
        yRange: {
            default: {}
        }
    },
    computed: {
        uniqueKey() {
            return JSON.stringify(this.data);
        },
        chartData() {
            let labels = [];
            if (this.data.length > 0) {
                labels = this.data[0].labels;
            }

            let datasets = discreteDataSeriesToChartJSDatasets(this.data)
            datasets.forEach(series => {
                series.backgroundColor = this.barColor
            });

            // Build the chart based on the processing above.
            const chart = {
                labels: labels,
                datasets: datasets
            };
            return chart;
        },
        chartOptions() {
            let valueColumnLabel = "";
            let labelColumnLabel = "";
            if (this.data.length > 0) {
                valueColumnLabel = this.data[0].name;
                labelColumnLabel = this.data[0].label;
            }

            let indexAxis = 'x';
            let yAxisLabel = valueColumnLabel;
            let xAxisLabel = labelColumnLabel;
            if (this.isHorizontal) {
                indexAxis = 'y';
                xAxisLabel = valueColumnLabel;
                yAxisLabel = labelColumnLabel;
            }

            let options = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    datalabels: {
                        display: false
                    },
                    legend: {
                        labels: {
                            color: getThemeColors().text.legend
                        }
                    }
                },
                indexAxis: indexAxis,
                scales: {
                    x: {
                        min: this.xRange?.min,
                        max: this.xRange?.max,
                        grid: {
                            color: getThemeColors().grid.lines
                        },
                        ticks: {
                            color: getThemeColors().text.axesText
                        },
                        title: {
                            text: xAxisLabel,
                            display: true,
                            color: getThemeColors().text.axesText
                        },
                    },
                    y: {
                        min: this.yRange?.min,
                        max: this.yRange?.max,
                        grid: {
                            color: getThemeColors().grid.lines
                        },
                        ticks: {
                            color: getThemeColors().text.axesText
                        },
                        title: {
                            text: yAxisLabel,
                            display: true,
                            color: getThemeColors().text.axesText
                        },
                    },
                }
            };

            return options;
        },
        chartStyle() {
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
