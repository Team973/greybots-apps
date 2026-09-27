// TODO: fix types
// @ts-nocheck

import { getChartModel } from "@/lib/chart-model";

export async function processLayout(tileLayout) {
    let tileModels = [];
    for (var i = 0; i < tileLayout.length; i++) {
        const input = tileLayout[i].inputs;
        const type = tileLayout[i].type;
        const title = tileLayout[i].title;

        let tileModel = {};
        if (type == "chart") {
            tileModel = await getChartModel(input.queryInputs, input.chartInputs);
        } else if (type == "filterable-chart") {
            tileModel['choices'] = input.choices;
            tileModel['models'] = [];
            for (var j = 0; j < input.chartInputs.length; j++) {
                const queryInput = input.chartInputs[j].queryInputs;
                const chartInput = input.chartInputs[j].chartInputs;
                const chartModel = await getChartModel(queryInput, chartInput);
                tileModel.models.push(chartModel);
            }
        }

        tileModels.push({
            id: i,
            type: type,
            model: tileModel,
            title: title
        });
    }

    return tileModels;
} 