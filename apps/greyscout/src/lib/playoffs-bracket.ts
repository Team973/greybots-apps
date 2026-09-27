/**
 * Double-elimination playoff bracket (issue #64): 8 alliances, matches 1-13,
 * then the finals (best 2 out of 3, tracked here as a single winner).
 * Matchups follow the official FIRST bracket graphic.
 *
 * The bracket's shape is fixed data; who is playing in a given match is
 * always *derived* from the recorded winners, so correcting an earlier
 * result automatically re-routes everyone downstream.
 */

export const ALLIANCE_COUNT = 8;
export const ALLIANCE_SIZE = 4;
export const FINALS_MATCH = 14;

/** Where a match slot's alliance comes from. */
export type SlotSource =
    | { kind: 'alliance'; alliance: number }
    | { kind: 'winner'; match: number }
    | { kind: 'loser'; match: number };

export interface BracketMatch {
    match: number;
    label: string;
    red: SlotSource;
    blue: SlotSource;
}

const seed = (alliance: number): SlotSource => ({ kind: 'alliance', alliance });
const win = (match: number): SlotSource => ({ kind: 'winner', match });
const lose = (match: number): SlotSource => ({ kind: 'loser', match });

export const BRACKET_MATCHES: BracketMatch[] = [
    { match: 1, label: 'Match 1', red: seed(1), blue: seed(8) },
    { match: 2, label: 'Match 2', red: seed(4), blue: seed(5) },
    { match: 3, label: 'Match 3', red: seed(2), blue: seed(7) },
    { match: 4, label: 'Match 4', red: seed(3), blue: seed(6) },
    { match: 5, label: 'Match 5', red: lose(1), blue: lose(2) },
    { match: 6, label: 'Match 6', red: lose(3), blue: lose(4) },
    { match: 7, label: 'Match 7', red: win(1), blue: win(2) },
    { match: 8, label: 'Match 8', red: win(3), blue: win(4) },
    { match: 9, label: 'Match 9', red: lose(7), blue: win(6) },
    { match: 10, label: 'Match 10', red: lose(8), blue: win(5) },
    { match: 11, label: 'Match 11', red: win(7), blue: win(8) },
    { match: 12, label: 'Match 12', red: win(10), blue: win(9) },
    { match: 13, label: 'Match 13', red: lose(11), blue: win(12) },
    { match: FINALS_MATCH, label: 'Finals', red: win(11), blue: win(13) }
];

/** Recorded winners: match number -> winning alliance number (1-8). */
export type MatchWinners = Record<number, number>;

export interface ResolvedMatch extends BracketMatch {
    /** Alliance number in each slot, or null while the feeding match is undecided. */
    redAlliance: number | null;
    blueAlliance: number | null;
    /** Recorded winner — only ever one of the two resolved alliances. */
    winner: number | null;
    loser: number | null;
}

/**
 * Walk the bracket in match order, resolving each slot from the winners
 * recorded so far. A stored winner is ignored unless both alliances are known
 * and it is one of them (which happens when an upstream result was changed
 * after it was recorded), which in turn un-resolves everything downstream.
 */
export function resolveBracket(winners: MatchWinners): ResolvedMatch[] {
    const resolved: ResolvedMatch[] = [];
    const byMatch: Record<number, ResolvedMatch> = {};

    const resolveSlot = (source: SlotSource): number | null => {
        if (source.kind === 'alliance') return source.alliance;
        const feeder = byMatch[source.match];
        return source.kind === 'winner' ? feeder.winner : feeder.loser;
    };

    BRACKET_MATCHES.forEach((m) => {
        const redAlliance = resolveSlot(m.red);
        const blueAlliance = resolveSlot(m.blue);
        const stored = winners[m.match] ?? null;
        const bothKnown = redAlliance != null && blueAlliance != null;
        const winner = bothKnown && (stored === redAlliance || stored === blueAlliance) ? stored : null;
        const loser = winner == null ? null : (winner === redAlliance ? blueAlliance : redAlliance);
        const entry: ResolvedMatch = { ...m, redAlliance, blueAlliance, winner, loser };
        resolved.push(entry);
        byMatch[m.match] = entry;
    });

    return resolved;
}

/** The winners map with any stale (no-longer-valid) results dropped. */
export function pruneWinners(winners: MatchWinners): MatchWinners {
    const pruned: MatchWinners = {};
    resolveBracket(winners).forEach((m) => {
        if (m.winner != null) pruned[m.match] = m.winner;
    });
    return pruned;
}

/**
 * Set (or, if already the winner, clear) a match's winner and return the
 * resulting pruned winners map. Callers pass the alliance that was clicked.
 */
export function withWinner(winners: MatchWinners, match: number, alliance: number): MatchWinners {
    const next = { ...winners };
    if (next[match] === alliance) delete next[match];
    else next[match] = alliance;
    return pruneWinners(next);
}

// Matches whose loser is out of the tournament for good. Losers of 1-4, 7,
// 8 and 11 drop to the lower bracket instead.
const KNOCKOUT_MATCHES = new Set([5, 6, 9, 10, 12, 13, FINALS_MATCH]);

/** Alliances that have been knocked out of the bracket so far. */
export function eliminatedAlliances(resolved: ResolvedMatch[]): Set<number> {
    const out = new Set<number>();
    resolved.forEach((m) => {
        if (KNOCKOUT_MATCHES.has(m.match) && m.loser != null) out.add(m.loser);
    });
    return out;
}

export function championAlliance(resolved: ResolvedMatch[]): number | null {
    return resolved.find((m) => m.match === FINALS_MATCH)?.winner ?? null;
}

/** Short description of where a slot's alliance comes from, for undecided slots. */
export function describeSource(source: SlotSource): string {
    if (source.kind === 'alliance') return `Alliance ${source.alliance}`;
    const verb = source.kind === 'winner' ? 'Winner' : 'Loser';
    return `${verb} of M${source.match}`;
}

/** A blank set of alliances: 8 empty arrays of team numbers. */
export function emptyAlliances(): number[][] {
    return Array.from({ length: ALLIANCE_COUNT }, () => []);
}

/** Normalize stored jsonb (which may be missing/malformed) into 8 alliances of <= 4 numbers. */
export function normalizeAlliances(raw: unknown): number[][] {
    const alliances = emptyAlliances();
    if (Array.isArray(raw)) {
        raw.slice(0, ALLIANCE_COUNT).forEach((teams, i) => {
            if (Array.isArray(teams)) {
                alliances[i] = teams.map(Number).filter((n) => Number.isFinite(n)).slice(0, ALLIANCE_SIZE);
            }
        });
    }
    return alliances;
}

export function normalizeWinners(raw: unknown): MatchWinners {
    const winners: MatchWinners = {};
    if (raw && typeof raw === 'object') {
        Object.entries(raw as Record<string, unknown>).forEach(([match, alliance]) => {
            const m = Number(match);
            const a = Number(alliance);
            if (Number.isInteger(m) && Number.isInteger(a)) winners[m] = a;
        });
    }
    return pruneWinners(winners);
}
