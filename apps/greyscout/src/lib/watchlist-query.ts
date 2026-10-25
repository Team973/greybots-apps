// @ts-nocheck

import { supabase } from '@greybots/common/supabase/client';
import { watchlistTable } from '@/lib/constants';
import { toTeamNumbers } from '@/lib/team-number';
import type { TeamNumber } from '@/lib/team-number';

/**
 * Fetch the set of team numbers currently on the watchlist for an event.
 */
export async function fetchWatchlist(eventId: string): Promise<TeamNumber[]> {
    const { data, error } = await supabase
        .from(watchlistTable)
        .select('team_number')
        .eq('event_id', eventId);

    if (error) {
        console.error('fetchWatchlist error:', error);
        return [];
    }

    return toTeamNumbers((data ?? []).map((row) => row.team_number));
}

/**
 * Add a team to the event's watchlist. Returns the error object or null on success.
 */
export async function addToWatchlist(eventId: string, teamNumber: TeamNumber) {
    const { error } = await supabase
        .from(watchlistTable)
        .insert({ event_id: eventId, team_number: teamNumber });

    return error;
}

/**
 * Remove a team from the event's watchlist. Returns the error object or null on success.
 */
export async function removeFromWatchlist(eventId: string, teamNumber: TeamNumber) {
    // RLS-denied deletes (non-leads) succeed with zero rows rather than
    // erroring, so ask for the deleted rows back to tell the two apart.
    const { data, error } = await supabase
        .from(watchlistTable)
        .delete()
        .eq('event_id', eventId)
        .eq('team_number', teamNumber)
        .select('team_number');

    if (!error && (!data || data.length === 0)) {
        return { message: 'Team was not removed (already gone, or not permitted).' };
    }

    return error;
}
