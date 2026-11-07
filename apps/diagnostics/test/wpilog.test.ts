// Parsing a data log in turns (so the main process keeps answering the
// window) gives just what parsing it at once does.

import assert from 'node:assert/strict';

import { LogSignalSource } from '@main/signals/log-source';
import { parseLog, parseLogInTurns } from '@main/signals/wpilog';
import { doubles, LogWriter } from './wpilog-writer';

// Enough records for several turns (20,000 a turn), on two entries.
const log = new LogWriter();
const a = log.start('/Robot/a', 'double');
const b = log.start('/Robot/b', 'double');
for (let i = 0; i < 50_000; i++) {
  log.append(a, i * 0.01, doubles(i));
  if (i % 2) log.append(b, i * 0.01, doubles(-i));
}
const bytes = log.bytes();

async function main() {
  // A turn as short as can be: a break after every 20,000 records.
  const inTurns = await parseLogInTurns(bytes, 0);
  assert.deepEqual(inTurns, parseLog(bytes));
  assert.equal(inTurns.records[0].length, 50_000);
  assert.equal(inTurns.records[1].length, 25_000);

  // Others got their turns meanwhile.
  let others = 0;
  const ticking = setInterval(() => others++, 0);
  await parseLogInTurns(bytes, 0);
  clearInterval(ticking);
  assert.ok(others > 0, 'nothing else ran while it parsed');

  const source = await LogSignalSource.open(bytes);
  assert.deepEqual(Array.from(source.read('/Robot/b')!.values as Float64Array).slice(0, 3), [-1, -3, -5]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
