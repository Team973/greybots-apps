// Driver Station logs (.dslog, .dsevents): read from bytes made here.

import assert from 'node:assert/strict';
import { readDsLog, readDsEvents, dsLogHead, recordSeconds } from '@main/signals/ds-log';
import { consoleTextEvents, deviceOf, dsLogEvents } from '@main/signals/events';

// A version 4 .dslog: a header at `start` (ms), then records.
const labview = (ms: number) => {
  const view = new DataView(new ArrayBuffer(16));
  const seconds = Math.floor(ms / 1000);
  view.setBigInt64(0, BigInt(seconds + 2082844800));
  view.setBigUint64(8, BigInt(Math.round(((ms / 1000) - seconds) * 2 ** 32)) << 32n);
  return new Uint8Array(view.buffer);
};
interface Rec { status: number; volt?: number; trip?: number; loss?: number; pdType?: number; pdBytes?: number }
function dslog(start: number, records: Rec[]): Uint8Array {
  const parts: number[] = [0, 0, 0, 4, ...labview(start)];
  for (const r of records) {
    const volt = Math.round((r.volt ?? 12.5) * 256);
    // Status bits are stored inverted.
    parts.push((r.trip ?? 3) * 2, (r.loss ?? 0) / 4, volt >> 8, volt & 255, 40, ~r.status & 255, 50, 0, 0, 0, 0, 0, 0, r.pdType ?? 0);
    for (let i = 0; i < (r.pdBytes ?? 0); i++) parts.push(0x5a);
  }
  return Uint8Array.from(parts);
}
const disabled = 1, auto = 2, teleop = 4, brown = 128;
const start = Date.UTC(2026, 9, 18, 0, 38, 0);
const recs: Rec[] = [
  ...Array(50).fill({ status: 0 }),               // 0–1 s: no robot
  ...Array(100).fill({ status: disabled }),       // 1–3 s: disabled
  ...Array(100).fill({ status: auto }),           // 3–5 s: auto
  { status: 0 }, { status: 0 },                   // a dropped packet or two: not lost
  ...Array(98).fill({ status: teleop }),          // to 7 s: teleop
  ...Array(10).fill({ status: teleop | brown, volt: 6.5 }), // a brownout
  ...Array(30).fill({ status: teleop, loss: 60 }), // a bad link
  ...Array(40).fill({ status: 0 }),               // lost while enabled (0.8 s)
  ...Array(70).fill({ status: disabled })
];
const bytes = dslog(start, recs);
const head = dsLogHead(bytes);
assert.equal(head.startedAt, start);
assert.equal(head.connected, true);
assert.ok(Math.abs(head.duration - recs.length * recordSeconds) < 1e-9);
const log = readDsLog(bytes);
assert.deepEqual(log.modes.map((m) => [Number(m.time.toFixed(2)), m.mode]), [[0, 'disabled'], [3, 'auto'], [5.04, 'teleop'], [7.8, 'disabled']]);
assert.equal(log.brownouts.length, 1);
assert.ok(Math.abs(log.brownouts[0].start - 7) < 1e-9);
assert.equal(log.lost.length, 1);
assert.equal(log.lost[0].enabled, true);
assert.equal(log.poorLink.length, 1);
assert.equal(log.poorLink[0].loss, 60);
// Numbers only while connected, the dropped packets left out.
assert.equal(log.source.read('Battery voltage')!.times.length, 100 + 100 + 98 + 10 + 30 + 70);
assert.equal(log.source.read('Battery voltage')!.stats!.min, 6.5);
const events = dsLogEvents(log, [], { robotConsole: false, key: (n) => `DS log/${n}` });
assert.deepEqual(events.map((e) => [e.kind, e.severity, e.title]), [
  ['brownout', 'error', 'Brownout'],
  ['network', 'error', 'Lost communication with the robot while enabled'],
  ['network', 'warning', 'Poor connection']
]);
assert.match(events[2].detail, /60% packets lost/);

// A power distribution type not known: its length measured from the file.
const rev = readDsLog(dslog(start, Array(20).fill({ status: disabled, pdType: 25, pdBytes: 27 })));
assert.equal(rev.duration.toFixed(2), (20 * recordSeconds).toFixed(2));
assert.equal(rev.truncated, false);
// CTRE's PDP, 33 bytes.
assert.equal(readDsLog(dslog(start, Array(20).fill({ status: disabled, pdType: 33, pdBytes: 33 }))).source.read('Battery voltage')!.times.length, 20);

// .dsevents: the robot's reports, its prints, the Driver Station's own, the FMS.
const text = (s: string) => new TextEncoder().encode(s);
function dsevents(entries: [number, string][]): Uint8Array {
  const parts: number[] = [0, 0, 0, 4, ...labview(start)];
  for (const [ms, s] of entries) {
    const body = text(s);
    parts.push(...labview(start + ms), (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255, ...body);
  }
  return Uint8Array.from(parts);
}
const ev = readDsEvents(dsevents([
  [1000, 'Info FMS Connected:   Qualification - 12:1, Field Time: 26/10/18 0:38:1'],
  [2000, '<TagVersion>1 <time> 02.000 <count> 1 <flags> 1 <Code> -1003 <details> CAN frame not received/too-stale. Check the CAN bus wiring. <location> talon fx 10 ("Canivore") Status Signal Position <stack> '],
  [2500, '<TagVersion>1 <time> 02.500 <message> ********** Robot program starting ********** <TagVersion>1 <time> 02.600 <count> 1 <flags> 0 <Code> 1 <details> Loop time of 0.02s overrun\n <location> edu.wpi.first.wpilibj.IterativeRobotBase.printLoopOverrunMessage(IterativeRobotBase.java:412) <stack> '],
  [3000, '<TagVersion>1 <time> 03.000 <count> 1 <flags> 2 <Code> 44004 <details> FRC: The Driver Station has lost communication with the robot. <location> Driver Station <stack> '],
  [3500, 'Warning <Code> 44007 <secondsSinceReboot> 40.666\r<Description>FRC: Time since robot boot.']
]), start);
assert.equal(ev.match, 'Qualification 12');
assert.deepEqual(ev.messages.map((m) => [m.time, m.from, m.severity, m.code]), [
  [2, 'robot', 'error', -1003], [2.5, 'robot', 'printed', 0], [2.5, 'robot', 'warning', 1], [3, 'ds', 'warning', 44004], [3.5, 'ds', 'warning', 44007]
]);
const fromMessages = dsLogEvents({ ...log, brownouts: [], lost: [], poorLink: [] }, ev.messages, { robotConsole: false, key: (n) => n });
assert.deepEqual(fromMessages.map((e) => e.title).sort(), ['Loop overrun', 'talon fx 10 (Canivore): CAN frame not received/too-stale.']);
// With the data log's console, the robot's copy here is left out.
assert.equal(dsLogEvents({ ...log, brownouts: [], lost: [], poorLink: [] }, ev.messages, { robotConsole: true, key: (n) => n }).length, 0);

assert.equal(deviceOf('talon fx 10 ("") Status Signal Position'), 'talon fx 10 (rio)');
assert.equal(deviceOf('pigeon 2 13 ("Canivore")'), 'pigeon 2 13 (Canivore)');
assert.equal(deviceOf('edu.wpi.first.wpilibj.DriverStation.reportJoystickUnpluggedWarning(DriverStation.java:2123)'), '');
// Messages that differ only in numbers: titled with # where they differ.
const variants = consoleTextEvents([
  { time: 1, text: 'Warning: Joystick Button 8 on port 0 not available', key: null },
  { time: 1.5, text: 'Warning: Joystick Button 3 on port 0 not available', key: null }
]);
assert.equal(variants[0].title, 'Joystick Button # on port 0 not available');
