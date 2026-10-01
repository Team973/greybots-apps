import { computed } from 'vue';
import { supabase } from '@greybots/common/supabase/client';
import { getMeta, setMeta } from '@/lib/db';
import { listKioskUsers } from '@/lib/kiosk-users';
import { useLiveQuery } from '@/lib/live-query';
import { useSessionStore } from '@/stores/session-store';

// Who work can be assigned to. Assignees are picked from a list, never typed:
// - everyone with a greybots-apps account (the shared `User` table), saved on
//   the device whenever it's online with a server session, so the list keeps
//   working offline afterwards; and
// - this device's kiosk crew, i.e. the people actually in the pit. A kiosk
//   that has never been online offers only them.

const userTable = 'User';
const directoryKey = 'account_directory';
// The directory rarely changes; no need to fetch it on every sync.
const refreshEveryMs = 10 * 60_000;

interface AccountDirectory {
    names: string[];
    fetched_at: string;
}

async function getAccountDirectory(): Promise<AccountDirectory | null> {
    return (await getMeta<AccountDirectory>(directoryKey)) ?? null;
}

// Save the names of everyone with an account. Needs internet and a Supabase
// session (the web user's own, or a kiosk's linked account); called after
// each sync, so a device picks the directory up as soon as it can.
export async function refreshAccountDirectory(force = false): Promise<void> {
    const saved = await getAccountDirectory();
    if (!force && saved && Date.now() - Date.parse(saved.fetched_at) < refreshEveryMs) return;

    const { data, error } = await supabase.from(userTable).select('name');
    if (error) throw new Error(`Reading the account directory failed: ${error.message}`);
    const names = [...new Set(((data ?? []) as { name: string | null }[]).map((u) => u.name?.trim() ?? '').filter(Boolean))];
    await setMeta<AccountDirectory>(directoryKey, { names, fetched_at: new Date().toISOString() });
}

// The names to offer in a person picker, sorted.
export function usePeople() {
    const session = useSessionStore();
    const directory = useLiveQuery<AccountDirectory | null>(getAccountDirectory, null);
    const crew = useLiveQuery(listKioskUsers, []);
    return computed(() => {
        const names = new Map<string, string>();
        const add = (name: string | null | undefined) => {
            const trimmed = name?.trim();
            if (trimmed && !names.has(trimmed.toLowerCase())) names.set(trimmed.toLowerCase(), trimmed);
        };
        for (const name of directory.value?.names ?? []) add(name);
        for (const user of crew.value) add(user.name);
        // Whoever is using the device is always assignable (e.g. "Assign to me").
        add(session.user?.name);
        return [...names.values()].sort((a, b) => a.localeCompare(b));
    });
}
