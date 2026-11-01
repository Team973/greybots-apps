// Just enough MessagePack (https://github.com/msgpack/msgpack/blob/master/spec.md)
// for NetworkTables 4, whose value messages are MessagePack arrays:
// [topic id, timestamp µs, type, value]. 64-bit integers come back as
// numbers: timestamps in µs fit well within 2^53.

export type PackValue = null | boolean | number | string | Uint8Array | PackValue[] | { [key: string]: PackValue };

const textDecoder = new TextDecoder();

// Every value in `bytes`, one after another (a frame can hold several).
export function unpackAll(bytes: Uint8Array): PackValue[] {
  const reader = new Reader(bytes);
  const values: PackValue[] = [];
  while (reader.at < bytes.length) values.push(reader.value());
  return values;
}

class Reader {
  at = 0;
  private view: DataView;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private take(length: number): number {
    const at = this.at;
    if (at + length > this.bytes.length) throw new Error('MessagePack value cut off');
    this.at += length;
    return at;
  }

  private str(length: number): string {
    const at = this.take(length);
    return textDecoder.decode(this.bytes.subarray(at, at + length));
  }

  private bin(length: number): Uint8Array {
    const at = this.take(length);
    return this.bytes.slice(at, at + length);
  }

  private array(length: number): PackValue[] {
    return Array.from({ length }, () => this.value());
  }

  private map(length: number): { [key: string]: PackValue } {
    const out: { [key: string]: PackValue } = {};
    for (let i = 0; i < length; i++) out[String(this.value())] = this.value();
    return out;
  }

  value(): PackValue {
    const view = this.view;
    const type = this.bytes[this.take(1)];
    if (type <= 0x7f) return type;
    if (type >= 0xe0) return type - 0x100;
    if ((type & 0xf0) === 0x80) return this.map(type & 0x0f);
    if ((type & 0xf0) === 0x90) return this.array(type & 0x0f);
    if ((type & 0xe0) === 0xa0) return this.str(type & 0x1f);
    switch (type) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return this.bin(view.getUint8(this.take(1)));
      case 0xc5: return this.bin(view.getUint16(this.take(2)));
      case 0xc6: return this.bin(view.getUint32(this.take(4)));
      case 0xca: return view.getFloat32(this.take(4));
      case 0xcb: return view.getFloat64(this.take(8));
      case 0xcc: return view.getUint8(this.take(1));
      case 0xcd: return view.getUint16(this.take(2));
      case 0xce: return view.getUint32(this.take(4));
      case 0xcf: return Number(view.getBigUint64(this.take(8)));
      case 0xd0: return view.getInt8(this.take(1));
      case 0xd1: return view.getInt16(this.take(2));
      case 0xd2: return view.getInt32(this.take(4));
      case 0xd3: return Number(view.getBigInt64(this.take(8)));
      case 0xd9: return this.str(view.getUint8(this.take(1)));
      case 0xda: return this.str(view.getUint16(this.take(2)));
      case 0xdb: return this.str(view.getUint32(this.take(4)));
      case 0xdc: return this.array(view.getUint16(this.take(2)));
      case 0xdd: return this.array(view.getUint32(this.take(4)));
      case 0xde: return this.map(view.getUint16(this.take(2)));
      case 0xdf: return this.map(view.getUint32(this.take(4)));
    }
    // Extension types: NT4 doesn't use them. Skipped, as null.
    const ext: Record<number, number> = { 0xd4: 1, 0xd5: 2, 0xd6: 4, 0xd7: 8, 0xd8: 16 };
    if (type in ext) {
      this.take(1 + ext[type]);
      return null;
    }
    if (type >= 0xc7 && type <= 0xc9) {
      const length = type === 0xc7 ? view.getUint8(this.take(1)) : type === 0xc8 ? view.getUint16(this.take(2)) : view.getUint32(this.take(4));
      this.take(1 + length);
      return null;
    }
    throw new Error(`Unknown MessagePack type 0x${type.toString(16)}`);
  }
}

// An array of integers: all NT4's time sync message needs.
export function packIntegers(values: number[]): Uint8Array {
  const out: number[] = [];
  if (values.length > 15) throw new Error('Too many values');
  out.push(0x90 | values.length);
  for (const value of values) {
    if (!Number.isInteger(value)) throw new Error('Not an integer');
    if (value >= 0 && value <= 0x7f) out.push(value);
    else if (value < 0 && value >= -32) out.push(value + 0x100);
    else {
      const bytes = new Uint8Array(9);
      const view = new DataView(bytes.buffer);
      bytes[0] = value < 0 ? 0xd3 : 0xcf;
      if (value < 0) view.setBigInt64(1, BigInt(value));
      else view.setBigUint64(1, BigInt(value));
      out.push(...bytes);
    }
  }
  return Uint8Array.from(out);
}
