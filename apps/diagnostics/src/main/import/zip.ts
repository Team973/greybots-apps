// Just enough of the zip format (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
// to read logs out of a zip: the list of files from the central directory,
// and each file's bytes, stored or deflated, as a stream. Zip64 is read too:
// a season of Hoot logs is easily over 4 GB.

import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';

export interface ZipEntry {
  // Its path in the zip, with / between folders.
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  // Where its local header starts.
  headerOffset: number;
  modified: Date;
}

// The end of central directory record is in the last 64 KB + 22 bytes.
const maxCommentAndRecord = 65535 + 22;

async function readAt(handle: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

// DOS date and time, in the computer's own time zone (zips don't say).
function dosTime(date: number, time: number): Date {
  return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
}

export async function listZip(path: string): Promise<ZipEntry[]> {
  const handle = await fs.open(path, 'r');
  try {
    const { size } = await handle.stat();
    const tailStart = Math.max(0, size - maxCommentAndRecord);
    const tail = await readAt(handle, tailStart, size - tailStart);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end === -1) throw new Error("This isn't a zip file, or it's cut off.");

    let count = tail.readUInt16LE(end + 10);
    let directorySize = tail.readUInt32LE(end + 12);
    let directoryOffset = tail.readUInt32LE(end + 16);
    // Zip64: the real numbers are in the zip64 end record, which a locator
    // just before this one points to.
    if (end >= 20 && tail.readUInt32LE(end - 20) === 0x07064b50) {
      const recordOffset = Number(tail.readBigUInt64LE(end - 20 + 8));
      const record = await readAt(handle, recordOffset, 56);
      if (record.readUInt32LE(0) === 0x06064b50) {
        count = Number(record.readBigUInt64LE(32));
        directorySize = Number(record.readBigUInt64LE(40));
        directoryOffset = Number(record.readBigUInt64LE(48));
      }
    }

    const directory = await readAt(handle, directoryOffset, directorySize);
    const entries: ZipEntry[] = [];
    let at = 0;
    for (let i = 0; i < count && at + 46 <= directory.length; i++) {
      if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error("This zip file's list of files is damaged.");
      const flags = directory.readUInt16LE(at + 8);
      const method = directory.readUInt16LE(at + 10);
      const time = directory.readUInt16LE(at + 12);
      const date = directory.readUInt16LE(at + 14);
      let compressedSize = directory.readUInt32LE(at + 20);
      let entrySize = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      let headerOffset = directory.readUInt32LE(at + 42);
      const nameBytes = directory.subarray(at + 46, at + 46 + nameLength);
      // Bit 11: the name is UTF-8; otherwise it's the old DOS code page, which
      // for the names logs have (ASCII) is the same.
      const name = (flags & 0x800 ? nameBytes.toString('utf8') : nameBytes.toString('latin1')).replace(/\\/g, '/');

      // Zip64 extra field: the sizes and offset that didn't fit, in order.
      let extra = at + 46 + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = directory.readUInt16LE(extra);
        const length = directory.readUInt16LE(extra + 2);
        if (id === 0x0001) {
          let field = extra + 4;
          if (entrySize === 0xffffffff) { entrySize = Number(directory.readBigUInt64LE(field)); field += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(directory.readBigUInt64LE(field)); field += 8; }
          if (headerOffset === 0xffffffff) headerOffset = Number(directory.readBigUInt64LE(field));
        }
        extra += 4 + length;
      }

      if (!name.endsWith('/')) {
        entries.push({ name, method, compressedSize, size: entrySize, headerOffset, modified: dosTime(date, time) });
      }
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

// A file in the zip, uncompressed.
export async function openZipEntry(path: string, entry: ZipEntry): Promise<Readable> {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`${entry.name} is compressed in a way this can't read (method ${entry.method}).`);
  }
  const handle = await fs.open(path, 'r');
  let header: Buffer;
  try {
    header = await readAt(handle, entry.headerOffset, 30);
  } finally {
    await handle.close();
  }
  if (header.length < 30 || header.readUInt32LE(0) !== 0x04034b50) throw new Error(`${entry.name}: damaged in the zip.`);
  const start = entry.headerOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (entry.compressedSize === 0) return Readable.from([]);
  const raw = createReadStream(path, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;
  const inflate = createInflateRaw();
  raw.on('error', (error) => inflate.destroy(error));
  return raw.pipe(inflate);
}
