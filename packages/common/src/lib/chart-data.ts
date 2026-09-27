// TODO: fix types
// @ts-nocheck

import { sortKeyValueArrays } from './util';

export function computeDiscreteDataSeries(data, labelColumn, valueColumn, isSorted = false, isNormalized = false, maxDataPoints = null) {
    // This function assumes the keys of "data" are the labels.
    var dataSeries = {
        "name": valueColumn,
        "label": labelColumn,
        "labels": [],
        "y": []
    };

    let totalValue = 0;
    data.forEach(row => {
        dataSeries.labels.push(row[labelColumn]);
        dataSeries.y.push(row[valueColumn]);
        totalValue += row[valueColumn];
    });

    // Normalize the data if requested.
    if (isNormalized && Math.abs(totalValue) > 1e-10) {
        for (var i = 0; i < dataSeries.y.length; i++) {
            dataSeries.y[i] = dataSeries.y[i] / totalValue;
        }
    }

    // Sort the data if requested.
    if (isSorted) {
        const sorted = sortKeyValueArrays(dataSeries.labels, dataSeries.y);

        // Reconstruct a key array and a value array.
        dataSeries.labels = [];
        dataSeries.y = [];
        for (const [key, val] of sorted) {
            dataSeries.labels.push(key);
            dataSeries.y.push(val);
        }
    }

    // Limit the amount of data shown if requested.
    if (maxDataPoints != null) {
        dataSeries.labels = dataSeries.labels.slice(0, maxDataPoints);
        dataSeries.y = dataSeries.y.slice(0, maxDataPoints);
    }

    return dataSeries;
}

export function discreteDataSeriesToChartJSDatasets(data) {
    let datasets = []
    data?.forEach(series => {
        const dataset = {
            label: series.name,
            data: series.y
        };
        datasets.push(dataset);
    });

    return datasets;
}

export function computeCartesianDataSeries(data, xColumn, yColumn, labelColumn) {
    // The labels in this data series are the values that would show up in a chart tooltip.
    var dataSeries = {
        "name": yColumn,
        'xAxis': xColumn,
        "labels": [],
        "x": [],
        "y": []
    };

    data.forEach(row => {
        dataSeries.labels.push(row[labelColumn]);
        dataSeries.x.push(row[xColumn]);
        dataSeries.y.push(row[yColumn]);
    })


    // TODO: data transforms.

    return dataSeries;
}

export function cartesianDataSeriesToChartJSDatasets(data) {
    if (data.length == 0) {
        return [];
    }
    if (!data[0]?.x || !data[0]?.y || !data[0]?.name) {
        return [];
    }

    let datasets = []
    data?.forEach(series => {
        // Populate an array of values, which are x,y coordinates.
        let xy_values = [];
        for (var i = 0; i < series.x.length; i++) {
            const xVal = series.x[i];
            const yVal = series.y[i];
            xy_values.push({ "x": xVal, "y": yVal });
        }

        const dataset = {
            label: series.name,
            data: xy_values
        };
        datasets.push(dataset);
    });

    return datasets;
}

export function computeSampledDataSeries(data, keyColumn, valueColumn, isSorted = false, maxDataPoints = null) {
    let dataseriesMap = {}
    data.forEach(row => {
        const key = row[keyColumn];
        if (!Object.keys(dataseriesMap).includes(key)) {
            dataseriesMap[key] = [row[valueColumn]];
        } else {
            dataseriesMap[key].push(row[valueColumn]);
        }
    });

    let labels = Object.keys(dataseriesMap);
    let values = Object.values(dataseriesMap);

    // Sort the data if requested.
    if (isSorted) {
        const sorted = sortKeyValueArrays(labels, values);

        // Reconstruct a key array and a value array.
        labels = [];
        values = [];
        for (const [key, val] of sorted) {
            labels.push(key);
            values.push(val);
        }
    }

    // Limit the amount of data shown if requested.
    if (maxDataPoints != null) {
        labels = labels.slice(0, maxDataPoints);
        values = values.slice(0, maxDataPoints);
    }

    let sampledDataSeries = {
        name: valueColumn,
        label: keyColumn,
        labels: labels,
        values: values
    };

    return [sampledDataSeries];
}

export function computeRadarDataSeries(data, comparisonColumn, comparisonItems, dimensionColumns) {
    let datasets = [];

    if (dimensionColumns.length == 0 || comparisonItems.length == 0) {
        return datasets;
    }

    let columnLabels = [];
    dimensionColumns.forEach(col => {
        columnLabels.push(col.name);
    });

    data.forEach(row => {
        if (comparisonItems.includes(row[comparisonColumn])) {
            let itemValues = []
            dimensionColumns.forEach(col => {
                itemValues.push(row[col.name]);
            });

            datasets.push({
                'labels': columnLabels,
                'name': row[comparisonColumn],
                'y': itemValues
            });
        }
    });

    return datasets;
}

export function computeCategoricalDataSeries(data, keyColumn, valueColumn) {
    let dataSeriesList = [];

    data.forEach(row => {
        const series = {
            'name': row[keyColumn],
            'y': row[valueColumn]
        };
        dataSeriesList.push(series);
    });

    return dataSeriesList;
}

export function computeCategoricalCountedDataSeries(data, label, valueColumn) {
    return dataseries = {
        'name': label,
        'y': data[valueColumn]
    }
}

export function categoricalDataSeriesListToChartJSDataset(dataseriesList) {
    let values = [];

    dataseriesList.forEach(series => {
        values.push(series.y);
    });

    return {
        data: values
    };
}