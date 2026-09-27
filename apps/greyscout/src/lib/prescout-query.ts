// @ts-nocheck

import { supabase } from '@greybots/common/supabase/client';
import { preScoutTable, preScoutCommentTable, userTable } from '@/lib/constants';

/**
 * Fetch the single canonical pre-scouting assessment (epa/archetype/tiers)
 * for a team, attributed to its author — one row per team/event, enforced
 * by prescout_data_team_unique. Returns null if the team hasn't been
 * pre-scouted yet.
 */
export async function fetchTeamPreScoutData(teamNumber: number, eventId: string) {
    const { data, error } = await supabase
        .from(preScoutTable)
        .select(`id, prescout_epa, prescout_archetype, prescout_scoring_tier, prescout_driving_tier, prescout_defense_tier, created_at, ${userTable}(name)`)
        .eq('event', eventId)
        .eq('prescout_team_number', teamNumber)
        .maybeSingle();

    if (error) {
        console.error('fetchTeamPreScoutData error:', error);
        return null;
    }

    if (!data) {
        return null;
    }

    return {
        id: data.id,
        author: data[userTable]?.name ?? 'Unknown',
        epa: data.prescout_epa,
        archetype: data.prescout_archetype,
        scoringTier: data.prescout_scoring_tier,
        drivingTier: data.prescout_driving_tier,
        defenseTier: data.prescout_defense_tier,
        created_at: data.created_at
    };
}

/**
 * Fetch pre-scouting comments for a team, one per scout, attributed to their
 * author, newest first — mirrors picklist-query.ts's fetchTeamPitData, but
 * for the N:1 (multiple scouts -> one team) PreScoutComment table.
 */
export async function fetchTeamPreScoutComments(teamNumber: number, eventId: string) {
    const { data, error } = await supabase
        .from(preScoutCommentTable)
        .select(`id, scouted_by, comment, created_at, ${userTable}(name)`)
        .eq('event', eventId)
        .eq('prescout_team_number', teamNumber)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('fetchTeamPreScoutComments error:', error);
        return [];
    }

    return (data ?? []).map((row) => ({
        id: row.id,
        scoutedBy: row.scouted_by,
        author: row[userTable]?.name ?? 'Unknown',
        comment: row.comment,
        created_at: row.created_at
    }));
}

/**
 * Fetch a single raw PreScoutData row by id (native prescout_* column
 * names), used to pre-fill the pre-scouting form when editing an existing
 * submission — mirrors picklist-query.ts's fetchPitDataById.
 */
export async function fetchPreScoutDataById(id: number) {
    const { data, error } = await supabase
        .from(preScoutTable)
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('fetchPreScoutDataById error:', error);
        return null;
    }

    return data;
}

/**
 * Fetch each team's most-recent pre-scouted EPA for an event, in one query
 * — used by the Stats page. Teams with no EPA on file (or no pre-scouting
 * data at all) are simply absent from the returned map.
 */
export async function fetchLatestEpaByTeam(eventId: string): Promise<Record<number, number>> {
    const { data, error } = await supabase
        .from(preScoutTable)
        .select('prescout_team_number, prescout_epa, created_at')
        .eq('event', eventId)
        .not('prescout_epa', 'is', null);

    if (error) {
        console.error('fetchLatestEpaByTeam error:', error);
        return {};
    }

    const latestByTeam: Record<number, { epa: number; createdAt: string }> = {};
    (data ?? []).forEach((row) => {
        const teamNumber = row.prescout_team_number;
        const existing = latestByTeam[teamNumber];
        if (!existing || row.created_at > existing.createdAt) {
            latestByTeam[teamNumber] = { epa: row.prescout_epa, createdAt: row.created_at };
        }
    });

    const result: Record<number, number> = {};
    Object.entries(latestByTeam).forEach(([teamNumber, entry]) => {
        result[Number(teamNumber)] = entry.epa;
    });
    return result;
}
