<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { dataPointColor, getThemeColors } from '../../lib/theme';
import { cartesianDataSeriesToChartJSDatasets } from '../../lib/chart-data';

import { Scatter } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, PointElement, CategoryScale, LinearScale } from 'chart.js'
import ChartJSPluginDatalabels from 'chartjs-plugin-datalabels'

ChartJS.register(Title, Tooltip, Legend, PointElement, CategoryScale, LinearScale, ChartJSPluginDatalabels);

</script>

<template>
    <div :style="chartStyle">
        <Scatter :options="chartOptions" :data="chartData" :key="uniqueKey" />
    </div>
</template>

<script lang="ts">
export default {
    props: {
        data: Array,
        series: {
            default: ""
        },
        pointColor: {
            default: dataPointColor
        },
        pointRadius: {
            default: 6
        },
        pointHoverRadius: {
            default: 8
        },
        height: {
            default: 300
        }
    },
    data() {
        return {
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    datalabels: {
                        color: getThemeColors().text.dataLabels,
                        align: 'top',
                        offset: 8,
                        font: {
                            weight: 'bold'
                        },
                        formatter: function (value, context) {
                            return context.chart.data?.labels[context.dataIndex];
                        }
                    }
                }
            }
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

            let datasets = cartesianDataSeriesToChartJSDatasets(this.data);
            datasets.forEach(series => {
                series.backgroundColor = this.pointColor;
                series.pointRadius = this.pointRadius;
                series.pointHoverRadius = this.pointHoverRadius;
                series.color = getThemeColors().text.axes;
            })

            // Build the chart based on the processing above.
            const chart = {
                labels: labels,
                datasets: datasets
            };

            // Label the axes.
            const columnX = this.data[0].xAxis;
            const columnY = this.data[0].name;
            this.options.scales = {
                x: {
                    title: {
                        text: columnX,
                        display: true,
                        color: getThemeColors().text.axesText
                    },
                    grid: {
                        color: getThemeColors().grid.lines
                    },
                    ticks: {
                        color: getThemeColors().text.axesText
                    }
                },
                y: {
                    title: {
                        text: columnY,
                        display: true,
                        color: getThemeColors().text.axesText
                    },
                    grid: {
                        color: getThemeColors().grid.lines
                    },
                    ticks: {
                        color: getThemeColors().text.axesText
                    }
                }
            }

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
