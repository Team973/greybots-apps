import type { User } from '@supabase/supabase-js';
import { ensureUserProfile } from '@greybots/common/lib/account';
import { supabase, supabasePublicKey, supabaseUrl } from '@greybots/common/supabase/client';
import { reachabilityTimeoutMs } from './constants';
import type { Role } from './roles';

export interface AccountProfile {
    id: string;
    email: string | null;
    name: string;
    role: Role;
}

// Look up the display name and Preflight role for a signed-in greybots-apps
// account. Roles are per app: `preflight_role` is this app's, and `role` is
// the scouting one (used only as a fallback against a database that doesn't
// have the Preflight column yet). The profile row is created the first time
// the account is seen, by whichever app sees it first; a new account is
// pending until a lead or admin gives it a role.
export async function fetchAccountProfile(user: User): Promise<AccountProfile> {
    const data = await ensureUserProfile(user);
    const email = user.email ?? null;
    return {
        id: user.id,
        email,
        name: data?.name || email || 'Unknown user',
        role: ((data?.preflight_role ?? data?.role) as Role | undefined) ?? 'pending'
    };
}

export async function signInAccount(email: string, password: string): Promise<AccountProfile> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return fetchAccountProfile(data.user);
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
