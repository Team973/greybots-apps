// Runs the unit tests: each test/*.test.ts bundled with esbuild (with the
// app's @shared and @main aliases) and run with Node. A test is plain
// asserts that throw on failure. No Electron: only code that doesn't need
// it is tested here. `npm test` from apps/diagnostics, or
// `npm run test:diagnostics` from the repo root.

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = import.meta.dirname;
const src = resolve(here, '../src');
const only = process.argv[2];
const tests = readdirSync(here).filter((name) => name.endsWith('.test.ts') && (!only || name.includes(only))).sort();
const out = mkdtempSync(join(tmpdir(), 'diagnostics-tests-'));

let failed = 0;
try {
  for (const name of tests) {
    const outfile = join(out, name.replace(/\.ts$/, '.cjs'));
    await build({
      entryPoints: [join(here, name)],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      logLevel: 'warning',
      alias: { '@shared': join(src, 'shared'), '@main': join(src, 'main') }
    });
    const run = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
    if (run.status === 0) {
      console.log(`ok    ${name}`);
    } else {
      failed += 1;
      console.log(`FAIL  ${name}`);
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(`${tests.length - failed} of ${tests.length} passed`);
process.exit(failed ? 1 : 0);
