// @ts-nocheck

import { getTeamInputElement } from "@/lib/data-submission";

// Fills in `component.value` (not `defaultValue` — that stays at the unfilled
// sentinel so validateForm's required-field checks keep working) from an
// existing PitData row, inverting the key convention parseScoutData uses
// (section.key + "_" + component.key, i.e. "pit_" + component.key here).
function applyExistingPitData(components, row) {
    components.forEach((component) => {
        const dbKey = "pit_" + component.key;
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

export async function getPitScoutSchema({ includeTeamSelector = true, existingData = null } = {}) {
    const components = [];
    if (includeTeamSelector) {
        components.push(await getTeamInputElement());
    }

    components.push(
        {
                    key: "drivetrain",
                    label: "Drivetrain Type",
                    type: "dropdown",
                    options: {
                        choices: [
                            { key: "swerve", text: "Swerve" },
                            { key: "not_swerve", text: "Not Swerve" }
                        ]
                    },
                    defaultValue: 0,
                    value: 0,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "drive_motor_type",
                    label: "Drive Motor Type",
                    type: "dropdown",
                    options: {
                        choices: [
                            { key: "none", text: "Select motor..." },
                            { key: "kraken", text: "Kraken" },
                            { key: "falcon", text: "Falcon" },
                            { key: "neo", text: "NEO" },
                            { key: "other", text: "Other" }
                        ]
                    },
                    defaultValue: 0,
                    value: 0,
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
                {
                    key: "length",
                    label: "Drivetrain Length (in)",
                    type: "number",
                    options: {},
                    defaultValue: null,
                    value: null,
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
                {
                    key: "width",
                    label: "Drivetrain Width (in)",
                    type: "number",
                    options: {},
                    defaultValue: null,
                    value: null,
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
                {
                    key: "weight",
                    label: "Weight (no bumper/battery, lbs)",
                    type: "number",
                    options: {},
                    defaultValue: null,
                    value: null,
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
                {
                    key: "archetype",
                    label: "Archetype",
                    type: "dropdown",
                    options: {
                        choices: [
                            { key: "none", text: "Select archetype..." },
                            { key: "dumper_fixed", text: "Dumper/Fixed" },
                            { key: "turret", text: "Turret" }
                        ]
                    },
                    defaultValue: 0,
                    value: 0,
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
                {
                    key: "language",
                    label: "Programming Language",
                    type: "dropdown",
                    options: {
                        choices: [
                            { key: "none", text: "Select language..." },
                            { key: "java", text: "Java" },
                            { key: "cpp", text: "C++" },
                            { key: "python", text: "Python" },
                            { key: "other", text: "Other" }
                        ]
                    },
                    defaultValue: 0,
                    value: 0,
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
                {
                    key: "num_batteries",
                    label: "Number of Batteries",
                    type: "number",
                    options: {},
                    defaultValue: null,
                    value: null,
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
                {
                    key: "num_chargers",
                    label: "Number of Chargers",
                    type: "number",
                    options: {},
                    defaultValue: null,
                    value: null,
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
                {
                    key: "traverse_bump",
                    label: "Can Traverse Bump?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "traverse_trench",
                    label: "Can Traverse Trench?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "outpost_fuel",
                    label: "Can Take Fuel from Outpost?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "shoot_close",
                    label: "Can Shoot: Close Shot?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "shoot_tower",
                    label: "Can Shoot: Tower Shot?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "shoot_corner",
                    label: "Can Shoot: Corner Shot?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "shoot_trench",
                    label: "Can Shoot: Trench Shot?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "climb",
                    label: "Climb?",
                    type: "dropdown",
                    options: {
                        choices: [
                            { key: "none", text: "Select climb..." },
                            { key: "no_climb", text: "No Climb" },
                            { key: "l1", text: "L1" },
                            { key: "l2", text: "L2" },
                            { key: "l3", text: "L3" }
                        ]
                    },
                    defaultValue: 0,
                    value: 0,
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
                {
                    key: "climb_auto",
                    label: "Can Climb in Auto?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "cycle_rate",
                    label: "Balls/Fuel per Second",
                    type: "number",
                    options: {},
                    defaultValue: null,
                    value: null,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "defense",
                    label: "OK Playing Defense?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "driver_new",
                    label: "Is Your Driver New?",
                    type: "switch",
                    options: {},
                    defaultValue: false,
                    value: false,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "system_check",
                    label: "When Do You Do a System Check?",
                    type: "dropdown",
                    options: {
                        choices: [
                            { key: "before_every_match", text: "Before Every Match" },
                            { key: "before_most_matches", text: "Before Most Matches" },
                            { key: "sometimes_before_match", text: "Sometimes Before a Match" },
                            { key: "once_or_twice", text: "Only Once or Twice Throughout Comp" },
                            { key: "never", text: "Never" }
                        ]
                    },
                    defaultValue: 0,
                    value: 0,
                    preserveAfterSubmit: false,
                    required: false,
                    error: false
                },
                {
                    key: "vibe_check",
                    label: "Vibe Check",
                    type: "radio",
                    options: {
                        choices: [
                            { key: "1", text: "1" },
                            { key: "2", text: "2" },
                            { key: "3", text: "3" },
                            { key: "4", text: "4" },
                            { key: "5", text: "5" }
                        ],
                        isVertical: false
                    },
                    defaultValue: '',
                    value: '',
                    preserveAfterSubmit: false,
                    required: true,
                    error: false
                },
        {
            key: "comments",
            label: "Comments",
            type: "textarea",
            options: {},
            defaultValue: "",
            value: "",
            preserveAfterSubmit: false,
            required: false,
            error: false
        },
    );

    if (existingData) {
        applyExistingPitData(components, existingData);
    }

    return [
        {
            key: "pit",
            name: "",
            components
        },
    ];
}
