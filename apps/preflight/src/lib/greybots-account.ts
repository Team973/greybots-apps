import { supabase, supabasePublicKey, supabaseUrl } from '@greybots/common/supabase/client';
import { reachabilityTimeoutMs } from './constants';
import type { Role } from './roles';

// Shared greybots-apps account table (same one GreyScout uses).
const userTable = 'User';

export interface AccountProfile {
    id: string;
    email: string | null;
    name: string;
    role: Role;
}

// Look up the display name/role for a signed-in greybots-apps account.
// Accounts without a profile row yet are treated as observers — GreyScout
// owns provisioning that row, so Preflight doesn't create it.
export async function fetchAccountProfile(userId: string, email: string | null): Promise<AccountProfile> {
    const { data, error } = await supabase.from(userTable).select('name, role').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return {
        id: userId,
        email,
        name: data?.name || email || 'Unknown user',
        role: (data?.role as Role) ?? 'observer'
    };
}

export async function signInAccount(email: string, password: string): Promise<AccountProfile> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return fetchAccountProfile(data.user.id, data.user.email ?? null);
}

// Local-scope sign out only clears this device's session, so it works offline.
export async function signOutAccount(): Promise<void> {
    await supabase.auth.signOut({ scope: 'local' });
}

// True if the Supabase server answers, regardless of navigator.onLine (which
// only says a network interface is up, e.g. venue Wi-Fi with no uplink).
export async function isServerReachable(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), reachabilityTimeoutMs);
    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
            headers: { apikey: supabasePublicKey },
            signal: controller.signal,
            cache: 'no-store'
        });
        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}
