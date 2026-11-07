// Files on USB drives already imported (or copied there from here), so
// plugging a drive in again doesn't import it all over again. A file is known
// by its path below the drive's root and its size: logs are never edited, so
// the same name and size is the same log. Kept in index/usb-seen.json.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const fileName = 'usb-seen.json';

export const seenKey = (pathOnDrive: string, size: number) => `${pathOnDrive.replace(/\\/g, '/')}|${size}`;

export async function loadSeen(dataDirectory: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dataDirectory, 'index', fileName), 'utf-8')) as { files?: unknown };
    return new Set(Array.isArray(parsed.files) ? parsed.files.filter((f): f is string => typeof f === 'string') : []);
  } catch {
    return new Set();
  }
}

// The logs already in the data folder, by file name and size, wherever
// they're filed: a log on a drive that's already here (downloaded from the
// robot, imported, or copied to the drive from here) isn't imported again.
// Log names carry when they were recorded, so name and size is the log.
export const storedKey = (name: string, size: number) => `${name.toLowerCase()}|${size}`;

export async function storedLogs(dataDirectory: string): Promise<Set<string>> {
  const stored = new Set<string>();
  const walk = async (folder: string) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const stat = await fs.stat(path).catch(() => null);
        if (stat) stored.add(storedKey(entry.name, stat.size));
      }
    }
  };
  await walk(join(dataDirectory, 'logs'));
  return stored;
}

export async function addSeen(dataDirectory: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const seen = await loadSeen(dataDirectory);
  for (const key of keys) seen.add(key);
  await fs.mkdir(join(dataDirectory, 'index'), { recursive: true });
  const path = join(dataDirectory, 'index', fileName);
  await fs.writeFile(`${path}.tmp`, JSON.stringify({ files: [...seen].sort() }, null, 1), 'utf-8');
  await fs.rename(`${path}.tmp`, path);
}
