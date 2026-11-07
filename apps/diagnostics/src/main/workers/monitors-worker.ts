// The post-match monitors, off the main process: run over a whole match
// they take most of a second, and the main process answers the window, so
// it would hang meanwhile. Given the data log's path and the gates, this
// reads and parses the log itself and sends back the results (plain data).

import { promises as fs } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

import { runMonitors, type Gates, type MonitorResult } from '@shared/monitors';
import { matchKey } from '@shared/signal-match';
import { LogSignalSource } from '../signals/log-source';

export interface MonitorsJob {
  path: string;
  gates: Gates;
}

export type MonitorsReply = { results: MonitorResult[] } | { error: string };

export function monitorsOf(source: LogSignalSource, gates: Gates): MonitorResult[] {
  const available = source.catalog().filter((s) => s.kind === 'number').map((s) => s.key);
  const lookup = (wanted: string) => {
    const key = matchKey(wanted, available).key;
    const series = key ? source.read(key) : null;
    return key && series && series.values instanceof Float64Array ? { key, series: { times: series.times, values: series.values } } : null;
  };
  return runMonitors(lookup, gates, available);
}

async function run(job: MonitorsJob): Promise<MonitorsReply> {
  try {
    const bytes = await fs.readFile(job.path);
    const source = new LogSignalSource(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { results: monitorsOf(source, job.gates) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

if (parentPort && workerData) {
  const port = parentPort;
  void run(workerData as MonitorsJob).then((reply) => port.postMessage(reply));
}
