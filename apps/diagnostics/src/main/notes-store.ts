// Notes people add to a log while reviewing it, kept in the data folder
// (notes/<log>.json) so they're backed up and moved with the logs.
// Syncing them to other computers comes with Preflight (#103).

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import { maxNoteLength, type Annotation } from '@shared/events';
import type { Settings } from '@shared/settings';
import { notesPathSegments } from '@shared/storage-layout';
import { dataDirectory } from './storage';

interface NotesFile {
  log: string;
  notes: Annotation[];
}

const pathFor = (settings: Settings, logId: string) => join(dataDirectory(settings), ...notesPathSegments(logId));

export async function loadNotes(settings: Settings, logId: string): Promise<Annotation[]> {
  try {
    const file = JSON.parse(await fs.readFile(pathFor(settings, logId), 'utf-8')) as NotesFile;
    return Array.isArray(file.notes) ? file.notes.filter((n) => typeof n?.id === 'string' && Number.isFinite(n.time) && typeof n.text === 'string') : [];
  } catch {
    return [];
  }
}

// One change at a time, so two quick edits can't lose one another.
let writing: Promise<unknown> = Promise.resolve();

async function change(settings: Settings, logId: string, edit: (notes: Annotation[]) => Annotation[]): Promise<Annotation[]> {
  const next = writing.then(async () => {
    const notes = edit(await loadNotes(settings, logId)).sort((a, b) => a.time - b.time);
    const path = pathFor(settings, logId);
    await fs.mkdir(dirname(path), { recursive: true });
    if (notes.length === 0) {
      await fs.rm(path, { force: true });
    } else {
      const file: NotesFile = { log: logId, notes };
      await fs.writeFile(`${path}.tmp`, JSON.stringify(file, null, 2), 'utf-8');
      await fs.rename(`${path}.tmp`, path);
    }
    return notes;
  });
  writing = next.catch(() => {});
  return next;
}

// Adds a note, or changes one (by id). Blank text deletes it.
export function saveNote(settings: Settings, logId: string, note: { id?: string; time: number; text: string }): Promise<Annotation[]> {
  if (!Number.isFinite(note.time)) throw new Error('A note needs a time.');
  const text = note.text.trim().slice(0, maxNoteLength);
  const now = new Date().toISOString();
  return change(settings, logId, (notes) => {
    const existing = note.id ? notes.find((n) => n.id === note.id) : undefined;
    if (!text) return notes.filter((n) => n.id !== note.id);
    if (existing) return notes.map((n) => (n === existing ? { ...n, time: note.time, text, changed: now } : n));
    return [...notes, { id: randomUUID(), time: note.time, text, created: now, changed: now }];
  });
}

export function deleteNote(settings: Settings, logId: string, id: string): Promise<Annotation[]> {
  return change(settings, logId, (notes) => notes.filter((n) => n.id !== id));
}
