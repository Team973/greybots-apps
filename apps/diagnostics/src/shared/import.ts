// Importing logs from files, folders and zip files (src/main/import/).
// Used by both sides, so nothing here may touch Node or the DOM.

// How the team a log is from was found: in its path, in the log itself, by
// a Hoot log's CANivore, by the Hoot log that started with it (a robot's rio
// and CANivore logs start together), or not at all (the team the person gave).
export type TeamSource = 'path' | 'log' | 'canivore' | 'hoot-partner' | 'assumed';

export interface ImportedFile {
  name: string;
  // Where it was, for people.
  from: string;
  // Where it went, below the data folder; null if it couldn't be read.
  localPath: string | null;
  team: number;
  teamFrom: TeamSource;
  outcome: 'copied' | 'already-here' | 'conflict' | 'error';
  message: string;
}

export interface ImportProgress {
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  // The file being copied in.
  current: string;
}

export interface ImportSummary {
  startedAt: string;
  // Where from, when not picked or dropped ("USB drive E: (KINGSTON)").
  source?: string;
  finishedAt: string;
  files: ImportedFile[];
  // Things dropped that couldn't be looked in (a damaged zip, ...).
  problems: string[];
}

export interface ImportStatus {
  running: boolean;
  progress: ImportProgress | null;
  last: ImportSummary | null;
}
