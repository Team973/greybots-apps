// @ts-nocheck

import { supabase } from '@greybots/common/supabase/client';
import { playoffsTable } from '@/lib/constants';
import { normalizeAlliances, normalizeWinners } from '@/lib/playoffs-bracket';
import type { MatchWinners } from '@/lib/playoffs-bracket';

export interface PlayoffsData {
    alliances: number[][];
    winners: MatchWinners;
}

/**
 * Fetch an event's alliances and bracket results. An event with nothing
 * saved yet just gets empty alliances / no winners. Returns null if the
 * fetch itself failed, so callers never mistake an error for "nothing
 * saved" and overwrite real data with an empty bracket.
 */
export async function fetchPlayoffs(eventId: string): Promise<PlayoffsData | null> {
    const { data, error } = await supabase
        .from(playoffsTable)
        .select('alliances, match_winners')
        .eq('event_id', eventId)
        .maybeSingle();

    if (error) {
        console.error('fetchPlayoffs error:', error);
        return null;
    }

    return {
        alliances: normalizeAlliances(data?.alliances),
        winners: normalizeWinners(data?.match_winners)
    };
}

/**
 * Save an event's alliances and bracket results. Returns the error object
 * or null on success.
 */
export async function upsertPlayoffs(eventId: string, alliances: number[][], winners: MatchWinners) {
    const { error } = await supabase
        .from(playoffsTable)
        .upsert({
            event_id: eventId,
            alliances,
            match_winners: winners,
            updated_at: new Date().toISOString()
        }, { onConflict: 'event_id' });
    return error;
}
