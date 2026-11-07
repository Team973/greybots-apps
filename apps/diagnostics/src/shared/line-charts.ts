// More than one line chart on the Signals page, each in a tab. The one in
// play (shown, or last shown) has its signals in `axes` and `traces`, so all
// the chart's code works on whichever it is; the others keep theirs: the
// first's in `mainLine`, the rest's in their tabs (LinePanel).
//
// Nothing here may touch Node or the DOM.

import type { LineAxis, LinePanel, LineTrace, PlotPanel } from './plots';

export interface LineChart {
  axes: LineAxis[];
  traces: LineTrace[];
}

export interface LineTabs extends LineChart {
  panels: PlotPanel[];
  // The line chart in play: 'line' for the first, or its tab's id.
  lineTab: string;
  mainLine: LineChart;
}

export const copyChart = (chart: LineChart): LineChart =>
  ({ axes: chart.axes.map((a) => ({ ...a })), traces: chart.traces.map((t) => ({ ...t })) });

// Whether a tab is a line chart's: the first's, or another's.
export const isLineTab = (panels: PlotPanel[], id: string) => id === 'line' || panels.some((p) => p.id === id && p.type === 'line');

// The line chart in play put back where it's kept.
export function keepLine(tabs: LineTabs) {
  const shown = copyChart(tabs);
  if (tabs.lineTab === 'line') {
    tabs.mainLine = shown;
    return;
  }
  const at = tabs.panels.findIndex((p) => p.id === tabs.lineTab);
  const panel = tabs.panels[at];
  if (panel?.type === 'line') tabs.panels.splice(at, 1, { ...panel, ...shown });
}

// Another line chart brought into play (the first, if `id` isn't one).
// Resolves to its axes, to number new ones after.
export function takeLine(tabs: LineTabs, id: string): LineAxis[] {
  const panel = tabs.panels.find((p): p is LinePanel => p.id === id && p.type === 'line');
  const chart = copyChart(panel ?? tabs.mainLine);
  tabs.axes = chart.axes;
  tabs.traces = chart.traces;
  tabs.lineTab = panel ? panel.id : 'line';
  return chart.axes;
}

// Every line chart as it is now: the first's, and each tab's.
export function chartsNow(tabs: LineTabs): { main: LineChart; panels: PlotPanel[] } {
  const shown = copyChart(tabs);
  const panels = tabs.panels.map((p) => (p.id === tabs.lineTab && p.type === 'line'
    ? { ...p, ...shown }
    : JSON.parse(JSON.stringify(p)) as PlotPanel));
  return { main: tabs.lineTab === 'line' ? shown : copyChart(tabs.mainLine), panels };
}
