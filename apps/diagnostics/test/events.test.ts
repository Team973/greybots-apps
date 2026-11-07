// Log review: merging spans, modes and match phases, faults, notes' files.

import assert from 'node:assert/strict';
import { mergeSpans, phaseClock, phaseAt, tapeSegments } from '@shared/events';
import { enabledSpans, faultSeverity, faultTitle, matchPhases, hootModes, modeEvents, spansWhere } from '@main/signals/events';
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
assert.equal(faultSeverity('TalonFX-1/StickyFault_BridgeBrownout'), 'warning');
assert.equal(faultSeverity('TalonFXS-7/Fault_DeviceTemp'), 'warning');
assert.equal(faultSeverity('Pigeon2-1/Fault_Hardware'), 'error');
assert.equal(faultSeverity('Pigeon2-1/StickyFault_BootDuringEnable'), 'error');
assert.equal(faultSeverity('CANcoder-4/Fault_BadMagnet'), 'error');
assert.equal(faultSeverity('CANcoder-4/StickyFault_BadMagnet'), 'warning');
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
