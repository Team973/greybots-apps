// One import at a time, with its progress for the window to ask after.

import { BrowserWindow, dialog } from 'electron';

import type { ImportStatus, ImportSummary } from '@shared/import';
import { importExtensions, importLogs } from './import/importer';
import { afterNewLogs, logIdsNow } from './reports';
import { loadSettings } from './settings-store';
import { dataDirectory } from './storage';

const status: ImportStatus = { running: false, progress: null, last: null };

export function importStatus(): ImportStatus {
  return { ...status };
}

// Resolves when it's done, to what happened (or why it didn't start).
export async function runImport(paths: string[], fallbackTeam: number, options: { pathBase?: string; source?: string } = {}): Promise<ImportSummary | string> {
  if (status.running) return 'An import is already running.';
  if (!Number.isInteger(fallbackTeam) || fallbackTeam < 1 || fallbackTeam > 99999) return 'Enter a team number from 1 to 99999.';
  if (paths.length === 0) return 'Nothing to import.';
  status.running = true;
  const startedAt = new Date().toISOString();
  try {
    const settings = await loadSettings();
    const directory = dataDirectory(settings);
    // The logs there before, so the pipelines run on the new ones after.
    const before = await logIdsNow(settings);
    const { files, problems } = await importLogs(directory, paths, {
      fallbackTeam,
      pathBase: options.pathBase,
      onProgress: (progress) => { status.progress = progress; }
    });
    if (files.length === 0 && problems.length === 0) {
      problems.push(`No logs found. Logs are ${importExtensions.join(', ')} files, or zip files of them.`);
    }
    status.last = { startedAt, ...(options.source ? { source: options.source } : {}), finishedAt: new Date().toISOString(), files, problems };
    afterNewLogs(before, 'import').catch(() => {});
    return status.last;
  } finally {
    status.running = false;
    status.progress = null;
  }
}

// A file picker for logs and zips, or a folder picker. Resolves to what
// was picked, or [] if cancelled.
export async function chooseImport(folders: boolean): Promise<string[]> {
  const options: Electron.OpenDialogOptions = folders
    ? { title: 'Choose folders of logs to import', properties: ['openDirectory', 'multiSelections'] }
    : {
        title: 'Choose logs to import',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Logs and zip files', extensions: [...importExtensions.map((e) => e.slice(1)), 'zip'] },
          { name: 'All files', extensions: ['*'] }
        ]
      };
  const window = BrowserWindow.getFocusedWindow();
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}
