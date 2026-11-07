// What people make and keep to look at logs again and again (#148): saved
// views of the chart, report templates, the pipelines that turn new logs
// into reports.
// Kept in the data folder's library/, and synced with the team's cloud
// copy when signed in. Reports made from them are kept in reports/.
//
// Nothing here may touch Node or the DOM.

import { isPowerEvent, type EventKind, type LogEvent, type MatchPhase } from './events';
import { monitorEvents, type MonitorAlarm, type MonitorResult } from './monitors';
import type { MatchInfo, MatchType } from './offload';
import type { VisionSummary } from './vision';
import { panelKeys, type PieMeasure, type PlotPanel } from './plots';
import type { SignalKind } from './signals';

export type LibraryKind = 'view' | 'template' | 'pipeline';

// Robot mappings (a kind 'mapping') were dropped: ones still in a data
// folder or the team's library are left there, and not read.
export const libraryKinds: LibraryKind[] = ['view', 'template', 'pipeline'];

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
  // Wherever the robot was enabled (auto, teleop or test): not the time
  // it sat disabled on the field or in the pit.
  | { type: 'enabled' }
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
  // `topic` 'power': only power problems (isPowerEvent), whatever the kinds.
  | { type: 'events'; title: string; kinds: EventKind[]; problemsOnly: boolean; topic?: 'power' }
  // The post-match monitors (monitors.ts): these, or every one with none.
  | { type: 'monitors'; title: string; ids: string[] }
  // Each camera: good data used against thrown out, when (a heatmap), and
  // how far its measurements were from the fused pose (vision.ts).
  | { type: 'vision'; title: string };

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
  // Which templates it ran, before every template ran. Kept, not used.
  templateIds: string[];
  // When a download or import brings several new logs at once (a backlog,
  // say): reports on all of them, on just the newest, or none.
  several: SeveralLogs;
}

export type SeveralLogs = 'all' | 'newest' | 'none';

export const severalLogsLabels: Record<SeveralLogs, string> = {
  all: 'Run on all of them',
  newest: 'Run on the newest only',
  none: "Don't run"
};

// There's one auto report configuration: the first one made. Libraries
// from before kept any number; the others are left alone and not run.
export function theAutoReport(pipelines: Pipeline[]): Pipeline | null {
  return [...pipelines].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))[0] ?? null;
}

export type LibraryItem = SavedView | ReportTemplate | Pipeline;

export interface LibraryItemOf {
  view: SavedView;
  template: ReportTemplate;
  pipeline: Pipeline;
}

export const kindLabels: Record<LibraryKind, { one: string; many: string }> = {
  view: { one: 'view', many: 'views' },
  template: { one: 'report template', many: 'report templates' },
  pipeline: { one: 'auto report', many: 'auto reports' }
};

export const scopeLabels: Record<ReportScope['type'], string> = {
  match: 'The whole match (or log)',
  enabled: 'While the robot is enabled',
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
  events: 'Events',
  monitors: 'Monitors (automatic checks)',
  vision: 'Vision system'
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
  | { type: 'events'; title: string; events: LogEvent[] }
  | { type: 'monitors'; title: string; results: MonitorResult[] }
  // `recorded`: when the log was, for which season's field to draw.
  | { type: 'vision'; title: string; summary: VisionSummary; alarms: MonitorAlarm[]; recorded?: string };

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
  // "Autonomous · mttd P5, Nov 6, 7:09 PM": its template's name and its log.
  name: string;
  // Just its template's name ("Autonomous"), for where the log is shown already.
  templateName: string;
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
  templateName: report.template?.name || report.name,
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

// --- A report's problems ---

// Whether an events section lists an event: of its kinds, and its topic.
export function sectionLists(section: Extract<ReportSection, { type: 'events' }>, event: LogEvent): boolean {
  return (section.kinds.length === 0 || section.kinds.includes(event.kind)) && (section.topic !== 'power' || isPowerEvent(event));
}

// The monitor the vision section shows.
export const visionMonitor = 'vision-disagreement';

export const isProblem = (event: LogEvent) => event.severity === 'error' || event.severity === 'warning';

// A report's errors and warnings are only what its own sections check: the
// events its events sections list, and the alarms of the monitors its
// monitors and vision sections show. So the Vision System report flags only
// the cameras, and the log's device faults (the Hoot logs', the robot
// code's) go to the reports that list them, the Match Report and the
// match-phase ones such as Autonomous.
export function reportProblems(sections: ReportSection[], events: LogEvent[], monitors: MonitorResult[]): LogEvent[] {
  const found = new Map<string, LogEvent>();
  const add = (list: LogEvent[]) => {
    for (const event of list) if (isProblem(event)) found.set(event.id, event);
  };
  for (const section of sections) {
    if (section.type === 'events') add(events.filter((e) => sectionLists(section, e)));
    if (section.type === 'monitors') add(monitorEvents(monitors.filter((r) => section.ids.length === 0 || section.ids.includes(r.id))));
    if (section.type === 'vision') add(monitorEvents(monitors.filter((r) => r.id === visionMonitor)));
  }
  return [...found.values()].sort((a, b) => a.start - b.start);
}
