// @ts-nocheck

// Per-team fields for the "Pre-match" section of a match-scouting row.
// team_number, match_number, and alliance are no longer editable form
// components here — in the compact multi-team match form they're derived
// from the match schedule slot and set directly on the parsed submission.
export function getMatchPrematchTeamFields() {
    return [
        {
            key: "noshow",
            label: "No Show",
            type: "switch",
            options: {},
            defaultValue: false,
            value: false,
            preserveAfterSubmit: false,
            incrementAfterSubmit: false,
            required: false,
            error: false
        },
    ];
}

// Per-team fields for the "Auto" section of a match-scouting row.
export function getMatchAutoFields() {
    return [
        {
            key: "failed",
            label: "Did auto fail?",
            type: "switch",
            options: {},
            defaultValue: false,
            value: false,
            preserveAfterSubmit: false,
            incrementAfterSubmit: false,
            required: false,
            error: false
        },
    ];
}

// Per-team fields for the "Post Match" section of a match-scouting row.
export function getMatchPostmatchFields() {
    return [
        {
            key: "cards",
            label: "Cards?",
            type: "dropdown",
            options: {
                choices: [
                    { key: "none", text: "No Card" },
                    { key: "yellow", text: "Yellow Card" },
                    { key: "red", text: "Red Card" },
                ]
            },
            defaultValue: 0,
            value: 0,
            preserveAfterSubmit: false,
            incrementAfterSubmit: false,
            required: false,
            error: false
        },
        {
            key: "died",
            label: "Died?",
            type: "switch",
            options: {},
            defaultValue: false,
            value: false,
            preserveAfterSubmit: false,
            incrementAfterSubmit: false,
            required: false,
            error: false
        },
        {
            key: "broke",
            label: "Broke?",
            type: "switch",
            options: {},
            defaultValue: false,
            value: false,
            preserveAfterSubmit: false,
            incrementAfterSubmit: false,
            required: false,
            error: false
        },
        {
            key: "beached",
            label: "Beached?",
            type: "switch",
            options: {},
            defaultValue: false,
            value: false,
            preserveAfterSubmit: false,
            incrementAfterSubmit: false,
            required: false,
            error: false
        },
        {
            key: "played_defense",
            label: "Played Defense?",
            type: "switch",
            options: {},
            defaultValue: false,
            value: false,
            preserveAfterSubmit: false,
            incrementAfterSubmit: false,
            required: false,
            error: false
        },
        // Only shown (see MatchTeamRow.vue) when played_defense is true. Kept
        // required:false always, even though it's conditionally displayed, so
        // a hidden field can never block validateForm() from passing.
        {
            key: "defense_impact",
            label: "Defense Impact",
            type: "dropdown",
            options: {
                choices: [
                    { key: "none", text: "Select impact..." },
                    { key: "good", text: "Good" },
                    { key: "minimal", text: "Minimal" },
                    { key: "ineffective", text: "Ineffective" },
                ]
            },
            defaultValue: 0,
            value: 0,
            preserveAfterSubmit: false,
            incrementAfterSubmit: false,
            required: false,
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
            incrementAfterSubmit: false,
            required: true,
            error: false
        },
    ];
}

// Pre-fills a team-row schema's component values from an existing MatchData
// row (issue #31 — editing an existing submission), keyed the same way
// parseScoutData() writes them: `${section.key}_${component.key}`. Mirrors
// pit-scouting-form.ts's applyExistingPitData, adapted for match data's
// per-section column prefixes instead of pit's flat `pit_` prefix.
function applyExistingMatchTeamData(schema, row) {
    schema.forEach((section) => {
        section.components.forEach((component) => {
            const dbKey = `${section.key}_${component.key}`.toLowerCase();
            if (!(dbKey in row) || row[dbKey] == null) return;

            const raw = row[dbKey];
            if (component.type === "dropdown") {
                const idx = component.options.choices.findIndex((c) => c.key === raw);
                if (idx >= 0) component.value = idx;
            } else {
                component.value = raw;
            }
        });
    });
}

// The full {key, name, components} section shape for one team's row —
// matches what FormSection/validateForm/parseScoutData already expect.
// Pass existingData (a raw MatchData row) to pre-fill for editing.
export function buildTeamRowSchema({ existingData = null } = {}) {
    const schema = [
        {
            key: "prematch",
            name: "Pre-match",
            components: getMatchPrematchTeamFields()
        },
        {
            key: "auto",
            name: "Auto",
            components: getMatchAutoFields()
        },
        {
            key: "postmatch",
            name: "Post Match",
            components: getMatchPostmatchFields()
        }
    ];

    if (existingData) {
        applyExistingMatchTeamData(schema, existingData);
    }

    return schema;
}
