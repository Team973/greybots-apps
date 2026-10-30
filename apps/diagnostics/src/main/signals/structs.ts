// Decodes WPILib structs (Pose2d, SwerveModuleState, team-defined ones)
// from the schemas a data log carries. A log that holds `struct:Pose2d`
// values also has an entry `/.schema/struct:Pose2d`, type `structschema`,
// whose value is the schema: `Translation2d translation;Rotation2d rotation`.
// The format is documented at
// https://github.com/wpilibsuite/allwpilib/blob/main/wpiutil/doc/struct.adoc
//
// Plain code, like wpilog.ts.

import type { LogValue, StructDecoder } from './wpilog';

interface Field {
  name: string;
  // A primitive ('double', 'int16', ...) or another struct's name.
  type: string;
  // How many: 1 for a plain field, n for `double x[4]`.
  count: number;
  // Declared with [n], so read as a list even when n is 1.
  declaredArray: boolean;
  // For a bitfield (`int8 mode:3`), its width.
  bits: number | null;
  // For an enum field, value -> name.
  names: Map<number, string> | null;
}

const primitiveSizes: Record<string, number> = {
  bool: 1,
  char: 1,
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  int64: 8,
  uint64: 8,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8
};

// One declaration: [enum {a=1, b=2}] type name[count]:bits
const declaration = /^(?:enum\s*\{([^}]*)\}\s*)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?\s*(?::\s*(\d+))?$/;

export function parseSchema(schema: string): Field[] | null {
  const fields: Field[] = [];
  for (const part of schema.split(';')) {
    const text = part.trim();
    if (text === '') continue;
    const found = declaration.exec(text);
    if (!found) return null;

    let names: Map<number, string> | null = null;
    if (found[1] !== undefined) {
      names = new Map();
      let next = 0;
      for (const item of found[1].split(',')) {
        const [label, value] = item.split('=').map((s) => s.trim());
        if (!label) continue;
        const number = value === undefined ? next : Number(value);
        names.set(number, label);
        next = number + 1;
      }
    }
    fields.push({
      name: found[3],
      type: found[2],
      count: found[4] === undefined ? 1 : Number(found[4]),
      declaredArray: found[4] !== undefined,
      bits: found[5] === undefined ? null : Number(found[5]),
      names
    });
  }
  return fields;
}

export class StructRegistry implements StructDecoder {
  private schemas = new Map<string, Field[]>();
  private sizes = new Map<string, number | null>();

  // `typeName` without the `struct:` prefix.
  add(typeName: string, schema: string) {
    const fields = parseSchema(schema);
    if (fields) this.schemas.set(typeName, fields);
    this.sizes.clear();
  }

  has(typeName: string): boolean {
    return this.schemas.has(typeName);
  }

  // The struct's size in bytes, or null if a part of it isn't known.
  size(typeName: string, seen = new Set<string>()): number | null {
    if (typeName in primitiveSizes) return primitiveSizes[typeName];
    if (this.sizes.has(typeName)) return this.sizes.get(typeName)!;
    const fields = this.schemas.get(typeName);
    if (!fields || seen.has(typeName)) return null;
    seen.add(typeName);

    let size = 0;
    let bitUnit = 0;
    let bitsLeft = 0;
    for (const field of fields) {
      if (field.bits !== null) {
        const unit = primitiveSizes[field.type];
        if (unit === undefined) return null;
        // Consecutive bitfields share storage while they fit in one unit of
        // the same size.
        if (unit !== bitUnit || field.bits > bitsLeft) {
          size += unit;
          bitUnit = unit;
          bitsLeft = unit * 8;
        }
        bitsLeft -= field.bits;
        continue;
      }
      bitUnit = 0;
      const one = this.size(field.type, seen);
      if (one === null) return null;
      size += one * field.count;
    }
    this.sizes.set(typeName, size);
    return size;
  }

  decode(typeName: string, data: Uint8Array): LogValue | null {
    // `Pose2d[]`: back to back.
    if (typeName.endsWith('[]')) {
      const one = this.size(typeName.slice(0, -2));
      if (!one) return null;
      const items: LogValue[] = [];
      for (let at = 0; at + one <= data.length; at += one) {
        const item = this.decode(typeName.slice(0, -2), data.subarray(at, at + one));
        if (item === null) return null;
        items.push(item);
      }
      return items;
    }

    const size = this.size(typeName);
    if (size === null || data.length < size) return null;
    return this.read(typeName, new DataView(data.buffer, data.byteOffset, data.byteLength), 0);
  }

  private read(typeName: string, view: DataView, start: number): { [field: string]: LogValue } {
    const fields = this.schemas.get(typeName)!;
    const out: { [field: string]: LogValue } = {};
    let at = start;
    let bitUnit = 0;
    let bitsLeft = 0;
    let bitStorage = 0;
    let bitOffset = 0;

    for (const field of fields) {
      if (field.bits !== null) {
        const unit = primitiveSizes[field.type];
        if (unit !== bitUnit || field.bits > bitsLeft) {
          bitStorage = Number(readPrimitive(field.type === 'bool' ? 'uint8' : unsigned(field.type), view, at));
          at += unit;
          bitUnit = unit;
          bitsLeft = unit * 8;
          bitOffset = 0;
        }
        let value = Math.floor(bitStorage / 2 ** bitOffset) % 2 ** field.bits;
        // Signed bitfields are two's complement in their width.
        if (field.type.startsWith('int') && value >= 2 ** (field.bits - 1)) value -= 2 ** field.bits;
        bitOffset += field.bits;
        bitsLeft -= field.bits;
        out[field.name] = field.type === 'bool' ? value !== 0 : named(field, value);
        continue;
      }
      bitUnit = 0;

      if (field.type === 'char') {
        const bytes = new Uint8Array(view.buffer, view.byteOffset + at, field.count);
        const end = bytes.indexOf(0);
        out[field.name] = new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
        at += field.count;
        continue;
      }

      const values: LogValue[] = [];
      for (let i = 0; i < field.count; i++) {
        if (field.type in primitiveSizes) {
          values.push(named(field, readPrimitive(field.type, view, at)));
          at += primitiveSizes[field.type];
        } else {
          values.push(this.read(field.type, view, at));
          at += this.size(field.type)!;
        }
      }
      out[field.name] = field.declaredArray ? values : values[0];
    }
    return out;
  }
}

function unsigned(type: string): string {
  return type.startsWith('int') ? `u${type}` : type;
}

function readPrimitive(type: string, view: DataView, at: number): boolean | number {
  switch (type) {
    case 'bool':
      return view.getUint8(at) !== 0;
    case 'int8':
      return view.getInt8(at);
    case 'uint8':
      return view.getUint8(at);
    case 'int16':
      return view.getInt16(at, true);
    case 'uint16':
      return view.getUint16(at, true);
    case 'int32':
      return view.getInt32(at, true);
    case 'uint32':
      return view.getUint32(at, true);
    case 'int64':
      return Number(view.getBigInt64(at, true));
    case 'uint64':
      return Number(view.getBigUint64(at, true));
    case 'float':
    case 'float32':
      return view.getFloat32(at, true);
    default:
      return view.getFloat64(at, true);
  }
}

// An enum field's name for its value, or the value if it has none.
function named(field: Field, value: boolean | number): LogValue {
  if (field.names && typeof value === 'number') return field.names.get(value) ?? value;
  return value;
}
