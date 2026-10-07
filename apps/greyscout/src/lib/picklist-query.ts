// @ts-nocheck

import { supabase } from '@greybots/common/supabase/client';
import {
    teamInfoTable,
    robotPhotoTable,
    matchScoutTable,
    pitScoutTable,
    pickListTable,
    pickListTypePersonal,
    pickListTypeTeam,
    userTable,
    eventInfoTable
} from '@/lib/constants';

/**
 * A team can be ranked independently under either or both archetypes
 * (issue #27) — this is a manual per-list distinction, not an automatic
 * classification.
 */
export type Archetype = 'scorer' | 'defender';
export const ARCHETYPES: Archetype[] = ['scorer', 'defender'];
export const DEFAULT_ARCHETYPE: Archetype = 'scorer';

/**
 * Fetch all teams attending an event, combined with their robot photo URL.
 * Returns an array of { team_number, name, photo_url | null }.
 */
export async function fetchTeamsForPicklist(eventId: string) {
    const { data: teams, error: teamsError } = await supabase
        .from(teamInfoTable)
        .select('team_number, name')
        .eq('event_id', eventId)
        .order('team_number', { ascending: true });

    if (teamsError || !teams) {
        console.error('fetchTeamsForPicklist teams error:', teamsError);
        return [];
    }

    // Fetch all robot photos for this event's teams in one shot.
    const teamNumbers = teams.map((t) => t.team_number);
    const { data: photos } = await supabase
        .from(robotPhotoTable)
        .select('team_number, photo_url')
        .in('team_number', teamNumbers);

    const photoMap: Record<number, string> = {};
    (photos ?? []).forEach((p) => {
        photoMap[p.team_number] = p.photo_url;
    });

    return teams.map((t) => ({
        team_number: t.team_number,
        name: t.name,
        photo_url: photoMap[t.team_number] ?? null
    }));
}

/**
 * Fetch match-scouting stats for a single team at an event.
 * Returns raw match rows — callers can aggregate as needed.
 */
export async function fetchTeamMatchStats(teamNumber: number, eventId: string) {
    const { data, error } = await supabase
        .from(matchScoutTable)
        .select('*')
        .eq('event', eventId)
        .eq('prematch_team_number', teamNumber);

    if (error) {
        console.error('fetchTeamMatchStats error:', error);
        return [];
    }
    return data ?? [];
}

export interface TeamMatchSummary {
    matches: number;
    brokeCount: number;
    diedCount: number;
    beachedCount: number;
    defenseCount: number;
    autoFailCount: number;
    noShowCount: number;
    /** defenseCount / matches * 100 — used to pre-filter Pick'em's Defender pool (issue #27). */
    defensePercent: number;
    /** Worst card seen across this team's matches at the event, or null if none. */
    worstCard: 'red' | 'yellow' | null;
}

/**
 * Fetch a lightweight per-team summary (card status + broke/died/beached/
 * defense counts) across every match at the event, in one query. Used to
 * show card status in the picklist row's collapsed summary view without
 * requiring a per-team round trip, and to compute the Break/Die/Beach/
 * Defense % stats shown when a row is expanded.
 */
export async function fetchTeamMatchSummaries(eventId: string): Promise<Record<number, TeamMatchSummary>> {
    const { data, error } = await supabase
        .from(matchScoutTable)
        .select('prematch_team_number, prematch_noshow, auto_failed, postmatch_broke, postmatch_died, postmatch_beached, postmatch_played_defense, postmatch_cards')
        .eq('event', eventId);

    if (error) {
        console.error('fetchTeamMatchSummaries error:', error);
        return {};
    }

    const summaries: Record<number, TeamMatchSummary> = {};
    (data ?? []).forEach((row) => {
        const teamNumber = row.prematch_team_number;
        if (teamNumber == null) return;

        const summary = summaries[teamNumber] ?? {
            matches: 0, brokeCount: 0, diedCount: 0, beachedCount: 0, defenseCount: 0, autoFailCount: 0, noShowCount: 0,
            defensePercent: 0, worstCard: null
        };
        summary.matches += 1;
        if (row.postmatch_broke) summary.brokeCount += 1;
        if (row.postmatch_died) summary.diedCount += 1;
        if (row.postmatch_beached) summary.beachedCount += 1;
        if (row.postmatch_played_defense) summary.defenseCount += 1;
        if (row.auto_failed) summary.autoFailCount += 1;
        if (row.prematch_noshow) summary.noShowCount += 1;
        if (row.postmatch_cards === 'red') summary.worstCard = 'red';
        else if (row.postmatch_cards === 'yellow' && summary.worstCard !== 'red') summary.worstCard = 'yellow';

        summaries[teamNumber] = summary;
    });

    Object.values(summaries).forEach((summary) => {
        summary.defensePercent = summary.matches > 0 ? (summary.defenseCount / summary.matches) * 100 : 0;
    });

    return summaries;
}

export interface TeamPitSummary {
    /** Pounds, without bumpers or battery. */
    weight: number | null;
    /** 1-5. */
    vibe: number | null;
}

/**
 * Fetch each team's weight and vibe check from pit scouting, in one query
 * (issue #123). The newest submission wins when a team has several.
 */
export async function fetchTeamPitSummaries(eventId: string): Promise<Record<number, TeamPitSummary>> {
    const { data, error } = await supabase
        .from(pitScoutTable)
        .select('pit_team_number, pit_weight, pit_vibe_check, created_at')
        .eq('event', eventId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('fetchTeamPitSummaries error:', error);
        return {};
    }

    const summaries: Record<number, TeamPitSummary> = {};
    (data ?? []).forEach((row) => {
        if (row.pit_team_number == null) return;
        summaries[row.pit_team_number] = { weight: row.pit_weight ?? null, vibe: row.pit_vibe_check ?? null };
    });
    return summaries;
}

/**
 * Fetch pit-scouting answers (drivetrain, weight, language, vibe check) for a team,
 * attributed to their author. Returns array of
 * { author, drivetrain, weight, language, vibe_check, comments, created_at }, newest first.
 */
export async function fetchTeamPitData(teamNumber: number, eventId: string) {
    const { data, error } = await supabase
        .from(pitScoutTable)
        .select(`id, pit_drivetrain, pit_drive_motor_type, pit_length, pit_width, pit_weight, pit_archetype, pit_language, pit_num_batteries, pit_num_chargers, pit_traverse_bump, pit_traverse_trench, pit_outpost_fuel, pit_shoot_close, pit_shoot_tower, pit_shoot_corner, pit_shoot_trench, pit_climb, pit_climb_auto, pit_auto_strategy, pit_cycle_rate, pit_defense, pit_driver_new, pit_system_check, pit_vibe_check, pit_comments, created_at, ${userTable}(name)`)
        .eq('event', eventId)
        .eq('pit_team_number', teamNumber)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('fetchTeamPitData error:', error);
        return [];
    }

    return (data ?? []).map((row) => ({
        id: row.id,
        author: row[userTable]?.name ?? 'Unknown',
        drivetrain: row.pit_drivetrain,
        driveMotorType: row.pit_drive_motor_type,
        length: row.pit_length,
        width: row.pit_width,
        weight: row.pit_weight,
        archetype: row.pit_archetype,
        language: row.pit_language,
        numBatteries: row.pit_num_batteries,
        numChargers: row.pit_num_chargers,
        traverseBump: row.pit_traverse_bump,
        traverseTrench: row.pit_traverse_trench,
        outpostFuel: row.pit_outpost_fuel,
        shootClose: row.pit_shoot_close,
        shootTower: row.pit_shoot_tower,
        shootCorner: row.pit_shoot_corner,
        shootTrench: row.pit_shoot_trench,
        climb: row.pit_climb,
        climbAuto: row.pit_climb_auto,
        autoStrategy: row.pit_auto_strategy,
        cycleRate: row.pit_cycle_rate,
        defense: row.pit_defense,
        driverNew: row.pit_driver_new,
        systemCheck: row.pit_system_check,
        vibe_check: row.pit_vibe_check,
        comments: row.pit_comments,
        created_at: row.created_at
    }));
}

/**
 * Fetch a single raw PitData row by id (native pit_* column names), used to
 * pre-fill the pit scouting form when editing an existing submission.
 */
export async function fetchPitDataById(id: number) {
    const { data, error } = await supabase
        .from(pitScoutTable)
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('fetchPitDataById error:', error);
        return null;
    }

    return data;
}

/**
 * Fetch a single raw MatchData row by id (native prematch_/auto_/postmatch_
 * column names), used to pre-fill the match scouting edit form (issue #31).
 */
export async function fetchMatchDataById(id: number) {
    const { data, error } = await supabase
        .from(matchScoutTable)
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('fetchMatchDataById error:', error);
        return null;
    }

    return data;
}

/**
 * "Match 12", "Practice 3", or "Playoff 2" for a MatchData row (issue #123).
 * Rows from before the match type existed are qualification matches.
 */
export function matchLabel(matchNumber: number | null, matchType: string | null | undefined) {
    if (matchNumber == null) return null;
    if (matchType === 'practice') return `Practice ${matchNumber}`;
    if (matchType === 'playoff') return `Playoff ${matchNumber}`;
    return `Match ${matchNumber}`;
}

/**
 * Fetch match- and pit-scouting comments for a team, attributed to their author.
 * Returns array of { source, author, comment, match_number, match_label,
 * card, noShow, created_at }, newest first. A match entry with a card or a
 * no-show is included even without a comment, so those always show up in
 * the comments section (issue #123).
 */
export async function fetchTeamComments(teamNumber: number, eventId: string) {
    // Match scout comments — scout identity is resolved via the submitting user's
    // account (scouted_by -> User.user_id) rather than a free-text name field.
    // Every column is selected so this keeps working whether or not the
    // match-type column exists yet.
    const { data: matchData } = await supabase
        .from(matchScoutTable)
        .select(`*, ${userTable}(name)`)
        .eq('event', eventId)
        .eq('prematch_team_number', teamNumber);

    // Pit scout comments — same account-based attribution as match comments.
    const { data: pitData } = await supabase
        .from(pitScoutTable)
        .select(`pit_comments, created_at, ${userTable}(name)`)
        .eq('event', eventId)
        .eq('pit_team_number', teamNumber)
        .not('pit_comments', 'is', null)
        .not('pit_comments', 'eq', '');

    const matchComments = (matchData ?? []).map((row) => ({
        source: 'Match',
        author: row[userTable]?.name ?? 'Unknown',
        comment: row.postmatch_comments ?? '',
        match_number: row.prematch_match_number ?? null,
        match_label: matchLabel(row.prematch_match_number ?? null, row.prematch_match_type),
        card: row.postmatch_cards === 'red' || row.postmatch_cards === 'yellow' ? row.postmatch_cards : null,
        noShow: !!row.prematch_noshow,
        created_at: row.created_at
    })).filter((entry) => entry.comment !== '' || entry.card || entry.noShow);

    const pitComments = (pitData ?? []).map((row) => ({
        source: 'Pit',
        author: row[userTable]?.name ?? 'Unknown',
        comment: row.pit_comments,
        match_number: null,
        match_label: null,
        card: null,
        noShow: false,
        created_at: row.created_at
    }));

    return [...matchComments, ...pitComments].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
}

/**
 * The tiers a team can be sorted into, best to worst. "DNP" = Do Not Pick.
 */
export const TIERS = ['S', 'A', 'B', 'C', 'D', 'DNP'] as const;
export type Tier = typeof TIERS[number];

/** Display groups for the tier-grouped picklist, including the untriaged bucket. */
export type TierGroup = 'Unranked' | Tier;
// "Unranked" (the untriaged pool) renders last, below the real tiers.
export const TIER_GROUPS: TierGroup[] = [...TIERS, 'Unranked'];

const TIER_INDEX: Record<Tier, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, DNP: 5 };

function isTier(value: unknown): value is Tier {
    return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/**
 * Normalize a raw team_tiers jsonb value (string keys) into a
 * Record<team_number, Tier>, dropping any invalid entries.
 */
export function parseTeamTiers(raw: Record<string, unknown> | null | undefined): Record<number, Tier> {
    const tiers: Record<number, Tier> = {};
    Object.entries(raw ?? {}).forEach(([teamNumStr, tier]) => {
        if (isTier(tier)) tiers[Number(teamNumStr)] = tier;
    });
    return tiers;
}

/**
 * Fetch the scout roster (members/leads/admins, not observers) for the
 * admin-only "view a scout's pick list" filter (issue #56) — sorted by
 * name so the dropdown reads alphabetically. Excludes unnamed accounts
 * (e.g. a still-provisioning profile) since they can't be identified in
 * the dropdown.
 */
export async function fetchScoutRoster(): Promise<{ user_id: string; name: string }[]> {
    const { data, error } = await supabase
        .from(userTable)
        .select('user_id, name')
        .in('role', ['member', 'lead', 'admin'])
        .not('name', 'is', null)
        .order('name', { ascending: true });

    if (error) {
        console.error('fetchScoutRoster error:', error);
        return [];
    }
    return data ?? [];
}

/**
 * Fetch every event other than the given (current) one, newest first, for
 * the lead/admin-only "view a prior event's pick list" filter (issue #58).
 */
export async function fetchPastEvents(currentEventId: string): Promise<{ event_id: string; name: string; start_date: string }[]> {
    const { data, error } = await supabase
        .from(eventInfoTable)
        .select('event_id, name, start_date')
        .neq('event_id', currentEventId)
        .order('start_date', { ascending: false });

    if (error) {
        console.error('fetchPastEvents error:', error);
        return [];
    }
    return data ?? [];
}

/**
 * Fetch the current user's personal picklist for an event/archetype.
 * Returns the ordered array of team_numbers plus tier assignments, or null if none exists.
 */
export async function fetchPersonalPicklist(userId: string, eventId: string, archetype: Archetype) {
    const { data, error } = await supabase
        .from(pickListTable)
        .select('id, team_numbers, team_tiers, updated_at')
        .eq('user_id', userId)
        .eq('event_id', eventId)
        .eq('type', pickListTypePersonal)
        .eq('archetype', archetype)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('fetchPersonalPicklist error:', error);
        return null;
    }
    return data;
}

/**
 * Fetch ALL personal picklists for an event/archetype (for the democratic view).
 * Returns array of { user_id, team_numbers, team_tiers }.
 */
export async function fetchAllPersonalPicklists(eventId: string, archetype: Archetype) {
    const { data, error } = await supabase
        .from(pickListTable)
        .select('user_id, team_numbers, team_tiers')
        .eq('event_id', eventId)
        .eq('type', pickListTypePersonal)
        .eq('archetype', archetype);

    if (error) {
        console.error('fetchAllPersonalPicklists error:', error);
        return [];
    }
    return data ?? [];
}

/**
 * Fetch the team (shared lead) picklist for an event/archetype.
 */
export async function fetchTeamPicklist(eventId: string, archetype: Archetype) {
    const { data, error } = await supabase
        .from(pickListTable)
        .select('id, team_numbers, team_tiers, updated_at')
        .eq('event_id', eventId)
        .eq('type', pickListTypeTeam)
        .eq('archetype', archetype)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('fetchTeamPicklist error:', error);
        return null;
    }
    return data;
}

/**
 * Fetch just the event-wide picked-team set. Visible to every user
 * regardless of role, unlike the rest of the team list which is lead-only.
 * Real-world draft status isn't per-archetype (a team once picked is picked
 * regardless of role), so this is always anchored to the Scorer archetype's
 * shared team row rather than being duplicated across both.
 */
export async function fetchPickedTeams(eventId: string): Promise<number[]> {
    const { data, error } = await supabase
        .from(pickListTable)
        .select('picked_team_numbers')
        .eq('event_id', eventId)
        .eq('type', pickListTypeTeam)
        .eq('archetype', DEFAULT_ARCHETYPE)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('fetchPickedTeams error:', error);
        return [];
    }
    return data?.picked_team_numbers ?? [];
}

/**
 * Upsert a personal picklist to Supabase.
 * Returns the error object or null on success.
 */
export async function upsertPersonalPicklist(
    userId: string,
    eventId: string,
    archetype: Archetype,
    teamNumbers: number[],
    teamTiers: Record<number, Tier>
) {
    const { data, error: fetchError } = await supabase
        .from(pickListTable)
        .select('id')
        .eq('user_id', userId)
        .eq('event_id', eventId)
        .eq('type', pickListTypePersonal)
        .eq('archetype', archetype)
        .maybeSingle();

    if (fetchError) return fetchError;

    if (data) {
        const { error } = await supabase
            .from(pickListTable)
            .update({
                team_numbers: teamNumbers,
                team_tiers: teamTiers,
                updated_at: new Date().toISOString()
            })
            .eq('id', data.id);
        return error;
    } else {
        const { error } = await supabase
            .from(pickListTable)
            .insert({
                user_id: userId,
                event_id: eventId,
                type: pickListTypePersonal,
                archetype,
                team_numbers: teamNumbers,
                team_tiers: teamTiers,
                updated_at: new Date().toISOString()
            });
        return error;
    }
}

/**
 * Upsert the shared team picklist to Supabase. Leaves picked_team_numbers
 * untouched — that's updated separately via updatePickedTeams.
 * Returns the error object or null on success.
 */
export async function upsertTeamPicklist(
    eventId: string,
    archetype: Archetype,
    teamNumbers: number[],
    teamTiers: Record<number, Tier>
) {
    const { data, error: fetchError } = await supabase
        .from(pickListTable)
        .select('id')
        .eq('event_id', eventId)
        .eq('type', pickListTypeTeam)
        .eq('archetype', archetype)
        .maybeSingle();

    if (fetchError) return fetchError;

    if (data) {
        const { error } = await supabase
            .from(pickListTable)
            .update({
                team_numbers: teamNumbers,
                team_tiers: teamTiers,
                updated_at: new Date().toISOString()
            })
            .eq('id', data.id);
        return error;
    } else {
        const { error } = await supabase
            .from(pickListTable)
            .insert({
                event_id: eventId,
                type: pickListTypeTeam,
                archetype,
                team_numbers: teamNumbers,
                team_tiers: teamTiers,
                updated_at: new Date().toISOString()
            });
        return error;
    }
}

/**
 * Update the event-wide picked-team set on the Scorer archetype's shared
 * team row (see fetchPickedTeams — draft status isn't per-archetype). This
 * is intentionally separate from upsertTeamPicklist so toggling a checkbox
 * never clobbers a concurrently-edited tier/order draft, and vice versa.
 * Returns the error object or null on success.
 */
export async function updatePickedTeams(eventId: string, pickedTeamNumbers: number[]) {
    const { data, error: fetchError } = await supabase
        .from(pickListTable)
        .select('id')
        .eq('event_id', eventId)
        .eq('type', pickListTypeTeam)
        .eq('archetype', DEFAULT_ARCHETYPE)
        .maybeSingle();

    if (fetchError) return fetchError;

    if (data) {
        const { error } = await supabase
            .from(pickListTable)
            .update({
                picked_team_numbers: pickedTeamNumbers,
                updated_at: new Date().toISOString()
            })
            .eq('id', data.id);
        return error;
    } else {
        const { error } = await supabase
            .from(pickListTable)
            .insert({
                event_id: eventId,
                type: pickListTypeTeam,
                archetype: DEFAULT_ARCHETYPE,
                picked_team_numbers: pickedTeamNumbers,
                updated_at: new Date().toISOString()
            });
        return error;
    }
}

export interface TeamTierStats {
    tier: Tier; // aggregate (average) tier across scouts who classified this team
    votes: number;
    avgIndex: number; // average of each vote's tier index (0=S..5=DNP) — used to bucket the aggregate tier
    avgRank: number; // average 1-indexed overall rank across voters' full tiered orderings
    tierCounts: Record<Tier, number>;
}

/**
 * Compute per-team aggregate tier statistics from all personal picklists.
 * A scout who left a team unranked contributes no data point for it — same
 * "no vote" convention the old rank stats used, so being untriaged in one
 * scout's list never drags a team's aggregate down.
 *
 * Each list's team_numbers is the tier-grouped flat order (real tiers
 * first, in S..DNP order, "Unranked" trailing), so a tiered team's index
 * in that array is already its 1-indexed overall rank among that scout's
 * *tiered* teams — untriaged teams always sort after it and can't shift it.
 */
export function computeTeamTierStats(
    allLists: { user_id: string; team_numbers: number[]; team_tiers: Record<string, unknown> }[]
): Record<number, TeamTierStats> {
    const tiersByTeam: Record<number, Tier[]> = {};
    const ranksByTeam: Record<number, number[]> = {};

    allLists.forEach(({ team_numbers, team_tiers }) => {
        const tiersMap = parseTeamTiers(team_tiers);
        (team_numbers ?? []).forEach((teamNumRaw, idx) => {
            const teamNum = Number(teamNumRaw);
            const tier = tiersMap[teamNum];
            if (!tier) return; // left unranked by this scout — no data point
            (tiersByTeam[teamNum] ??= []).push(tier);
            (ranksByTeam[teamNum] ??= []).push(idx + 1);
        });
    });

    const stats: Record<number, TeamTierStats> = {};

    Object.entries(tiersByTeam).forEach(([teamNumStr, tiers]) => {
        const teamNum = Number(teamNumStr);
        const tierCounts = { S: 0, A: 0, B: 0, C: 0, D: 0, DNP: 0 };
        let sum = 0;
        tiers.forEach((t) => {
            tierCounts[t]++;
            sum += TIER_INDEX[t];
        });
        const avgIndex = sum / tiers.length;
        const bucket = Math.min(TIERS.length - 1, Math.max(0, Math.round(avgIndex)));
        const ranks = ranksByTeam[teamNum];
        const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;

        stats[teamNum] = { tier: TIERS[bucket], votes: tiers.length, avgIndex, avgRank, tierCounts };
    });

    return stats;
}

/**
 * Group every team into a TierGroup based on computeTeamTierStats output.
 * Teams with no votes land in "Unranked". Within a real tier, teams are
 * ordered best-to-worst by average overall placement (avgRank), then by
 * vote count.
 */
export function computeDemocraticTierGroups(
    allTeamNumbers: number[],
    stats: Record<number, TeamTierStats>
): Record<TierGroup, number[]> {
    const groups: Record<TierGroup, number[]> = {
        Unranked: [], S: [], A: [], B: [], C: [], D: [], DNP: []
    };

    allTeamNumbers.forEach((teamNum) => {
        const s = stats[teamNum];
        groups[s ? s.tier : 'Unranked'].push(teamNum);
    });

    TIERS.forEach((tier) => {
        groups[tier].sort((a, b) => {
            const sa = stats[a];
            const sb = stats[b];
            if (sa.avgRank !== sb.avgRank) return sa.avgRank - sb.avgRank;
            if (sa.votes !== sb.votes) return sb.votes - sa.votes;
            return a - b;
        });
    });

    return groups;
}
