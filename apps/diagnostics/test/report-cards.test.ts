// The Reports page's cards: reports grouped by log, problems counted once
// per log, and the filters (only logs with reports by default).

import assert from 'node:assert/strict';
import type { SignalLogFile } from '@shared/ipc';
import { reportSummary, type Report, type ReportSummary } from '@shared/library';
import type { MatchInfo } from '@shared/offload';
import { isReport, reportFileNames } from '@shared/report-files';
import { defaultCardFilter, duplicateReports, filterCards, logCards, missingTemplates } from '@shared/report-cards';

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

// --- What a log is missing ---
const templates = [
  { id: 't', name: 'Match Review', robot: null },
  { id: 'auto', name: 'Autonomous', robot: null },
  { id: 'b-only', name: 'B robot', robot: 'frc973B' },
  { id: 'ours', name: 'Ours', robot: 'frc973' }
];
// Q12 has reports from template t: the rest that apply to its robot.
assert.deepEqual(missingTemplates(q12Card, templates).map((t) => t.id), ['auto', 'ours']);
// No reports: every one that applies.
assert.deepEqual(missingTemplates(cards[1], templates).map((t) => t.id), ['t', 'auto', 'ours']);
// A log that's gone can't have reports made.
assert.deepEqual(missingTemplates(gone, templates), []);

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

// --- Duplicates: only the newest report from each template for each log ---
{
  const a1 = report('a1', 'q12.wpilog', '2026-11-07T21:00:00Z', []);
  const a2 = report('a2', 'q12.wpilog', '2026-11-07T22:00:00Z', []);
  const other = { ...report('b1', 'q12.wpilog', '2026-11-07T20:00:00Z', []), templateId: 'power' };
  const elsewhere = report('c1', 'p5.wpilog', '2026-11-07T19:00:00Z', []);
  assert.deepEqual(duplicateReports([a1, other, a2, elsewhere]).map((r) => r.id), ['a1']);
  assert.deepEqual(duplicateReports([a2, a1]).map((r) => r.id), ['a1']);
  assert.deepEqual(duplicateReports([other, elsewhere]), []);
}

// --- Exported file names, and telling a report file from anything else ---
{
  const template = { name: 'Match Review', sections: [] } as unknown as Report['template'];
  const one = { id: 'r1', name: 'Match Review · mttd Q12', logLabel: 'q12', match: { event: 'mttd', type: 'qualification' as const, number: 12 }, template };
  const again = { ...one, id: 'r2' };
  const odd = { id: 'r3', name: 'x', logLabel: 'Nov 6, 7:09 PM (FRC_1.wpilog)', match: null, template: { ...template, name: 'A/B: "C"?' } };
  const names = reportFileNames([one, again, odd]);
  assert.equal(names.get('r1'), 'mttd Q12 - Match Review.pdf');
  assert.equal(names.get('r2'), 'mttd Q12 - Match Review (2).pdf');
  // Nothing a file name can't hold.
  assert.equal(names.get('r3'), 'Nov 6, 7_09 PM (FRC_1.wpilog) - A_B_ _C__.pdf');

  const good = {
    id: '5f0c2a10-0009-4000-8000-000000000001', name: 'n', generated: '2026-11-07T21:00:00.000Z', by: 'By hand', templateId: 't',
    template: { name: 'T', sections: [] }, logId: 'l', logLabel: 'L', robot: 'frc973', match: null, spans: [], phases: [], sections: [], missing: []
  };
  assert.equal(isReport(good), true);
  assert.equal(isReport({ ...good, id: '../../escape' }), false);
  assert.equal(isReport({ ...good, sections: 'no' }), false);
  assert.equal(isReport({ ...good, generated: 'whenever' }), false);
  assert.equal(isReport({ ...good, template: null }), false);
  assert.equal(isReport([]), false);
  assert.equal(isReport(null), false);
}
