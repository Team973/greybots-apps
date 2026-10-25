// The team pick list's layout: one ranked list of teams with labelled
// dividers between groups, instead of S-DNP tiers — like the spreadsheet the
// team used for the final pick list. Personal lists keep their tiers.
//
// In the database (PickList.dividers, see the 20261025120000 migration) a
// team list stores its ranked teams in team_numbers and its dividers as
// [{ id, label, position }], position being how many ranked teams come
// before the divider. A NULL dividers column means the row still uses tiers.

import { TIERS } from '@/lib/picklist-query';
import type { Tier, TierGroup } from '@/lib/picklist-query';
import { toTeamNumber } from '@/lib/team-number';
import type { TeamNumber } from '@/lib/team-number';

export interface TeamItem {
    kind: 'team';
    team: TeamNumber;
}

export interface DividerItem {
    kind: 'divider';
    id: string;
    label: string;
}

export type LayoutItem = TeamItem | DividerItem;

export interface SavedDivider {
    id: string;
    label: string;
    position: number;
}

export interface TeamListLayout {
    /** The ranked teams and dividers, top to bottom. */
    ranked: LayoutItem[];
    /** Teams not placed yet, in team-number order. */
    unranked: TeamItem[];
}

export function teamItem(team: TeamNumber): TeamItem {
    return { kind: 'team', team };
}

export function newDivider(label = ''): DividerItem {
    const id = globalThis.crypto?.randomUUID?.() ?? `divider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return { kind: 'divider', id, label };
}

/** A stable key for vuedraggable / v-for. */
export function layoutItemKey(item: LayoutItem): string {
    return item.kind === 'team' ? `team-${item.team}` : `divider-${item.id}`;
}

/** Whether a saved row is already in the divider format. */
export function hasDividers(row: { dividers?: unknown } | null | undefined): boolean {
    return Array.isArray(row?.dividers);
}

/** Every event team not in `ranked`, as unranked items in event order. */
function unrankedFrom(ranked: LayoutItem[], allTeamNumbers: TeamNumber[]): TeamItem[] {
    const placed = new Set(ranked.filter((i) => i.kind === 'team').map((i) => (i as TeamItem).team));
    return allTeamNumbers.filter((n) => !placed.has(n)).map(teamItem);
}

/**
 * Lay out a team list saved in the divider format. Teams no longer at the
 * event are dropped (unless the team list itself didn't load, so a save
 * can't wipe the list), and teams new to the event land in unranked.
 */
export function layoutFromSaved(
    teamNumbers: TeamNumber[],
    dividers: unknown,
    allTeamNumbers: TeamNumber[]
): TeamListLayout {
    const atEvent = new Set(allTeamNumbers);
    const seen = new Set<TeamNumber>();
    const keep = (n: TeamNumber) => (atEvent.size === 0 || atEvent.has(n)) && !seen.has(n);

    const sorted = (Array.isArray(dividers) ? dividers : [])
        .filter((d) => d && typeof d.id === 'string')
        .map((d) => ({ id: d.id, label: String(d.label ?? ''), position: Number(d.position) || 0 }))
        .sort((a, b) => a.position - b.position);

    // Positions count against the saved order, so place dividers by that
    // order and only then skip teams that are gone, keeping each divider
    // above the same teams it was above. One past the end stays at the end.
    const ranked: LayoutItem[] = [];
    let d = 0;
    const placeDividersUpTo = (index: number) => {
        for (; d < sorted.length && sorted[d].position <= index; d += 1) {
            ranked.push({ kind: 'divider', id: sorted[d].id, label: sorted[d].label });
        }
    };
    teamNumbers.map(toTeamNumber).forEach((team, index) => {
        placeDividersUpTo(index);
        if (team === null || !keep(team)) return;
        seen.add(team);
        ranked.push(teamItem(team));
    });
    placeDividersUpTo(Infinity);

    return { ranked, unranked: unrankedFrom(ranked, allTeamNumbers) };
}

/**
 * Lay out tier-grouped sections (an old tier-based team list, or the
 * democratic grouping) as a ranked list with a divider named for each
 * non-empty tier, so the existing grouping carries over.
 */
export function layoutFromTierSections(
    sections: Record<TierGroup, TeamNumber[]>,
    allTeamNumbers: TeamNumber[]
): TeamListLayout {
    const ranked: LayoutItem[] = [];
    TIERS.forEach((tier: Tier) => {
        const teams = sections[tier] ?? [];
        if (teams.length === 0) return;
        ranked.push(newDivider(tier));
        teams.forEach((team) => ranked.push(teamItem(team)));
    });
    return { ranked, unranked: unrankedFrom(ranked, allTeamNumbers) };
}

/** The ranked layout in its saved form. */
export function serializeLayout(ranked: LayoutItem[]): { teamNumbers: TeamNumber[]; dividers: SavedDivider[] } {
    const teamNumbers: TeamNumber[] = [];
    const dividers: SavedDivider[] = [];
    ranked.forEach((item) => {
        if (item.kind === 'team') teamNumbers.push(item.team);
        else dividers.push({ id: item.id, label: item.label, position: teamNumbers.length });
    });
    return { teamNumbers, dividers };
}
