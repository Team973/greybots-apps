import { app, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { StorageFolderInfo, StorageInfo } from '@shared/ipc';
import type { Settings } from '@shared/settings';
import { defaultDataFolderName, storageFolders, storageReadme } from '@shared/storage-layout';

export function defaultDataDirectory(): string {
  return join(app.getPath('documents'), defaultDataFolderName);
}

export function dataDirectory(settings: Settings): string {
  return settings.dataDirectory || defaultDataDirectory();
}

// Creates the data folder and the folders inside it. Safe to call every
// launch: nothing that's already there is touched.
export async function ensureStorageLayout(directory: string): Promise<void> {
  for (const folder of storageFolders) {
    await fs.mkdir(join(directory, folder.name), { recursive: true });
  }
  // 'wx' fails if the file exists, which is the point.
  await fs.writeFile(join(directory, 'README.txt'), storageReadme, { encoding: 'utf-8', flag: 'wx' }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
}

async function measure(directory: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const inner = await measure(path);
      files += inner.files;
      bytes += inner.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await fs.stat(path)).size;
    }
  }
  return { files, bytes };
}

export async function storageInfo(settings: Settings): Promise<StorageInfo> {
  const directory = dataDirectory(settings);
  const info: StorageInfo = { directory, isDefault: settings.dataDirectory === '', folders: [], error: '' };

  try {
    await ensureStorageLayout(directory);
    for (const folder of storageFolders) {
      const size = await measure(join(directory, folder.name));
      info.folders.push({ ...folder, ...size } satisfies StorageFolderInfo);
    }
  } catch (error) {
    info.error = (error as Error).message;
  }
  return info;
}

export async function openDataDirectory(settings: Settings): Promise<string> {
  const directory = dataDirectory(settings);
  try {
    await ensureStorageLayout(directory);
  } catch (error) {
    return (error as Error).message;
  }
  // Resolves to '' when the folder opened, or to what went wrong.
  return shell.openPath(directory);
}
