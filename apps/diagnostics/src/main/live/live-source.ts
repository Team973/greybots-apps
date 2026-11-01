// Signals as they come from the robot over NetworkTables: the same catalog
// and series as a data log (../signals/log-source.ts), over the last few
// minutes. Times are seconds since connecting, by the robot's clock.

import { liveKeepSeconds } from '@shared/live';
import { splitName, unitFor, type SignalInfo, type SignalKind, type SignalRange, type SignalSeries } from '@shared/signals';
import { asNumber, downsample, fieldSignals, firstAtOrAfter, heldStats, pick } from '../signals/log-source';
import { StructRegistry } from '../signals/structs';
import type { LogValue } from '../signals/wpilog';
import type { PackValue } from './msgpack';
import type { Nt4Topic } from './nt4-client';

const keepSeconds = liveKeepSeconds;

const kinds: Record<string, SignalKind> = {
  double: 'number',
  float: 'number',
  int: 'number',
  boolean: 'boolean',
  string: 'string',
  json: 'string'
};

const textDecoder = new TextDecoder();

interface TopicBuffer {
  topic: Nt4Topic;
  // Seconds since `origin`, in arrival order (NT4 sends each topic's
  // changes in order). Values before `first` have been let go.
  times: number[];
  values: LogValue[];
  first: number;
}

interface Location {
  name: string;
  path: (string | number)[];
  kind: SignalKind;
}

export class LiveSignalSource {
  private buffers = new Map<string, TopicBuffer>();
  private structs = new StructRegistry();
  private signals: SignalInfo[] | null = null;
  private locations = new Map<string, Location>();
  // How many values have come in, all topics: tells the window when to look again.
  received = 0;
  // Seconds since `origin`: the robot's clock now.
  now = 0;

  // `originUs`: the robot's clock when we connected, µs.
  constructor(readonly originUs: number) {}

  // When the robot's clock has gone back (robot code restarted in a
  // simulator, or a roboRIO rebooted), a new source is needed.
  continues(serverUs: number): boolean {
    return serverUs >= this.originUs + this.now * 1e6 - 1e6;
  }

  announce(topic: Nt4Topic) {
    const buffer = this.buffers.get(topic.name);
    if (buffer) buffer.topic = topic;
    else this.buffers.set(topic.name, { topic, times: [], values: [], first: 0 });
    this.signals = null;
  }

  add(topic: Nt4Topic, timeUs: number, raw: PackValue) {
    // Struct schemas: to see inside struct values.
    if (topic.type === 'structschema' && topic.name.startsWith('/.schema/struct:') && raw instanceof Uint8Array) {
      this.structs.add(topic.name.slice('/.schema/struct:'.length), textDecoder.decode(raw));
      this.signals = null;
      return;
    }
    let buffer = this.buffers.get(topic.name);
    if (!buffer) {
      this.announce(topic);
      buffer = this.buffers.get(topic.name)!;
    }
    // Values set before we connected start at 0: what they were is what held.
    const time = Math.max(0, (timeUs - this.originUs) / 1e6);
    const value = raw === null ? null : (raw as LogValue);
    if (value === null) return;
    // A first value: the catalog changes (it has values now; a struct's or
    // an array's fields become signals too). Counts are otherwise left as
    // they were when the catalog was made.
    if (buffer.values.length === buffer.first) this.signals = null;
    buffer.times.push(time);
    buffer.values.push(value);
    this.received += 1;
    this.now = Math.max(this.now, time);
    this.trim(buffer);
  }

  private trim(buffer: TopicBuffer) {
    const cutoff = this.now - keepSeconds;
    while (buffer.first + 1 < buffer.times.length && buffer.times[buffer.first + 1] <= cutoff) buffer.first += 1;
    if (buffer.first > 4096 && buffer.first * 2 > buffer.times.length) {
      buffer.times.splice(0, buffer.first);
      buffer.values.splice(0, buffer.first);
      buffer.first = 0;
    }
  }

  // Where the window's timeline starts: values older than kept are gone.
  get start(): number {
    return Math.max(0, this.now - keepSeconds);
  }

  private decode(buffer: TopicBuffer, value: LogValue): LogValue {
    const { type } = buffer.topic;
    if (value instanceof Uint8Array && type.startsWith('struct:')) return this.structs.decode(type.slice('struct:'.length), value) ?? value;
    return value;
  }

  catalog(): SignalInfo[] {
    if (this.signals) return this.signals;
    const signals: SignalInfo[] = [];
    this.locations.clear();
    for (const buffer of [...this.buffers.values()].sort((a, b) => a.topic.name.localeCompare(b.topic.name))) {
      const { name, type, properties } = buffer.topic;
      if (type === 'structschema' || name.startsWith('/.schema/')) continue;
      const kind = kinds[type] ?? 'other';
      const { subsystem, rest } = splitName(name);
      const info: SignalInfo = {
        key: name,
        name: rest.join(' / '),
        subsystem,
        type,
        kind,
        unit: kind === 'number' ? unitFor(name, { properties }) : '',
        count: buffer.values.length - buffer.first,
        source: 'NT'
      };
      signals.push(info);
      this.locations.set(name, { name, path: [], kind });
      if (kind !== 'other' || buffer.values.length === buffer.first) continue;
      for (const field of fieldSignals(info, this.decode(buffer, buffer.values[buffer.values.length - 1]))) {
        signals.push(field.info);
        this.locations.set(field.info.key, { name, path: field.path, kind: field.info.kind });
      }
    }
    this.signals = signals;
    return signals;
  }

  read(key: string, range: SignalRange = {}): SignalSeries | null {
    if (!this.signals) this.catalog();
    const location = this.locations.get(key);
    const buffer = location && this.buffers.get(location.name);
    if (!location || !buffer) return null;
    const start = range.start ?? -Infinity;
    const end = range.end ?? Infinity;

    // As in a data log: the range by binary search, and the value just
    // outside each end, so the line reaches the edges.
    const count = buffer.times.length - buffer.first;
    const timeAt = (i: number) => buffer.times[buffer.first + i];
    const first = Math.max(0, firstAtOrAfter(count, timeAt, start) - (range.start === undefined ? 0 : 1));
    const last = Math.min(count, firstAtOrAfter(count, timeAt, end, true) + (range.end === undefined ? 0 : 1));

    const times: number[] = [];
    const strings: string[] = [];
    const numbers: number[] = [];
    for (let i = first; i < last; i++) {
      const raw = buffer.values[buffer.first + i];
      const decoded = location.path.length === 0 ? raw : pick(this.decode(buffer, raw), location.path);
      if (location.kind === 'string') {
        if (typeof decoded !== 'string') continue;
        strings.push(decoded);
      } else {
        const number = asNumber(decoded);
        if (number === null) continue;
        numbers.push(number);
      }
      times.push(timeAt(i));
    }

    if (location.kind === 'string' || location.kind === 'other') {
      return { key, kind: location.kind, times: Float64Array.from(times), values: strings, downsampled: false, stats: null };
    }
    const stats = heldStats(times, numbers, start, end, this.now);
    const maxPoints = range.maxPoints ?? Infinity;
    if (numbers.length <= maxPoints) {
      return { key, kind: location.kind, times: Float64Array.from(times), values: Float64Array.from(numbers), downsampled: false, stats };
    }
    const reduced = downsample(times, numbers, maxPoints);
    return { key, kind: location.kind, times: reduced.times, values: reduced.values, downsampled: true, stats };
  }
}
