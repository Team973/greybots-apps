// Turbo download, on the robot (shared/turbo.ts says what and why): reading
// whether it's enabled or on a field, and pausing and resuming its program
// over the download's own SSH connection.

import {
  controlWord,
  controlWordTopic,
  findRobotProgramScript,
  parsePids,
  parseRobotPrograms,
  signalCommand,
  stoppedCheckScript,
  type RobotControl,
  type RobotProcess
} from '@shared/turbo';
import { Nt4Client } from '../live/nt4-client';
import { SftpReader } from './readers';

// The robot's control word from NetworkTables, or null if it doesn't come
// in time (no robot code, or NetworkTables not answering).
export function readRobotControl(host: string, timeoutMs = 4000): Promise<RobotControl | null> {
  return new Promise((resolve) => {
    let done = false;
    let client: Nt4Client | null = null;
    const finish = (control: RobotControl | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client?.close("Read the robot's state.");
      resolve(control);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    client = new Nt4Client(host, {
      connected: () => {},
      announce: () => {},
      unannounce: () => {},
      value: (topic, _time, value) => {
        if (topic.name === controlWordTopic && typeof value === 'number') finish(controlWord(value));
      },
      closed: () => finish(null)
    });
  });
}

// The robot program's processes, found and stopped. Throws if there's none
// or they didn't stop (and lets any that did go again).
export async function pauseRobotCode(reader: SftpReader): Promise<RobotProcess[]> {
  const programs = parseRobotPrograms((await reader.exec(findRobotProgramScript)).stdout);
  if (programs.length === 0) throw new Error('No robot program is running on the robot.');
  const pids = programs.map((p) => p.pid);
  const stopped = await reader.exec(signalCommand('STOP', pids));
  const nowStopped = new Set(parsePids((await reader.exec(stoppedCheckScript(pids))).stdout));
  if (stopped.code !== 0 || pids.some((pid) => !nowStopped.has(pid))) {
    await reader.exec(`${signalCommand('CONT', pids)} 2>/dev/null; true`).catch(() => {});
    throw new Error(`Couldn't pause it: ${stopped.stderr.trim() || 'it kept running'}`);
  }
  return programs;
}

// Lets them go again: over the download's connection if it's still up,
// otherwise a new one (a robot that rebooted meanwhile is going already,
// and a pid that's gone is no matter). Throws if any is still stopped.
export async function resumeRobotCode(reader: SftpReader | null, host: string, pids: number[]): Promise<void> {
  let own: SftpReader | null = null;
  try {
    const via = reader?.connected ? reader : (own = await SftpReader.connect(host));
    await via.exec(`${signalCommand('CONT', pids)} 2>/dev/null; true`);
    const still = parsePids((await via.exec(stoppedCheckScript(pids))).stdout);
    if (still.length) throw new Error(`still paused: ${still.join(', ')}`);
  } finally {
    own?.close();
  }
}
