// The other plots (#144): poses, pies, panels as kept, robot models, the
// roboRIO console's framing, and whole records from a log and live.

import assert from 'node:assert/strict';
import { cleanModelConfig, cleanPanel, cleanPanels, foldSlices, mapPanelKeys, posesFrom, recordAt, timeInStates, yawOf, newPanel } from '@shared/plots';
import { cleanLibraryItem } from '@shared/library-check';
import { viewKeys } from '@shared/library';
import { FrameReader, parseFrame } from '@main/live/net-console';
import { LogSignalSource } from '@main/signals/log-source';
import { LiveSignalSource } from '@main/live/live-source';
import { poseLog, utf8 } from './wpilog-writer';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

// --- Poses ---
const p2 = posesFrom({ translation: { x: 1, y: 2 }, rotation: { value: Math.PI / 2 } }, 'struct:Pose2d');
assert.equal(p2.length, 1);
close(yawOf(p2[0]), Math.PI / 2);
assert.equal(p2[0].heading, true);
const list = posesFrom([{ translation: { x: 1, y: 2 }, rotation: { value: 0 } }, { translation: { x: 3, y: 4 }, rotation: { value: 1 } }], 'struct:Pose2d[]');
assert.deepEqual(list.map((p) => [p.x, p.y]), [[1, 2], [3, 4]]);
const p3 = posesFrom({ translation: { x: 1, y: 2, z: 0.5 }, rotation: { q: { w: Math.cos(0.3), x: 0, y: 0, z: Math.sin(0.3) } } }, 'struct:Pose3d')[0];
close(yawOf(p3), 0.6);
assert.equal(p3.z, 0.5);
// Field2d: x, y, degrees.
const f2d = posesFrom([1, 2, 90, 3, 4, 180], 'double[]');
assert.equal(f2d.length, 2);
close(yawOf(f2d[0]), Math.PI / 2);
assert.deepEqual(posesFrom([1, 2], 'double[]'), []);
assert.equal(posesFrom({ x: 1, y: 2 }, 'struct:Translation2d')[0].heading, false);
assert.deepEqual(posesFrom(null, 'struct:Pose2d'), []);
assert.deepEqual(posesFrom({ translation: { x: 1 } }, 'struct:Pose2d'), []);
assert.deepEqual(posesFrom(5, 'double'), []);
// The value holding at a time.
const recs = { key: 'k', type: 'double', times: [1, 2, 3], values: [10, 20, 30], truncated: false };
assert.equal(recordAt(recs, 0.5), undefined);
assert.equal(recordAt(recs, 2), 20);
assert.equal(recordAt(recs, 9), 30);

// --- Pies ---
// Carried in from before the start; the last holds to the end.
assert.deepEqual(timeInStates([0, 5, 8], ['A', 'B', 'A'], 2, 10), [{ label: 'A', value: 5 }, { label: 'B', value: 3 }]);
assert.deepEqual(timeInStates([0, 1], [0, 1], 0, 4, (v) => (v ? 'true' : 'false')), [{ label: 'true', value: 3 }, { label: 'false', value: 1 }]);
assert.deepEqual(timeInStates([5], ['A'], 0, 4), []);
assert.deepEqual(foldSlices([{ label: 'a', value: 5 }, { label: 'b', value: 3 }, { label: 'c', value: 1 }, { label: 'd', value: 1 }], 3).map((s) => [s.label, s.value]), [['a', 5], ['b', 3], ['Other', 2]]);
assert.deepEqual(foldSlices([{ label: 'a', value: 0 }], 3), []);

// --- Panels as kept ---
for (const type of ['field', 'console', 'pie', 'robot3d'] as const) assert.deepEqual(cleanPanel(newPanel(type, 'panel1', '2026')), newPanel(type, 'panel1', '2026'), type);
assert.equal(cleanPanel({ id: 'bad id!', type: 'field' }), null);
assert.equal(cleanPanel({ id: 'p', type: 'chart' }), null);
const field = cleanPanel({ id: 'p', type: 'field', rotation: 45, robotSize: 99, season: '20xx', items: [{ key: 'a', style: 'nope', color: 99, opacity: 3 }, { nokey: 1 }] })!;
assert.deepEqual(field, { id: 'p', type: 'field', season: '', rotation: 0, robotSize: 0.9, trail: 0, items: [{ key: 'a', style: 'robot', color: 0, opacity: 1 }] });
assert.equal(cleanPanels([newPanel('pie', 'a', ''), newPanel('pie', 'a', ''), ...Array.from({ length: 9 }, (_, i) => newPanel('console', `c${i}`, ''))]).length, 6);
const mapped = mapPanelKeys({ ...newPanel('robot3d', 'r', ''), poseKey: '/Robot/robot/drive/pose', componentsKey: '' } as any, (k) => k.replace('/robot/', '/'));
assert.equal((mapped as any).poseKey, '/Robot/drive/pose');
assert.equal((mapped as any).componentsKey, '');
// A view keeps its plots, and they count as its signals; an old view has none.
const view = cleanLibraryItem({ id: '5f0c2a10-0009-4000-8000-000000000001', kind: 'view', name: 'v', axes: [], traces: [], span: { type: 'all' }, eventKinds: null,
  panels: [{ id: 'panel1', type: 'console', key: 'console', filter: '' }, { id: 'x', type: 'pie', mode: 'share', keys: ['a', 'b'] }] })!;
assert.equal(view.kind === 'view' && view.panels?.length, 2);
assert.deepEqual(view.kind === 'view' && viewKeys(view), ['console', 'a', 'b']);
const old = cleanLibraryItem({ id: '5f0c2a10-0009-4000-8000-000000000002', kind: 'view', name: 'v', axes: [], traces: [], span: { type: 'all' }, eventKinds: null })!;
assert.equal('panels' in old, false);
// Models: AdvantageScope's config, with what's used.
assert.deepEqual(cleanModelConfig({ name: 'Bot', rotations: [{ axis: 'x', degrees: 90 }, { axis: 'w', degrees: 1 }], position: [0, 0, 0.1], components: [{ zeroedRotations: [], zeroedPosition: [0, 0.2, 0.3] }], isFTC: false }, 'f'),
  { name: 'Bot', rotations: [{ axis: 'x', degrees: 90 }], position: [0, 0, 0.1], components: [{ zeroedRotations: [], zeroedPosition: [0, 0.2, 0.3] }] });
assert.equal(cleanModelConfig({}, 'folder')!.name, 'folder');
assert.equal(cleanModelConfig('nope', 'f'), null);

// --- The roboRIO's console ---
function frame(tag: number, body: Buffer) {
  const out = Buffer.alloc(3 + body.length);
  out.writeUInt16BE(1 + body.length, 0);
  out[2] = tag;
  body.copy(out, 3);
  return out;
}
const sized = (text: string) => {
  const b = Buffer.from(text);
  const out = Buffer.alloc(2 + b.length);
  out.writeUInt16BE(b.length, 0);
  b.copy(out, 2);
  return out;
};
const print = frame(12, Buffer.concat([Buffer.alloc(6), Buffer.from('Hello robot' + String.fromCharCode(10))]));
const errorBody = Buffer.alloc(13);
errorBody.writeInt32BE(-1003, 8);
errorBody[12] = 1;
const err = frame(11, Buffer.concat([errorBody, sized('Joystick not found'), sized('Robot.java:12'), sized('stack')]));
const warnBody = Buffer.from(errorBody);
warnBody[12] = 0;
const warn = frame(11, Buffer.concat([warnBody, sized('Loop overrun'), sized(''), sized('')]));
const keepalive = Buffer.from([0, 0]);
const all = Buffer.concat([keepalive, print, err, warn]);
// Split anywhere: the same lines.
for (const cut of [1, 2, 5, 17, all.length - 1]) {
  const reader = new FrameReader();
  const lines = [...reader.push(all.subarray(0, cut)), ...reader.push(all.subarray(cut))];
  assert.deepEqual(lines, [
    { text: 'Hello robot', problem: null },
    { text: 'ERROR -1003: Joystick not found (Robot.java:12)', problem: 'error' },
    { text: 'Warning -1003: Loop overrun', problem: 'warning' }
  ], `cut at ${cut}`);
}
assert.equal(parseFrame(Buffer.from([99, 1, 2])), null);

// --- Records from a log ---
// 300 poses 20 ms apart, and console text, as a robot logs them.
const poses = Array.from({ length: 300 }, (_, i) => ({ time: 1 + i * 0.02, x: i * 0.01, y: 2, heading: i * 0.001 }));
const writer = poseLog('/Robot/drive/pose', poses);
const consoleId = writer.start('console', 'string');
for (let i = 0; i < 20; i++) writer.append(consoleId, 1 + i * 0.25, utf8(`line ${i}`));
const log = new LogSignalSource(writer.bytes());
const key = '/Robot/drive/pose';
const allPoses = log.records(key)!;
assert.equal(allPoses.type, 'struct:Pose2d');
assert.equal(allPoses.times.length, 300);
const pose150 = posesFrom(allPoses.values[150], allPoses.type)[0];
close(pose150.x, 1.5);
close(yawOf(pose150), 0.15);
const t = allPoses.times[100];
const some = log.records(key, { start: t + 1e-6, end: allPoses.times[200] })!;
// The one holding at the start comes too.
assert.equal(some.times[0], t);
assert.equal(some.times.length, 101);
assert.equal(posesFrom(some.values[0], some.type).length, 1);
const capped = log.records(key, {}, 10)!;
assert.equal(capped.times.length, 10);
assert.equal(capped.truncated, true);
assert.equal(capped.times[9], allPoses.times[allPoses.times.length - 1]);
assert.equal(log.records('/nope'), null);
// The pose's fields are signals too, beside it.
assert.ok(log.catalog().some((s) => s.key === `${key}/translation/x` && s.parent === key));
assert.deepEqual([...log.read('console')!.values].slice(0, 2), ['line 0', 'line 1']);

// --- Live: console text joins the session ---
const live = new LiveSignalSource(1_000_000);
live.now = 5;
live.addText('console', 'first');
live.now = 6;
live.addText('console', 'second');
assert.ok(live.catalog().some((s) => s.key === 'console' && s.kind === 'string'));
assert.deepEqual([...live.read('console')!.values], ['first', 'second']);
assert.deepEqual(live.records('console', { start: 5.5 })!.values, ['first', 'second']);
