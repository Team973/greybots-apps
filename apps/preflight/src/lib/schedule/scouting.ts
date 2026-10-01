import { supabase } from '@greybots/common/supabase/client';
import { db, getMeta, setMeta } from '@/lib/db';
import { scheduleTable } from './schedule-repo';
import type { ScheduleItem } from './types';

// Match completion from GreyScout (issue #80): once a match has scouting
// data, it has been played. This usually arrives before TBA posts the result
// (and works at events TBA doesn't track closely), so it's a second source
// for a match's completion time.
//
// Each device reads GreyScout's MatchData table itself whenever it syncs and
// keeps the answer locally, so nothing here needs a lead's device or a
// Preflight table. Scouting covers qualification matches, which GreyScout
// identifies by match number.

const matchDataTable = 'MatchData';

// Match number -> when the first scouting entry for it was submitted (ISO).
export type ScoutingCompletion = Record<string, string>;

function completionKey(eventKey: string) {
    return `scouting_completion:${eventKey}`;
}

export async function getScoutingCompletion(eventKey: string): Promise<ScoutingCompletion> {
    return (await getMeta<ScoutingCompletion>(completionKey(eventKey))) ?? {};
}

// Our qualification matches at the event that don't have a result from TBA
// yet: the only ones scouting data can tell us anything new about.
async function pendingQualNumbers(eventKey: string): Promise<number[]> {
    const items = await db.syncedTable<ScheduleItem>(scheduleTable).where('event_key').equals(eventKey).toArray();
    return items
        .filter((i) => !i.deleted && i.kind === 'match' && i.match_info?.comp_level === 'qm' && !i.match_info.result_time)
        .map((i) => i.match_info!.match_number);
}

// Ask GreyScout which of our matches have scouting data. Needs internet and a
// Supabase session; called after each sync. Returns true if anything changed.
export async function refreshScoutingCompletion(eventKey: string): Promise<boolean> {
    const numbers = await pendingQualNumbers(eventKey);
    if (!numbers.length) return false;

    const { data, error } = await supabase
        .from(matchDataTable)
        .select('prematch_match_number, created_at')
        .eq('event', eventKey)
        .in('prematch_match_number', numbers)
        .order('created_at', { ascending: true });
    if (error) throw new Error(`Reading scouting data failed: ${error.message}`);

    const current = await getScoutingCompletion(eventKey);
    const next: ScoutingCompletion = { ...current };
    for (const row of (data ?? []) as { prematch_match_number: number; created_at: string }[]) {
        // Rows come oldest first, so the first one seen per match is kept.
        const key = String(row.prematch_match_number);
        if (!next[key]) next[key] = row.created_at;
    }
    if (JSON.stringify(next) === JSON.stringify(current)) return false;
    await setMeta(completionKey(eventKey), next);
    return true;
}
