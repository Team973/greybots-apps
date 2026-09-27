// @ts-nocheck

import { getTeamInputElement } from "@/lib/data-submission";
import { TIERS } from "@/lib/picklist-query";

// One S/A/B/C/D/DNP tier dropdown, parameterized by key/label — used for
// the three independent tiers (scoring/driving/defense).
function tierField(key, label) {
    return {
        key,
        label,
        type: "dropdown",
        options: {
            choices: [
                { key: "none", text: "Select tier..." },
                ...TIERS.map((tier) => ({ key: tier, text: tier }))
            ]
        },
        defaultValue: 0,
        value: 0,
        preserveAfterSubmit: false,
        required: false,
        error: false
    };
}

// Fills in `component.value` (not `defaultValue`) from an existing
// PreScoutData row, inverting the key convention parseScoutData uses
// (section.key + "_" + component.key, i.e. "prescout_" + component.key
// here) — mirrors pit-scouting-form.ts's applyExistingPitData.
function applyExistingPreScoutData(components, row) {
    components.forEach((component) => {
        const dbKey = "prescout_" + component.key;
        if (!(dbKey in row) || row[dbKey] == null) {
            return;
        }

        const raw = row[dbKey];
        if (component.type === "dropdown") {
            const idx = component.options.choices.findIndex((c) => c.key === raw);
            if (idx >= 0) {
                component.value = idx;
            }
        } else {
            component.value = raw;
        }
    });
}

export async function getPreScoutSchema({ includeTeamSelector = true, existingData = null } = {}) {
    const components = [];
    if (includeTeamSelector) {
        components.push(await getTeamInputElement());
    }

    components.push(
        {
            key: "epa",
            label: "Pre-Event EPA",
            type: "number",
            options: {},
            defaultValue: null,
            value: null,
            preserveAfterSubmit: false,
            required: false,
            error: false
        },
        {
            key: "archetype",
            label: "Robot Archetype",
            type: "dropdown",
            options: {
                choices: [
                    { key: "none", text: "Select archetype..." },
                    { key: "turret", text: "Turret" },
                    { key: "dumper", text: "Dumper" },
                    { key: "defense", text: "Defense" }
                ]
            },
            defaultValue: 0,
            value: 0,
            preserveAfterSubmit: false,
            required: true,
            error: false
        },
        tierField("scoring_tier", "Scoring Tier"),
        tierField("driving_tier", "Driving Tier"),
        tierField("defense_tier", "Defense Tier")
    );

    if (existingData) {
        applyExistingPreScoutData(components, existingData);
    }

    return [
        {
            key: "prescout",
            name: "",
            components
        },
    ];
}
