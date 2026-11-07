// Device health: that every CAN device the robot should have is in the Hoot
// logs, logged all through the span, and had no faults. A Device Health
// report's devices section (reports.ts reads the logs; this judges them).
//
// - A log missing (the data log, or a bus's Hoot log) is an error, and so is
//   one that couldn't be read.
// - A device missing from its bus's Hoot log, or not logging (no sample of
//   its supply voltage for `maxGapSeconds`), is an error: not a signal
//   missing, which is what a report says of a signal it was only asked for.
// - Any fault while it's happening is an error, whatever the device: but a
//   current limit holding is the motor doing as it was told (information),
//   and a sticky fault says only that it happened at some point, maybe
//   before the log (information).
//
// Nothing here may touch Node or the DOM.

import type { LogEvent } from './events';
import type { HootState } from './hoot';

// The roboRIO's own CAN bus, or a CANivore (whatever its name or serial).
export type DeviceBus = 'rio' | 'canivore';

export interface DeviceSpec {
  // As CTRE names it in a Hoot log: TalonFX-2, Pigeon2-1, CANcoder-4.
  device: string;
  // For people: "Module 0 drive".
  label: string;
  bus: DeviceBus;
}

export const busLabels: Record<DeviceBus, string> = { rio: 'roboRIO CAN bus', canivore: 'CANivore' };

export const busOf = (hootBus: string): DeviceBus => (hootBus.toLowerCase() === 'rio' ? 'rio' : 'canivore');

// What every device logs, at its own rate, and so shows it's there.
export const loggingSignal = (device: string) => `${device}/SupplyVoltage`;

// Longer than this without a sample is not logging. Every device on a bus
// pauses together for up to about 2 s at times (Q9 at an off-season event):
// that's the log, not the device.
export const maxGapSeconds = 3;

const currentLimit = /(Stator|Supply)CurrLimit$/;

export type DeviceStatus = 'ok' | 'warning' | 'error';

export interface LogCheck {
  // "Data log", "Hoot log (CANivore)".
  label: string;
  // The file's name, or null when there's none.
  file: string | null;
  status: DeviceStatus;
  problem: string;
}

export interface DeviceFaultCount {
  title: string;
  // Times it came on, and for how long in all.
  count: number;
  seconds: number;
}

export interface DeviceCheck extends DeviceSpec {
  status: DeviceStatus;
  // The Hoot log it's in, or null when it isn't in any.
  hoot: string | null;
  samples: number;
  // Samples a second, over the span.
  rate: number;
  // The longest without a sample, from the span's start to its end.
  longestGap: number | null;
  faults: DeviceFaultCount[];
  // Current limits holding: information.
  limits: DeviceFaultCount[];
  // Sticky faults set: information.
  sticky: string[];
  problems: string[];
}

export interface DeviceHealth {
  logs: LogCheck[];
  devices: DeviceCheck[];
}

// What the report found of a device in the logs.
export interface DeviceFound {
  // The Hoot log its signals are in (its label), or null.
  hoot: string | null;
  // Times of its logging signal, or null if it couldn't be read.
  times: ArrayLike<number> | null;
  // Its fault events (Fault_ and StickyFault_), in the span.
  faults: LogEvent[];
}

export interface HootFound {
  bus: string;
  label: string;
  name: string;
  state: HootState;
  message: string;
}

// As written in a template's editor: a device a line, "TalonFX-2, Module 0
// drive, canivore" (the bus is rio or canivore; canivore unless it says).
export const deviceLines = (specs: DeviceSpec[]) => specs.map((s) => `${s.device}, ${s.label}, ${s.bus}`).join('\n');

export function parseDeviceLines(text: string): DeviceSpec[] {
  const out: DeviceSpec[] = [];
  for (const line of text.split('\n')) {
    const [device = '', label = '', bus = ''] = line.split(',').map((part) => part.trim());
    if (!/^[A-Za-z0-9]+-\d{1,3}$/.test(device) || out.some((s) => s.device === device)) continue;
    out.push({ device, label: label || device, bus: bus.toLowerCase() === 'rio' ? 'rio' : 'canivore' });
  }
  return out;
}

const inSpans = (t: number, spans: [number, number][]) => spans.some(([s, e]) => t >= s && t <= e);

// The longest stretch of the spans without a sample, edges included.
export function longestGap(times: ArrayLike<number>, spans: [number, number][]): number {
  let longest = 0;
  for (const [start, end] of spans) {
    let last = start;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t < start) continue;
      if (t > end) break;
      longest = Math.max(longest, t - last);
      last = t;
    }
    longest = Math.max(longest, end - last);
  }
  return longest;
}

const isSticky = (event: LogEvent) => /\/StickyFault_/.test(event.key ?? '');

// "TalonFX-2: bridge brownout" -> "bridge brownout"; "(sticky)" off.
const faultName = (event: LogEvent) => event.title.replace(/^[^:]*:\s*/, '').replace(/\s*\(sticky\)$/, '');

function countFaults(events: LogEvent[], spans: [number, number][]): DeviceFaultCount[] {
  const byTitle = new Map<string, DeviceFaultCount>();
  for (const event of events) {
    const title = faultName(event);
    const entry = byTitle.get(title) ?? { title, count: 0, seconds: 0 };
    entry.count += event.count || 1;
    const end = event.end ?? event.start;
    for (const [s, e] of spans) entry.seconds += Math.max(0, Math.min(end, e) - Math.max(event.start, s));
    byTitle.set(title, entry);
  }
  return [...byTitle.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

const worst = (statuses: DeviceStatus[]): DeviceStatus =>
  statuses.includes('error') ? 'error' : statuses.includes('warning') ? 'warning' : 'ok';

export function checkDevices(
  specs: DeviceSpec[],
  dataLog: string | null,
  hoots: HootFound[],
  found: (device: string) => DeviceFound,
  spans: [number, number][]
): DeviceHealth {
  const logs: LogCheck[] = [{
    label: 'Data log',
    file: dataLog,
    status: dataLog ? 'ok' : 'error',
    problem: dataLog ? '' : 'No data log (.wpilog) for this match.'
  }];
  // A Hoot log for each bus the devices are on, read.
  const busReadable = new Map<DeviceBus, string>();
  for (const bus of (['rio', 'canivore'] as const).filter((b) => specs.some((s) => s.bus === b))) {
    const label = `Hoot log (${busLabels[bus]})`;
    const onBus = hoots.filter((h) => busOf(h.bus) === bus);
    if (onBus.length === 0) {
      logs.push({ label, file: null, status: 'error', problem: `No Hoot log from the ${busLabels[bus]}.` });
      busReadable.set(bus, `there's no Hoot log from the ${busLabels[bus]}`);
      continue;
    }
    for (const hoot of onBus) {
      const readable = hoot.state === 'ready' || hoot.state === 'opening';
      logs.push({
        label,
        file: hoot.name,
        status: readable ? 'ok' : 'error',
        problem: readable ? '' : `Couldn't be read${hoot.message ? `: ${hoot.message}` : ` (${hoot.state})`}.`
      });
    }
    if (!onBus.some((h) => h.state === 'ready' || h.state === 'opening')) busReadable.set(bus, `the ${busLabels[bus]}'s Hoot log couldn't be read`);
  }

  const seconds = spans.reduce((t, [s, e]) => t + Math.max(0, e - s), 0);
  const devices = specs.map((spec): DeviceCheck => {
    const check: DeviceCheck = { ...spec, status: 'ok', hoot: null, samples: 0, rate: 0, longestGap: null, faults: [], limits: [], sticky: [], problems: [] };
    const noBus = busReadable.get(spec.bus);
    if (noBus) {
      // Said once, of the log: not again for each device on it.
      check.status = 'error';
      check.problems.push(`Not checked: ${noBus}.`);
      return check;
    }
    const of = found(spec.device);
    check.hoot = of.hoot;
    if (!of.hoot) {
      check.status = 'error';
      check.problems.push(`Not in the Hoot logs: not on the CAN bus, or not logged.`);
      return check;
    }
    const statuses: DeviceStatus[] = [];
    if (!of.times) {
      statuses.push('error');
      check.problems.push(`Its ${loggingSignal(spec.device).split('/')[1]} couldn't be read.`);
    } else {
      let samples = 0;
      for (let i = 0; i < of.times.length; i++) if (inSpans(of.times[i], spans)) samples++;
      check.samples = samples;
      check.rate = seconds > 0 ? samples / seconds : 0;
      check.longestGap = longestGap(of.times, spans);
      if (samples === 0) {
        statuses.push('error');
        check.problems.push('Not logging: no samples in the span.');
      } else if (check.longestGap > maxGapSeconds) {
        statuses.push('error');
        check.problems.push(`Stopped logging for ${check.longestGap.toFixed(1)} s.`);
      }
    }
    const live = of.faults.filter((e) => !isSticky(e));
    check.faults = countFaults(live.filter((e) => !currentLimit.test(e.key ?? '')), spans);
    check.limits = countFaults(live.filter((e) => currentLimit.test(e.key ?? '')), spans);
    check.sticky = [...new Set(of.faults.filter(isSticky).map(faultName))].sort();
    for (const fault of check.faults) {
      statuses.push('error');
      check.problems.push(`Fault: ${fault.title}${fault.count > 1 ? `, ${fault.count} times` : ''}.`);
    }
    check.status = worst(statuses);
    return check;
  });
  return { logs, devices };
}

// A Device Health section's errors, as a report's problems: each log
// missing or unreadable, each device missing or not logging (at the span's
// start), and each fault while it was on (as an error, whatever it was).
export function deviceProblems(health: DeviceHealth, spans: [number, number][], found: (device: string) => DeviceFound): LogEvent[] {
  const start = spans[0]?.[0] ?? 0;
  const at = (id: string, title: string, detail: string): LogEvent =>
    ({ id, kind: 'fault', severity: 'error', start, end: null, title, detail, count: 1, key: null });
  const out: LogEvent[] = [];
  for (const log of health.logs) {
    if (log.status === 'error') out.push(at(`device-log:${log.label}:${log.file ?? ''}`, `${log.label}: ${log.file ? "couldn't be read" : 'missing'}`, log.problem));
  }
  for (const device of health.devices) {
    if (device.status !== 'error' || device.problems[0]?.startsWith('Not checked')) continue;
    const name = `${device.device} (${device.label})`;
    if (!device.hoot) {
      out.push(at(`device:${device.device}:missing`, `${name}: not in the Hoot logs`, device.problems[0]));
      continue;
    }
    for (const problem of device.problems.filter((p) => !p.startsWith('Fault:'))) {
      // "Stopped logging for 30.0 s." -> "stopped logging for 30.0 s"; "Not logging: ..." -> "not logging".
      const title = problem.replace(/:.*$/, '').replace(/\.$/, '');
      out.push(at(`device:${device.device}:${title}`, `${name}: ${title[0].toLowerCase()}${title.slice(1)}`, problem));
    }
    if (device.faults.length) {
      for (const event of found(device.device).faults) {
        if (isSticky(event) || currentLimit.test(event.key ?? '')) continue;
        out.push({ ...event, id: `device:${event.id}`, severity: 'error', title: `${device.device} (${device.label}): ${faultName(event)}` });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
