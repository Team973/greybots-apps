// TODO: fix types
// @ts-nocheck

export function aggregateData(data, groupByColumnName, fn) {
    if (!data || data.length === 0) {
        return [];
    }

    let dependentColumns = Object.keys(data[0]);
    const groupByColumnIndex = dependentColumns.indexOf(groupByColumnName);
    if (groupByColumnIndex > -1) {
        dependentColumns.splice(groupByColumnIndex, 1);
    }

    let resultDict = {};
    for (var i = 0; i < data.length; i++) {
        const row = data[i];
        const key = row[groupByColumnName];

        if (!Object.keys(resultDict).includes(key)) {
            resultDict[key] = {};
        }

        dependentColumns.forEach(col => {
            const val = row[col];

            if (!Object.keys(resultDict[key]).includes(col)) {
                resultDict[key][col] = [val]
            } else {
                resultDict[key][col].push(val);
            }
        });
    }

    let resultData = [];
    Object.keys(resultDict).forEach(key => {
        let groupedData = {};
        groupedData[groupByColumnName] = key;

        const entry = resultDict[key];
        dependentColumns.forEach(col => {
            var aggregatedValues = fn(entry[col])
            groupedData[col] = aggregatedValues;
        });

        resultData.push(groupedData);
    });

    return resultData;
}

export function countDiscreteData(data, independentColumn, groupByColumnName) {
    let dataDict = {}

    data.forEach(row => {
        const dataPoint = String(row[groupByColumnName]);

        if (Object.keys(dataDict).includes(dataPoint)) {
            dataDict[dataPoint] += 1;
        } else {
            dataDict[dataPoint] = 1;
        }
    });

    let processedData = [];
    Object.keys(dataDict).forEach(element => {
        let row = {};
        row[independentColumn] = element;
        row[groupByColumnName] = dataDict[element];

        processedData.push(row);
    });

    return processedData;
}