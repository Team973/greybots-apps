// Log review: merging spans, modes and match phases, faults, notes' files.

import assert from 'node:assert/strict';
import { brownoutCount, defaultClockMode, matchFit, mergeSpans, phaseClock, phaseAt, tapeDoubleClickView, tapeSegments, tapeZoomChoices, type LogEvent } from '@shared/events';
import { brownoutDetail, enabledSpans, eventsFrom, faultSeverity, faultTitle, matchPhases, hootModes, modeEvents, spansWhere } from '@main/signals/events';
import { notesPathSegments } from '@shared/storage-layout';
const series = (times: number[], values: number[] | string[]) => ({ key: 'k', kind: typeof values[0] === 'string' ? 'string' : 'number', times: Float64Array.from(times), values: typeof values[0] === 'string' ? values : Float64Array.from(values as number[]), downsampled: false, stats: null }) as never;

// Merging: close spans join and are counted; far ones don't.
assert.deepEqual(mergeSpans([{ start: 0, end: 1 }, { start: 2.5, end: 3 }, { start: 10, end: null }]), [{ start: 0, end: 3, count: 2 }, { start: 10, end: null, count: 1 }]);
assert.deepEqual(mergeSpans([{ start: 5, end: null }, { start: 6, end: null }]), [{ start: 5, end: 6, count: 2 }]);
// Spans where a value passes; one still on at the end runs to the end.
assert.deepEqual(spansWhere(series([0, 1, 2, 3], [0, 1, 0, 1]), (v) => v === 1, 9), [{ start: 1, end: 2 }, { start: 3, end: 9 }]);
// Modes from CTRE's RobotMode, offset onto the timeline.
const modes = hootModes(series([0, 10, 25, 30, 170], ['Disabled', 'Autonomous', 'Disabled', 'Teleop', 'Disabled']), 100)!;
assert.deepEqual(modes.map((m) => [m.time, m.mode]), [[100, 'disabled'], [110, 'auto'], [125, 'disabled'], [130, 'teleop'], [270, 'disabled']]);
assert.deepEqual(modeEvents(modes, null).map((e) => e.title), ['Enabled: Autonomous', 'Disabled', 'Enabled: Teleop', 'Disabled']);
// Phases: endgame only in a match, the last 30 s of teleop.
const phases = matchPhases(modes, 300, true);
assert.deepEqual(phases.map((p) => [p.name, p.start, p.end]), [['auto', 110, 125], ['teleop', 130, 270], ['endgame', 240, 270]]);
assert.equal(matchPhases(modes, 300, false).length, 2);
// A brief drop doesn't split teleop.
assert.equal(matchPhases([{ time: 0, mode: 'teleop' }, { time: 50, mode: 'disabled' }, { time: 50.5, mode: 'teleop' }], 140, true).filter((p) => p.name === 'teleop').length, 1);
assert.equal(phaseAt(phases, 250)!.phase.name, 'endgame');
assert.equal(phaseClock(phases, 195), 'Teleop 1:05');
assert.equal(phaseClock(phases, 20), '');
// A report's choice: time into the phase, or left in it (a countdown, rounded up).
assert.equal(phaseClock(phases, 195, 'elapsed'), 'Teleop 1:05 elapsed');
assert.equal(phaseClock(phases, 195, 'remaining'), 'Teleop 1:15 remaining');
assert.equal(phaseClock(phases, 112.5, 'remaining'), 'Auto 0:13 remaining');
assert.equal(phaseClock(phases, 260, 'remaining'), 'Endgame 0:10 remaining', 'the endgame, not teleop');
assert.equal(phaseClock(phases, 270, 'remaining'), 'Endgame 0:00 remaining');
assert.equal(defaultClockMode(true), 'remaining', 'a match counts down');
assert.equal(defaultClockMode(false), 'elapsed');
// Faults.
assert.equal(faultTitle('TalonFX-59/Fault_SupplyCurrLimit'), 'TalonFX-59: supply current limit');
assert.equal(faultTitle('TalonFX-60/Fault_RotorFault1'), 'TalonFX-60: rotor fault1');
assert.equal(faultTitle('CANcoder-4/Fault_BadMagnet'), 'CANcoder-4: magnet out of range');
assert.equal(faultTitle('TalonFX-59/StickyFault_BridgeBrownout'), 'TalonFX-59: bridge brownout (sticky)');
// Every fault while it's happening is an error; sticky ones are warnings.
// Motors' faults are warnings; the Pigeon's errors, sticky or not; anything
// else's an error while it's happening and a warning once only sticky.
// Current limits are information.
assert.equal(faultSeverity('TalonFX-1/Fault_StatorCurrLimit'), 'info');
assert.equal(faultSeverity('TalonFX-1/StickyFault_SupplyCurrLimit'), 'info');
assert.equal(faultSeverity('TalonFX-1/Fault_ForwardSoftLimit'), 'warning');
assert.equal(faultSeverity('TalonFX-1/Fault_BridgeBrownout'), 'warning');
assert.equal(faultSeverity('TalonFX-1/StickyFault_BridgeBrownout'), 'info');
assert.equal(faultSeverity('TalonFXS-7/Fault_DeviceTemp'), 'warning');
assert.equal(faultSeverity('Pigeon2-1/Fault_Hardware'), 'error');
assert.equal(faultSeverity('Pigeon2-1/StickyFault_BootDuringEnable'), 'error');
assert.equal(faultSeverity('CANcoder-4/Fault_BadMagnet'), 'error');
assert.equal(faultSeverity('CANcoder-4/StickyFault_BadMagnet'), 'info');
assert.equal(faultSeverity('CANrange-3/StickyFault_Hardware'), 'warning');
// Notes' files can't step out of notes/.
assert.deepEqual(notesPathSegments('logs/frc973/2026-10-18/roborio/a.wpilog'), ['notes', 'frc973~2026-10-18~roborio~a.wpilog.json']);
assert.equal(notesPathSegments('../../x')[1].includes('/'), false);
assert.equal(notesPathSegments('..\\..\\x')[1].includes('\\'), false);

// --- When the robot was enabled ---
// Enabled in auto, a moment's drop, teleop; disabled; then test mode.
const enables = enabledSpans([
  { time: 0, mode: 'disabled' },
  { time: 10, mode: 'auto' },
  { time: 25, mode: 'disabled' },
  { time: 26, mode: 'teleop' },
  { time: 160, mode: 'disabled' },
  { time: 300, mode: 'test' }
], 330);
assert.deepEqual(enables, [[10, 160], [300, 330]]);
assert.deepEqual(enabledSpans([{ time: 0, mode: 'disabled' }], 100), []);

// The playback tape: disabled, auto, teleop and its endgame, and enabled
// outside the phases, merged where alike.
{
  const tape = tapeSegments([0, 300], [
    { name: 'auto', start: 10, end: 30 },
    { name: 'teleop', start: 33, end: 168 },
    { name: 'endgame', start: 138, end: 168 }
  ], [[10, 30], [33, 168], [200, 220]]);
  assert.deepEqual(tape.map((s) => [s.kind, s.start, s.end]), [
    ['disabled', 0, 10], ['auto', 10, 30], ['disabled', 30, 33], ['teleop', 33, 138], ['endgame', 138, 168],
    ['disabled', 168, 200], ['enabled', 200, 220], ['disabled', 220, 300]
  ]);
  // Never enabled: one stretch.
  assert.deepEqual(tapeSegments([5, 50], [], []), [{ kind: 'disabled', start: 5, end: 50 }]);
  assert.deepEqual(tapeSegments([5, 5], [], []), []);
}

// --- Brownouts: the flag going on and off close together is one ---
{
  // As mttd Q19's: on for a tenth of a second, every fifth, eleven times; then once more later.
  const flags = [...Array.from({ length: 11 }, (_, i) => ({ start: 282 + i * 0.3, end: 282.1 + i * 0.3 })), { start: 305.8, end: 305.9 }];
  const events = eventsFrom('brownout', 'error', 'Brownout', flags, { key: '/Robot/SystemStats/BrownedOut', detail: (count, span) => brownoutDetail(flags, count, span) });
  assert.equal(events.length, 2);
  assert.equal(events[0].count, 11);
  assert.equal(events[0].detail, 'Browned out 1.10 s in all, on and off 11 times over 3.1 s');
  assert.equal(events[1].detail, 'Browned out 0.10 s');
  assert.deepEqual(brownoutCount(events), { brownouts: 2, flags: 12 });
  // The same brownout in a Driver Station log too: still one.
  const ds: LogEvent = { ...events[0], id: 'ds', key: 'DS/Brownout', count: 1, start: 282.05, end: 282.2 };
  assert.deepEqual(brownoutCount([...events, ds]), { brownouts: 2, flags: 12 });
  assert.deepEqual(brownoutCount([]), { brownouts: 0, flags: 0 });
}

// Fitting the Signals page to the match: auto's start to the endgame's end,
// 5 s either side, within the log; nothing to fit without phases.
{
  const phases = [
    { name: 'auto' as const, start: 100, end: 120 },
    { name: 'teleop' as const, start: 123, end: 263 },
    { name: 'endgame' as const, start: 233, end: 263 }
  ];
  assert.deepEqual(matchFit(phases, [0, 400]), [95, 268]);
  assert.deepEqual(matchFit(phases, [98, 265]), [98, 265], 'not past the log');
  assert.deepEqual(matchFit(phases, [0, 400], 0), [100, 263]);
  assert.equal(matchFit([], [0, 400]), null);
  // Enabled again after the match (in the queue): not part of it.
  assert.deepEqual(matchFit([...phases, { name: 'teleop' as const, start: 1010, end: 1060 }], [0, 1100]), [95, 268]);
  // Not a match (no endgame): every phase.
  assert.deepEqual(matchFit([{ name: 'teleop' as const, start: 50, end: 60 }, { name: 'teleop' as const, start: 80, end: 90 }], [0, 100]), [45, 95]);
}

// Zooming the tape to fit: right-clicking offers the phase there (a second
// either side), the teleop an endgame is in, a stretch, the match, everything.
{
  const phases = [
    { name: 'auto' as const, start: 100, end: 120 },
    { name: 'teleop' as const, start: 123, end: 263 },
    { name: 'endgame' as const, start: 233, end: 263 }
  ];
  const enabled: [number, number][] = [[100, 120], [123, 263]];
  const at = (t: number) => tapeZoomChoices([0, 400], phases, enabled, t).map((c) => [c.label, c.view]);
  assert.deepEqual(at(110), [['Zoom to auto', [99, 121]], ['Zoom to the match', [95, 268]], ['Show all', [0, 400]]]);
  assert.deepEqual(at(150)[0], ['Zoom to teleop', [122, 264]]);
  assert.deepEqual(at(250).slice(0, 2), [['Zoom to endgame', [232, 264]], ['Zoom to teleop', [122, 264]]]);
  assert.deepEqual(at(50)[0], ['Zoom to this disabled stretch', [0, 100]]);
  // Not past the log.
  assert.deepEqual(tapeZoomChoices([100.5, 300], phases, enabled, 110)[0].view, [100.5, 121]);
  // No phases: a stretch and everything.
  assert.deepEqual(tapeZoomChoices([0, 50], [], [[10, 20]], 15).map((c) => c.label), ['Zoom to this enabled stretch', 'Show all']);
  // Double-click: the phase or stretch there, then out to the match, and
  // everything only once the match is shown (or there's none).
  const dbl = (view: [number, number], t: number) => tapeDoubleClickView([0, 400], phases, enabled, view, t);
  assert.deepEqual(dbl([0, 400], 110), [99, 121], 'auto');
  assert.deepEqual(dbl([0, 400], 150), [122, 264], 'teleop');
  assert.deepEqual(dbl([0, 400], 250), [232, 264], 'endgame');
  assert.deepEqual(dbl([0, 400], 50), [0, 100], 'disabled');
  assert.deepEqual(dbl([99, 121], 110), [95, 268], 'auto again: the match');
  assert.deepEqual(dbl([232, 264], 250), [95, 268], 'endgame again: the match');
  assert.deepEqual(dbl([95, 268], 110), [99, 121], 'from the match: the phase');
  assert.deepEqual(tapeDoubleClickView([0, 50], [], [[10, 20]], [0, 50], 15), [10, 20]);
  assert.deepEqual(tapeDoubleClickView([0, 50], [], [[10, 20]], [10, 20], 15), [0, 50], 'no match: everything');}
