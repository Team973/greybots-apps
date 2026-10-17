// How offloaded logs and computed results are laid out on disk, under the
// data folder chosen in Settings. See docs/design.md for the reasoning.
//
//   <data folder>/
//     logs/<robot>/<yyyy-mm-dd>/<source>/<original file name>
//     results/<kind>/<id>.json
//     index/
//     README.txt

// The default data folder's name, inside the person's Documents folder.
export const defaultDataFolderName = 'GreybotsDiagnostics';

export interface StorageFolder {
  name: string;
  purpose: string;
}

export const storageFolders: StorageFolder[] = [
  {
    name: 'logs',
    purpose: 'Files pulled off the robot, exactly as they were. Never edited.'
  },
  {
    name: 'results',
    purpose: 'What the app works out from the logs: match summaries, test runs.'
  },
  {
    name: 'index',
    purpose: 'What has been offloaded, and which match or test each file belongs to.'
  }
];

// Where a kind of log comes from. A folder name under each day.
export const logSources = ['roborio', 'driver-station', 'ctre-hoot', 'coprocessor', 'custom'] as const;
export type LogSource = (typeof logSources)[number];

// The day folder a file goes in, by the local date it was recorded.
export function dayFolderName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The path of an offloaded log below the data folder, as segments for the
// main process to join. `sourceName` tells coprocessors and custom sources
// apart (coprocessor-limelight-front).
export function logPathSegments(robot: string, recorded: Date, source: LogSource, fileName: string, sourceName = ''): string[] {
  const sourceFolder = sourceName ? `${source}-${safeSegment(sourceName)}` : source;
  return ['logs', safeSegment(robot), dayFolderName(recorded), sourceFolder, safeSegment(fileName)];
}

// The path of a computed result below the data folder.
export function resultPathSegments(kind: string, id: string): string[] {
  return ['results', safeSegment(kind), `${safeSegment(id)}.json`];
}

// Names come from robots and from people, so anything that could step out of
// the folder or isn't allowed in a file name on Windows is replaced.
export function safeSegment(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '_').replace(/[. ]+$/, '');
  return cleaned === '' ? '_' : cleaned;
}

export const storageReadme = `Greybots Diagnostics data

This folder is managed by the Greybots Diagnostics app.

logs/<robot>/<yyyy-mm-dd>/<source>/<file>
    Files pulled off the robot, exactly as they were. Never edited.
    <source> is where the file came from: roborio, driver-station,
    ctre-hoot, coprocessor-<name>, or custom-<name>.

results/<kind>/<id>.json
    What the app works out from the logs: match summaries, test runs.

index/
    What has been offloaded, and which match or test each file belongs to.

It is safe to copy this whole folder to back it up or move it to another
computer. Don't rename or edit the files inside it.
`;
