<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { getThemeColors } from '../../lib/theme';

import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js'
import ChartJSPluginDatalabels from 'chartjs-plugin-datalabels'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ChartJSPluginDatalabels)

</script>

<template>
    <div :style="chartCssStyle">
        <Bar :options="chartOptions" :data="chartData" :key="uniqueKey" />
    </div>
</template>

<script lang="ts">
export default {
    props: {
        columns: {
            default: []
        },
        data: Array,
        chartStyle: Array,
        isSorted: {
            default: true
        },
        height: {
            default: 500
        },
        maxLabels: {
            default: null
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
            return JSON.stringify(this.data);// + JSON.stringify(getThemeColors());
        },
        chartData() {
            if (!this.data || this.data?.length == 0 || !this.chartStyle || this.chartStyle?.length != this.data.length) {
                return {
                    labels: [],
                    datasets: []
                };
            }

            const labels = this.data[0].labels;

            let datasets = [];
            for (var i = 0; i < this.data.length; i++) {
                const label = this.data[i].name;
                const values = this.data[i].y;

                const dataset = {
                    label: label,
                    backgroundColor: this.chartStyle[i].color,
                    data: values
                };
                datasets.push(dataset)
            }

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
                this.data?.forEach(series => {
                    valueColumnLabel += series.name + ",";
                });
                valueColumnLabel = valueColumnLabel.slice(0, valueColumnLabel.length - 1);

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
                        stacked: true,
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
                        stacked: true,
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
