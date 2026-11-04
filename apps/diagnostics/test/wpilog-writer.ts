// Writes small WPILib data logs for tests, in the format DataLogManager
// writes (https://github.com/wpilibsuite/allwpilib/blob/main/wpiutil/doc/datalog.adoc):
// a header, then records, each with 4-byte entry ids and sizes and 8-byte
// timestamps (microseconds). Entry 0's records start entries.

const encoder = new TextEncoder();

export const utf8 = (text: string) => encoder.encode(text);

export function doubles(...values: number[]): Uint8Array {
  const view = new DataView(new ArrayBuffer(values.length * 8));
  values.forEach((value, i) => view.setFloat64(i * 8, value, true));
  return new Uint8Array(view.buffer);
}

export class LogWriter {
  private parts: Uint8Array[] = [];
  private nextId = 1;

  constructor() {
    const header = new DataView(new ArrayBuffer(12));
    utf8('WPILOG').forEach((byte, i) => header.setUint8(i, byte));
    header.setUint16(6, 0x0100, true);
    header.setUint32(8, 0, true);
    this.parts.push(new Uint8Array(header.buffer));
  }

  // Starts an entry; its id, for `append`.
  start(name: string, type: string, metadata = '', micros = 0): number {
    const id = this.nextId++;
    const strings = [name, type, metadata].map(utf8);
    const payload = new DataView(new ArrayBuffer(5 + strings.reduce((n, s) => n + 4 + s.length, 0)));
    payload.setUint8(0, 0);
    payload.setUint32(1, id, true);
    let at = 5;
    for (const s of strings) {
      payload.setUint32(at, s.length, true);
      new Uint8Array(payload.buffer).set(s, at + 4);
      at += 4 + s.length;
    }
    this.record(0, micros, new Uint8Array(payload.buffer));
    return id;
  }

  append(id: number, seconds: number, payload: Uint8Array) {
    this.record(id, Math.round(seconds * 1e6), payload);
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  private record(id: number, micros: number, payload: Uint8Array) {
    const head = new DataView(new ArrayBuffer(17));
    // 4-byte id and size, 8-byte timestamp.
    head.setUint8(0, 3 | (3 << 2) | (7 << 4));
    head.setUint32(1, id, true);
    head.setUint32(5, payload.length, true);
    head.setBigUint64(9, BigInt(micros), true);
    this.parts.push(new Uint8Array(head.buffer), payload);
  }
}

// A log with WPILib's Pose2d struct: its schemas, then the poses given
// (x, y, heading in radians) at the times given.
export function poseLog(name: string, poses: { time: number; x: number; y: number; heading: number }[]): LogWriter {
  const log = new LogWriter();
  const schemas: [string, string][] = [
    ['Translation2d', 'double x;double y'],
    ['Rotation2d', 'double value'],
    ['Pose2d', 'Translation2d translation;Rotation2d rotation']
  ];
  for (const [type, schema] of schemas) log.append(log.start(`/.schema/struct:${type}`, 'structschema'), 0, utf8(schema));
  const id = log.start(name, 'struct:Pose2d');
  for (const pose of poses) log.append(id, pose.time, doubles(pose.x, pose.y, pose.heading));
  return log;
}
