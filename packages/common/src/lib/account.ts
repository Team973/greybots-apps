import type { User } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';
import type { UserAccount } from './user-roles';

// Registering and provisioning accounts, shared by every greybots app. One
// account works in all of them; a new one is "pending" everywhere until a
// lead or admin gives it a role (see user-roles.ts).

const userTable = 'User';

// What's in a form's fields right now, by field name. The sign-in and
// registration forms read their values this way when they're submitted,
// instead of trusting what input events told them: autofill and password
// managers can fill a field without firing one.
export function readFormValues(form: HTMLFormElement): Record<string, string> {
    const values: Record<string, string> = {};
    for (const element of Array.from(form.elements)) {
        if (element instanceof HTMLInputElement && element.name) values[element.name] = element.value;
    }
    return values;
}

export interface Registration {
    name: string;
    email: string;
    password: string;
    // Where the confirmation email's link lands (the app's own login page).
    emailRedirectTo: string;
}

export interface RegistrationResult {
    // False when the person has to confirm their email before signing in.
    signedIn: boolean;
}

// Create an account. If the project confirms emails, the person gets a link
// and signs in afterwards; otherwise they're signed in right away.
export async function registerAccount(registration: Registration): Promise<RegistrationResult> {
    const { data, error } = await supabase.auth.signUp({
        email: registration.email.trim(),
        password: registration.password,
        options: { data: { name: registration.name.trim() }, emailRedirectTo: registration.emailRedirectTo }
    });
    if (error) throw new Error(error.message);
    if (data.session && data.user) {
        await ensureUserProfile(data.user);
        return { signedIn: true };
    }
    return { signedIn: false };
}

// The signed-in person's profile row, created the first time they're seen
// (it can't be created at sign-up while the email is still unconfirmed,
// since there's no session yet). Null if it can't be read or created.
//
// The row is inserted without roles: the database makes every new account
// pending.
export async function ensureUserProfile(user: User): Promise<UserAccount | null> {
    const { data, error } = await supabase.from(userTable).select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as UserAccount;

    const name = (user.user_metadata?.name as string | undefined)?.trim() || null;
    const { data: inserted } = await supabase.from(userTable).insert({ user_id: user.id, name }).select().maybeSingle();
    return (inserted as UserAccount | null) ?? null;
}
