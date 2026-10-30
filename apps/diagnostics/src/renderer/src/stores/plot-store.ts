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

export interface PlotTrace {
  key: string;
  kind: SignalKind;
  // A numeric axis's id, or 'lanes' for text signals (drawn as bands of
  // labelled spans above the plot).
  axis: string;
  // A slot in the palette. It stays with the signal while it's on the chart.
  color: number;
}

// Where a signal goes: an axis, or a new one on one side.
export type PlotTarget = { axis: string } | { newAxis: AxisSide };

// The palette has this many colours; more signals than that can't be told apart.
export const maxTraces = 8;

let nextAxisId = 1;

export const usePlotStore = defineStore('plot', {
  state: () => ({
    axes: [] as PlotAxis[],
    traces: [] as PlotTrace[],
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
    // to the lanes. Resolves to why it couldn't, or ''.
    place(key: string, kind: SignalKind, target?: PlotTarget): string {
      if (kind === 'other') return "This signal can't be plotted: it's a group of values. Plot its fields instead.";
      const existing = this.traces.find((t) => t.key === key);
      if (kind === 'string') {
        if (!existing) {
          if (this.traces.length >= maxTraces) return `At most ${maxTraces} signals fit on one chart.`;
          this.traces.push({ key, kind, axis: 'lanes', color: this.freeColor() });
        }
        return '';
      }
      if (!existing && this.traces.length >= maxTraces) return `At most ${maxTraces} signals fit on one chart.`;
      const axis = this.resolve(target);
      if (existing) existing.axis = axis;
      else this.traces.push({ key, kind, axis, color: this.freeColor() });
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
    freeColor(): number {
      for (let slot = 0; slot < maxTraces; slot++) if (!this.traces.some((t) => t.color === slot)) return slot;
      return 0;
    },
    setView(view: [number, number] | null) {
      this.view = view;
    }
  }
});
