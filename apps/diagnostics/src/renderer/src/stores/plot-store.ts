import { defineStore } from 'pinia';

import type { SignalKind } from '@shared/signals';

// What's on the Signals page's chart: which signals, on which axes, and the
// time span shown. Kept in a store so it survives going to another page and
// back. Saving charts by name comes with dashboards (#95).

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

export const usePlotStore = defineStore('plot', {
  state: () => ({
    axes: [] as PlotAxis[],
    traces: [] as PlotTrace[],
    colorChoices: loadColors(),
    // Seconds, as in signal series. Null shows the whole log.
    view: null as [number, number] | null
  }),
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
    setView(view: [number, number] | null) {
      this.view = view;
    }
  }
});
