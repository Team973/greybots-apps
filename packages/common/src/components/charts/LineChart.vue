<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { dataPointColorTranslucent, getThemeColors } from '../../lib/theme';

import { Line } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, LineElement, PointElement, CategoryScale, LinearScale } from 'chart.js'
import ChartJSPluginDatalabels from 'chartjs-plugin-datalabels'
import { discreteDataSeriesToChartJSDatasets } from '../../lib/chart-data';

ChartJS.register(Title, Tooltip, Legend, LineElement, PointElement, CategoryScale, LinearScale, ChartJSPluginDatalabels)

</script>

<template>
    <div :style="chartStyle">
        <Line :options="chartOptions" :data="chartData" :key="uniqueKey" />
    </div>
</template>

<script lang="ts">
export default {
    props: {
        data: {
            default: []
        },
        options: {
            default: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    datalabels: {
                        display: false
                    }
                }
            }
        },
        lineColor: {
            default: dataPointColorTranslucent
        },
        pointColor: {
            default: dataPointColorTranslucent
        },
        height: {
            default: 500
        }
    },
    computed: {
        uniqueKey() {
            return JSON.stringify(this.data);// + JSON.stringify(getThemeColors());
        },
        chartData() {
            let labels = [];
            let valueColumnLabel = "";
            let labelColumnLabel = "";
            if (this.data.length > 0) {
                labels = this.data[0].labels;
                valueColumnLabel = this.data[0].name;
                labelColumnLabel = this.data[0].label;
            }

            let datasets = discreteDataSeriesToChartJSDatasets(this.data);
            datasets.forEach(element => {
                element.backgroundColor = this.pointColor;
                element.borderColor = this.lineColor;
            });
            const chart = {
                labels: labels,
                datasets: datasets
            };

            this.options.scales = {
                x: {
                    grid: {
                        color: getThemeColors().grid.lines
                    },
                    ticks: {
                        color: getThemeColors().text.axesText
                    },
                    title: {
                        text: labelColumnLabel,
                        display: true,
                        color: getThemeColors().text.axesText
                    },
                },
                y: {
                    grid: {
                        color: getThemeColors().grid.lines
                    },
                    ticks: {
                        color: getThemeColors().text.axesText
                    },
                    title: {
                        text: valueColumnLabel,
                        display: true,
                        color: getThemeColors().text.axesText
                    },
                }
            };

            this.options.plugins.legend = {
                labels: {
                    color: getThemeColors().text.legend
                }
            };

            return chart;
        },
        chartOptions() {
            return this.options;
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
