// TODO: fix types
// @ts-nocheck


import { mean, standardDeviation, min, max } from 'simple-statistics';
import { sortKeyValueArrays } from '@greybots/common/lib/util';


export const eventStatisticsKeys = [
    "rankings", "distributions"
];


export function computeAccuracy(made: Number, missed: Number) {
    let accuracy = 0;
    if (made > 0) {
        accuracy = made / (made + missed);
    }
    return accuracy;
}

export function computeEventStatistics(eventData, excludeKeysFromStats) {
    const teamNumbers = Object.keys(eventData);

    // Create rankings and statistical distributions for each metric if there are more than 0 teams.
    if (teamNumbers.length > 0) {
        let matchKeys = Object.keys(eventData[teamNumbers[0]]);
        let rankings = {}
        let eventDists = {}

        matchKeys.forEach((element) => {
            if (!excludeKeysFromStats.includes(element)) {
                let labels = teamNumbers.slice();
                let values = [];

                for (var i = 0; i < teamNumbers.length; i++) {
                    const val = eventData[teamNumbers[i]][element];
                    values.push(val);
                }

                // Sort to find the team order.
                const sorted = sortKeyValueArrays(labels, values);
                labels = [];
                values = [];
                for (const [key, val] of sorted) {
                    labels.push(key);
                    values.push(val);
                }

                // Set the rankings
                rankings[element] = labels.slice();

                // Compute distributions
                eventDists[element] = {};
                eventDists[element]["mean"] = mean(values);
                eventDists[element]["std"] = standardDeviation(values);
                eventDists[element]["min"] = min(values);
                eventDists[element]["max"] = max(values);
            }
        });

        eventData.rankings = rankings;
        eventData.distributions = eventDists;
    }

    return eventData;
}

export function computeTeamStatistics(eventData, excludeKeysFromStats, negativeValuesNA) {
    const teamKeys = Object.keys(eventData);
    for (let i = 0; i < teamKeys.length; i++) {
        const teamNumber = teamKeys[i];
        const numMatches = eventData[teamNumber].numMatches;
        const matchData = eventData[teamNumber].matchData;

        // Set defaults in case averages cannot be computed.
        Object.keys(matchData).forEach(key => {
            if (!excludeKeysFromStats.includes(key)) {
                const avgKeyName = "mean_" + key;
                const stddevKeyName = "stddev_" + key;
                const minKeyName = "min_" + key;
                const maxKeyName = "max_" + key;

                let meanValue = 0;
                let stddev = 0;
                let minValue = 0;
                let maxValue = 0;

                let samples = matchData[key];

                // Take out samples that are N/A if applicable.
                if (negativeValuesNA.includes(key)) {
                    samples = samples.filter(function (x) {
                        return x >= 0;
                    });
                }

                if (samples.length > 0) {
                    meanValue = mean(samples);
                    stddev = standardDeviation(samples);
                    minValue = min(samples);
                    maxValue = max(samples);
                }

                eventData[teamNumber][avgKeyName] = meanValue;
                eventData[teamNumber][stddevKeyName] = stddev;
                eventData[teamNumber][minKeyName] = minValue;
                eventData[teamNumber][maxKeyName] = maxValue;
            }
        });
    }

    return eventData;
}
