// What people make and keep to look at logs again and again (#148): saved
// views of the chart, report templates, the pipelines that turn new logs
// into reports, and mappings from one robot's signal names to another's.
// Kept in the data folder's library/, and synced with the team's cloud
// copy when signed in. Reports made from them are kept in reports/.
//
// Nothing here may touch Node or the DOM.

import type { EventKind, LogEvent, MatchPhase } from './events';
import type { MatchInfo, MatchType } from './offload';
import { panelKeys, type PieMeasure, type PlotPanel } from './plots';
import type { SignalKind } from './signals';

export type LibraryKind = 'view' | 'template' | 'pipeline' | 'mapping';

export const libraryKinds: LibraryKind[] = ['view', 'template', 'pipeline', 'mapping'];

// Where an item stands with the team's cloud copy.
export interface CloudState {
  // When it was last sent or received, and its `changed` then: changed
  // since if they differ.
  syncedAt: string;
  changedAtSync: string;
}

export interface LibraryItemBase {
  // A UUID: the same here and in the cloud.
  id: string;
  kind: LibraryKind;
  name: string;
  description: string;
  // ISO times.
  created: string;
  changed: string;
  // Who made it, when known (a greybots-apps account's name).
  createdBy: string | null;
  // Saved for one robot's data only ("frc254"), or for any (null).
  robot: string | null;
  // Null until it's been in the cloud.
  cloud: CloudState | null;
}

// --- Views ---

// The span a view shows: the whole log, or a phase of the match.
export type ViewSpan = { type: 'all' } | { type: 'phase'; phase: 'auto' | 'teleop' | 'endgame' | 'match' };

export interface ViewAxis {
  id: string;
  side: 'left' | 'right';
}

export interface ViewTrace {
  key: string;
  kind: SignalKind;
  // An axis's id, or 'lanes' for a band.
  axis: string;
  band: 'top' | 'bottom';
  // A palette slot, or '#rrggbb'.
  color: number | string;
  hidden?: boolean;
}

export interface ViewBody {
  axes: ViewAxis[];
  traces: ViewTrace[];
  span: ViewSpan;
  // Which kinds of event show, if the view says.
  eventKinds: EventKind[] | null;
  // The other plots under the chart (#144). Left out by views saved before
  // there were any.
  panels?: PlotPanel[];
}

// Every signal a view shows, on the chart and in its other plots.
export function viewKeys(view: ViewBody): string[] {
  return [...new Set([...view.traces.map((t) => t.key), ...(view.panels ?? []).flatMap(panelKeys)])];
}

export interface SavedView extends LibraryItemBase, ViewBody {
  kind: 'view';
}

// --- Report templates ---

// What part of a log a report is of.
export type ReportScope =
  | { type: 'match' }
  | { type: 'auto' }
  | { type: 'teleop' }
  // A test mode, or anything else: wherever these flags all hold.
  | { type: 'conditions'; conditions: { key: string; value: boolean }[] };

export type ReportSection =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  // Facts about the log and the span: how long, the phases, the battery.
  | { type: 'summary' }
  // A chart, from a saved view (copied in, so the template stands alone).
  | { type: 'chart'; title: string; viewId: string | null; view: ViewBody }
  | { type: 'stats'; title: string; keys: string[] }
  // Each slice's share of the total over the span: a signal (a motor's
  // current), or a group of them added up (a subsystem's motors).
  | { type: 'pie'; title: string; measure: PieMeasure; voltage: string; slices: PieSliceSpec[] }
  | { type: 'events'; title: string; kinds: EventKind[]; problemsOnly: boolean };

// What a pie adds up, as a pie plot's (plots.ts): `voltage` is the signal
// every current is multiplied by for energy, or '' for each current's own.
export type { PieMeasure };

export const pieMeasureLabels: Record<PieMeasure, string> = {
  charge: 'Current over time (amp-seconds)',
  energy: 'Energy: voltage times current over time (watt-hours)'
};

export interface PieSliceSpec {
  label: string;
  keys: string[];
}

export type ReportSectionType = ReportSection['type'];

export interface ReportTemplate extends LibraryItemBase {
  kind: 'template';
  scope: ReportScope;
  sections: ReportSection[];
}

// --- Pipelines ---

export interface Pipeline extends LibraryItemBase {
  kind: 'pipeline';
  enabled: boolean;
  // Which new logs it runs on: offloaded, imported, or both.
  onOffload: boolean;
  onImport: boolean;
  // Logs of these robots only (empty: any).
  robots: string[];
  // Matches of these types only, or 'none' for logs that aren't a match (empty: any).
  matchTypes: (MatchType | 'none')[];
  templateIds: string[];
}

// --- Mappings ---

// A robot's own names for the signals views and templates ask for: for
// another team's robot, or a robot whose code names things differently.
export interface SignalMapping extends LibraryItemBase {
  kind: 'mapping';
  // Which robot's data ("frc254"); also in `robot`.
  // The signal asked for -> the robot's signal, or null when it has none
  // (flagged: a report says it's missing rather than guessing).
  fields: Record<string, string | null>;
}

export type LibraryItem = SavedView | ReportTemplate | Pipeline | SignalMapping;

export interface LibraryItemOf {
  view: SavedView;
  template: ReportTemplate;
  pipeline: Pipeline;
  mapping: SignalMapping;
}

export const kindLabels: Record<LibraryKind, { one: string; many: string }> = {
  view: { one: 'view', many: 'views' },
  template: { one: 'report template', many: 'report templates' },
  pipeline: { one: 'pipeline', many: 'pipelines' },
  mapping: { one: 'robot mapping', many: 'robot mappings' }
};

export const scopeLabels: Record<ReportScope['type'], string> = {
  match: 'The whole match (or log)',
  auto: 'Autonomous only',
  teleop: 'Teleop only',
  conditions: 'While chosen signals are true (a test mode)'
};

export const sectionLabels: Record<ReportSectionType, string> = {
  heading: 'Heading',
  text: 'Text',
  summary: 'Summary',
  chart: 'Chart',
  stats: 'Stats table',
  pie: 'Pie chart',
  events: 'Events'
};

export const maxNameLength = 120;
export const maxTextLength = 4000;

// --- Reports ---

// A chart's data as kept in a report: what was read, at the size drawn.
export interface ReportLine {
  key: string;
  label: string;
  unit: string;
  // A palette slot, or '#rrggbb'.
  color: number | string;
  axis: string;
  band: 'top' | 'bottom';
  kind: SignalKind;
  times: number[];
  values: number[] | string[];
}

export interface ReportStatsRow {
  key: string;
  label: string;
  unit: string;
  min: number | null;
  max: number | null;
  mean: number | null;
}

export interface ReportPieSlice {
  label: string;
  // The signals found, and those asked for that weren't.
  keys: string[];
  missing: string[];
  // The slice's signals' time-weighted means added up (amps for currents),
  // and that times the span's length (amp-seconds), which the share is of.
  // For energy, its average power (watts) and its energy (watt-hours).
  mean: number;
  total: number;
}

export type RenderedSection =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'summary'; facts: { label: string; value: string }[] }
  | { type: 'chart'; title: string; axes: ViewAxis[]; lines: ReportLine[]; view: [number, number]; missing: string[] }
  | { type: 'stats'; title: string; rows: ReportStatsRow[]; missing: string[] }
  // `measure` is missing from reports made before energy (charge).
  | { type: 'pie'; title: string; measure?: PieMeasure; unit: string; seconds: number; slices: ReportPieSlice[] }
  | { type: 'events'; title: string; events: LogEvent[] };

export interface Report {
  id: string;
  name: string;
  // When, and how: by hand, or by a pipeline (its name).
  generated: string;
  by: string;
  templateId: string;
  // The template as it was, so a report can be read (and made a template
  // again) after the template changes or goes.
  template: ReportTemplate;
  logId: string;
  logLabel: string;
  robot: string;
  match: MatchInfo | null;
  // The spans of the log it's of, in seconds.
  spans: [number, number][];
  phases: MatchPhase[];
  sections: RenderedSection[];
  // The errors and warnings in its spans, shown first. Missing from
  // reports made before they were kept.
  problems?: LogEvent[];
  // Signals asked for that this log doesn't have, mapped or not.
  missing: string[];
}

// An error or warning a report found, as the list of reports shows it.
export interface ReportProblem {
  // The same each time the log is read, so the same problem found by two
  // reports of one log is one problem.
  id: string;
  severity: 'error' | 'warning';
  title: string;
}

// The list of reports, without their data.
export interface ReportSummary {
  id: string;
  name: string;
  generated: string;
  by: string;
  templateId: string;
  logId: string;
  logLabel: string;
  robot: string;
  match: MatchInfo | null;
  missing: number;
  // The errors and warnings in its spans (none for reports made before
  // they were kept).
  problems: ReportProblem[];
}

export const reportSummary = (report: Report): ReportSummary => ({
  id: report.id,
  name: report.name,
  generated: report.generated,
  by: report.by,
  templateId: report.templateId,
  logId: report.logId,
  logLabel: report.logLabel,
  robot: report.robot,
  match: report.match ?? null,
  missing: report.missing.length,
  problems: (report.problems ?? [])
    .filter((event) => event.severity === 'error' || event.severity === 'warning')
    .map((event) => ({ id: event.id, severity: event.severity as ReportProblem['severity'], title: event.title }))
});

// Every signal a template or view asks for.
export function templateKeys(sections: ReportSection[], scope?: ReportScope): string[] {
  const keys = new Set<string>();
  for (const section of sections) {
    if (section.type === 'chart') for (const trace of section.view.traces) keys.add(trace.key);
    if (section.type === 'stats') for (const key of section.keys) keys.add(key);
    if (section.type === 'pie') {
      for (const slice of section.slices) for (const key of slice.keys) keys.add(key);
      if (section.measure === 'energy' && section.voltage) keys.add(section.voltage);
    }
  }
  if (scope?.type === 'conditions') for (const condition of scope.conditions) keys.add(condition.key);
  return [...keys];
}
