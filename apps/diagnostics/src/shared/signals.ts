// The signal framework both sides share: what a signal is, how it's named
// and grouped, and the time series read from it. The same catalog and
// series come from a log file (log review, #94) or, later, from the robot
// live (#93), so dashboards work the same on both.
//
// Nothing here may touch Node or the DOM.

export type SignalKind = 'number' | 'boolean' | 'string' | 'other';

export interface SignalInfo {
  // Unique within its source: the log entry's name, or for a field of a
  // struct or an element of an array, the entry's name and the path to it
  // (`/Robot/robot/drive/estimators/fused/pose/translation/x`).
  key: string;
  // For people: the path below the subsystem (`estimators / fused / pose / translation / x`).
  name: string;
  // The subsystem it belongs to, from its path (`drive`). '' when the path
  // doesn't say.
  subsystem: string;
  // The logged type: 'double', 'struct:Pose2d', ...
  type: string;
  kind: SignalKind;
  // '' when not known.
  unit: string;
  // How many values it has.
  count: number;
  // Who logged it, from the entry's metadata: 'DogLog', 'NT', ... or ''.
  source: string;
  // For a struct field or an array element, the key of the signal it's part of.
  parent?: string;
}

// Values over time. Times are seconds since the source's start. Numbers and
// booleans (0 or 1) are `Float64Array`; strings are strings.
export interface SignalSeries {
  key: string;
  kind: SignalKind;
  times: Float64Array;
  values: Float64Array | string[];
  // Whether values were dropped to fit `maxPoints` (the smallest and
  // largest of each stretch are kept, so peaks still show).
  downsampled: boolean;
  // Of what held during the range read, of every value, not only those
  // sent: the value carried in from before the start counts, and the mean
  // is weighted by how long each value held (values are only logged when
  // they change). Null for strings, or when there are none.
  stats: { min: number; max: number; mean: number } | null;
}

export interface SignalRange {
  // Seconds, as in SignalSeries.times. Leave out for the start or end.
  start?: number;
  end?: number;
  // At most this many points; more are downsampled. Leave out for all.
  maxPoints?: number;
}

// --- Naming ---

// Leading path segments that hold everything rather than saying what it is:
// DogLog's /Robot/robot/..., AdvantageKit's /RealOutputs/..., ...
const rootSegments = new Set(['robot', 'realoutputs', 'advantagekit', 'smartdashboard', 'shuffleboard', 'nt:']);

// The entry name split into its subsystem and the rest.
export function splitName(entryName: string): { subsystem: string; rest: string[] } {
  const segments = entryName.replace(/^NT:/, '').split('/').filter((segment) => segment !== '');
  while (segments.length > 1 && rootSegments.has(segments[0].toLowerCase())) segments.shift();
  if (segments.length === 1) return { subsystem: '', rest: segments };
  return { subsystem: segments[0], rest: segments.slice(1) };
}

// --- Units ---

const unitNames: Record<string, string> = {
  amp: 'A',
  amps: 'A',
  ampere: 'A',
  volt: 'V',
  volts: 'V',
  celsius: '°C',
  microsecond: 'µs',
  millisecond: 'ms',
  second: 's',
  seconds: 's',
  meter: 'm',
  meters: 'm',
  degree: '°',
  degrees: '°',
  radian: 'rad',
  radians: 'rad',
  rotation: 'rot',
  rotations: 'rot',
  percent: '%',
  watt: 'W',
  watts: 'W'
};

// What a name ends in, for code that puts the unit in the name. Longest first.
const unitSuffixes: [RegExp, string][] = [
  [/(MPS|MetersPerSec(ond)?)$/, 'm/s'],
  [/(RPS|RotPerSec|RotationsPerSec(ond)?)$/, 'rot/s'],
  [/RPM$/, 'rpm'],
  [/(DegPerSec|DPS)$/, '°/s'],
  [/(RadPerSec)$/, 'rad/s'],
  [/(Celsius|Celcius|TempC)$/i, '°C'],
  [/(Volts|Voltage|Volt)$/i, 'V'],
  [/(Amps|Current)$/i, 'A'],
  [/(Meters|Meter)$/, 'm'],
  [/(Deg|Degrees)$/, '°'],
  [/(Rad|Radians)$/, 'rad'],
  [/(Rot|Rotations)$/, 'rot'],
  [/(Ms|Millis)$/, 'ms'],
  [/(Sec|Seconds|Secs)$/, 's'],
  [/Percent$/, '%']
];

// A unit from the entry's metadata (DogLog's `unit`, NetworkTables'
// `properties.unit`), or failing that, from how the name ends.
export function unitFor(entryName: string, metadata: Record<string, unknown>): string {
  const properties = metadata.properties as Record<string, unknown> | undefined;
  const declared = metadata.unit ?? properties?.unit;
  if (typeof declared === 'string' && declared !== '') return unitNames[declared.toLowerCase()] ?? declared;

  const last = entryName.split('/').pop() ?? '';
  for (const [suffix, unit] of unitSuffixes) if (suffix.test(last)) return unit;
  return '';
}

// Units of the fields of WPILib's own structs, by the end of the path to
// them: a Pose2d's translation/x is metres, its rotation/value radians.
const structFieldUnits: [RegExp, string][] = [
  [/(^|\/)(translation\/)?[xyz]$/, 'm'],
  [/(^|\/)(rotation|angle)\/value$|(^|\/)value$/, 'rad'],
  [/(^|\/)(speed|vx|vy|vz)$/, 'm/s'],
  [/(^|\/)omega$/, 'rad/s'],
  [/(^|\/)distance$/, 'm']
];

// `path` is the field path inside a struct of type `structType` (`struct:Pose2d`).
export function structFieldUnit(structType: string, path: string): string {
  if (!/^struct:(Pose|Translation|Rotation|Transform|Twist|SwerveModule|ChassisSpeeds)/.test(structType)) return '';
  for (const [pattern, unit] of structFieldUnits) if (pattern.test(path)) return unit;
  return '';
}

export function parseMetadata(metadata: string): Record<string, unknown> {
  if (!metadata.startsWith('{')) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// --- Built-in groupings ---
//
// The metric lists from the requirements (§3.2), matched by name, so they
// find a robot's signals without the app knowing its code. A metric matches
// a signal when every `all` pattern and no `none` pattern is found in the
// signal's key, lowercased. Team-defined subsystems need no rules: they're
// grouped by subsystem.

export interface GroupMetric {
  name: string;
  all: RegExp[];
  none?: RegExp[];
}

export interface SignalGroup {
  id: string;
  name: string;
  metrics: GroupMetric[];
}

const swerve = /swerve|module|mod\d|\b(fl|fr|bl|br)\b|front.?left|front.?right|back.?left|back.?right/;
const steer = /steer|angle|azimuth|turn/;
// "drive" below a module (mod0/Drive Motor/...), not the drive subsystem
// the module is in (drive/swerve/...).
const moduleDrive = /(swerve|module|mod\d)\/.*drive/;
const gyro = /gyro|pigeon|navx|imu|ahrs/;

export const builtInGroups: SignalGroup[] = [
  {
    id: 'power',
    name: 'Power',
    metrics: [
      { name: 'Battery voltage', all: [/battery.?voltage|vbat|bus.?voltage|batt?.?volt|inputvoltage/] },
      { name: 'Battery current', all: [/battery.?current|total.?current|input.?current/] },
      { name: 'Brownouts', all: [/brown(ed)?.?out/] },
      { name: 'Power rails', all: [/(3v3|5v|6v).?rail/] },
      { name: 'Power distribution', all: [/pdh|pdp|power.?distribution/] }
    ]
  },
  {
    id: 'can',
    name: 'CAN / motor controllers',
    metrics: [
      { name: 'CAN bus utilization', all: [/(can|canivore|bus).*utili[sz]ation/] },
      { name: 'CAN errors', all: [/(can|canivore|bus)/, /error|off.?count|tx.?full|bus.?off/] },
      { name: 'Motor current', all: [/stator.?current|supply.?current|torque.?current|motor.*current/] },
      { name: 'Motor temperature', all: [/temp/], none: [/cpu/] },
      { name: 'Motor output', all: [/motor/, /voltage|duty.?cycle|output|applied/] },
      { name: 'Faults', all: [/fault/] }
    ]
  },
  {
    id: 'performance',
    name: 'Robot performance',
    metrics: [
      { name: 'Loop timing', all: [/loop.?(time|period|duration|overrun)|cycle.?time|overrun/] },
      { name: 'CPU', all: [/cpu/] },
      { name: 'Memory', all: [/memory|heap|\bram\b/] },
      { name: 'Robot mode', all: [/(auto|teleop|test|robot).?(mode|enabled)|ds:(enabled|autonomous|test)|selected.?mode/] },
      { name: 'Subsystem state', all: [/\/state$|current.?command|active.?command/] },
      { name: 'Network', all: [/radio|latency|packet|network/] },
      { name: 'Alerts', all: [/alerts\/(errors|warnings)/] }
    ]
  },
  {
    id: 'drivetrain',
    name: 'Drivetrain',
    metrics: [
      { name: 'Module angles', all: [swerve, steer], none: [/target|setpoint|desired|error|current$|stator|supply|volt|vel|kv|ks/] },
      { name: 'Module target angles', all: [swerve, steer, /target|setpoint|desired/], none: [/kv|ks|volt/] },
      { name: 'Steering error', all: [swerve, steer, /error/] },
      { name: 'Drive velocity', all: [moduleDrive, /vel|speed/], none: [/kv|ks|volt|target|setpoint|desired/] },
      { name: 'Drive current', all: [moduleDrive, /current/], none: [/currentvel|currentpos/] },
      { name: 'Module temperature', all: [swerve, /temp/] },
      { name: 'Gyro heading', all: [gyro, /yaw|heading|angle$|rotation/] },
      { name: 'Gyro rate', all: [gyro, /rate|angular|omega|velocity/] },
      { name: 'Odometry', all: [/odometry|estimat|pose/] }
    ]
  }
];

export function matchesMetric(metric: GroupMetric, key: string): boolean {
  const text = key.toLowerCase();
  return metric.all.every((pattern) => pattern.test(text)) && !(metric.none ?? []).some((pattern) => pattern.test(text));
}

export interface GroupedMetric {
  name: string;
  // Keys of the signals that match, in catalog order.
  keys: string[];
}

export interface GroupedSignals {
  id: string;
  name: string;
  metrics: GroupedMetric[];
}

// Sorts a catalog into the built-in groups. Struct fields and array
// elements are matched by their own keys; their parent struct isn't listed
// too. A signal can be in more than one metric.
export function groupSignals(signals: SignalInfo[], groups = builtInGroups): GroupedSignals[] {
  const leaves = signals.filter((signal) => signal.kind !== 'other');
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    metrics: group.metrics.map((metric) => ({
      name: metric.name,
      keys: leaves.filter((signal) => matchesMetric(metric, signal.key)).map((signal) => signal.key)
    }))
  }));
}
