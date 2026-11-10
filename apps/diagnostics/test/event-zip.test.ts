// Zipping an event's logs: which logs and files go in, their names in the
// zip, and the zip itself, read back as Log Import reads zips.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  defaultEventZipOptions,
  eventDays,
  eventZipEntryName,
  eventZipFiles,
  eventZipName,
  logsForEventZip
} from '@shared/event-zip';
import type { SignalLogFile } from '@shared/ipc';
import { writeZip } from '@main/export/zip-writer';
import { listZip, openZipEntry } from '@main/import/zip';

function log(id: string, recorded: string, match: SignalLogFile['match'], extra: Partial<SignalLogFile> = {}): SignalLogFile {
  return { id, localPath: `logs/frc973/${recorded.slice(0, 10)}/roborio/${id}.wpilog`, name: id, robot: 'frc973', size: 100, recorded, match, hoots: [], dsLogs: [], ...extra };
}
const at = (event: string, type: 'practice' | 'qualification' | 'elimination', number: number) => ({ event, type, number });
const ids = (logs: SignalLogFile[]) => logs.map((l) => l.id);
// Local times (no Z): the event's days are this computer's days.
const logs = [
  log('pit-before', '2026-11-05T15:00:00', null),
  log('p1', '2026-11-06T09:00:00', at('MTTD', 'practice', 1)),
  log('pit-friday', '2026-11-06T12:00:00', null),
  log('q2', '2026-11-07T11:00:00', at('MTTD', 'qualification', 2)),
  log('q1', '2026-11-07T10:00:00', at('mttd', 'qualification', 1)),
  log('e3', '2026-11-08T14:00:00', at('MTTD', 'elimination', 3)),
  log('pit-sunday-night', '2026-11-08T23:30:00', null),
  log('pit-after', '2026-11-09T08:00:00', null),
  log('other-q1', '2026-11-07T10:30:00', at('CASJ', 'qualification', 1)),
  log('9973-q1', '2026-11-07T10:00:00', at('MTTD', 'qualification', 1), { robot: 'frc9973' }),
  log('9973-pit', '2026-11-07T08:00:00', null, { robot: 'frc9973' })
];

// --- Which logs ---
// By default, the team's official field matches, oldest first; any case of the code.
assert.deepEqual(ids(logsForEventZip(logs, defaultEventZipOptions('MTTD', 'frc973'))), ['p1', 'q1', 'q2', 'e3']);
assert.deepEqual(ids(logsForEventZip(logs, { ...defaultEventZipOptions('mttd', 'frc973'), kinds: ['qualification'] })), ['q1', 'q2']);
assert.deepEqual(ids(logsForEventZip(logs, defaultEventZipOptions('MTTD', 'frc9973'))), ['9973-q1']);
// Every team's.
assert.deepEqual(ids(logsForEventZip(logs, { ...defaultEventZipOptions('MTTD'), kinds: ['qualification'] })), ['q1', '9973-q1', 'q2']);
// Logs not from a match: those on the event's days only, the team's.
assert.deepEqual(ids(logsForEventZip(logs, { ...defaultEventZipOptions('MTTD', 'frc973'), kinds: ['none'] })), ['pit-friday', 'pit-sunday-night']);
assert.deepEqual(ids(logsForEventZip(logs, { ...defaultEventZipOptions('MTTD', 'frc9973'), kinds: ['none'] })), ['9973-pit']);
const days = eventDays(logs, 'MTTD')!;
assert.equal(new Date(days[0]).getDate(), 6);
assert.equal(new Date(days[1]).getDate(), 9, 'up to midnight after the last');
assert.equal(eventDays(logs, 'NONE'), null);
assert.deepEqual(logsForEventZip(logs, { ...defaultEventZipOptions('NONE'), kinds: ['none'] }), []);

// --- Which files ---
{
  const ds = { localPath: 'logs/ds/2026-11-07/a.dslog', eventsPath: 'logs/ds/2026-11-07/a.dsevents', name: 'a', label: 'DS log', size: 30 };
  const hoot = { localPath: 'logs/frc973/2026-11-07/hoot/q1.hoot', name: 'q1.hoot', bus: 'rio', label: 'rio', size: 50 };
  const withFiles = [
    log('q1', '2026-11-07T10:00:00', at('MTTD', 'qualification', 1), { size: 180, hoots: [hoot], dsLogs: [ds] }),
    // The same Driver Station log: once.
    log('q2', '2026-11-07T11:00:00', at('MTTD', 'qualification', 2), { size: 130, dsLogs: [ds] })
  ];
  assert.deepEqual(eventZipFiles(withFiles, { hoots: true, driverStation: true }), [
    { path: 'logs/frc973/2026-11-07/roborio/q1.wpilog', size: 100 },
    { path: hoot.localPath, size: 50 },
    { path: ds.localPath, size: 30 },
    { path: ds.eventsPath, size: 0 },
    { path: 'logs/frc973/2026-11-07/roborio/q2.wpilog', size: 100 }
  ]);
  assert.deepEqual(eventZipFiles(withFiles, { hoots: false, driverStation: false }).map((f) => f.path),
    ['logs/frc973/2026-11-07/roborio/q1.wpilog', 'logs/frc973/2026-11-07/roborio/q2.wpilog']);
}

// --- Names ---
assert.equal(eventZipName('mttd'), 'MTTD-logs.zip');
assert.equal(eventZipName('mttd', 'frc973'), 'MTTD-frc973-logs.zip');
assert.equal(eventZipEntryName('MTTD', 'frc973', 'logs/frc973/2026-11-07/roborio/q1.wpilog'), 'MTTD-frc973-logs/frc973/2026-11-07/roborio/q1.wpilog');
assert.equal(eventZipEntryName('MTTD', null, 'logs/../../x'), 'MTTD-logs/x', "can't step out of its folder");
assert.equal(eventZipName('a/b\\c'), 'ABC-logs.zip');

// --- The zip, read back ---
async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function zips() {
  const dir = mkdtempSync(join(tmpdir(), 'event-zip-'));
  try {
    // A log that compresses, one that doesn't, an empty one; one gone.
    const files: Record<string, Buffer> = {
      'a.wpilog': Buffer.from('robot data '.repeat(50000)),
      'b.hoot': randomBytes(300000),
      'c.dsevents': Buffer.alloc(0)
    };
    for (const [name, bytes] of Object.entries(files)) await fs.writeFile(join(dir, name), bytes);
    const inputs = [...Object.keys(files), 'gone.wpilog'].map((name) => ({ from: join(dir, name), name: `MTTD-logs/frc973/${name}` }));

    for (const [label, options] of [['plain', {}], ['zip64', { zip64Above: 1000, max32: 1000 }]] as const) {
      const to = join(dir, `${label}.zip`);
      const seen: number[] = [];
      const result = await writeZip(to, inputs, { ...options, onProgress: (p) => seen.push(p.bytesDone) });
      assert.equal(result.files, 3, label);
      assert.deepEqual(result.missing, [join(dir, 'gone.wpilog')]);
      assert.equal(result.bytesIn, 550000 + 300000);
      assert.equal(result.bytesOut, (await fs.stat(to)).size);
      assert.ok(seen.length > 1 && seen.at(-1) === result.bytesIn, 'progress up to every byte');
      const entries = await listZip(to);
      assert.deepEqual(entries.map((e) => e.name), Object.keys(files).map((name) => `MTTD-logs/frc973/${name}`));
      for (const entry of entries) {
        const bytes = await readAll(await openZipEntry(to, entry));
        assert.ok(bytes.equals(files[entry.name.slice(entry.name.lastIndexOf('/') + 1)]), `${label}: ${entry.name} read back`);
      }
      if (label === 'plain') assert.ok(entries[0].compressedSize < 10000, 'compressed');
    }

    // Cancelled: stops, saying so.
    const cancel = new AbortController();
    cancel.abort();
    await assert.rejects(writeZip(join(dir, 'cancelled.zip'), inputs, { signal: cancel.signal }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

zips().then(() => console.log('event-zip: ok')).catch((error) => {
  console.error(error);
  process.exit(1);
});
