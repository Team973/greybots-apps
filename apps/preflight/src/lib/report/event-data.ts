import { listBatteries, listBatteryUses, listMeasurements, type Battery, type BatteryMeasurement, type BatteryUse } from '@/lib/batteries/batteries';
import { listAllChecks, type ChecklistCheck } from '@/lib/checklists/checks';
import { getChecklistSequence, type ChecklistSequence } from '@/lib/checklists/config';
import { listChecklistRuns, type ChecklistRun } from '@/lib/checklists/runs';
import { db } from '@/lib/db';
import { listNotes, type Note } from '@/lib/notes/notes';
import { listRepairs, type Repair } from '@/lib/repairs/repairs';
import { listStatusHistory, type RobotStatusEntry } from '@/lib/robot-status/robot-status';
import { addDays, parseLocalDate } from '@/lib/schedule/dates';
import { listScheduleItems } from '@/lib/schedule/schedule-repo';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';
import { settingsTable, type Setting } from '@/lib/settings';
import { listTasks, type Task } from '@/lib/tasks/tasks';

// Everything Preflight holds about one event, as it is on this device right
// now. The report, the data export, and the wipe all start from this.
export interface EventData {
    event: ActiveEvent;
    items: ScheduleItem[];
    // Newest first.
    history: RobotStatusEntry[];
    checks: ChecklistCheck[];
    runs: ChecklistRun[];
    tasks: Task[];
    repairs: Repair[];
    notes: Note[];
    sequence: ChecklistSequence;
    // Batteries belong to the team, so the registry is all of them; uses and
    // measurements are the ones from this event.
    batteries: Battery[];
    uses: BatteryUse[];
    measurements: BatteryMeasurement[];
    // The shared settings (pit roles, checklists, timing…) as they stand.
    settings: Setting[];
}

// Only awaits database calls, so it can run inside a live query.
export async function loadEventData(event: ActiveEvent): Promise<EventData> {
    const key = event.event_key;
    // Measurements aren't tied to an event: take the ones made on its days.
    const from = parseLocalDate(event.start_date).getTime();
    const to = parseLocalDate(addDays(event.end_date, 1)).getTime();
    const during = (iso: string) => Date.parse(iso) >= from && Date.parse(iso) < to;

    return {
        event,
        items: await listScheduleItems(key),
        history: await listStatusHistory(key),
        checks: await listAllChecks(key),
        runs: await listChecklistRuns(key),
        tasks: await listTasks(key),
        repairs: await listRepairs(key),
        notes: await listNotes(key),
        sequence: await getChecklistSequence(),
        batteries: await listBatteries(),
        uses: (await listBatteryUses()).filter((use) => use.event_key === key),
        measurements: (await listMeasurements()).filter((m) => during(m.measured_at)),
        settings: await db.syncedTable<Setting>(settingsTable).filter((row) => !row.deleted).toArray()
    };
}

// How many records the event has (what a wipe removes).
export function eventRecordCount(data: EventData): number {
    return data.items.length + data.history.length + data.checks.length + data.runs.length + data.tasks.length + data.repairs.length + data.notes.length;
}

// When the event's data last changed, or null when there's none.
export function lastEventChange(data: EventData): string | null {
    const rows = [...data.items, ...data.history, ...data.checks, ...data.runs, ...data.tasks, ...data.repairs, ...data.notes];
    const latest = Math.max(0, ...rows.map((row) => Date.parse(row.updated_at)));
    return latest ? new Date(latest).toISOString() : null;
}
