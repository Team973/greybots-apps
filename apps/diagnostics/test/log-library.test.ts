// The log picker's filter, what deleting a log removes, and when a log was
// recorded when its name's time can't be trusted.

import assert from 'node:assert/strict';
import type { SignalLogFile } from '@shared/ipc';
import { eventsIn, filesToDelete, filterLogs, noLogFilter } from '@shared/log-filter';
import { trustedTime, type MatchInfo } from '@shared/offload';

function log(id: string, match: MatchInfo | null, extra: Partial<SignalLogFile> = {}): SignalLogFile {
  return { id, localPath: id, name: id, robot: 'frc973', size: 1, recorded: '2026-11-07T00:00:00.000Z', match, hoots: [], dsLogs: [], ...extra };
}

const q12 = log('q12.wpilog', { event: 'mttd', type: 'qualification', number: 12 });
const p5 = log('p5.wpilog', { event: 'MTTD', type: 'practice', number: 5 });
const caven = log('e3.wpilog', { event: 'CAVEN', type: 'elimination', number: 3 });
const pit = log('pit.wpilog', null);
const all = [q12, p5, caven, pit];

// --- Filter ---
assert.deepEqual(filterLogs(all, noLogFilter), all);
// Real matches: any match FMS named, practice included.
assert.deepEqual(filterLogs(all, { event: null, realMatches: true }), [q12, p5, caven]);
// Events match whatever the case.
assert.deepEqual(filterLogs(all, { event: 'MTTD', realMatches: false }), [q12, p5]);
assert.deepEqual(filterLogs(all, { event: 'mttd', realMatches: true }), [q12, p5]);
assert.deepEqual(filterLogs(all, { event: 'NOPE', realMatches: false }), []);
// Each event once, upper-cased, in order.
assert.deepEqual(eventsIn(all), ['CAVEN', 'MTTD']);
assert.deepEqual(eventsIn([pit]), []);

// --- What deleting removes ---
const ds = (path: string, events: boolean) => ({ localPath: path, eventsPath: events ? path.replace('.dslog', '.dsevents') : null, name: path, label: 'DS log', size: 1 });
const hoot = (path: string) => ({ localPath: path, name: path, bus: 'rio', label: 'Hoot rio', size: 1 });
const shared = ds('a.dslog', true);
const one = log('one.wpilog', null, { hoots: [hoot('one_rio.hoot'), hoot('one_can.hoot')], dsLogs: [shared, ds('b.dslog', false)] });
const two = log('two.wpilog', null, { dsLogs: [shared] });
const { remove, kept } = filesToDelete(one, [one, two]);
assert.deepEqual(remove, ['one.wpilog', 'one_rio.hoot', 'one_can.hoot', 'b.dslog']);
// The Driver Station log the other log also has stays, with its events file.
assert.deepEqual(kept, ['a.dslog', 'a.dsevents']);
// On its own, everything goes.
assert.deepEqual(filesToDelete(one, [one]).remove, ['one.wpilog', 'one_rio.hoot', 'one_can.hoot', 'a.dslog', 'a.dsevents', 'b.dslog']);
// A Driver Station log on its own (no data log).
const dsOnly = log('c.dslog', null, { localPath: null, dsLogs: [ds('c.dslog', true)] });
assert.deepEqual(filesToDelete(dsOnly, [dsOnly, one]).remove, ['c.dslog', 'c.dsevents']);

// --- When it was recorded ---
const named = new Date('2026-11-07T03:08:40Z');
const onRobot = new Date('2026-11-07T03:12:00Z');
const pulled = new Date('2026-11-08T10:00:00Z');
// The name's time, when the robot's time agrees with it.
assert.equal(trustedTime(named, onRobot, pulled), named);
// A name from the robot's unset clock: the robot's time for the file.
const unset = new Date('2024-12-18T14:02:28Z');
const october = new Date('2026-10-18T23:42:46Z');
assert.equal(trustedTime(unset, october, pulled), october);
// No time on the robot known: the name's, else the file's own.
assert.equal(trustedTime(named, null, pulled), named);
assert.equal(trustedTime(null, null, pulled), pulled);
assert.equal(trustedTime(null, onRobot, pulled), onRobot);
