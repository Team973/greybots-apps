import { defineStore } from 'pinia';

import type { EventKind } from '@shared/events';
import type { ViewBody, ViewSpan } from '@shared/library';
import { cleanPanels, mapPanelKeys, maxPanels, newPanel, type PanelType, type PlotPanel } from '@shared/plots';
import type { SignalKind } from '@shared/signals';

// What's on the Signals page's chart: which log or live session, which
// signals, on which axes, and the time span shown. Kept in a store so it
// survives going to another page and back, and saved, so it's there again
// when the app is opened. Saving charts by name comes with dashboards (#95).

export type AxisSide = 'left' | 'right';

export interface PlotAxis {
  id: string;
  side: AxisSide;
}

// A slot in the palette (a step per theme), or a colour the person chose
// ('#rrggbb', the same in both themes).
export type TraceColor = number | string;

// Text signals' bands go above the plot or below it.
export type BandSide = 'top' | 'bottom';

export interface PlotTrace {
  key: string;
  kind: SignalKind;
  // A numeric axis's id, or 'lanes' for a band of labelled spans above or
  // below the plot: always for text signals, and for numbers that are
  // really states (a 0/1 flag, a mode number) when the person says so.
  axis: string;
  // In a band: which side of the plot it's on.
  band: BandSide;
  // It stays with the signal while it's on the chart.
  color: TraceColor;
  // Taken off the chart for now, but still listed with its values.
  hidden?: boolean;
}

// Where a signal goes: an axis, a new one on one side, or a band.
export type PlotTarget = { axis: string } | { newAxis: AxisSide } | { band: BandSide };

// The palette has this many colours; more signals than that can't be told apart.
export const maxTraces = 8;

let nextAxisId = 1;

// Colours the person picked, by signal, kept between visits: a signal
// added again gets its colour back.
const colorsKey = 'signals.colors';
function loadColors(): Record<string, TraceColor> {
  try {
    return JSON.parse(localStorage.getItem(colorsKey) ?? '{}') as Record<string, TraceColor>;
  } catch {
    return {};
  }
}

// The chart as it was last left.
const savedKey = 'signals.chart';
interface SavedChart {
  logId: string;
  axes: PlotAxis[];
  traces: PlotTrace[];
  view: [number, number] | null;
  // The other plots, each in a tab beside the chart's (#144).
  panels: PlotPanel[];
  // The tab shown: 'line' for the chart, or a plot's id.
  activeTab: string;
}

let nextPanelId = 1;

function loadChart(): SavedChart {
  const empty: SavedChart = { logId: '', axes: [], traces: [], view: null, panels: [], activeTab: 'line' };
  try {
    const saved = JSON.parse(localStorage.getItem(savedKey) ?? 'null') as Partial<SavedChart> | null;
    if (!saved || typeof saved !== 'object') return empty;
    const axes = Array.isArray(saved.axes)
      ? saved.axes.filter((a) => typeof a?.id === 'string' && (a.side === 'left' || a.side === 'right'))
      : [];
    const traces = Array.isArray(saved.traces)
      ? saved.traces.filter((t) => typeof t?.key === 'string' && typeof t.axis === 'string' &&
          (t.axis === 'lanes' || axes.some((a) => a.id === t.axis))).slice(0, maxTraces)
      : [];
    const view = Array.isArray(saved.view) && saved.view.length === 2 && saved.view.every(Number.isFinite) ? saved.view : null;
    // New axes are numbered after the ones brought back.
    for (const axis of axes) nextAxisId = Math.max(nextAxisId, Number(axis.id.replace(/^axis/, '')) + 1 || nextAxisId);
    const panels = cleanPanels(saved.panels);
    for (const panel of panels) nextPanelId = Math.max(nextPanelId, Number(panel.id.replace(/^panel/, '')) + 1 || nextPanelId);
    const activeTab = panels.some((p) => p.id === saved.activeTab) ? saved.activeTab! : 'line';
    return { logId: typeof saved.logId === 'string' ? saved.logId : '', axes, traces, view, panels, activeTab };
  } catch {
    return empty;
  }
}

export const usePlotStore = defineStore('plot', {
  state: () => {
    const saved = loadChart();
    return {
      // The log (or live session) open on the Signals page.
      logId: saved.logId,
      axes: saved.axes,
      traces: saved.traces,
      colorChoices: loadColors(),
      // Seconds, as in signal series. Null shows the whole log.
      view: saved.view,
      panels: saved.panels,
      activeTab: saved.activeTab
    };
  },
  getters: {
    // L1, L2, ... and R1, R2, ..., numbered outward from the plot.
    axisName: (state) => (id: string): string => {
      const axis = state.axes.find((a) => a.id === id);
      if (!axis) return '';
      const sameSide = state.axes.filter((a) => a.side === axis.side);
      return `${axis.side === 'left' ? 'L' : 'R'}${sameSide.indexOf(axis) + 1}`;
    },
    trace: (state) => (key: string) => state.traces.find((t) => t.key === key)
  },
  actions: {
    addAxis(side: AxisSide): string {
      const id = `axis${nextAxisId++}`;
      this.axes.push({ id, side });
      return id;
    },
    // The axis a target names, made if it's a new one.
    resolve(target: PlotTarget | undefined): string {
      if (target && 'axis' in target && this.axes.some((a) => a.id === target.axis)) return target.axis;
      if (target && 'newAxis' in target) return this.addAxis(target.newAxis);
      return this.axes.find((a) => a.side === 'left')?.id ?? this.addAxis('left');
    },
    // Adds a signal, or moves it if it's already on. Text signals always go
    // to a band (the top one unless it says); others go to a band only when
    // the target is one. Returns why it couldn't, or ''.
    place(key: string, kind: SignalKind, target?: PlotTarget): string {
      if (kind === 'other') return "This signal can't be plotted: it's a group of values. Plot its fields instead.";
      const existing = this.traces.find((t) => t.key === key);
      if (!existing && this.traces.length >= maxTraces) return `At most ${maxTraces} signals fit on one chart.`;
      if (kind === 'string' || (target && 'band' in target)) {
        const band = target && 'band' in target ? target.band : existing?.band ?? 'top';
        if (existing) Object.assign(existing, { axis: 'lanes', band });
        else this.traces.push({ key, kind, axis: 'lanes', band, color: this.colorFor(key) });
        this.prune();
        return '';
      }
      const axis = this.resolve(target);
      if (existing) existing.axis = axis;
      else this.traces.push({ key, kind, axis, band: 'top', color: this.colorFor(key) });
      this.prune();
      return '';
    },
    // A signal's type, once read, when it wasn't known before (Hoot logs):
    // text goes to the bands, numbers to an axis.
    setKind(key: string, kind: SignalKind) {
      const trace = this.traces.find((t) => t.key === key);
      if (!trace || kind === 'other') return;
      trace.kind = kind;
      if (kind === 'string') trace.axis = 'lanes';
      else if (trace.axis === 'lanes') trace.axis = this.resolve(undefined);
      this.prune();
    },
    toggleHidden(key: string) {
      const trace = this.traces.find((t) => t.key === key);
      if (trace) trace.hidden = !trace.hidden;
    },
    remove(key: string) {
      this.traces = this.traces.filter((t) => t.key !== key);
      this.prune();
    },
    clear() {
      this.traces = [];
      this.axes = [];
    },
    // Axes with nothing on them go.
    prune() {
      this.axes = this.axes.filter((a) => this.traces.some((t) => t.axis === a.id));
    },
    // The colour the person picked for this signal, or the first free slot.
    colorFor(key: string): TraceColor {
      if (this.colorChoices[key] !== undefined) return this.colorChoices[key];
      for (let slot = 0; slot < maxTraces; slot++) if (!this.traces.some((t) => t.color === slot)) return slot;
      return 0;
    },
    setColor(key: string, color: TraceColor) {
      const trace = this.traces.find((t) => t.key === key);
      if (trace) trace.color = color;
      this.colorChoices[key] = color;
      localStorage.setItem(colorsKey, JSON.stringify(this.colorChoices));
    },
    // What's on the chart, to save as a view (#148).
    viewBody(span: ViewSpan, eventKinds: EventKind[] | null): ViewBody {
      return {
        axes: this.axes.map((a) => ({ ...a })),
        traces: this.traces.map((t) => ({ key: t.key, kind: t.kind, axis: t.axis, band: t.band, color: t.color, ...(t.hidden ? { hidden: true } : {}) })),
        span,
        eventKinds,
        panels: this.panels.map((p) => JSON.parse(JSON.stringify(p)) as PlotPanel)
      };
    },
    // Puts a saved view on the chart, each signal found in this log by
    // `find` (by name, or the end of its path). Resolves to the
    // signals it couldn't find.
    applyView(body: ViewBody, find: (key: string) => string | null): string[] {
      const missing: string[] = [];
      const axes = body.axes.map((a) => ({ id: `axis${nextAxisId++}`, side: a.side, was: a.id }));
      const traces: PlotTrace[] = [];
      for (const trace of body.traces) {
        const key = find(trace.key);
        if (!key) {
          missing.push(trace.key);
          continue;
        }
        if (traces.some((t) => t.key === key)) continue;
        const axis = trace.axis === 'lanes' ? 'lanes' : axes.find((a) => a.was === trace.axis)?.id ?? axes[0]?.id ?? 'lanes';
        traces.push({ key, kind: trace.kind, axis, band: trace.band, color: trace.color, ...(trace.hidden ? { hidden: true } : {}) });
      }
      this.axes = axes.map(({ id, side }) => ({ id, side }));
      this.traces = traces.slice(0, maxTraces);
      // A view saved before there were other plots leaves them as they are.
      if (body.panels) {
        this.panels = body.panels.map((p) => mapPanelKeys({ ...p, id: `panel${nextPanelId++}` }, find));
        this.activeTab = 'line';
      }
      this.prune();
      return missing;
    },
    // --- The other plots (#144), each in a tab ---
    // Opens a plot in a new tab, and shows it.
    addPanel(type: PanelType, season: string): string {
      if (this.panels.length >= maxPanels) return `At most ${maxPanels} plots can be open beside the chart.`;
      const panel = newPanel(type, `panel${nextPanelId++}`, season);
      this.panels.push(panel);
      this.activeTab = panel.id;
      return '';
    },
    showTab(id: string) {
      this.activeTab = id === 'line' || this.panels.some((p) => p.id === id) ? id : 'line';
    },
    updatePanel(panel: PlotPanel) {
      const at = this.panels.findIndex((p) => p.id === panel.id);
      if (at !== -1) this.panels.splice(at, 1, panel);
    },
    // Closes a plot's tab. If it was shown, the tab before it is.
    removePanel(id: string) {
      const at = this.panels.findIndex((p) => p.id === id);
      if (at === -1) return;
      this.panels.splice(at, 1);
      if (this.activeTab === id) this.activeTab = this.panels[at - 1]?.id ?? 'line';
    },
    setView(view: [number, number] | null) {
      this.view = view;
    },
    save() {
      const chart: SavedChart = { logId: this.logId, axes: this.axes, traces: this.traces, view: this.view, panels: this.panels, activeTab: this.activeTab };
      localStorage.setItem(savedKey, JSON.stringify(chart));
    }
  }
});
