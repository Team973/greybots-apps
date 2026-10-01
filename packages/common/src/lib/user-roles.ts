import { supabase } from '../supabase/client';

// Accounts and their roles, shared by every greybots app. A person has one
// account (a row in the `User` table) and a separate role in each app: someone
// can be a lead for scouting and only an observer in the pit.

export type AppRole = 'observer' | 'member' | 'lead' | 'admin';

export const appRoles: AppRole[] = ['observer', 'member', 'lead', 'admin'];

export const roleRank: Record<AppRole, number> = { observer: 0, member: 1, lead: 2, admin: 3 };

// The apps, and the `User` column that holds a person's role in each.
export type AppKey = 'greyscout' | 'preflight';

export interface AppRoleColumn {
    app: AppKey;
    label: string;
    column: 'role' | 'preflight_role';
}

export const appRoleColumns: AppRoleColumn[] = [
    { app: 'greyscout', label: 'Scouting', column: 'role' },
    { app: 'preflight', label: 'Preflight', column: 'preflight_role' }
];

export interface UserAccount {
    user_id: string;
    name: string | null;
    created_at: string;
    role: AppRole;
    // Absent until the per-app roles migration has been applied.
    preflight_role?: AppRole;
}

const userTable = 'User';

// Everyone with an account, oldest first.
export async function fetchAllUsers(): Promise<UserAccount[]> {
    const { data, error } = await supabase.from(userTable).select('*').order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as UserAccount[];
}

// Change a person's role in one app. The database decides whether the
// signed-in user is allowed to (see enforce_user_profile_update); this only
// reports the outcome.
export async function updateUserRole(userId: string, column: AppRoleColumn['column'], role: AppRole): Promise<void> {
    const { error } = await supabase.from(userTable).update({ [column]: role }).eq('user_id', userId);
    if (error) throw new Error(error.message ?? 'Unable to update role.');
}

// The roles the actor may move the target to, in one app. Mirrors the
// database's rules, so the UI only offers changes that will be accepted:
// - promote: the actor must outrank the target's current role, and can't
//   grant a role above their own;
// - demote: admins only.
export function allowedRoles(actorRole: AppRole | null | undefined, targetRole: AppRole | null | undefined): AppRole[] {
    const actorRank = actorRole ? roleRank[actorRole] : -1;
    const oldRank = targetRole ? roleRank[targetRole] : -1;
    return appRoles.filter((candidate) => {
        const newRank = roleRank[candidate];
        if (newRank === oldRank) return false;
        if (newRank > oldRank) return actorRank > oldRank && newRank <= actorRank;
        return actorRole === 'admin';
    });
}
