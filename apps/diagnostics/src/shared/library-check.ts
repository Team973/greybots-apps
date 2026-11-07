// Library items as they're kept: what's read from disk, sent by the window
// or received from the cloud is checked and cleaned here first, so a bad
// or hand-edited file can't break a page. Unknown fields are dropped.
//
// Nothing here may touch Node or the DOM.

import { eventKinds, type EventKind } from './events';
import {
  libraryKinds,
  maxNameLength,
  maxTextLength,
  type LibraryItem,
  type LibraryItemBase,
  type ReportScope,
  type ReportSection,
  type ViewBody,
  type ViewSpan
} from './library';
import type { MatchType } from './offload';
import { cleanPanels } from './plots';

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = maxNameLength) => (typeof value === 'string' ? value.slice(0, max) : '');
const strings = (value: unknown, max = 200): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, max) : [];
const time = (value: unknown, fallback: string) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback);
const allKinds = new Set<string>(eventKinds.map((k) => k.kind));
const eventKindList = (value: unknown): EventKind[] => strings(value).filter((k): k is EventKind => allKinds.has(k));

// Most signals a chart can have, and sections a template.
const maxTraces = 8;
const maxSections = 40;

export function cleanViewBody(raw: Raw): ViewBody {
  const axes = (Array.isArray(raw.axes) ? raw.axes : [])
    .filter(isObject)
    .filter((a) => typeof a.id === 'string' && (a.side === 'left' || a.side === 'right'))
    .slice(0, maxTraces)
    .map((a) => ({ id: a.id as string, side: a.side as 'left' | 'right' }));
  const traces = (Array.isArray(raw.traces) ? raw.traces : [])
    .filter(isObject)
    .filter((t) => typeof t.key === 'string' && typeof t.axis === 'string' && (t.axis === 'lanes' || axes.some((a) => a.id === t.axis)))
    .slice(0, maxTraces)
    .map((t) => ({
      key: (t.key as string).slice(0, 500),
      kind: (['number', 'boolean', 'string'].includes(t.kind as string) ? t.kind : 'number') as ViewBody['traces'][number]['kind'],
      axis: t.axis as string,
      band: (t.band === 'bottom' ? 'bottom' : 'top') as 'top' | 'bottom',
      color: typeof t.color === 'number' && Number.isInteger(t.color) && t.color >= 0 && t.color < maxTraces
        ? t.color
        : typeof t.color === 'string' && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : 0,
      ...(t.hidden === true ? { hidden: true } : {})
    }));
  const span = isObject(raw.span) ? raw.span : {};
  const cleanSpan: ViewSpan = span.type === 'phase' && ['auto', 'teleop', 'endgame', 'match'].includes(span.phase as string)
    ? { type: 'phase', phase: span.phase as 'auto' | 'teleop' | 'endgame' | 'match' }
    : { type: 'all' };
  return {
    axes,
    traces,
    span: cleanSpan,
    eventKinds: raw.eventKinds === null || raw.eventKinds === undefined ? null : eventKindList(raw.eventKinds),
    ...(Array.isArray(raw.panels) ? { panels: cleanPanels(raw.panels) } : {})
  };
}

function cleanScope(raw: unknown): ReportScope {
  if (!isObject(raw)) return { type: 'match' };
  if (raw.type === 'auto' || raw.type === 'teleop' || raw.type === 'enabled') return { type: raw.type };
  if (raw.type === 'conditions') {
    const conditions = (Array.isArray(raw.conditions) ? raw.conditions : [])
      .filter(isObject)
      .filter((c) => typeof c.key === 'string')
      .slice(0, 10)
      .map((c) => ({ key: (c.key as string).slice(0, 500), value: c.value !== false }));
    return { type: 'conditions', conditions };
  }
  return { type: 'match' };
}

function cleanSection(raw: Raw): ReportSection | null {
  switch (raw.type) {
    case 'heading':
      return { type: 'heading', text: text(raw.text) };
    case 'text':
      return { type: 'text', text: text(raw.text, maxTextLength) };
    case 'summary':
      return { type: 'summary' };
    case 'chart':
      return {
        type: 'chart',
        title: text(raw.title),
        viewId: typeof raw.viewId === 'string' ? raw.viewId : null,
        view: cleanViewBody(isObject(raw.view) ? raw.view : {})
      };
    case 'stats':
      return { type: 'stats', title: text(raw.title), keys: strings(raw.keys, 40) };
    case 'pie':
      return {
        type: 'pie',
        title: text(raw.title),
        measure: raw.measure === 'energy' ? 'energy' : 'charge',
        voltage: text(raw.voltage, 500),
        slices: (Array.isArray(raw.slices) ? raw.slices : [])
          .filter(isObject)
          .slice(0, 40)
          .map((slice) => ({ label: text(slice.label), keys: strings(slice.keys, 40).map((k) => k.slice(0, 500)) }))
      };
    case 'events':
      return { type: 'events', title: text(raw.title), kinds: eventKindList(raw.kinds), problemsOnly: raw.problemsOnly !== false };
    default:
      return null;
  }
}

const matchTypes = new Set(['practice', 'qualification', 'elimination', 'none']);

// The item, cleaned, or null if it isn't one. `now` fills in missing times.
export function cleanLibraryItem(raw: unknown, now = new Date().toISOString()): LibraryItem | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(raw.id)) return null;
  if (!libraryKinds.includes(raw.kind as LibraryItem['kind'])) return null;
  const cloud = isObject(raw.cloud) && typeof raw.cloud.syncedAt === 'string' && typeof raw.cloud.changedAtSync === 'string'
    ? { syncedAt: raw.cloud.syncedAt, changedAtSync: raw.cloud.changedAtSync }
    : null;
  const base: LibraryItemBase = {
    id: raw.id,
    kind: raw.kind as LibraryItem['kind'],
    name: text(raw.name).trim() || 'Untitled',
    description: text(raw.description, maxTextLength),
    created: time(raw.created, now),
    changed: time(raw.changed, now),
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy.slice(0, maxNameLength) : null,
    robot: typeof raw.robot === 'string' && raw.robot.trim() ? raw.robot.trim().slice(0, 40) : null,
    cloud
  };
  switch (base.kind) {
    case 'view':
      return { ...base, kind: 'view', ...cleanViewBody(raw) };
    case 'template':
      return {
        ...base,
        kind: 'template',
        scope: cleanScope(raw.scope),
        sections: (Array.isArray(raw.sections) ? raw.sections : [])
          .filter(isObject)
          .map(cleanSection)
          .filter((s): s is ReportSection => s !== null)
          .slice(0, maxSections)
      };
    case 'pipeline':
      return {
        ...base,
        kind: 'pipeline',
        enabled: raw.enabled !== false,
        onOffload: raw.onOffload !== false,
        onImport: raw.onImport === true,
        robots: strings(raw.robots, 50),
        matchTypes: strings(raw.matchTypes).filter((t): t is MatchType | 'none' => matchTypes.has(t)),
        templateIds: strings(raw.templateIds, 50),
        several: raw.several === 'newest' || raw.several === 'none' ? raw.several : 'all'
      };
  }
}
