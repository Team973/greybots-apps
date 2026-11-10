// Writing a zip file of logs, a file at a time, without holding any of them
// in memory: each is read and deflated as a stream (Node's zlib, off the main
// thread) straight into the zip, and its header filled in once its size and
// checksum are known. Zip64 where sizes or places don't fit in 32 bits: an
// event's Hoot logs are easily over 4 GB. Read back by import/zip.ts.
// (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)

import { createReadStream, promises as fs } from 'node:fs';
import { createDeflateRaw, crc32 } from 'node:zlib';

export interface ZipInput {
  // The file on disk.
  from: string;
  // Its path in the zip, with / between folders.
  name: string;
}

export interface ZipWriteProgress {
  filesDone: number;
  // Bytes read from the files so far.
  bytesDone: number;
  current: string;
}

export interface ZipWriteResult {
  files: number;
  bytesIn: number;
  bytesOut: number;
  // Files that couldn't be opened (gone): left out.
  missing: string[];
}

const max32 = 0xffffffff;
// A file this big gets Zip64 sizes in its local header, as deflating can
// make a file that doesn't shrink a little bigger.
const defaultZip64Above = max32 - 64 * 1024 * 1024;
const utf8Names = 0x0800;
const deflated = 8;

interface Written {
  name: Buffer;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export async function writeZip(to: string, inputs: ZipInput[],
  options: {
    level?: number;
    signal?: AbortSignal;
    onProgress?: (progress: ZipWriteProgress) => void;
    // Lower for tests, which can't write 4 GB.
    zip64Above?: number;
    max32?: number;
  } = {}): Promise<ZipWriteResult> {
  const zip64Above = options.zip64Above ?? defaultZip64Above;
  const big32 = options.max32 ?? max32;
  const handle = await fs.open(to, 'w');
  const written: Written[] = [];
  const missing: string[] = [];
  let position = 0;
  let bytesIn = 0;
  const write = async (buffer: Buffer) => {
    await handle.write(buffer, 0, buffer.length, position);
    position += buffer.length;
  };

  try {
    for (const input of inputs) {
      options.signal?.throwIfAborted();
      const stat = await fs.stat(input.from).catch(() => null);
      if (!stat?.isFile()) {
        missing.push(input.from);
        continue;
      }
      options.onProgress?.({ filesDone: written.length, bytesDone: bytesIn, current: input.name });
      const name = Buffer.from(input.name, 'utf8');
      const { time, date } = dosDateTime(stat.mtime);
      const zip64 = stat.size > zip64Above;
      const offset = position;

      // The local header, its checksum and sizes filled in after.
      const header = Buffer.alloc(30 + name.length + (zip64 ? 20 : 0));
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(zip64 ? 45 : 20, 4);
      header.writeUInt16LE(utf8Names, 6);
      header.writeUInt16LE(deflated, 8);
      header.writeUInt16LE(time, 10);
      header.writeUInt16LE(date, 12);
      header.writeUInt16LE(name.length, 26);
      header.writeUInt16LE(zip64 ? 20 : 0, 28);
      name.copy(header, 30);
      if (zip64) {
        header.writeUInt32LE(max32, 18);
        header.writeUInt32LE(max32, 22);
        header.writeUInt16LE(0x0001, 30 + name.length);
        header.writeUInt16LE(16, 32 + name.length);
      }
      await write(header);

      // The file, deflated as it's read.
      let crc = 0;
      let size = 0;
      const start = position;
      const read = createReadStream(input.from, { highWaterMark: 1024 * 1024, signal: options.signal });
      const deflate = createDeflateRaw({ level: options.level ?? 6, chunkSize: 256 * 1024 });
      read.on('data', (chunk) => {
        const bytes = chunk as Buffer;
        crc = crc32(bytes, crc);
        size += bytes.length;
        bytesIn += bytes.length;
      });
      read.on('error', (error) => deflate.destroy(error));
      read.pipe(deflate);
      for await (const chunk of deflate) {
        await write(chunk as Buffer);
        options.onProgress?.({ filesDone: written.length, bytesDone: bytesIn, current: input.name });
      }
      const compressedSize = position - start;

      const sizes = Buffer.alloc(zip64 ? 4 : 12);
      sizes.writeUInt32LE(crc >>> 0, 0);
      if (!zip64) {
        sizes.writeUInt32LE(compressedSize, 4);
        sizes.writeUInt32LE(size, 8);
      }
      await handle.write(sizes, 0, sizes.length, offset + 14);
      if (zip64) {
        const big = Buffer.alloc(16);
        big.writeBigUInt64LE(BigInt(size), 0);
        big.writeBigUInt64LE(BigInt(compressedSize), 8);
        await handle.write(big, 0, 16, offset + 34 + name.length);
      }
      written.push({ name, crc: crc >>> 0, compressedSize, size, offset, time, date });
    }

    // The central directory: each file again, with where it is.
    const directoryOffset = position;
    for (const file of written) {
      const bigSizes = file.size > zip64Above || file.compressedSize >= big32;
      const bigOffset = file.offset >= big32;
      const extraLength = bigSizes || bigOffset ? 4 + (bigSizes ? 16 : 0) + (bigOffset ? 8 : 0) : 0;
      const entry = Buffer.alloc(46 + file.name.length + extraLength);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(45, 4);
      entry.writeUInt16LE(extraLength ? 45 : 20, 6);
      entry.writeUInt16LE(utf8Names, 8);
      entry.writeUInt16LE(deflated, 10);
      entry.writeUInt16LE(file.time, 12);
      entry.writeUInt16LE(file.date, 14);
      entry.writeUInt32LE(file.crc, 16);
      entry.writeUInt32LE(bigSizes ? max32 : file.compressedSize, 20);
      entry.writeUInt32LE(bigSizes ? max32 : file.size, 24);
      entry.writeUInt16LE(file.name.length, 28);
      entry.writeUInt16LE(extraLength, 30);
      entry.writeUInt32LE(bigOffset ? max32 : file.offset, 42);
      file.name.copy(entry, 46);
      if (extraLength) {
        let at = 46 + file.name.length;
        entry.writeUInt16LE(0x0001, at);
        entry.writeUInt16LE(extraLength - 4, at + 2);
        at += 4;
        // In this order, only those that didn't fit.
        if (bigSizes) {
          entry.writeBigUInt64LE(BigInt(file.size), at);
          entry.writeBigUInt64LE(BigInt(file.compressedSize), at + 8);
          at += 16;
        }
        if (bigOffset) entry.writeBigUInt64LE(BigInt(file.offset), at);
      }
      await write(entry);
    }
    const directorySize = position - directoryOffset;

    // The end: Zip64's too when there are too many files, or it's too big.
    const zip64End = written.length >= 0xffff || directoryOffset >= big32 || directorySize >= big32;
    if (zip64End) {
      const record = Buffer.alloc(56 + 20);
      const recordOffset = position;
      record.writeUInt32LE(0x06064b50, 0);
      record.writeBigUInt64LE(44n, 4);
      record.writeUInt16LE(45, 12);
      record.writeUInt16LE(45, 14);
      record.writeBigUInt64LE(BigInt(written.length), 24);
      record.writeBigUInt64LE(BigInt(written.length), 32);
      record.writeBigUInt64LE(BigInt(directorySize), 40);
      record.writeBigUInt64LE(BigInt(directoryOffset), 48);
      // The locator, which says where that is.
      record.writeUInt32LE(0x07064b50, 56);
      record.writeBigUInt64LE(BigInt(recordOffset), 64);
      record.writeUInt32LE(1, 72);
      await write(record);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(written.length, 0xffff), 8);
    end.writeUInt16LE(Math.min(written.length, 0xffff), 10);
    end.writeUInt32LE(Math.min(directorySize, max32), 12);
    end.writeUInt32LE(zip64End ? max32 : directoryOffset, 16);
    await write(end);
    options.onProgress?.({ filesDone: written.length, bytesDone: bytesIn, current: '' });
    return { files: written.length, bytesIn, bytesOut: position, missing };
  } finally {
    await handle.close();
  }
}
