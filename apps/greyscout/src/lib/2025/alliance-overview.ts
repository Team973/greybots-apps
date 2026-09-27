// TODO: fix types
// @ts-nocheck

import { sum } from 'simple-statistics';

export function getAllianceOverview(teamNumbers, teamStats) {
    if (!teamNumbers || !teamStats) {
        return {};
    }

    const highlightColumns = {
        auto_coral: "Avg. Auto Coral",
        teleop_coral: "Avg. Teleop Coral",
        teleop_net: "Avg. Teleop Net",
        endgame_climb: "Climb %"
    };

    const colKeys = Object.keys(highlightColumns);

    let allianceHighlight = {}

    for (var i = 0; i < colKeys.length; i++) {
        const col = colKeys[i];

        const prettyColName = highlightColumns[col];
        let colData = {
            rank: [],
            value: [],
            normalized: []
        };

        for (var j = 0; j < teamNumbers.length; j++) {
            const teamNumber = teamNumbers[j];
            const teamStat = teamStats[teamNumber];

            if (!teamStat) {
                colData.rank.push(-1);
                colData.normalized.push(-1);
                colData.value.push(0);
                continue;
            }

            const teamValue = Number(teamStat[col]);
            colData.value.push(teamValue);
        }

        const colTotal = sum(colData.value);
        colData.value.push(colTotal);

        allianceHighlight[prettyColName] = colData;
    }

    return allianceHighlight;
}

