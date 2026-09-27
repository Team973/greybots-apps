// @ts-nocheck

import type { QueryInputs, ChartInputs } from "@/lib/chart-model"
import { mean } from "simple-statistics";

export function getEventAnalysisLayout(eventId) {
    return [
        {
            type: "chart",
            title: "Teleop Coral Averages",
            inputs: {
                "queryInputs": {
                    "type": "event_query",
                    "teamNumber": null,
                    "eventId": eventId,
                },
                "chartInputs": {
                    "type": "boxplot",
                    "independentColumn": { name: "prematch_team_number" },
                    "ySeries": { name: "teleop_coral" },
                    "xSeries": { name: "teleop_coral" },
                    "dimensions": [],
                    "comparisonItems": [],
                    "options": {
                        "isSorted": true,
                        "isHorizontal": false,
                        "maxDataPoints": null,
                        "xRange": null,
                        "yRange": null,
                        "height": null,
                        "heightRatio": 0.5
                    }
                }
            }
        },
        {
            type: "chart",
            title: "Auto Coral Averages",
            inputs: {
                "queryInputs": {
                    "type": "event_query",
                    "teamNumber": null,
                    "eventId": eventId,
                },
                "chartInputs": {
                    "type": "boxplot",
                    "independentColumn": { name: "prematch_team_number" },
                    "ySeries": { name: "auto_coral" },
                    "xSeries": { name: "auto_coral" },
                    "dimensions": [],
                    "comparisonItems": [],
                    "options": {
                        "isSorted": true,
                        "isHorizontal": false,
                        "maxDataPoints": null,
                        "xRange": null,
                        "yRange": null,
                        "height": null,
                        "heightRatio": 0.5
                    }
                }
            }
        },
        {
            type: "chart",
            title: "Algae Scoring",
            inputs: {
                "queryInputs": {
                    "type": "event_query",
                    "teamNumber": null,
                    "eventId": eventId,
                    "aggregationFn": "mean"
                },
                "chartInputs": {
                    "type": "scatter",
                    "independentColumn": { name: "prematch_team_number" },
                    "ySeries": { name: "teleop_net" },
                    "xSeries": { name: "teleop_processor" },
                    "dimensions": [],
                    "comparisonItems": [],
                    "options": {
                        "isSorted": false,
                        "isNormalized": false,
                        "isHorizontal": false,
                        "maxDataPoints": null,
                        "xRange": null,
                        "yRange": null,
                        "height": null,
                        "heightRatio": 0.5
                    }
                }
            }
        }
    ];
}

