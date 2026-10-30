import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { OffloadedFile } from '@shared/offload';

// index/offloaded.json: every file offloaded so far, and any download that
// was cut off, so the next run can skip the first and finish the second.
export interface PartialDownload {
  size: number;
  modified: string;
}

export interface OffloadIndex {
  version: 1;
  files: Record<string, OffloadedFile>;
  partials: Record<string, PartialDownload>;
}

// One key per copy: where it came from, and where it was put (which says
// which robot, and which day).
export function indexKey(origin: OffloadedFile['origin'], originPath: string, localPath: string): string {
  return `${origin}|${originPath}|${localPath}`;
}

const emptyIndex = (): OffloadIndex => ({ version: 1, files: {}, partials: {} });

const indexPath =(dataDirectory: string) => join(dataDirectory, 'index', 'offloaded.json');

export async function loadIndex(dataDirectory: string): Promise<OffloadIndex> {
  const path = indexPath(dataDirectory);
  let text: string;
  try {
    text = await fs.readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return emptyIndex();
  }

  try {
    const raw = JSON.parse(text);
    if (raw && raw.version === 1 && typeof raw.files === 'object' && typeof raw.partials === 'object') return raw;
  } catch {
    // Falls through to starting over.
  }
  // Unreadable, or from a newer version of the app: kept aside, and a new
  // one started. Nothing is lost: files already in logs/ are recognized by
  // their size and not pulled again.
  await fs.rename(path, `${path}.${Date.now()}.unreadable`).catch(() => {});
  return emptyIndex();
}

export async function storeIndex(dataDirectory: string, index: OffloadIndex): Promise<void> {
  // Written aside and renamed over, like the settings, so a crash can't leave
  // half an index.
  const path = indexPath(dataDirectory);
  await fs.mkdir(join(dataDirectory, 'index'), { recursive: true });
  await fs.writeFile(`${path}.tmp`, JSON.stringify(index, null, 2), 'utf-8');
  await fs.rename(`${path}.tmp`, path);
}
