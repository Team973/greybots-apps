// @ts-nocheck

import { supabase } from '@greybots/common/supabase/client';
import { scoutAssignmentTable } from '@/lib/constants';

/**
 * All scout assignments for an event. Returns rows of
 * { id, event_id, match_number, alliance, slot_index, scout_user_id, created_at, updated_at }.
 * Assignments are by alliance station (red/blue, slot 1-3) rather than by a
 * specific team, since the team occupying a station changes match-to-match.
 */
export async function queryScoutAssignments(eventId) {
    const { data, error } = await supabase
        .from(scoutAssignmentTable)
        .select('*')
        .eq('event_id', eventId);

    if (error) {
        console.error('queryScoutAssignments error:', error);
        return [];
    }

    return data ?? [];
}

/**
 * All scout assignments for a given scout, across every event (not just the
 * current one). Used by the Schedule page so a scout can still see
 * assignments from a past event even after the app's active event changes.
 */
export async function queryScoutAssignmentsForUser(userId) {
    const { data, error } = await supabase
        .from(scoutAssignmentTable)
        .select('*')
        .eq('scout_user_id', userId);

    if (error) {
        console.error('queryScoutAssignmentsForUser error:', error);
        return [];
    }

    return data ?? [];
}

/**
 * Assign (or reassign) a scout to an alliance station slot (up to 3 per
 * alliance per match), or clear it by passing scoutUserId as null. Upserts
 * on the (event_id, match_number, alliance, slot_index) unique slot.
 * Returns the error object, or null on success.
 */
export async function assignScout(eventId, matchNumber, alliance, slotIndex, scoutUserId) {
    const { error } = await supabase
        .from(scoutAssignmentTable)
        .upsert({
            event_id: eventId,
            match_number: matchNumber,
            alliance,
            slot_index: slotIndex,
            scout_user_id: scoutUserId,
            updated_at: new Date().toISOString()
        }, { onConflict: 'event_id,match_number,alliance,slot_index' });

    return error;
}

/**
 * Assign the same scout to many alliance station slots in one request —
 * used by the schedule grid's fill-drag (copy one cell's scout across a
 * dragged range) so a large drag doesn't fire one request per cell.
 * `slots` is an array of { matchNumber, alliance, slotIndex }. Returns the
 * error object, or null on success.
 */
export async function assignScoutToSlots(eventId, slots, scoutUserId) {
    if (slots.length === 0) return null;

    const updatedAt = new Date().toISOString();
    const rows = slots.map(({ matchNumber, alliance, slotIndex }) => ({
        event_id: eventId,
        match_number: matchNumber,
        alliance,
        slot_index: slotIndex,
        scout_user_id: scoutUserId,
        updated_at: updatedAt
    }));

    const { error } = await supabase
        .from(scoutAssignmentTable)
        .upsert(rows, { onConflict: 'event_id,match_number,alliance,slot_index' });

    return error;
}
