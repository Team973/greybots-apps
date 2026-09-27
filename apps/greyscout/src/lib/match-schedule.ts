// @ts-nocheck

// Builds team_number dropdown choices (see getTeamInputElement in
// data-submission.ts for the shape) restricted to the six teams in a
// schedule row, tagged with which alliance each slot belongs to so the
// caller can auto-set the Alliance field from whichever team is picked.
export function buildMatchTeamChoices(matchTeams, teamNameByNumber = {}) {
    const slots = [
        { teamNumber: matchTeams.red1, label: "Red 1", isBlue: false },
        { teamNumber: matchTeams.red2, label: "Red 2", isBlue: false },
        { teamNumber: matchTeams.red3, label: "Red 3", isBlue: false },
        { teamNumber: matchTeams.blue1, label: "Blue 1", isBlue: true },
        { teamNumber: matchTeams.blue2, label: "Blue 2", isBlue: true },
        { teamNumber: matchTeams.blue3, label: "Blue 3", isBlue: true },
    ];

    const choices = [{ key: "none", text: "Select team..." }];

    slots.forEach(({ teamNumber, label, isBlue }) => {
        if (!teamNumber) return;
        const name = teamNameByNumber[teamNumber];
        choices.push({
            key: teamNumber,
            text: `${label}: ${teamNumber}${name ? " - " + name : ""}`,
            isBlue
        });
    });

    return choices;
}
