import { supabase } from '@greybots/common/supabase/client';
import { deleteMeta, getMeta, setMeta } from '@/lib/db';
import { saveSetting } from '@/lib/settings';
import { eventWipesKey, getEventWipes, purgeEventLocally, type EventWipes } from '@/lib/sync/wipes';
import { useSyncStore } from '@/stores/sync-store';

// Wiping an event (admins, issue #110): once the report and the data export
// have been pulled, the event's data is removed for good, from the server and
// from every device. Batteries, shared settings, and the pit timer belong to
// the team and are kept.

// When this device last downloaded the event's data. A wipe is only offered
// after a download that's newer than the event's last change.
const exportKey = (eventKey: string) => `report_export:${eventKey}`;

export const getLastExport = async (eventKey: string): Promise<string | null> => (await getMeta<string>(exportKey(eventKey))) ?? null;
export const recordExport = (eventKey: string, at: string) => setMeta(exportKey(eventKey), at);

async function syncFully(): Promise<void> {
    const sync = useSyncStore();
    // syncNow() does nothing while a sync is already running: let it finish.
    for (let i = 0; sync.syncing && i < 300; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    await sync.syncNow();
    if (sync.lastError) throw new Error(`Sync failed: ${sync.lastError}`);
    if (sync.reachable === false) throw new Error("Can't reach the server.");
}

export async function wipeEvent(eventKey: string, editor: string | null): Promise<void> {
    const sync = useSyncStore();
    if (!navigator.onLine) throw new Error('Wiping needs a connection: the data is removed from the server.');
    if (!sync.hasServerSession) throw new Error("This device isn't signed in to the server, so it can't wipe the data there.");

    // Everything this device has goes up first, so nothing is pushed back
    // after the wipe.
    await syncFully();
    if (sync.pendingCount > 0) throw new Error('Some changes on this device are still waiting to sync. Try again in a moment.');

    const { error } = await supabase.rpc('preflight_wipe_event', { p_event_key: eventKey });
    if (error) {
        if (error.code === 'PGRST202') throw new Error("The database isn't set up for wiping events yet (the migration hasn't been applied).");
        throw new Error(error.message);
    }

    // Tell the other devices, then drop this one's copy.
    const wipedAt = new Date().toISOString();
    const wipes: EventWipes = { ...(await getEventWipes()), [eventKey]: wipedAt };
    await saveSetting<EventWipes>(eventWipesKey, wipes, editor);
    await purgeEventLocally(eventKey, wipedAt);
    await deleteMeta(exportKey(eventKey));
    await sync.syncNow();
}
