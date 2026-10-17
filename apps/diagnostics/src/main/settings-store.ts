import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { defaultSettings, normalizeSettings, type Settings } from '@shared/settings';

// Settings live in one JSON file in the app's per-user data folder
// (%APPDATA%, ~/.config, ~/Library/Application Support), not in the data
// folder: they say where the data folder is.
const settingsPath = () => join(app.getPath('userData'), 'settings.json');

let cached: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;

  try {
    cached = normalizeSettings(JSON.parse(await fs.readFile(settingsPath(), 'utf-8')));
  } catch (error) {
    // No file yet is the normal first launch. A file that won't parse is kept
    // aside rather than overwritten, in case someone wants what was in it.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await fs.rename(settingsPath(), join(app.getPath('userData'), 'settings.invalid.json')).catch(() => {});
    }
    cached = { ...defaultSettings };
  }
  return cached;
}

export async function storeSettings(settings: Settings): Promise<void> {
  // Written to a second file and renamed over the first, so losing power
  // mid-save can't leave half a file.
  const temporary = `${settingsPath()}.tmp`;
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(settings, null, 2), 'utf-8');
  await fs.rename(temporary, settingsPath());
  cached = settings;
}
