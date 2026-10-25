// Team numbers are text, not integers: offseason events can field a second
// robot as a "B" team (e.g. 973B), which TBA keys as "frc973B". Every team
// number that enters the app — from the database, TBA, the URL, or a form —
// goes through toTeamNumber, so the rest of the code can compare them with
// === and use them as keys.
//
// toTeamNumber also accepts plain numbers, so this works before and after
// the database's team number columns became text.

/** A team number such as "973" or "973B". */
export type TeamNumber = string;

// A number (no leading zero), optionally followed by one letter.
const TEAM_NUMBER_PATTERN = /^[1-9]\d{0,5}[A-Z]?$/;

/**
 * The canonical form of a team number ("973", "973B"), or null for anything
 * that isn't one: null/empty, an unfilled TBA slot, "frc" alone, etc.
 * Accepts numbers, strings, and TBA team keys ("frc973B").
 */
export function toTeamNumber(raw: unknown): TeamNumber | null {
    if (raw === null || raw === undefined) return null;
    let value = String(raw).trim().toUpperCase();
    if (value.startsWith('FRC')) value = value.slice(3);
    return TEAM_NUMBER_PATTERN.test(value) ? value : null;
}

export function isTeamNumber(raw: unknown): boolean {
    return toTeamNumber(raw) !== null;
}

/** Sorts 254 < 973 < 973B < 1678: by the number first, then the letter. */
export function compareTeamNumbers(a: unknown, b: unknown): number {
    const left = String(a ?? '');
    const right = String(b ?? '');
    const diff = (parseInt(left, 10) || 0) - (parseInt(right, 10) || 0);
    if (diff !== 0) return diff;
    return left.localeCompare(right);
}

/**
 * Normalizes the named team number fields of each row in place (e.g.
 * team_number, or red1..blue3 on a Match row) and returns the rows.
 */
export function normalizeTeamFields<T extends Record<string, unknown>>(rows: T[] | null | undefined, fields: string[]): T[] {
    (rows ?? []).forEach((row) => {
        fields.forEach((field) => {
            if (field in row) (row as Record<string, unknown>)[field] = toTeamNumber(row[field]);
        });
    });
    return rows ?? [];
}

/** A normalized list of team numbers, dropping anything that isn't one. */
export function toTeamNumbers(raw: unknown): TeamNumber[] {
    return (Array.isArray(raw) ? raw : []).map(toTeamNumber).filter((n): n is TeamNumber => n !== null);
}

export const MATCH_SLOT_FIELDS = ['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3'];
