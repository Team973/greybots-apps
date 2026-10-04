import { supabase } from '../supabase/client';

// Accounts and their roles, shared by every greybots app. A person has one
// account (a row in the `User` table) and a separate role in each app: someone
// can be a lead for scouting and only an observer in the pit.
//
// A new account is "pending" in every app until a lead or admin gives it a
// role, and has no access to anything until then. An admin can deactivate an
// account, which makes its role "deactivated" in every app until it's
// restored.

export type AppRole = 'deactivated' | 'pending' | 'observer' | 'member' | 'lead' | 'admin';

// The roles a person can be given, lowest first. ("deactivated" isn't given:
// it's what deactivating an account sets.)
export const appRoles: AppRole[] = ['pending', 'observer', 'member', 'lead', 'admin'];

export const roleRank: Record<AppRole, number> = { deactivated: -2, pending: -1, observer: 0, member: 1, lead: 2, admin: 3 };

// How a role is shown to people.
export const roleLabels: Record<AppRole, string> = {
    deactivated: 'Deactivated',
    pending: 'Pending',
    observer: 'Observer',
    member: 'Member',
    lead: 'Lead',
    admin: 'Admin'
};

// Whether a role lets its holder into the app at all.
export function hasAppAccess(role: AppRole | null | undefined): boolean {
    return !!role && roleRank[role] >= roleRank.observer;
}

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
    // Absent until the pending / deactivation migration has been applied.
    deactivated?: boolean;
}

const userTable = 'User';

// Where an account stands overall: waiting for its first role in any app,
// in use, or switched off.
export type AccountStatus = 'pending' | 'active' | 'deactivated';

export function accountStatus(account: UserAccount): AccountStatus {
    if (account.deactivated) return 'deactivated';
    const roles = appRoleColumns.map((c) => account[c.column]).filter((r): r is AppRole => r !== undefined);
    return roles.some(hasAppAccess) ? 'active' : 'pending';
}

// An admin of any app can deactivate, restore, and rename people.
export function isAnyAppAdmin(account: UserAccount | null | undefined): boolean {
    return !!account && !account.deactivated && appRoleColumns.some((c) => account[c.column] === 'admin');
}

// Everyone with an account, oldest first.
export async function fetchAllUsers(): Promise<UserAccount[]> {
    const { data, error } = await supabase.from(userTable).select('*').order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as UserAccount[];
}

// The rest of these change someone's account. The database decides whether
// the signed-in user is allowed to (see enforce_user_profile_update); they
// only report the outcome.

// Change a person's role in one app.
export async function updateUserRole(userId: string, column: AppRoleColumn['column'], role: AppRole): Promise<void> {
    const { error } = await supabase.from(userTable).update({ [column]: role }).eq('user_id', userId);
    if (error) throw new Error(error.message ?? 'Unable to update role.');
}

// Change a person's name (your own, or anyone's if you're an admin).
export async function updateUserName(userId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('A name is required.');
    const { error } = await supabase.from(userTable).update({ name: trimmed }).eq('user_id', userId);
    if (error) throw new Error(error.message ?? 'Unable to update the name.');
}

// Deactivate an account, or restore a deactivated one. Returns the account
// as the database left it: deactivating takes away its roles in every app,
// and restoring puts back the ones it had.
export async function setUserDeactivated(userId: string, deactivated: boolean): Promise<UserAccount> {
    const { data, error } = await supabase.from(userTable).update({ deactivated }).eq('user_id', userId).select().single();
    if (error) throw new Error(error.message ?? 'Unable to update the account.');
    return data as UserAccount;
}

// The roles the actor may move the target to, in one app. Mirrors the
// database's rules, so the UI only offers changes that will be accepted:
// - promote: the actor must outrank the target's current role, and can't
//   grant a role above their own;
// - approve (give a pending account its first role): leads and admins only;
// - demote: admins only.
export function allowedRoles(actorRole: AppRole | null | undefined, targetRole: AppRole | null | undefined): AppRole[] {
    if (targetRole === 'deactivated') return [];
    const actorRank = actorRole ? roleRank[actorRole] : -Infinity;
    const oldRank = targetRole ? roleRank[targetRole] : roleRank.pending;
    return appRoles.filter((candidate) => {
        const newRank = roleRank[candidate];
        if (newRank === oldRank) return false;
        if (newRank > oldRank) {
            if (oldRank === roleRank.pending && actorRank < roleRank.lead) return false;
            return actorRank > oldRank && newRank <= actorRank;
        }
        return actorRole === 'admin';
    });
}
