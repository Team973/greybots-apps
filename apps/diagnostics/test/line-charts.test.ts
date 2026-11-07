// More than one line chart on the Signals page: each tab keeps its own
// signals and axes, the one in play has them, and they're all kept.

import assert from 'node:assert/strict';

import { chartsNow, isLineTab, keepLine, takeLine, type LineTabs } from '@shared/line-charts';
import { cleanPanel, mapPanelKeys, newPanel, panelKeys, type LinePanel, type LineTrace } from '@shared/plots';

// A line chart's tab, as kept: a signal on an axis it doesn't have is left out.
const kept = cleanPanel({
  id: 'p2', type: 'line', title: 'Shooter',
  axes: [{ id: 'axis1', side: 'left' }, { id: 'x', side: 'up' }],
  traces: [{ key: '/a', kind: 'number', axis: 'axis1', band: 'top', color: 2 }, { key: '/b', kind: 'number', axis: 'nope', band: 'top', color: 0 }]
}) as LinePanel;
assert.equal(kept.title, 'Shooter');
assert.deepEqual(kept.axes, [{ id: 'axis1', side: 'left' }]);
assert.deepEqual(kept.traces.map((t) => t.key), ['/a']);
assert.deepEqual(panelKeys(kept), ['/a']);
assert.deepEqual(panelKeys(mapPanelKeys(kept, (k) => `/Robot${k}`)), ['/Robot/a']);

const trace = (key: string): LineTrace => ({ key, kind: 'number', axis: 'axis1', band: 'top', color: 0 });
const keys = (chart: { traces: LineTrace[] }) => chart.traces.map((t) => t.key);
// The page's charts: the first with the battery on it, another, and a field.
const tabs: LineTabs = {
  axes: [{ id: 'axis1', side: 'left' }],
  traces: [trace('/battery')],
  panels: [newPanel('line', 'p1', '2026'), newPanel('field', 'p2', '2026')],
  lineTab: 'line',
  mainLine: { axes: [], traces: [] }
};
assert.equal(isLineTab(tabs.panels, 'line'), true);
assert.equal(isLineTab(tabs.panels, 'p1'), true);
assert.equal(isLineTab(tabs.panels, 'p2'), false);

// To the second: it's empty, and the first's are kept.
keepLine(tabs);
takeLine(tabs, 'p1');
assert.equal(tabs.lineTab, 'p1');
assert.deepEqual(tabs.traces, []);
assert.deepEqual(keys(tabs.mainLine), ['/battery']);
tabs.axes = [{ id: 'axis2', side: 'left' }];
tabs.traces = [{ ...trace('/current'), axis: 'axis2' }];

// Kept as they are now, with neither moved: the first's as the chart's.
const now = chartsNow(tabs);
assert.deepEqual(keys(now.main), ['/battery']);
assert.deepEqual(keys(now.panels[0] as LinePanel), ['/current']);
assert.deepEqual(keys(tabs.panels[0] as LinePanel), [], 'the tab itself is filled in only when it leaves play');

// And back: each has its own.
keepLine(tabs);
assert.deepEqual(takeLine(tabs, 'line'), [{ id: 'axis1', side: 'left' }]);
assert.deepEqual(keys(tabs), ['/battery']);
keepLine(tabs);
takeLine(tabs, 'p1');
assert.deepEqual(keys(tabs), ['/current']);
assert.deepEqual(chartsNow(tabs).main, { axes: [{ id: 'axis1', side: 'left' }], traces: [trace('/battery')] });

// A tab that isn't a line chart brings the first into play.
keepLine(tabs);
takeLine(tabs, 'p2');
assert.equal(tabs.lineTab, 'line');
assert.deepEqual(keys(tabs), ['/battery']);
