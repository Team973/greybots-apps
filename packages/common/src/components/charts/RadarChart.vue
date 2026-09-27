<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { getThemeColors } from '../../lib/theme';

import {
    Chart as ChartJS,
    RadialLinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend,
    Title
} from 'chart.js'
import { Radar } from 'vue-chartjs'
import ChartJSPluginDatalabels from 'chartjs-plugin-datalabels'

ChartJS.register(Title, Tooltip, Legend, PointElement, RadialLinearScale, LineElement, Filler, ChartJSPluginDatalabels);

</script>

<template>
    <div :style="chartCssStyle">
        <Radar :options="chartOptions" :data="chartData" class="radar-chart" :key="uniqueKey" />
    </div>
</template>

<script lang="ts">
export default {
    props: {
        data: Array,
        chartStyle: Array,
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
        pointRadius: {
            default: 6
        },
        pointHoverRadius: {
            default: 8
        },
        height: {
            default: 200
        },
        range: {
            default: null
        }
    },
    computed: {
        uniqueKey() {
            return JSON.stringify(this.data);// + JSON.stringify(getThemeColors());
        },
        chartData() {
            if (!this.data
                || this.data.length == 0
                || !this.chartStyle
                || this.chartStyle.length != this.data.length) {
                return {
                    labels: [],
                    datasets: []
                };
            }

            // Initialize the labels to the keys of the dictionary
            let labels = this.data[0].labels;

            // Populate an array of values, which are x,y coordinates.
            let datasets = [];
            for (var i = 0; i < this.data.length; i++) {
                const series = this.data[i];
                const style = this.chartStyle[i];

                const dataset = {
                    label: series.name,
                    data: series.y,
                    backgroundColor: style?.background?.color,
                    borderColor: style?.border?.color,
                    pointBackgroundColor: style?.point?.background?.color,
                    pointHoverBackgroundColor: style?.point?.background?.hoverColor,
                    pointBorderColor: style?.point?.border?.color,
                    pointHoverBorderColor: style?.point?.border?.hoverColor,
                };
                datasets.push(dataset);
            }

            // Build the chart based on the processing above.
            const chart = {
                labels: labels,
                datasets: datasets
            };

            this.options.plugins.legend = {
                labels: {
                    color: getThemeColors().text.legend
                }
            }

            this.options.scales = {
                r: {
                    grid: {
                        color: getThemeColors().grid.lines
                    },
                    angleLines: {
                        color: getThemeColors().grid.lines
                    },
                    ticks: {
                        color: getThemeColors().text.axesText,
                        showLabelBackdrop: false
                    },
                    pointLabels: {
                        color: getThemeColors().text.axesText
                    }
                },
            }

            if (this.range) {
                this.options.scales.r[min] = this.range.min;
                this.options.scales.r[max] = this.range.max;
            }

            return chart;
        },
        chartOptions() {
            return this.options;
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
