// Driver Station logs: the .dslog the Driver Station writes every 20 ms
// while it's open (the connection, the battery, the roboRIO's CPU and CAN
// use, the mode), and the .dsevents beside it (the robot's console errors
// and warnings, and the Driver Station's own). Both start with a version
// (4) and a LabVIEW time; everything is big-endian.

import type { SignalInfo } from '@shared/signals';
import { MemorySignalSource } from './memory-source';
import type { ModeChange, RobotMode } from './events';

const headerBytes = 20;
const recordBytes = 14;
export const recordSeconds = 0.02;

// LabVIEW times: seconds since 1904 (UTC), and a 64-bit fraction.
const labviewEpochSeconds = 2082844800;
function labviewTime(view: DataView, at: number): number {
  const seconds = Number(view.getBigInt64(at));
  const fraction = Number(view.getBigUint64(at + 8) >> 11n) / 2 ** 53;
  return (seconds - labviewEpochSeconds + fraction) * 1000;
}

// The power distribution data after each record's 14 bytes, by the type
// in its last byte: none, or CTRE's PDP. Others (REV's PDH) are measured
// from the file. What's in it isn't read: the channels' packing isn't
// documented.
const powerDataBytes: Record<number, number> = { 0: 0, 33: 33 };

// How long another type's data is: the length that puts the same type at
// the end of the next several records.
function measurePowerData(bytes: Uint8Array, at: number, type: number): number | null {
  for (let extra = 0; extra <= 96; extra++) {
    const stride = recordBytes + extra;
    let fits = true;
    for (let k = 1; k <= 8 && fits; k++) {
      const next = at + k * stride + recordBytes - 1;
      if (next >= bytes.length) break;
      fits = bytes[next] === type;
    }
    if (fits && at + stride + recordBytes <= bytes.length) return extra;
  }
  return null;
}

export interface DsRecordHead {
  // When the log started (ms since 1970), and how long it runs.
  startedAt: number;
  duration: number;
  // Whether the robot was ever connected: most logs are the Driver Station
  // open with no robot, and aren't worth listing.
  connected: boolean;
}

interface DsRecords extends DsRecordHead {
  // Per record, from the start.
  count: number;
  trip: Float64Array;
  loss: Float64Array;
  voltage: Float64Array;
  cpu: Float64Array;
  can: Float64Array;
  wifi: Float64Array;
  bandwidth: Float64Array;
  // The status byte, its bits made true-when-set (they're stored inverted).
  status: Uint8Array;
  // The end was cut off or couldn't be read.
  truncated: boolean;
}

// Status bits.
const robotDisabled = 1;
const robotAuto = 2;
const robotTeleop = 4;
const watchdog = 64;
const brownout = 128;
const robotBits = robotDisabled | robotAuto | robotTeleop;

function readRecords(bytes: Uint8Array): DsRecords {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < headerBytes || view.getInt32(0) !== 4) throw new Error('Not a version 4 Driver Station log.');
  const startedAt = labviewTime(view, 4);
  // At most this many: each is 14 bytes or more.
  const most = Math.floor((bytes.length - headerBytes) / recordBytes);
  const columns = [0, 0, 0, 0, 0, 0, 0].map(() => new Float64Array(most));
  const [trip, loss, voltage, cpu, can, wifi, bandwidth] = columns;
  const status = new Uint8Array(most);
  const measured = new Map<number, number | null>();
  let at = headerBytes;
  let count = 0;
  let connected = false;
  let truncated = false;
  while (at + recordBytes <= bytes.length) {
    const type = bytes[at + recordBytes - 1];
    let extra: number | null | undefined = powerDataBytes[type] ?? measured.get(type);
    if (extra === undefined) {
      extra = measurePowerData(bytes, at, type);
      measured.set(type, extra);
    }
    if (extra === null) {
      truncated = true;
      break;
    }
    trip[count] = bytes[at] / 2;
    loss[count] = Math.min(100, Math.max(0, view.getInt8(at + 1) * 4));
    voltage[count] = view.getUint16(at + 2) / 256;
    cpu[count] = bytes[at + 4] / 2;
    status[count] = ~bytes[at + 5] & 0xff;
    can[count] = bytes[at + 6] / 2;
    wifi[count] = bytes[at + 7] / 2;
    bandwidth[count] = view.getUint16(at + 8) / 256;
    if (status[count] & robotBits) connected = true;
    count += 1;
    at += recordBytes + extra;
  }
  if (at < bytes.length && !truncated) truncated = bytes.length - at >= recordBytes;
  return { startedAt, duration: count * recordSeconds, connected, count, trip, loss, voltage, cpu, can, wifi, bandwidth, status, truncated };
}

// Just when it started, how long it is, and whether a robot was there.
export function dsLogHead(bytes: Uint8Array): DsRecordHead {
  const { startedAt, duration, connected } = readRecords(bytes);
  return { startedAt, duration, connected };
}

// --- The .dsevents ---

export interface DsMessage {
  // Seconds from the .dslog's start.
  time: number;
  // The robot's (its console, its reported errors) or the Driver Station's own.
  from: 'robot' | 'ds';
  // A reported error or warning, or a line printed.
  severity: 'error' | 'warning' | 'printed';
  code: number;
  text: string;
  location: string;
}

// Bytes that aren't text turn up in these files: dropped.
const clean = (text: string) => text.replace(/[^\t\n\r\x20-\x7e -￼]/g, '').trim();

export interface DsEvents {
  messages: DsMessage[];
  // "Qualification 12", when the FMS was connected for a match.
  match: string | null;
}

export function readDsEvents(bytes: Uint8Array, logStartedAt: number): DsEvents {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const messages: DsMessage[] = [];
  let match: string | null = null;
  if (bytes.length < headerBytes || view.getInt32(0) !== 4) return { messages, match };
  const decoder = new TextDecoder('utf-8');
  let at = headerBytes;
  while (at + 20 <= bytes.length) {
    const time = (labviewTime(view, at) - logStartedAt) / 1000;
    const length = view.getInt32(at + 16);
    if (length < 0 || at + 20 + length > bytes.length) break;
    const text = decoder.decode(bytes.subarray(at + 20, at + 20 + length));
    at += 20 + length;

    // A record can hold several messages: the robot's are tagged.
    for (const piece of text.split(/(?=<TagVersion>)/)) {
      if (piece.startsWith('<TagVersion>')) {
        const reported = /<flags> (\d+) <Code> (-?\d+) <details> ([\s\S]*?)(?: <location> ([\s\S]*?))?(?: <stack>[\s\S]*)?$/.exec(piece);
        if (reported) {
          const flags = Number(reported[1]);
          const code = Number(reported[2]);
          messages.push({
            time,
            from: flags & 2 ? 'ds' : 'robot',
            severity: flags & 1 ? 'error' : code !== 0 ? 'warning' : 'printed',
            code,
            text: clean(reported[3]),
            location: clean(reported[4] ?? '')
          });
          continue;
        }
        const printed = /<message> ([\s\S]*)$/.exec(piece);
        if (printed) messages.push({ time, from: 'robot', severity: 'printed', code: 0, text: clean(printed[1]), location: '' });
        continue;
      }
      // The Driver Station's own, untagged: "Warning <Code> 44007 ... <Description>...", "Info ...".
      const fms = /FMS Connected:\s+([A-Za-z]+)\s*-\s*(\d+):(\d+)/.exec(piece);
      if (fms && !/^none$/i.test(fms[1]) && Number(fms[2]) > 0) match = `${fms[1]} ${fms[2]}`;
      const coded = /^(Warning|ERROR|Error) <Code> (-?\d+)[\s\S]*?(?:<Description>([^<]*))?$/.exec(piece.trim());
      if (coded) {
        messages.push({
          time,
          from: 'ds',
          severity: /^e/i.test(coded[1]) ? 'error' : 'warning',
          code: Number(coded[2]),
          text: clean(coded[3] ?? ''),
          location: ''
        });
      }
    }
  }
  return { messages, match };
}

// --- As signals ---

export interface DsLog extends DsRecordHead {
  source: MemorySignalSource;
  modes: ModeChange[];
  // Spans, in seconds from the start.
  brownouts: { start: number; end: number }[];
  // Each time the robot was lost after being there, and whether it was enabled then.
  lost: { start: number; end: number; enabled: boolean }[];
  // Enabled with a bad link: lots of packets lost, or a slow trip.
  poorLink: { start: number; end: number; loss: number; trip: number }[];
  truncated: boolean;
}

// Enabled with more lost than this (%), or a slower round trip (ms), is a
// bad link: well past what a field normally sees (8% and 26 ms at the 90th
// percentile in Team 973's logs).
export const poorLossPercent = 50;
export const poorTripMs = 100;

const info = (name: string, kind: SignalInfo['kind'], unit: string): SignalInfo => ({
  key: name,
  name,
  subsystem: '',
  type: '',
  kind,
  unit,
  count: 0,
  source: 'Driver Station'
});

// A record with nothing from the robot is usually one packet that didn't
// arrive, many times a match: the robot's only taken to be gone after this long.
export const lostAfterSeconds = 0.25;

// The status with dropped packets filled in from the record before.
function withoutDroppedPackets(status: Uint8Array, count: number): Uint8Array {
  const out = Uint8Array.from(status.subarray(0, count));
  const most = Math.round(lostAfterSeconds / recordSeconds);
  for (let i = 1; i < count; i++) {
    if (out[i] & robotBits || !(out[i - 1] & robotBits)) continue;
    let end = i;
    while (end < count && !(status[end] & robotBits)) end++;
    // Back before it was long enough to count, and not the end of the log.
    if (end - i < most && end < count) for (let j = i; j < end; j++) out[j] = (out[i - 1] & ~(watchdog | brownout)) | (status[j] & (watchdog | brownout));
    i = end - 1;
  }
  return out;
}

export function readDsLog(bytes: Uint8Array): DsLog {
  const records = readRecords(bytes);
  const { count } = records;
  // As received, for the numbers in each record; and with dropped packets
  // filled in, for whether the robot was there and its mode.
  const received = records.status;
  const status = withoutDroppedPackets(received, count);
  const source = new MemorySignalSource(records.duration);
  const time = (i: number) => i * recordSeconds;
  const isConnected = (i: number) => (status[i] & robotBits) !== 0;
  const isEnabled = (i: number) => isConnected(i) && !(status[i] & robotDisabled);
  const modeAt = (i: number): RobotMode | 'disconnected' =>
    !isConnected(i) ? 'disconnected' : !isEnabled(i) ? 'disabled' : status[i] & robotAuto ? 'auto' : status[i] & robotTeleop ? 'teleop' : 'test';

  // Numbers the robot sends are only there while it's connected.
  const numbers: [string, Float64Array, string][] = [
    ['Trip time', records.trip, 'ms'],
    ['Packet loss', records.loss, '%'],
    ['Battery voltage', records.voltage, 'V'],
    ['roboRIO CPU', records.cpu, '%'],
    ['CAN utilization', records.can, '%'],
    ['Wi-Fi signal', records.wifi, 'dB'],
    ['Bandwidth', records.bandwidth, 'Mb/s']
  ];
  for (const [name, column, unit] of numbers) {
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      if (!(received[i] & robotBits)) continue;
      times.push(time(i));
      values.push(column[i]);
    }
    // Fields this Driver Station doesn't fill in (Wi-Fi, bandwidth off the field).
    if (values.some((v) => v !== 0)) source.add(info(name, 'number', unit), times, values);
  }

  // Flags and the mode, where they change.
  const changes = <T extends number | string>(valueAt: (i: number) => T) => {
    const times: number[] = [];
    const values: T[] = [];
    for (let i = 0; i < count; i++) {
      const value = valueAt(i);
      if (values.length === 0 || values[values.length - 1] !== value) {
        times.push(time(i));
        values.push(value);
      }
    }
    return { times, values };
  };
  const modeNames = { disconnected: 'No robot', disabled: 'Disabled', auto: 'Autonomous', teleop: 'Teleop', test: 'Test' };
  const mode = changes((i) => modeNames[modeAt(i)]);
  source.add(info('Mode', 'string', ''), mode.times, mode.values);
  for (const [name, test] of [
    ['Robot connected', isConnected],
    ['Enabled', isEnabled],
    ['Brownout', (i: number) => !!(status[i] & brownout)],
    ['Watchdog', (i: number) => !!(status[i] & watchdog)]
  ] as const) {
    const flag = changes((i) => (test(i) ? 1 : 0));
    source.add(info(name, 'boolean', ''), flag.times, flag.values);
  }

  // The mode as the rest of the app has it: without the robot, disabled.
  const modes: ModeChange[] = [];
  for (let i = 0; i < count; i++) {
    const m = modeAt(i);
    const robotMode: RobotMode = m === 'disconnected' ? 'disabled' : m;
    if (modes[modes.length - 1]?.mode !== robotMode) modes.push({ time: time(i), mode: robotMode });
  }

  const spans = (test: (i: number) => boolean) => {
    const out: { start: number; end: number; first: number; last: number }[] = [];
    let from = -1;
    for (let i = 0; i <= count; i++) {
      const passes = i < count && test(i);
      if (passes && from === -1) from = i;
      if (!passes && from !== -1) {
        out.push({ start: time(from), end: time(i), first: from, last: i - 1 });
        from = -1;
      }
    }
    return out;
  };

  const brownouts = spans((i) => isConnected(i) && !!(status[i] & brownout)).map(({ start, end }) => ({ start, end }));
  // Gone, once it had been there.
  const firstSeen = Array.from({ length: count }, (_, i) => i).find(isConnected) ?? count;
  const lost = spans((i) => i > firstSeen && !isConnected(i)).map(({ start, end, first }) => ({ start, end, enabled: isEnabled(first - 1) }));
  const poorLink = spans((i) => isEnabled(i) && (records.loss[i] >= poorLossPercent || records.trip[i] >= poorTripMs)).map(({ start, end, first, last }) => {
    let worstLoss = 0;
    let worstTrip = 0;
    for (let i = first; i <= last; i++) {
      worstLoss = Math.max(worstLoss, records.loss[i]);
      worstTrip = Math.max(worstTrip, records.trip[i]);
    }
    return { start, end, loss: worstLoss, trip: worstTrip };
  });

  return {
    startedAt: records.startedAt,
    duration: records.duration,
    connected: records.connected,
    source,
    modes,
    brownouts,
    lost,
    poorLink,
    truncated: records.truncated
  };
}
