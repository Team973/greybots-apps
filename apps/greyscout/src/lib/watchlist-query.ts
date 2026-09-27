// @ts-nocheck

import { supabase } from '@greybots/common/supabase/client';
import { watchlistTable } from '@/lib/constants';

/**
 * Fetch the set of team numbers currently on the watchlist for an event.
 */
export async function fetchWatchlist(eventId: string): Promise<number[]> {
    const { data, error } = await supabase
        .from(watchlistTable)
        .select('team_number')
        .eq('event_id', eventId);

    if (error) {
        console.error('fetchWatchlist error:', error);
        return [];
    }

    return (data ?? []).map((row) => row.team_number);
}

/**
 * Add a team to the event's watchlist. Returns the error object or null on success.
 */
export async function addToWatchlist(eventId: string, teamNumber: number) {
    const { error } = await supabase
        .from(watchlistTable)
        .insert({ event_id: eventId, team_number: teamNumber });

    return error;
}

/**
 * Remove a team from the event's watchlist. Returns the error object or null on success.
 */
export async function removeFromWatchlist(eventId: string, teamNumber: number) {
    const { error } = await supabase
        .from(watchlistTable)
        .delete()
        .eq('event_id', eventId)
        .eq('team_number', teamNumber);

    return error;
}
