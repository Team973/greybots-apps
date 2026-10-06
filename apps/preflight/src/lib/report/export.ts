import { toCsv, type CsvRow } from './csv';
import type { EventData } from './event-data';
import type { EventReport } from './event-report';
import { buildZip, type ZipFile } from './zip';

// The event's data as a package of CSV files, zipped (issue #110): one file
// per table as it's stored, plus two worked out for the report (the
// turnarounds and the as-run log).

const rows = <T extends object>(list: T[]) => list as unknown as CsvRow[];

export function exportFileName(data: EventData, at: Date): string {
    const stamp = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}-${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}`;
    return `preflight-${data.event.event_key}-${stamp}.zip`;
}

export function buildEventExport(data: EventData, report: EventReport, at = new Date()): Blob {
    const tables: { name: string; what: string; rows: CsvRow[] }[] = [
        { name: 'event.csv', what: 'The event these files are for.', rows: rows([data.event]) },
        {
            name: 'schedule.csv',
            what: 'Matches (with their estimated times), calendar entries, and timeline milestones.',
            rows: rows(data.items)
        },
        { name: 'robot_status_log.csv', what: 'Every change of the robot status, i.e. the pit flow.', rows: rows(data.history) },
        { name: 'checklist_checks.csv', what: 'Every checklist step checked off: who, when, and what it recorded.', rows: rows(data.checks) },
        { name: 'checklist_runs.csv', what: 'Runs of the checklists started by hand, each with the checklist as it was.', rows: rows(data.runs) },
        { name: 'tasks.csv', what: 'Tasks.', rows: rows(data.tasks) },
        { name: 'repairs.csv', what: 'The repair and maintenance log.', rows: rows(data.repairs) },
        { name: 'notes.csv', what: 'Pit notes.', rows: rows(data.notes) },
        { name: 'batteries.csv', what: 'The battery registry (every battery, not just this event).', rows: rows(data.batteries) },
        { name: 'battery_uses.csv', what: 'Batteries put in the robot at this event.', rows: rows(data.uses) },
        { name: 'battery_measurements.csv', what: "Battery measurements taken on the event's days.", rows: rows(data.measurements) },
        { name: 'settings.csv', what: 'Shared settings as they stood: pit roles, checklists, match timing, and so on.', rows: rows(data.settings) },
        {
            name: 'turnarounds.csv',
            what: 'Worked out for the report: each pit visit and its time per stage, in milliseconds.',
            rows: report.stats.turnarounds.map((t) => ({
                match: t.matchTitle,
                started_at: t.startedAt,
                ready_at: t.readyAt,
                post_match_ms: t.post,
                repair_ms: t.repair,
                pre_match_ms: t.pre,
                total_ms: t.total,
                without_repairs_ms: t.withoutRepairs
            }))
        },
        {
            name: 'as_run_log.csv',
            what: 'Worked out for the report: everything that happened in the pit, in order.',
            rows: report.log.map((entry) => ({ at: entry.at, kind: entry.kind, what: entry.text, detail: entry.detail, by: entry.by }))
        }
    ];

    const files: ZipFile[] = [];
    const readme = [
        `Preflight data for ${data.event.name} (${data.event.event_key}), team ${data.event.team_number}.`,
        `Exported ${at.toISOString()}.`,
        '',
        'Times are UTC (ISO 8601). Columns holding more than one value (a match’s teams, a checklist) are JSON.',
        ''
    ];
    for (const table of tables) {
        // A table with nothing in it has no columns to write.
        if (table.rows.length) files.push({ name: table.name, content: toCsv(table.rows) });
        readme.push(`${table.name}: ${table.what}${table.rows.length ? ` ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}.` : ' Nothing recorded, so there is no file.'}`);
    }
    files.unshift({ name: 'README.txt', content: readme.join('\r\n') + '\r\n' });
    return buildZip(files, at);
}
