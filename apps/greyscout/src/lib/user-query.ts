// @ts-nocheck

import { supabase } from '@greybots/common/supabase/client';
import { userTable } from '@/lib/constants';

/**
 * Fetch all user profiles for the People section of the Account page.
 * Returns an array of { user_id, name, role, created_at }.
 */
export async function fetchAllUsers() {
    const { data, error } = await supabase
        .from(userTable)
        .select('user_id, name, role, created_at')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('fetchAllUsers error:', error);
        return [];
    }
    return data ?? [];
}

/**
 * Update another user's role. Server-side triggers are the source of truth for
 * whether this transition is authorized — this call simply reports the result.
 * Returns the error object, or null on success.
 */
export async function updateUserRole(targetUserId: string, newRole: string) {
    const { error } = await supabase
        .from(userTable)
        .update({ role: newRole })
        .eq('user_id', targetUserId);

    return error;
}
