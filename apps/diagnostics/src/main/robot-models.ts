// Robot models for the 3D robot plot (#144), kept in the data folder's
// models/, one folder each, as AdvantageScope keeps them (see plots.ts):
// a team's models work in both, and go with the data folder when it's
// copied to another computer.

import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';

import { cleanModelConfig, modelFile, type RobotModel } from '@shared/plots';
import type { Settings } from '@shared/settings';
import { modelPathSegments, safeSegment } from '@shared/storage-layout';
import { dataDirectory } from './storage';

const partFile = /^model(_\d+)?\.glb$/;
// A model bigger than this is likely not one (and would be slow to draw).
const maxFileBytes = 200 * 1024 * 1024;

const modelsDirectory = (settings: Settings) => join(dataDirectory(settings), 'models');

async function readModel(directory: string, id: string): Promise<RobotModel | null> {
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  const files = names.filter((name) => partFile.test(name));
  if (!files.includes(modelFile(null))) return null;
  let raw: unknown = {};
  if (names.includes('config.json')) {
    raw = await fs.readFile(join(directory, 'config.json'), 'utf-8').then(JSON.parse).catch(() => null);
  }
  const config = cleanModelConfig(raw, id);
  if (!config) return null;
  // The robot, then its parts in order.
  files.sort((a, b) => (a === 'model.glb' ? -1 : b === 'model.glb' ? 1 : Number(a.slice(6, -4)) - Number(b.slice(6, -4))));
  return { id, config, files };
}

export async function listModels(settings: Settings): Promise<RobotModel[]> {
  const directory = modelsDirectory(settings);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const models = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => readModel(join(directory, e.name), e.name)));
  return models.filter((m): m is RobotModel => m !== null).sort((a, b) => a.config.name.localeCompare(b.config.name));
}

// Copies a model's folder (config.json and its .glb files) into models/.
// Resolves to the model, or why it can't.
export async function addModel(settings: Settings, folder: string): Promise<RobotModel | string> {
  const names = await fs.readdir(folder).catch(() => null);
  if (!names) return "That folder can't be read.";
  const parts = names.filter((name) => partFile.test(name));
  if (!parts.includes(modelFile(null))) {
    return 'A robot model is a folder with model.glb in it (and config.json, model_0.glb, ... as AdvantageScope has them).';
  }
  for (const name of parts) {
    const stat = await fs.stat(join(folder, name));
    if (stat.size > maxFileBytes) return `${name} is over ${maxFileBytes / 1024 / 1024} MB.`;
  }
  if (names.includes('config.json')) {
    const raw = await fs.readFile(join(folder, 'config.json'), 'utf-8').then(JSON.parse).catch(() => null);
    if (!cleanModelConfig(raw, '')) return "Its config.json isn't one.";
  }

  // Its folder's name, made unique.
  const base = safeSegment(basename(folder));
  const taken = new Set(await fs.readdir(modelsDirectory(settings)).catch(() => [] as string[]));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base} ${n}`;
  const target = join(modelsDirectory(settings), id);
  await fs.mkdir(target, { recursive: true });
  for (const name of [...parts, ...(names.includes('config.json') ? ['config.json'] : [])]) {
    await fs.copyFile(join(folder, name), join(target, name));
  }
  return (await readModel(target, id)) ?? "It couldn't be read once copied.";
}

export async function removeModel(settings: Settings, id: string): Promise<void> {
  const target = join(modelsDirectory(settings), safeSegment(id));
  // Only a model's folder.
  if (!(await readModel(target, id))) return;
  await fs.rm(target, { recursive: true, force: true });
}

// One of a model's .glb files, for the window to draw.
export async function readModelFile(settings: Settings, id: string, file: string): Promise<Uint8Array> {
  if (!partFile.test(file)) throw new Error('Not a model file.');
  const bytes = await fs.readFile(join(dataDirectory(settings), ...modelPathSegments(id, file)));
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
