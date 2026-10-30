// Signals read from a WPILib data log: the catalog of what's in it, and the
// values of any one signal over time. Live signals from the robot (#93) are
// to offer the same two things.

import {
  parseMetadata,
  splitName,
  structFieldUnit,
  unitFor,
  type SignalInfo,
  type SignalKind,
  type SignalRange,
  type SignalSeries
} from '@shared/signals';
import { StructRegistry } from './structs';
import { decodeValue, parseLog, type LogValue, type ParsedLog } from './wpilog';

const kinds: Record<string, SignalKind> = {
  double: 'number',
  float: 'number',
  int64: 'number',
  boolean: 'boolean',
  string: 'string',
  json: 'string'
};

// Arrays longer than this aren't split into one signal per element.
const maxElements = 32;

// Where a signal's values come from: an entry, and for a struct field or an
// array element, the path into each decoded value.
interface Location {
  entry: number;
  path: (string | number)[];
  kind: SignalKind;
}

// The value at `path` inside a decoded struct or array.
function pick(value: LogValue, path: (string | number)[]): LogValue | undefined {
  let at: LogValue | undefined = value;
  for (const step of path) {
    if (at === undefined || at === null || typeof at !== 'object' || at instanceof Uint8Array) return undefined;
    at = (at as Record<string | number, LogValue>)[step];
  }
  return at;
}

function asNumber(value: LogValue | undefined): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
}

export class LogSignalSource {
  private log: ParsedLog;
  private structs = new StructRegistry();
  private locations = new Map<string, Location>();
  private signals: SignalInfo[] = [];

  // The first and last record's times, in seconds since the robot program
  // started. Series times are counted from `firstTime`.
  readonly firstTime: number;
  readonly lastTime: number;
  // When `firstTime` was, by the clock, if the log says (an ISO time).
  readonly startedAt: string | null;
  readonly truncated: boolean;

  constructor(private bytes: Uint8Array) {
    this.log = parseLog(bytes);
    this.truncated = this.log.truncated;

    let first = Infinity;
    let last = -Infinity;
    for (const records of this.log.records) {
      if (records.length === 0) continue;
      first = Math.min(first, records[0].timestamp);
      last = Math.max(last, records[records.length - 1].timestamp);
    }
    this.firstTime = Number.isFinite(first) ? first / 1e6 : 0;
    this.lastTime = Number.isFinite(last) ? last / 1e6 : 0;

    // Struct schemas first: the catalog needs them to see inside structs.
    for (const [index, entry] of this.log.entries.entries()) {
      if (entry.type !== 'structschema' || !entry.name.includes('struct:')) continue;
      const records = this.log.records[index];
      if (records.length === 0) continue;
      const schema = decodeValue(bytes, records[records.length - 1], 'string');
      this.structs.add(entry.name.slice(entry.name.indexOf('struct:') + 'struct:'.length), schema as string);
    }

    this.startedAt = this.findStartedAt();
    this.buildCatalog();
  }

  catalog(): SignalInfo[] {
    return this.signals;
  }

  // DataLogManager logs `systemTime`, the clock in microseconds, once the
  // Driver Station has set it. Its last value is the likeliest to be right.
  private findStartedAt(): string | null {
    const index = this.log.entries.findIndex((entry) => entry.name === 'systemTime' && entry.type === 'int64');
    const records = index === -1 ? [] : this.log.records[index];
    if (records.length === 0) return null;
    const record = records[records.length - 1];
    const clock = decodeValue(this.bytes, record, 'int64') as number;
    const started = (clock - (record.timestamp - this.firstTime * 1e6)) / 1000;
    return started >= Date.UTC(2020, 0, 1) ? new Date(started).toISOString() : null;
  }

  private sortedEntries = new Map<number, boolean>();

  private inTimeOrder(entry: number): boolean {
    let sorted = this.sortedEntries.get(entry);
    if (sorted === undefined) {
      const records = this.log.records[entry];
      sorted = records.every((record, i) => i === 0 || records[i - 1].timestamp <= record.timestamp);
      this.sortedEntries.set(entry, sorted);
    }
    return sorted;
  }

  private buildCatalog() {
    for (const [index, entry] of this.log.entries.entries()) {
      if (entry.type === 'structschema' || entry.name.startsWith('/.schema/')) continue;

      const metadata = parseMetadata(entry.metadata);
      const source = typeof metadata.source === 'string' ? metadata.source : '';
      const records = this.log.records[index];
      const { subsystem, rest } = splitName(entry.name);
      const kind = kinds[entry.type] ?? 'other';

      const info: SignalInfo = {
        key: entry.name,
        name: rest.join(' / '),
        subsystem,
        type: entry.type,
        kind,
        unit: kind === 'number' ? unitFor(entry.name, metadata) : '',
        count: records.length,
        source
      };
      // A name logged twice (an entry finished and started again) keeps its
      // first catalog place; its values are read from the later entry.
      if (!this.locations.has(info.key)) this.signals.push(info);
      this.locations.set(info.key, { entry: index, path: [], kind });

      // Structs and arrays: a numeric signal for each field or element,
      // shaped like the first value.
      if (kind !== 'other' || records.length === 0) continue;
      const sample = decodeValue(this.bytes, records[0], entry.type, this.structs);
      if (sample instanceof Uint8Array || typeof sample !== 'object') continue;
      this.addChildren(info, index, sample, [], records.length);
    }
  }

  private addChildren(parent: SignalInfo, entry: number, value: LogValue, path: (string | number)[], count: number) {
    if (Array.isArray(value) && value.length > maxElements) return;
    const parts: [string | number, LogValue][] = Array.isArray(value)
      ? value.map((item, i) => [i, item])
      : Object.entries(value as Record<string, LogValue>);

    for (const [step, item] of parts) {
      const childPath = [...path, step];
      if (typeof item === 'number' || typeof item === 'boolean') {
        const key = `${parent.key}/${childPath.join('/')}`;
        const kind: SignalKind = typeof item === 'number' ? 'number' : 'boolean';
        this.signals.push({
          key,
          name: `${parent.name} / ${childPath.join(' / ')}`,
          subsystem: parent.subsystem,
          type: parent.type,
          kind,
          unit: kind === 'number' ? structFieldUnit(parent.type.replace(/\[\]$/, ''), childPath.filter((s) => typeof s === 'string').join('/')) : '',
          count,
          source: parent.source,
          parent: parent.key
        });
        this.locations.set(key, { entry, path: childPath, kind });
      } else if (item && typeof item === 'object' && !(item instanceof Uint8Array)) {
        this.addChildren(parent, entry, item, childPath, count);
      }
    }
  }

  read(key: string, range: SignalRange = {}): SignalSeries | null {
    const location = this.locations.get(key);
    if (!location) return null;
    const entry = this.log.entries[location.entry];
    const records = this.log.records[location.entry];
    const start = range.start ?? -Infinity;
    const end = range.end ?? Infinity;

    // Entries are nearly always written in time order; then the range is
    // found by binary search, and the value just outside each end is
    // included so a zoomed-in line reaches the edges. Stats are of the
    // range only.
    const sorted = this.inTimeOrder(location.entry);
    const timeAt = (i: number) => records[i].timestamp / 1e6 - this.firstTime;
    let first = 0;
    let last = records.length;
    if (sorted) {
      first = Math.max(0, firstAtOrAfter(records.length, timeAt, start) - (range.start === undefined ? 0 : 1));
      last = Math.min(records.length, firstAtOrAfter(records.length, timeAt, end, true) + (range.end === undefined ? 0 : 1));
    }

    const times: number[] = [];
    const strings: string[] = [];
    const numbers: number[] = [];
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let counted = 0;
    for (let i = first; i < last; i++) {
      const time = timeAt(i);
      const inRange = time >= start && time <= end;
      if (!inRange && !sorted) continue;
      const decoded = decodeValue(this.bytes, records[i], entry.type, this.structs);
      const value = location.path.length === 0 ? decoded : pick(decoded, location.path);
      if (location.kind === 'string') {
        if (typeof value !== 'string') continue;
        strings.push(value);
      } else {
        const number = asNumber(value);
        if (number === null) continue;
        numbers.push(number);
        if (inRange) {
          if (number < min) min = number;
          if (number > max) max = number;
          sum += number;
          counted += 1;
        }
      }
      times.push(time);
    }

    if (location.kind === 'string' || location.kind === 'other') {
      return { key, kind: location.kind, times: Float64Array.from(times), values: strings, downsampled: false, stats: null };
    }

    const stats: SignalSeries['stats'] = counted > 0 ? { min, max, mean: sum / counted } : null;

    const maxPoints = range.maxPoints ?? Infinity;
    if (numbers.length <= maxPoints) {
      return { key, kind: location.kind, times: Float64Array.from(times), values: Float64Array.from(numbers), downsampled: false, stats };
    }
    const reduced = downsample(times, numbers, maxPoints);
    return { key, kind: location.kind, times: reduced.times, values: reduced.values, downsampled: true, stats };
  }
}

// The first index whose time is at or after `time` (after it, with
// `after`), in times sorted ascending; `count` if there's none.
function firstAtOrAfter(count: number, timeAt: (i: number) => number, time: number, after = false): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (after ? timeAt(mid) <= time : timeAt(mid) < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

// Splits the time span into maxPoints / 2 stretches and keeps each one's
// smallest and largest value, in time order, so peaks and dips survive.
export function downsample(times: number[], values: number[], maxPoints: number): { times: Float64Array; values: Float64Array } {
  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const first = times[0];
  const span = times[times.length - 1] - first || 1;
  const outTimes: number[] = [];
  const outValues: number[] = [];

  let i = 0;
  for (let bucket = 0; bucket < buckets && i < times.length; bucket++) {
    const bucketEnd = bucket === buckets - 1 ? Infinity : first + (span * (bucket + 1)) / buckets;
    let low = -1;
    let high = -1;
    for (; i < times.length && times[i] < bucketEnd; i++) {
      if (low === -1 || values[i] < values[low]) low = i;
      if (high === -1 || values[i] > values[high]) high = i;
    }
    if (low === -1) continue;
    for (const at of low === high ? [low] : low < high ? [low, high] : [high, low]) {
      outTimes.push(times[at]);
      outValues.push(values[at]);
    }
  }
  return { times: Float64Array.from(outTimes), values: Float64Array.from(outValues) };
}
