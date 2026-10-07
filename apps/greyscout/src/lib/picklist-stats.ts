// @ts-nocheck
// Shared expanded-detail stat computation, used by both PicklistRow.vue and
// PicklistUnrankedCard.vue's expanded views so the two don't duplicate the
// same field-derivation logic.

import { getTeamTbaStats } from '@/lib/tba-cache';

const formatWeight = (weight: number) => `${Number(weight.toFixed(1))} lbs`;

// Weight and vibe check from pit scouting (issue #123), for the expanded
// view. Empty until the team has been pit scouted.
export function computePitStats(pit) {
    if (!pit) return [];
    const entries = [];
    if (pit.weight != null) entries.push({ label: 'Weight', avg: formatWeight(pit.weight), sub: 'no bumpers / battery' });
    if (pit.vibe != null) entries.push({ label: 'Vibe', avg: `${pit.vibe} / 5`, sub: 'pit vibe check' });
    return entries;
}

// The stats shown inline on a ranked row when the pick list's "Show stats"
// switch is on (issue #123), so teams can be compared without expanding
// each one. `summary` is a TeamMatchSummary, `pit` a TeamPitSummary; both
// can be missing. `warn` marks a figure worth a second look.
export function computeInlineStats(eventId: string, teamNumber: number, summary, pit) {
    const chips = [];
    const tba = getTeamTbaStats(eventId, teamNumber);
    if (tba?.opr != null) chips.push({ label: 'OPR', value: tba.opr.toFixed(1) });
    if (tba?.dpr != null) chips.push({ label: 'DPR', value: tba.dpr.toFixed(1) });

    if (summary?.matches) {
        const pct = (count: number) => Math.round((count / summary.matches) * 100);
        chips.push({ label: 'Matches', value: String(summary.matches) });
        chips.push({ label: 'Def', value: `${pct(summary.defenseCount)}%` });
        [
            ['Auto fail', summary.autoFailCount],
            ['Break', summary.brokeCount],
            ['Die', summary.diedCount],
            ['Beach', summary.beachedCount]
        ].forEach(([label, count]) => chips.push({ label, value: `${pct(count)}%`, warn: count > 0 }));
        if (summary.noShowCount) chips.push({ label: 'No show', value: String(summary.noShowCount), warn: true });
    } else {
        chips.push({ label: 'Matches', value: '0' });
    }

    if (pit?.weight != null) chips.push({ label: 'Weight', value: formatWeight(pit.weight) });
    if (pit?.vibe != null) chips.push({ label: 'Vibe', value: `${pit.vibe}/5`, warn: pit.vibe <= 2 });
    return chips;
}

export function computeBasicStats(matchData: unknown[]) {
    if (!matchData.length) return [];

    // Derive numeric fields automatically from the first row
    const numericFields: string[] = [];
    if (matchData[0]) {
        Object.entries(matchData[0]).forEach(([key, val]) => {
            if (typeof val === 'number' && key !== 'id' && !key.includes('match_number') && !key.includes('team_number')) {
                numericFields.push(key);
            }
        });
    }

    return numericFields.slice(0, 8).map((field) => {
        const values = matchData.map(row => row[field]).filter(v => typeof v === 'number');
        const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : 0;
        const max = values.length ? Math.max(...values) : 0;
        return { label: formatFieldLabel(field), avg: avg.toFixed(1), max };
    });
}

export function formatFieldLabel(field: string) {
    return field
        .replace(/^(prematch_|postmatch_|auto_|teleop_|endgame_)/g, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

export const FLAG_STATS = [
    { key: 'auto_failed', label: 'Auto Fail %' },
    { key: 'postmatch_broke', label: 'Break %' },
    { key: 'postmatch_died', label: 'Die %' },
    { key: 'postmatch_beached', label: 'Beach %' },
    { key: 'postmatch_played_defense', label: 'Defense %' }
];

export function computeFlagStats(matchData: unknown[]) {
    if (!matchData.length) return [];
    return FLAG_STATS.map(({ key, label }) => {
        const count = matchData.filter(row => !!row[key]).length;
        const pct = (count / matchData.length) * 100;
        return { label, pct: pct.toFixed(0), count, total: matchData.length };
    });
}

// TBA OPR/DPR, read synchronously from the local cache (src/lib/tba-cache.ts)
// — never fetched here. Empty until a "Refresh TBA Stats" action has run at
// least once for this event.
export function computeTbaStats(eventId: string, teamNumber: number) {
    const stats = getTeamTbaStats(eventId, teamNumber);
    if (!stats) return [];

    const entries = [];
    if (stats.opr != null) entries.push({ label: 'OPR', avg: stats.opr.toFixed(1), sub: 'via TBA' });
    if (stats.dpr != null) entries.push({ label: 'DPR', avg: stats.dpr.toFixed(1), sub: 'via TBA' });
    return entries;
}
