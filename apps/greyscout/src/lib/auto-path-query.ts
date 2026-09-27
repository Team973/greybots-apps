// @ts-nocheck

import { supabase } from '@greybots/common/supabase/client';
import { autoPathTable, userTable } from '@/lib/constants';

/**
 * Fetch all saved auto paths for a team at an event, newest first.
 * Returns array of { id, name, alliance, side, points, isDefault, author, created_at }.
 */
export async function fetchTeamAutoPaths(teamNumber: number, eventId: string) {
    const { data, error } = await supabase
        .from(autoPathTable)
        .select(`id, name, alliance, side, path, is_default, created_at, ${userTable}(name)`)
        .eq('event', eventId)
        .eq('team_number', teamNumber)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('fetchTeamAutoPaths error:', error);
        return [];
    }

    return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        alliance: row.alliance,
        side: row.side,
        points: row.path ?? [],
        isDefault: row.is_default,
        author: row[userTable]?.name ?? 'Unknown',
        created_at: row.created_at
    }));
}

/**
 * Fetch a single raw AutoPath row by id, used to pre-fill the editor.
 */
export async function fetchAutoPathById(id: number) {
    const { data, error } = await supabase
        .from(autoPathTable)
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('fetchAutoPathById error:', error);
        return null;
    }

    return data;
}

// Insert/update go through the shared submitScoutData/updateScoutData
// helpers in data-submission.ts (same as pit scouting) so a save that fails
// offline reuses the existing OfflineQueue 'scout_data' retry path instead
// of a bespoke queue type.

/**
 * Delete an auto path. Returns the error object or null on success.
 */
export async function deleteAutoPath(id: number) {
    const { error } = await supabase.from(autoPathTable).delete().eq('id', id);
    return error;
}

/**
 * Mark an auto path as the team's default for an event, replacing whichever
 * path (if any) was previously the default. There's no "unset" — a default
 * can only be changed by picking a different path, never cleared outright.
 * Only one path can be default per (team_number, event), enforced by a
 * partial unique index, so this clears any existing default first. Returns
 * the error object or null on success.
 */
export async function setAutoPathDefault(teamNumber: number, eventId: string, id: number) {
    const { error: clearError } = await supabase
        .from(autoPathTable)
        .update({ is_default: false })
        .eq('team_number', teamNumber)
        .eq('event', eventId)
        .eq('is_default', true);

    if (clearError) return clearError;

    const { error } = await supabase.from(autoPathTable).update({ is_default: true }).eq('id', id);
    return error;
}
