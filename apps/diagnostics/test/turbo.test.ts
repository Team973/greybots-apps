// Turbo download (pausing the robot program while its logs come) and the
// transfer log: the guard, the commands sent to the robot, reading them
// back; the log's lines and filtering; why USB imports failed.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { filterIoLog, ioLogLine, type IoLogEntry } from '@shared/io-log';
import {
  controlWord,
  findRobotProgramScript,
  parsePids,
  parseRobotPrograms,
  signalCommand,
  stoppedCheckScript,
  turboRefusal
} from '@shared/turbo';
import { usbImportFailures } from '@shared/usb';

// --- The control word: WPILib's bits ---
assert.deepEqual(controlWord(0x20), { enabled: false, autonomous: false, test: false, eStop: false, fmsAttached: false, dsAttached: true });
assert.equal(controlWord(0x21).enabled, true);
assert.equal(controlWord(0x23).autonomous, true);
assert.equal(controlWord(0x30).fmsAttached, true);

// --- Only disabled, off the field, and known ---
assert.equal(turboRefusal(controlWord(0x20)), '', 'disabled, Driver Station attached: may');
assert.equal(turboRefusal(controlWord(0x00)), '', 'no Driver Station: may');
assert.match(turboRefusal(controlWord(0x21)), /enabled/);
assert.match(turboRefusal(controlWord(0x30)), /field/, 'on a field, even disabled: never');
assert.match(turboRefusal(null), /Couldn't read/, "can't tell: not paused");

// --- Finding the robot program ---
assert.deepEqual(parseRobotPrograms('1234 /usr/local/frc/JRE/bin/java\n\n987 /home/lvuser/frcUserProgram\njunk\n'), [
  { pid: 1234, program: '/usr/local/frc/JRE/bin/java' },
  { pid: 987, program: '/home/lvuser/frcUserProgram' }
]);
assert.deepEqual(parseRobotPrograms(''), []);
// The script is a valid shell script (checked by a shell where there is one).
const shell = spawnSync('sh', ['-n', '-c', findRobotProgramScript]);
if (!shell.error) assert.equal(shell.status, 0, String(shell.stderr));

// --- What's sent: only pids, never init or anything else ---
assert.equal(signalCommand('STOP', [1234, 987]), 'kill -STOP 1234 987');
assert.equal(signalCommand('CONT', [1, 0, -5, 1.5, 42]), 'kill -CONT 42');
assert.equal(stoppedCheckScript([7, 1, 8]).startsWith('for p in 7 8; do'), true);
if (!shell.error) assert.equal(spawnSync('sh', ['-n', '-c', stoppedCheckScript([7, 8])]).status, 0);
assert.deepEqual(parsePids('12\n\n34\nx\n'), [12, 34]);

// --- The transfer log ---
{
  const entries: IoLogEntry[] = [
    { seq: 1, at: '2026-11-09T10:00:00.000Z', area: 'robot', op: 'download', outcome: 'ok', path: '/home/lvuser/logs/a.wpilog', bytes: 10, ms: 12.4 },
    { seq: 2, at: '2026-11-09T10:00:01.000Z', area: 'usb-import', op: 'import', outcome: 'fail', path: 'E:\\logs\\b.hoot', message: 'bad\nzip' },
    { seq: 3, at: '2026-11-09T10:00:02.000Z', area: 'usb-import', op: 'import', outcome: 'skip', path: 'E:\\logs\\c.hoot', message: 'already here' }
  ];
  assert.equal(ioLogLine(entries[0]), '2026-11-09T10:00:00.000Z\trobot\tdownload\tOK\t/home/lvuser/logs/a.wpilog\t10 B\t12 ms\t');
  assert.ok(ioLogLine(entries[1]).endsWith('\tbad zip'), 'one line a line');
  const seqs = (list: IoLogEntry[]) => list.map((e) => e.seq);
  assert.deepEqual(seqs(filterIoLog(entries, { area: 'usb-import', outcomes: ['fail'], text: '' })), [2]);
  assert.deepEqual(seqs(filterIoLog(entries, { area: null, outcomes: ['fail', 'skip'], text: '' })), [2, 3]);
  assert.deepEqual(seqs(filterIoLog(entries, { area: null, outcomes: null, text: 'ALREADY' })), [3]);
  assert.deepEqual(seqs(filterIoLog(entries, { area: null, outcomes: null, text: 'a.wpilog' })), [1]);
}

// --- Why a USB import's files didn't come in ---
{
  const file = (from: string, outcome: 'copied' | 'already-here' | 'conflict' | 'error', message = '') =>
    ({ name: from, from, localPath: null, team: 973, teamFrom: 'path' as const, outcome, message });
  const failures = usbImportFailures({
    startedAt: '', finishedAt: '',
    files: [file('a', 'copied'), file('b', 'error', 'unexpected end of file'), file('c', 'conflict'), file('d', 'already-here')],
    problems: ['E:\\x.zip: damaged']
  });
  assert.deepEqual(failures, [
    { path: 'b', message: 'unexpected end of file' },
    { path: 'c', message: 'A different file by this name is already here.' },
    { path: '', message: 'E:\\x.zip: damaged' }
  ]);
}

console.log('turbo: ok');
