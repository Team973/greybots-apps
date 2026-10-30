// Reads WPILib data logs (.wpilog), the format DataLogManager writes. The
// format is documented at
// https://github.com/wpilibsuite/allwpilib/blob/main/wpiutil/doc/datalog.adoc
//
// A log is a header, then records. Each record belongs to an entry (a
// signal, by name and type), has a timestamp in microseconds since the
// robot program started, and a payload. Records for entry 0 are control
// records, which start and finish entries and set their metadata.
//
// Plain code over a Uint8Array: no Node, no Electron.

export interface LogEntry {
  id: number;
  name: string;
  // The data type: 'double', 'boolean[]', 'struct:Pose2d', ...
  type: string;
  // Free-form, often JSON (NetworkTables properties, units, ...).
  metadata: string;
  // When the entry was started, in microseconds.
  start: number;
}

export interface LogRecord {
  entry: number;
  timestamp: number;
  // Where the payload is in the log's bytes.
  offset: number;
  length: number;
}

export interface ParsedLog {
  // What the logger put in the header (often empty).
  extraHeader: string;
  // Every entry, by id. An id can be reused after its entry is finished;
  // the later entry gets a new key here (see `entryKeys`).
  entries: LogEntry[];
  // Each entry's records, in the order they were written, by index in
  // `entries`.
  records: LogRecord[][];
  // Records that couldn't be read, at the end of a log that was cut off.
  truncated: boolean;
}

const decoder = new TextDecoder('utf-8');

export class LogFormatError extends Error {}

// Little-endian unsigned integer of 1 to 8 bytes. Timestamps fit well
// within a double's 53 bits (that's 285 years of microseconds).
function readUint(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < length; i++) {
    value += bytes[offset + i] * scale;
    scale *= 256;
  }
  return value;
}

export function parseLog(bytes: Uint8Array): ParsedLog {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || decoder.decode(bytes.subarray(0, 6)) !== 'WPILOG') {
    throw new LogFormatError('Not a WPILib data log.');
  }
  const version = view.getUint16(6, true);
  if (version >> 8 !== 1) throw new LogFormatError(`Data log version ${version >> 8}.${version & 0xff} isn't supported.`);
  const extraLength = view.getUint32(8, true);
  const extraHeader = decoder.decode(bytes.subarray(12, 12 + extraLength));

  const entries: LogEntry[] = [];
  const records: LogRecord[][] = [];
  // Entry id -> index in `entries`, for the entries currently started.
  const live = new Map<number, number>();
  let truncated = false;

  let offset = 12 + extraLength;
  while (offset < bytes.length) {
    const bitfield = bytes[offset];
    const idLength = (bitfield & 0x3) + 1;
    const sizeLength = ((bitfield >> 2) & 0x3) + 1;
    const timestampLength = ((bitfield >> 4) & 0x7) + 1;
    const headerLength = 1 + idLength + sizeLength + timestampLength;
    if (offset + headerLength > bytes.length) {
      truncated = true;
      break;
    }

    const id = readUint(bytes, offset + 1, idLength);
    const size = readUint(bytes, offset + 1 + idLength, sizeLength);
    const timestamp = readUint(bytes, offset + 1 + idLength + sizeLength, timestampLength);
    const payload = offset + headerLength;
    if (payload + size > bytes.length) {
      truncated = true;
      break;
    }
    offset = payload + size;

    if (id !== 0) {
      const index = live.get(id);
      // Data for an entry that was never started is skipped, as WPILib's
      // own reader does.
      if (index !== undefined) records[index].push({ entry: index, timestamp, offset: payload, length: size });
      continue;
    }

    // A control record. A malformed one is skipped rather than ending the
    // log: everything after it may still be good.
    if (size < 5) continue;
    const kind = bytes[payload];
    const target = view.getUint32(payload + 1, true);
    try {
      if (kind === 0) {
        let at = payload + 5;
        const string = () => {
          const length = view.getUint32(at, true);
          const text = decoder.decode(bytes.subarray(at + 4, at + 4 + length));
          at += 4 + length;
          return text;
        };
        const name = string();
        const type = string();
        const metadata = string();
        if (at > payload + size) continue;
        live.set(target, entries.length);
        entries.push({ id: target, name, type, metadata, start: timestamp });
        records.push([]);
      } else if (kind === 1) {
        live.delete(target);
      } else if (kind === 2) {
        const index = live.get(target);
        const length = view.getUint32(payload + 5, true);
        if (index !== undefined) entries[index].metadata = decoder.decode(bytes.subarray(payload + 9, payload + 9 + length));
      }
    } catch {
      // A length running past the end of the payload: skipped.
    }
  }

  return { extraHeader, entries, records, truncated };
}

// --- Payloads ---

export type LogValue = boolean | number | bigint | string | Uint8Array | LogValue[] | { [field: string]: LogValue };

// Reads one record's payload as its entry's type. Struct types need their
// schemas (see structs.ts); anything not understood comes back as raw bytes.
export function decodeValue(bytes: Uint8Array, record: LogRecord, type: string, structs?: StructDecoder): LogValue {
  const data = bytes.subarray(record.offset, record.offset + record.length);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  switch (type) {
    case 'boolean':
      return data[0] !== 0;
    case 'int64':
      return Number(view.getBigInt64(0, true));
    case 'float':
      return view.getFloat32(0, true);
    case 'double':
      return view.getFloat64(0, true);
    case 'string':
    case 'json':
      return decoder.decode(data);
    case 'boolean[]':
      return Array.from(data, (b) => b !== 0);
    case 'int64[]':
      return Array.from({ length: data.length >> 3 }, (_, i) => Number(view.getBigInt64(i * 8, true)));
    case 'float[]':
      return Array.from({ length: data.length >> 2 }, (_, i) => view.getFloat32(i * 4, true));
    case 'double[]':
      return Array.from({ length: data.length >> 3 }, (_, i) => view.getFloat64(i * 8, true));
    case 'string[]': {
      const count = view.getUint32(0, true);
      const strings: string[] = [];
      let at = 4;
      for (let i = 0; i < count && at + 4 <= data.length; i++) {
        const length = view.getUint32(at, true);
        strings.push(decoder.decode(data.subarray(at + 4, at + 4 + length)));
        at += 4 + length;
      }
      return strings;
    }
  }

  if (structs && type.startsWith('struct:')) {
    const decoded = structs.decode(type.slice('struct:'.length), data);
    if (decoded !== null) return decoded;
  }
  return data;
}

// Supplied by structs.ts; declared here so this file doesn't depend on it.
export interface StructDecoder {
  decode(typeName: string, data: Uint8Array): LogValue | null;
}
