// The team's library in the cloud (#148): signing in to a greybots-apps
// account, and keeping the data folder's library/ and the team's copy (the
// DiagnosticsLibraryItem table) the same. Reports and notes aren't synced.
//
// How each item's reconciled is library-sync.ts's. Only leads and admins
// delete shared items (the database enforces it too).

import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabasePublicKey, supabaseUrl } from '@greybots/common/supabase/client';
import { roleRank, type AppRole } from '@greybots/common/lib/user-roles';

import type { AccountStatus } from '@shared/account';
import { cleanLibraryItem } from '@shared/library-check';
import { libraryKinds, type LibraryItem, type LibraryKind } from '@shared/library';
import { planSync } from '@shared/library-sync';
import type { Settings } from '@shared/settings';
import { deleteLibraryItem, getLibraryItem, listLibrary, storeLibraryItem } from './library-store';
import { loadSettings } from './settings-store';

const table = 'DiagnosticsLibraryItem';
const syncEveryMs = 5 * 60 * 1000;
const syncAfterChangeMs = 3000;

// --- The session, kept on this computer ---

// Encrypted with the system's keychain where there is one.
const sessionFile = () => join(app.getPath('userData'), 'account.json');
let stored: Record<string, string> | null = null;

async function readStored(): Promise<Record<string, string>> {
  if (stored) return stored;
  try {
    const bytes = await fs.readFile(sessionFile());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(bytes) : bytes.toString('utf-8');
    stored = JSON.parse(text) as Record<string, string>;
  } catch {
    stored = {};
  }
  return stored;
}

async function writeStored() {
  const text = JSON.stringify(stored ?? {});
  const bytes = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf-8');
  await fs.writeFile(`${sessionFile()}.tmp`, bytes);
  await fs.rename(`${sessionFile()}.tmp`, sessionFile());
}

const storage = {
  getItem: async (key: string) => (await readStored())[key] ?? null,
  setItem: async (key: string, value: string) => {
    (await readStored())[key] = value;
    await writeStored();
  },
  removeItem: async (key: string) => {
    delete (await readStored())[key];
    await writeStored();
  }
};

let client: SupabaseClient | null = null;
const cloud = () => (client ??= createClient(supabaseUrl, supabasePublicKey, {
  auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}));

// --- Who's signed in ---

const status: AccountStatus = {
  signedIn: false,
  email: null,
  name: null,
  role: null,
  syncing: false,
  lastSync: null,
  problem: '',
  cloudReady: true
};

export function accountStatus(): AccountStatus {
  return { ...status };
}

export const accountName = () => (status.signedIn ? status.name ?? status.email : null);
const canShare = () => status.signedIn && roleRank[status.role ?? 'pending'] >= roleRank.member;
const canDeleteShared = () => status.signedIn && roleRank[status.role ?? 'pending'] >= roleRank.lead;

// The account's name and Diagnostics role, from its User row. Before the
// Diagnostics migration there's no diagnostics_role: the Preflight role
// stands in, as that's what the migration starts it at.
async function loadProfile(): Promise<void> {
  const { data: sessionData } = await cloud().auth.getSession();
  const user = sessionData.session?.user;
  if (!user) {
    Object.assign(status, { signedIn: false, email: null, name: null, role: null });
    return;
  }
  status.signedIn = true;
  status.email = user.email ?? null;
  const { data, error } = await cloud().from('User').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as { name?: string | null; diagnostics_role?: AppRole; preflight_role?: AppRole; deactivated?: boolean };
  status.name = row.name || status.email;
  status.role = row.deactivated ? 'deactivated' : row.diagnostics_role ?? row.preflight_role ?? 'pending';
}

export async function signIn(email: string, password: string): Promise<AccountStatus> {
  status.problem = '';
  const { error } = await cloud().auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    status.problem = error.message;
    return accountStatus();
  }
  await loadProfile().catch((e: Error) => { status.problem = e.message; });
  await syncLibrary();
  return accountStatus();
}

export async function signOut(): Promise<AccountStatus> {
  // Only this computer's session, so it works offline.
  await cloud().auth.signOut({ scope: 'local' }).catch(() => {});
  Object.assign(status, { signedIn: false, email: null, name: null, role: null, problem: '', lastSync: null });
  return accountStatus();
}

// --- Syncing ---

interface Row {
  id: string;
  kind: LibraryKind;
  name: string;
  robot: string | null;
  body: unknown;
  changed_at: string;
}

const toRow = (item: LibraryItem): Row => ({
  id: item.id,
  kind: item.kind,
  name: item.name,
  robot: item.robot,
  body: { ...item, cloud: null },
  changed_at: item.changed
});

// A missing table means the database hasn't had the Diagnostics migration.
const notSetUp = (message: string) => /DiagnosticsLibraryItem|does not exist|schema cache/i.test(message);

let syncing: Promise<AccountStatus> | null = null;

export function syncLibrary(): Promise<AccountStatus> {
  syncing ??= syncOnce().finally(() => { syncing = null; });
  return syncing;
}

async function syncOnce(): Promise<AccountStatus> {
  if (!status.signedIn) return accountStatus();
  status.syncing = true;
  try {
    const settings = await loadSettings();
    if (roleRank[status.role ?? 'pending'] < roleRank.observer) {
      status.problem = 'Your account has no Diagnostics role yet: a lead or admin gives it one on the People page.';
      return accountStatus();
    }
    const { data, error } = await cloud().from(table).select('id, kind, name, robot, body, changed_at');
    if (error) {
      status.cloudReady = !notSetUp(error.message);
      throw new Error(status.cloudReady ? error.message : "The team's database isn't set up for Diagnostics yet (its migration hasn't been applied).");
    }
    status.cloudReady = true;
    const now = new Date().toISOString();
    const remote = new Map<string, LibraryItem>();
    for (const row of (data ?? []) as Row[]) {
      const item = cleanLibraryItem(row.body);
      if (item && item.id === row.id) remote.set(item.id, item);
    }
    const local: LibraryItem[] = [];
    for (const kind of libraryKinds) local.push(...(await listLibrary(settings, kind)));
    const plan = planSync(local, [...remote.values()], canShare());
    for (const item of plan.remove) await deleteLibraryItem(settings, item.kind, item.id);
    for (const item of plan.bring) await storeLibraryItem(settings, { ...item, cloud: { syncedAt: now, changedAtSync: item.changed } });
    const toSend = plan.send;

    if (toSend.length) {
      const { error: sendError } = await cloud().from(table).upsert(toSend.map(toRow), { onConflict: 'id' });
      if (sendError) throw new Error(sendError.message);
      for (const item of toSend) {
        // Unless it changed again meanwhile.
        const current = await getLibraryItem(settings, item.kind, item.id);
        if (current && current.changed === item.changed) await storeLibraryItem(settings, { ...current, cloud: { syncedAt: now, changedAtSync: item.changed } });
      }
    }
    status.lastSync = now;
    status.problem = '';
  } catch (error) {
    status.problem = (error as Error).message;
  } finally {
    status.syncing = false;
  }
  return accountStatus();
}

// After a change here, soon (several changes, one sync).
let soon: ReturnType<typeof setTimeout> | undefined;
export function syncSoon() {
  if (!status.signedIn) return;
  clearTimeout(soon);
  soon = setTimeout(() => { syncLibrary().catch(() => {}); }, syncAfterChangeMs);
}

// Deleting: a shared item goes from the cloud too, which only a lead or
// admin may do. Resolves to why it can't be deleted, or ''.
export async function deleteItem(settings: Settings, kind: LibraryKind, id: string): Promise<string> {
  const item = await getLibraryItem(settings, kind, id);
  if (item?.cloud) {
    if (!status.signedIn) return 'This is shared with the team: sign in (Settings) to delete it.';
    if (!canDeleteShared()) return 'This is shared with the team, and only leads and admins delete shared items.';
    const { error } = await cloud().from(table).delete().eq('id', id);
    if (error) return error.message;
  }
  await deleteLibraryItem(settings, kind, id);
  return '';
}

// At start: the session kept from last time, a sync, and one every few minutes.
export async function startCloudSync() {
  await loadProfile().catch((error: Error) => { status.problem = error.message; });
  syncLibrary().catch(() => {});
  setInterval(() => { syncLibrary().catch(() => {}); }, syncEveryMs);
}
