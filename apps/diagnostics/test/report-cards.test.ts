// The Reports page's cards: reports grouped by log, problems counted once
// per log, and the filters (only logs with reports by default).

import assert from 'node:assert/strict';
import type { SignalLogFile } from '@shared/ipc';
import { reportSummary, type Report, type ReportSummary } from '@shared/library';
import type { MatchInfo } from '@shared/offload';
import { defaultCardFilter, filterCards, logCards } from '@shared/report-cards';

function log(id: string, match: MatchInfo | null, recorded: string): SignalLogFile {
  return { id, localPath: id, name: id, robot: 'frc973', size: 1, recorded, match, hoots: [], dsLogs: [] };
}

function report(id: string, logId: string, generated: string, problems: ReportSummary['problems'], missing = 0, name = 'Match Review'): ReportSummary {
  return { id, name: `${name} · ${logId} label`, templateName: name, generated, by: 'Jo', templateId: 't', logId, logLabel: `${logId} label`, robot: 'frc973', match: null, missing, problems };
}

const q12 = log('q12.wpilog', { event: 'mttd', type: 'qualification', number: 12 }, '2026-11-07T20:00:00Z');
const p5 = log('p5.wpilog', { event: 'MTTD', type: 'practice', number: 5 }, '2026-11-07T03:09:00Z');
const pit = log('pit.wpilog', null, '2026-11-06T22:00:00Z');
const caven = log('e3.wpilog', { event: 'CAVEN1', type: 'elimination', number: 3 }, '2026-10-18T23:00:00Z');
const logs = [q12, p5, pit, caven];

const brownout = { id: 'b1', severity: 'error' as const, title: 'Brownout' };
const limit = { id: 'w1', severity: 'warning' as const, title: 'TalonFX-59: supply current limit' };
const reports = [
  report('r1', 'q12.wpilog', '2026-11-07T21:00:00Z', [brownout, limit]),
  // The same brownout found by another report of the same log.
  report('r2', 'q12.wpilog', '2026-11-07T21:05:00Z', [brownout], 3, 'Power Analysis'),
  report('r3', 'pit.wpilog', '2026-11-06T23:00:00Z', []),
  // A report whose log was deleted.
  report('r4', 'gone.wpilog', '2026-11-01T10:00:00Z', [limit])
];

const cards = logCards(logs, reports);
// One card per log in the logs' order, then the gone log's.
assert.deepEqual(cards.map((c) => c.id), ['q12.wpilog', 'p5.wpilog', 'pit.wpilog', 'e3.wpilog', 'gone.wpilog']);
const q12Card = cards[0];
// Its reports, newest first; the brownout counted once.
assert.deepEqual(q12Card.reports.map((r) => r.id), ['r2', 'r1']);
assert.deepEqual(q12Card.errors.map((p) => p.title), ['Brownout']);
assert.deepEqual(q12Card.warnings.map((p) => p.id), ['w1']);
assert.equal(q12Card.missing, 3);
assert.equal(q12Card.title, 'mttd Q12');
// A log with no reports, and one that's gone (titled from its reports).
assert.equal(cards[1].reports.length, 0);
const gone = cards[4];
assert.equal(gone.log, null);
assert.equal(gone.title, 'gone.wpilog label');
assert.equal(gone.warnings.length, 1);

// --- Filters ---
const ids = (filter: Partial<typeof defaultCardFilter>) => filterCards(cards, { ...defaultCardFilter, ...filter }).map((c) => c.id);
// By default, only logs with reports.
assert.deepEqual(ids({}), ['q12.wpilog', 'pit.wpilog', 'gone.wpilog']);
assert.deepEqual(ids({ analyzedOnly: false }), ['q12.wpilog', 'p5.wpilog', 'pit.wpilog', 'e3.wpilog', 'gone.wpilog']);
// Real matches: any match FMS named.
assert.deepEqual(ids({ analyzedOnly: false, realMatches: true }), ['q12.wpilog', 'p5.wpilog', 'e3.wpilog']);
// An event, whatever its case.
assert.deepEqual(ids({ analyzedOnly: false, event: 'MTTD' }), ['q12.wpilog', 'p5.wpilog']);
assert.deepEqual(ids({ event: 'caven1' }), []);
// Search: the log's title, and its reports' names.
assert.deepEqual(ids({ query: 'power' }), ['q12.wpilog']);
assert.deepEqual(ids({ analyzedOnly: false, query: 'e3' }), ['e3.wpilog']);

// --- A report's summary keeps its errors and warnings, not information ---
const full = {
  id: 'r', name: 'n', generated: 'g', by: 'b', templateId: 't', template: {} as Report['template'], logId: 'l', logLabel: 'L', robot: 'frc973',
  match: null, spans: [], phases: [], sections: [], missing: ['a', 'b'],
  problems: [
    { id: 'e', kind: 'fault', severity: 'error', start: 1, end: null, title: 'Fault', detail: '', count: 1, key: null },
    { id: 'i', kind: 'mode', severity: 'info', start: 2, end: null, title: 'Enabled', detail: '', count: 1, key: null }
  ]
} as unknown as Report;
const summary = reportSummary({ ...full, name: 'Autonomous · mttd P5, Nov 6, 7:09 PM', template: { name: 'Autonomous' } as Report['template'] });
assert.equal(summary.missing, 2);
// The card shows just the template's name: the card says which log.
assert.equal(summary.templateName, 'Autonomous');
assert.deepEqual(summary.problems, [{ id: 'e', severity: 'error', title: 'Fault' }]);
// Reports made before problems were kept have none.
assert.deepEqual(reportSummary({ ...full, problems: undefined }).problems, []);
