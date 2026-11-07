// How offloaded logs and computed results are laid out on disk, under the
// data folder chosen in Settings. See docs/design.md for the reasoning.
//
//   <data folder>/
//     logs/<robot>/<yyyy-mm-dd>/<source>/<original file name>
//     results/<kind>/<id>.json
//     notes/<log>.json
//     library/<kind>/<id>.json
//     reports/<id>.json
//     models/<model>/config.json, model.glb, model_0.glb, ...
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
    name: 'notes',
    purpose: 'Notes people added to logs while reviewing them.'
  },
  {
    name: 'library',
    purpose: 'Saved views, report templates and auto reports.'
  },
  {
    name: 'reports',
    purpose: 'Reports made from logs, by hand or automatically.'
  },
  {
    name: 'models',
    purpose: 'Robot models for the 3D robot plot, one folder each, as AdvantageScope keeps them.'
  },
  {
    name: 'index',
    purpose: 'What has been downloaded, and which match or test each file belongs to.'
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

// Where the notes on a log are kept, below the data folder: one file per
// log, named for its path under logs/.
export function notesPathSegments(logId: string): string[] {
  return ['notes', `${safeSegment(logId.replace(/^logs\//, '').replace(/\//g, '~'))}.json`];
}

// Where a library item is kept, below the data folder.
export function libraryPathSegments(kind: string, id: string): string[] {
  return ['library', safeSegment(kind), `${safeSegment(id)}.json`];
}

// Where a report is kept, below the data folder.
export function reportPathSegments(id: string): string[] {
  return ['reports', `${safeSegment(id)}.json`];
}

// A robot model's file, below the data folder.
export function modelPathSegments(model: string, file: string): string[] {
  return ['models', safeSegment(model), safeSegment(file)];
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

notes/<log>.json
    Notes people added to logs while reviewing them.

library/<kind>/<id>.json
    Saved views, report templates and auto reports
    (<kind> is view, template or pipeline).

reports/<id>.json
    Reports made from logs, by hand or by a pipeline.

models/<model>/
    Robot models for the 3D robot plot: config.json, model.glb (the
    robot) and model_0.glb, model_1.glb, ... (its moving parts), as
    AdvantageScope keeps them.

index/
    What has been downloaded, and which match or test each file belongs to.

It is safe to copy this whole folder to back it up or move it to another
computer. Don't rename or edit the files inside it.
`;
