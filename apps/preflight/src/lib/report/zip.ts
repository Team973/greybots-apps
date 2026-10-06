// A minimal zip writer for the event data export: files are stored
// uncompressed (CSV text for one event is small), which keeps this to the
// container format itself and works offline with no extra dependency.

export interface ZipFile {
    name: string;
    content: string;
}

const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

// Zip timestamps are local time in the old DOS layout.
function dosDateTime(date: Date): { time: number; day: number } {
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        day: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
}

export function buildZip(files: ZipFile[], date = new Date()): Blob {
    const encoder = new TextEncoder();
    const { time, day } = dosDateTime(date);
    const parts: Uint8Array[] = [];
    const directory: Uint8Array[] = [];
    let offset = 0;

    for (const file of files) {
        const name = encoder.encode(file.name);
        const data = encoder.encode(file.content);
        const crc = crc32(data);

        // Fields shared by the local header and the central directory entry.
        const shared = new DataView(new ArrayBuffer(26));
        shared.setUint16(0, 20, true); // Version needed.
        shared.setUint16(2, 0x0800, true); // Names are UTF-8.
        shared.setUint16(4, 0, true); // Stored, not compressed.
        shared.setUint16(6, time, true);
        shared.setUint16(8, day, true);
        shared.setUint32(10, crc, true);
        shared.setUint32(14, data.length, true);
        shared.setUint32(18, data.length, true);
        shared.setUint16(22, name.length, true);
        shared.setUint16(24, 0, true); // No extra field.
        const sharedBytes = new Uint8Array(shared.buffer);

        const local = new Uint8Array(4 + 26 + name.length);
        new DataView(local.buffer).setUint32(0, 0x04034b50, true);
        local.set(sharedBytes, 4);
        local.set(name, 30);

        const entry = new Uint8Array(46 + name.length);
        const entryView = new DataView(entry.buffer);
        entryView.setUint32(0, 0x02014b50, true);
        entryView.setUint16(4, 20, true); // Version made by.
        entry.set(sharedBytes, 6);
        // Comment length, disk number, and attributes (bytes 32-41) stay zero.
        entryView.setUint32(42, offset, true);
        entry.set(name, 46);

        parts.push(local, data);
        directory.push(entry);
        offset += local.length + data.length;
    }

    const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...directory, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// Hands a file to the browser's downloads.
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
