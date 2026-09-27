// @ts-nocheck

export function getTeamAnalysisLayout(teamNumber, eventId) {
    return [
        {
            type: "chart",
            title: "Team Performance",
            inputs: {
                "queryInputs": {
                    "type": "event_query",
                    "teamNumber": teamNumber,
                    "eventId": eventId,
                    "aggregationFn": "mean"
                },
                "chartInputs": {
                    "type": "radar",
                    "independentColumn": { name: "prematch_team_number" },
                    "ySeries": { name: "auto_coral" },
                    "xSeries": { name: "auto_coral" },
                    "dimensions": [
                        { name: "auto_coral" },
                        { name: "teleop_net" },
                        { name: "teleop_coral" },
                        { name: "endgame_climb" },
                        { name: "postmatch_defense" }
                    ],
                    "comparisonItems": [
                        teamNumber
                    ],
                    "options": {
                        "isSorted": false,
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
            title: "Match Scoring Breakdown",
            inputs: {
                "queryInputs": {
                    "type": "team_query",
                    "teamNumber": teamNumber,
                    "eventId": eventId
                },
                "chartInputs": {
                    "type": "stacked-bar",
                    "independentColumn": { name: "prematch_match_number" },
                    "ySeries": { name: "auto_coral" },
                    "xSeries": { name: "auto_coral" },
                    "dimensions": [
                        { name: "auto_coral" },
                        { name: "teleop_net" },
                        { name: "teleop_coral" }
                    ],
                    "comparisonItems": [],
                    "options": {
                        "isSorted": false,
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
            title: "Climb success rate",
            inputs: {
                "queryInputs": {
                    "type": "team_query",
                    "teamNumber": teamNumber,
                    "eventId": eventId,
                    "aggregationFn": "count"
                },
                "chartInputs": {
                    "type": "pie",
                    "independentColumn": { name: "prematch_match_number" },
                    "ySeries": { name: "endgame_climb" },
                    "xSeries": { name: "auto_coral" },
                    "dimensions": [],
                    "comparisonItems": [],
                    "options": {
                        "isSorted": false,
                        "isNormalized": true,
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
            type: "filterable-chart",
            title: "Match by Match Performance",
            inputs: {
                choices: [
                    { key: "auto_coral", text: "Auto Coral" },
                    { key: "teleop_coral", text: "Teleop Coral" }
                ],
                chartInputs: [
                    {
                        "queryInputs": {
                            "type": "team_query",
                            "teamNumber": teamNumber,
                            "eventId": eventId
                        },
                        "chartInputs": {
                            "type": "bar",
                            "independentColumn": { name: "prematch_match_number" },
                            "ySeries": { name: "auto_coral" },
                            "xSeries": { name: "auto_coral" },
                            "dimensions": [],
                            "comparisonItems": [],
                            "options": {
                                "isSorted": false,
                                "isHorizontal": false,
                                "maxDataPoints": null,
                                "xRange": null,
                                "yRange": null,
                                "height": null,
                                "heightRatio": 0.5
                            }
                        }
                    },
                    {
                        "queryInputs": {
                            "type": "team_query",
                            "teamNumber": teamNumber,
                            "eventId": eventId
                        },
                        "chartInputs": {
                            "type": "bar",
                            "independentColumn": { name: "prematch_match_number" },
                            "ySeries": { name: "teleop_coral" },
                            "xSeries": { name: "teleop_coral" },
                            "dimensions": [],
                            "comparisonItems": [],
                            "options": {
                                "isSorted": false,
                                "isHorizontal": false,
                                "maxDataPoints": null,
                                "xRange": null,
                                "yRange": null,
                                "height": null,
                                "heightRatio": 0.5
                            }
                        }
                    }
                ]
            }
        }
    ];
}

