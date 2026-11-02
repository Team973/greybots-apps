// The library (#148): saved views, report templates, pipelines and robot
// mappings, one JSON file each under the data folder's library/<kind>/, so
// they're backed up and moved with the logs. Synced with the cloud by
// cloud-sync.ts.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import { cleanLibraryItem } from '@shared/library-check';
import type { LibraryItem, LibraryItemOf, LibraryKind } from '@shared/library';
import type { Settings } from '@shared/settings';
import { libraryPathSegments } from '@shared/storage-layout';
import { dataDirectory } from './storage';

const pathFor = (settings: Settings, kind: LibraryKind, id: string) => join(dataDirectory(settings), ...libraryPathSegments(kind, id));

export async function listLibrary<K extends LibraryKind>(settings: Settings, kind: K): Promise<LibraryItemOf[K][]> {
  const folder = dirname(pathFor(settings, kind, 'x'));
  const names = await fs.readdir(folder).catch(() => [] as string[]);
  const items: LibraryItemOf[K][] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const item = await readItem(join(folder, name));
    if (item?.kind === kind) items.push(item as LibraryItemOf[K]);
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function readItem(path: string): Promise<LibraryItem | null> {
  try {
    return cleanLibraryItem(JSON.parse(await fs.readFile(path, 'utf-8')));
  } catch {
    return null;
  }
}

export function getLibraryItem<K extends LibraryKind>(settings: Settings, kind: K, id: string): Promise<LibraryItemOf[K] | null> {
  return readItem(pathFor(settings, kind, id)).then((item) => (item?.kind === kind ? (item as LibraryItemOf[K]) : null));
}

// One change at a time, so two quick saves can't lose one another.
let writing: Promise<unknown> = Promise.resolve();
function serially<T>(work: () => Promise<T>): Promise<T> {
  const next = writing.then(work);
  writing = next.catch(() => {});
  return next;
}

async function writeItem(settings: Settings, item: LibraryItem) {
  const path = pathFor(settings, item.kind, item.id);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(`${path}.tmp`, JSON.stringify(item, null, 2), 'utf-8');
  await fs.rename(`${path}.tmp`, path);
}

// Saves an item the window sent: a new one (no id, or one not here yet)
// or a change. Its times are set here; its cloud state is kept from what's
// on disk, never taken from the window.
export function saveLibraryItem(settings: Settings, raw: unknown, who: string | null): Promise<LibraryItem> {
  return serially(async () => {
    const now = new Date().toISOString();
    const given = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const id = typeof given.id === 'string' && given.id ? given.id : randomUUID();
    const kind = given.kind as LibraryKind;
    const existing = typeof given.id === 'string' ? await getLibraryItem(settings, kind, id) : null;
    const item = cleanLibraryItem({
      ...given,
      id,
      created: existing?.created ?? now,
      changed: now,
      createdBy: existing?.createdBy ?? who,
      cloud: existing?.cloud ?? null
    }, now);
    if (!item) throw new Error("That can't be saved: it isn't a view, template, pipeline or mapping.");
    await writeItem(settings, item);
    return item;
  });
}

// For cloud sync: puts an item as it is, times and cloud state included.
export function storeLibraryItem(settings: Settings, item: LibraryItem): Promise<void> {
  return serially(() => writeItem(settings, item));
}

export function deleteLibraryItem(settings: Settings, kind: LibraryKind, id: string): Promise<void> {
  return serially(() => fs.rm(pathFor(settings, kind, id), { force: true }));
}
