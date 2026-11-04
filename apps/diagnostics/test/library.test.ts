// Library items: matching a template's signals in a log, cleaning items as
// they're kept, the starters, syncing with the team, and energy pies.

import assert from 'node:assert/strict';
import { matchKey, searchMatches, sharedTail, suggestKeys } from '@shared/signal-match';
import { cleanLibraryItem } from '@shared/library-check';
import { planSync } from '@shared/library-sync';
import { starterLibrary } from '@shared/starters';
import { templateKeys, type LibraryItem } from '@shared/library';
import { integrateProduct } from '@shared/signals';

// --- Matching ---
const robot = ['/Robot/SystemStats/BatteryVoltage', '/Robot/drive/speedXMPS', '/Robot/shooter/state', '/Robot/intake/state', 'DS log/Battery voltage'];
// Simulation's /Robot/robot/... finds the robot's /Robot/...
assert.deepEqual(matchKey('/Robot/robot/drive/speedXMPS', robot), { key: '/Robot/drive/speedXMPS', how: 'suffix', flagged: false, ambiguous: [] });
assert.equal(matchKey('/Robot/SystemStats/BatteryVoltage', robot).how, 'exact');
// One shared part isn't enough for a two-part name ("state" is everywhere)...
assert.equal(matchKey('/Robot/robot/superstructure/state', robot).key, null);
// ...and two equally good fits are neither.
assert.deepEqual(matchKey('state', robot).ambiguous.sort(), ['/Robot/intake/state', '/Robot/shooter/state']);
// A one-part name matches a single fit.
assert.equal(matchKey('speedXMPS', robot).key, '/Robot/drive/speedXMPS');
// A mapping wins, and can flag a signal as missing.
assert.deepEqual(matchKey('/Robot/robot/shooter/velocity', robot, { '/Robot/robot/shooter/velocity': '/Robot/shooter/state' }).how, 'mapped');
assert.deepEqual(matchKey('/Robot/SystemStats/BatteryVoltage', robot, { '/Robot/SystemStats/BatteryVoltage': null }), { key: null, how: null, flagged: true, ambiguous: [] });
// A mapping to a signal this log hasn't falls back to the name.
assert.equal(matchKey('/Robot/SystemStats/BatteryVoltage', robot, { '/Robot/SystemStats/BatteryVoltage': '/gone' }).how, 'exact');
assert.equal(sharedTail('/A/b/C', 'x/B/c'), 2);
// Suggestions: the path end counts most, then words.
const other = [{ key: '/Robot/Power/BatteryVolts', unit: 'V' }, { key: '/Robot/Power/BatteryAmps', unit: 'A' }, { key: '/Robot/Drive/Vx' }];
assert.equal(suggestKeys('/Robot/SystemStats/BatteryVoltage', other, { unit: 'V' })[0].key, '/Robot/Power/BatteryVolts');
assert.equal(searchMatches('battery voltage', 'Pit', ['/Robot/robot/SystemStats/BatteryVoltage']), true);
assert.equal(searchMatches('shooter', 'Pit', ['/Robot/SystemStats/BatteryVoltage']), false);

// --- Items as kept ---
assert.equal(cleanLibraryItem({ id: 'not a uuid!', kind: 'view' }), null);
assert.equal(cleanLibraryItem({ id: '5f0c2a10-0001-4000-8000-000000000099', kind: 'mapping', fields: {} }), null, 'a mapping needs a robot');
const messy = cleanLibraryItem({
  id: '5f0c2a10-0001-4000-8000-000000000099', kind: 'template', name: '  ', extra: 'dropped',
  scope: { type: 'conditions', conditions: [{ key: 'isTestEnabled' }, { nope: 1 }] },
  sections: [{ type: 'chart', view: { axes: [{ id: 'a', side: 'left' }], traces: [{ key: 'x', axis: 'a', color: 99 }, { key: 'y', axis: 'missing' }] } }, { type: 'bogus' }]
})!;
assert.equal(messy.name, 'Untitled');
assert.equal('extra' in messy, false);
assert.equal(messy.kind === 'template' && messy.scope.type === 'conditions' && messy.scope.conditions.length, 1);
assert.equal(messy.kind === 'template' && messy.sections.length, 1);
const chart = messy.kind === 'template' && messy.sections[0].type === 'chart' ? messy.sections[0] : null;
assert.equal(chart!.view.traces.length, 1, 'a trace on an axis that isn\'t there goes');
assert.equal(chart!.view.traces[0].color, 0, 'a colour out of range is the first');

// --- Starters: every one is kept as it is, and their templates' charts come from their views ---
const starters = starterLibrary();
assert.equal(new Set(starters.map((s) => s.id)).size, starters.length);
for (const item of starters) assert.deepEqual(cleanLibraryItem(item), item, item.name);
const viewIds = new Set(starters.filter((s) => s.kind === 'view').map((s) => s.id));
for (const t of starters) {
  if (t.kind !== 'template') continue;
  for (const s of t.sections) if (s.type === 'chart') assert.ok(s.viewId && viewIds.has(s.viewId), `${t.name}: ${s.title}`);
  assert.ok(templateKeys(t.sections, t.scope).length > 0, t.name);
}
const pipeline = starters.find((s) => s.kind === 'pipeline')!;
assert.equal(pipeline.kind === 'pipeline' && pipeline.enabled, false, 'the starter pipeline starts off');

// --- Syncing ---
const at = (n: number) => `2026-11-01T00:00:0${n}.000Z`;
const item = (id: string, changed: number, synced: number | null): LibraryItem => ({
  ...starters[0], id: `5f0c2a10-0009-4000-8000-00000000000${id}`, name: id, changed: at(changed),
  cloud: synced === null ? null : { syncedAt: at(synced), changedAtSync: at(synced) }
} as LibraryItem);
const ids = (list: LibraryItem[]) => list.map((i) => i.name).sort();
const plan = planSync(
  [item('1', 1, null), item('2', 1, 1), item('3', 5, 1), item('4', 1, 1), item('5', 6, 1), item('6', 4, 1)],
  [item('2', 1, null), item('3', 1, null), item('4', 3, null), item('5', 4, null), item('6', 7, null), item('7', 2, null)],
  true
);
// 1: new here, sent. 2: unchanged both, nothing. 3: changed here, sent. 4: changed there, brought.
// 5: changed both, here last: sent. 6: changed both, there last: brought. 7: new there: brought.
assert.deepEqual(ids(plan.send), ['1', '3', '5']);
assert.deepEqual(ids(plan.bring), ['4', '6', '7']);
assert.deepEqual(plan.remove, []);
// Synced before and gone from the cloud: deleted there by a lead, so here too.
assert.deepEqual(ids(planSync([item('8', 1, 1)], [], true).remove), ['8']);
// An observer can't send: their new items stay here, unsent.
assert.deepEqual(planSync([item('1', 1, null), item('3', 5, 1)], [item('3', 1, null)], false), { bring: [], send: [], remove: [] });
// Pie sections: slices kept with their names and signals; junk dropped.
const pie = cleanLibraryItem({ id: '5f0c2a10-0001-4000-8000-0000000000aa', kind: 'template', name: 'Power', scope: { type: 'match' },
  sections: [{ type: 'pie', title: 'By motor', slices: [{ label: 'Drive', keys: ['/a/supplyCurrent', 3, '/b/supplyCurrent'] }, 'junk', { keys: ['/c'] }] }] });
assert.deepEqual(pie && pie.kind === 'template' && pie.sections, [{ type: 'pie', title: 'By motor', measure: 'charge', voltage: '', slices: [{ label: 'Drive', keys: ['/a/supplyCurrent', '/b/supplyCurrent'] }, { label: '', keys: ['/c'] }] }]);
assert.deepEqual(pie && pie.kind === 'template' && templateKeys(pie.sections), ['/a/supplyCurrent', '/b/supplyCurrent', '/c']);
// Energy pies keep their voltage, which a template asks for too.
const energy = cleanLibraryItem({ id: '5f0c2a10-0001-4000-8000-0000000000ab', kind: 'template', name: 'E', scope: { type: 'match' },
  sections: [{ type: 'pie', title: 'E', measure: 'energy', voltage: '/v', slices: [{ label: 'a', keys: ['/a'] }] }, { type: 'pie', title: 'F', measure: 'joules', slices: [] }] });
assert.deepEqual(energy && energy.kind === 'template' && energy.sections.map((s) => s.type === 'pie' && [s.measure, s.voltage]), [['energy', '/v'], ['charge', '']]);
assert.deepEqual(energy && energy.kind === 'template' && templateKeys(energy.sections), ['/a', '/v']);
// The starters' Hoot pies ask for each Talon by the end of its name.
const power = starters.find((s) => s.name === 'Power Analysis')!;
assert.ok(power.kind === 'template' && templateKeys(power.sections).includes('TalonFX-59/SupplyCurrent'));

// Energy: a(t) b(t), each held until its next value, over [start, end].
// 2 A from 0 s, 4 A from 1 s; 10 V from 0.5 s, 12 V from 2 s; over 0-3 s:
// nothing until both have a value (0.5 s), then 2*10*0.5 + 4*10*1 + 4*12*1.
assert.equal(integrateProduct([0, 1], [2, 4], [0.5, 2], [10, 12], 0, 3), 10 + 40 + 48);
// A value from before the start holds into it.
assert.equal(integrateProduct([-5], [3], [-1], [12], 0, 2), 72);
assert.equal(integrateProduct([], [], [0], [12], 0, 2), 0);
