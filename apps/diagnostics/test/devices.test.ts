// Device Health: every device there, logging, and without faults; a log or
// device missing is an error, not a signal missing.

import assert from 'node:assert/strict';

import { checkDevices, deviceLines, deviceProblems, longestGap, parseDeviceLines, type DeviceFound, type DeviceSpec, type HootFound } from '@shared/devices';
import type { LogEvent } from '@shared/events';

const spans: [number, number][] = [[10, 160]];
const steady = (from: number, to: number, every = 0.05) => Array.from({ length: Math.round((to - from) / every) + 1 }, (_, i) => from + i * every);

// The gap: edges count, and only within the spans.
assert.equal(longestGap([12, 13, 160], spans), 147);
assert.ok(Math.abs(longestGap(steady(0, 200), spans) - 0.05) < 1e-9);
assert.equal(longestGap([], spans), 150);

const specs: DeviceSpec[] = [
  { device: 'TalonFX-2', label: 'Module 0 drive', bus: 'canivore' },
  { device: 'Pigeon2-1', label: 'Pigeon', bus: 'canivore' },
  { device: 'CANcoder-4', label: 'Module 0 encoder', bus: 'canivore' },
  { device: 'TalonFX-60', label: 'Intake roller', bus: 'rio' }
];
const canivore = 'Hoot CANivore 17E61D98';
const hoots: HootFound[] = [
  { bus: '17E61D9833533853202020340F3103FF', label: canivore, name: 'mttd_Q4_17E61D98.hoot', state: 'ready', message: '' },
  { bus: 'rio', label: 'Hoot rio', name: 'mttd_Q4_rio.hoot', state: 'ready', message: '' }
];
// As faultTitle names them.
const words: Record<string, string> = { SupplyCurrLimit: 'supply current limit', BootDuringEnable: 'rebooted while enabled', BridgeBrownout: 'bridge brownout' };
const fault = (device: string, field: string, start: number, end: number): LogEvent => ({
  id: `hoot:${device}:${field}:${start}`, kind: 'fault', severity: 'warning', start, end,
  title: `${device}: ${words[field.replace(/^(Sticky)?Fault_/, '')]}${field.startsWith('Sticky') ? ' (sticky)' : ''}`,
  detail: '', count: 1, key: `${canivore}/${device}/${field}`
});
const found: Record<string, DeviceFound> = {
  // Logging, with a current limit (information), a sticky fault, and a
  // bridge brownout while it was on.
  'TalonFX-2': {
    hoot: canivore,
    times: steady(0, 170),
    faults: [fault('TalonFX-2', 'Fault_SupplyCurrLimit', 20, 22), fault('TalonFX-2', 'StickyFault_BootDuringEnable', 10, 160), fault('TalonFX-2', 'Fault_BridgeBrownout', 50, 50.5)]
  },
  // Not in the Hoot logs at all (mttd Q4's Pigeon).
  'Pigeon2-1': { hoot: null, times: null, faults: [] },
  // There, but stopped logging for 30 s.
  'CANcoder-4': { hoot: canivore, times: [...steady(0, 60), ...steady(90, 170)], faults: [] },
  'TalonFX-60': { hoot: 'Hoot rio', times: steady(0, 170, 0.1), faults: [] }
};
const lookup = (device: string) => found[device];

const health = checkDevices(specs, 'FRC_20261107_164852_mttd_Q4.wpilog', hoots, lookup, spans);
assert.deepEqual(health.logs.map((l) => l.status), ['ok', 'ok', 'ok']);
const byDevice = new Map(health.devices.map((d) => [d.device, d]));
const talon = byDevice.get('TalonFX-2')!;
assert.equal(talon.status, 'error');
assert.deepEqual(talon.faults.map((f) => [f.title, f.count]), [['bridge brownout', 1]]);
assert.deepEqual(talon.limits.map((f) => f.title), ['supply current limit']);
assert.deepEqual(talon.sticky, ['rebooted while enabled']);
assert.ok(Math.abs(talon.rate - 20) < 0.1);
assert.equal(byDevice.get('Pigeon2-1')!.status, 'error');
assert.match(byDevice.get('Pigeon2-1')!.problems[0], /Not in the Hoot logs/);
assert.equal(byDevice.get('CANcoder-4')!.status, 'error');
assert.match(byDevice.get('CANcoder-4')!.problems[0], /Stopped logging for 30\.0 s/);
assert.equal(byDevice.get('TalonFX-60')!.status, 'ok');

// As the report's problems: all errors, the fault at its time.
const problems = deviceProblems(health, spans, lookup);
assert.ok(problems.every((p) => p.severity === 'error'));
assert.deepEqual(problems.map((p) => p.title).sort(), [
  'CANcoder-4 (Module 0 encoder): stopped logging for 30.0 s',
  'Pigeon2-1 (Pigeon): not in the Hoot logs',
  'TalonFX-2 (Module 0 drive): bridge brownout'
].sort());
assert.equal(problems.find((p) => p.title.startsWith('TalonFX-2'))!.start, 50);

// Logs missing: the data log, and the roboRIO bus's Hoot log; its devices
// are said once, of the log.
const without = checkDevices(specs, null, hoots.slice(0, 1), lookup, spans);
assert.deepEqual(without.logs.map((l) => [l.label, l.status]), [
  ['Data log', 'error'], ['Hoot log (roboRIO CAN bus)', 'error'], ['Hoot log (CANivore)', 'ok']
]);
assert.match(without.devices.find((d) => d.device === 'TalonFX-60')!.problems[0], /Not checked/);
const withoutProblems = deviceProblems(without, spans, lookup).map((p) => p.title);
assert.ok(withoutProblems.includes('Data log: missing'));
assert.ok(withoutProblems.includes('Hoot log (roboRIO CAN bus): missing'));
assert.ok(!withoutProblems.some((t) => t.startsWith('TalonFX-60')));
// One that couldn't be read is an error too.
const unread = checkDevices(specs, 'a.wpilog', [{ ...hoots[0], state: 'error', message: 'owlet failed' }, hoots[1]], lookup, spans);
const canivoreLog = unread.logs.find((l) => l.label === 'Hoot log (CANivore)')!;
assert.equal(canivoreLog.status, 'error');
assert.match(canivoreLog.problem, /owlet failed/);

// The editor's lines, both ways.
assert.deepEqual(parseDeviceLines(deviceLines(specs)), specs);
assert.deepEqual(parseDeviceLines('TalonFX-9\nnot a device\nTalonFX-9, again\nCANcoder-4,  Encoder ,RIO'), [
  { device: 'TalonFX-9', label: 'TalonFX-9', bus: 'canivore' },
  { device: 'CANcoder-4', label: 'Encoder', bus: 'rio' }
]);
