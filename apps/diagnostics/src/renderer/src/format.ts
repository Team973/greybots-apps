import type { SignalLogFile } from '@shared/ipc';

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

// A time as the person's computer shows dates and times, without seconds.
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// What a log has with it, for lists of logs: ' + 2 Hoot + DS log' when its
// data log has Hoot or Driver Station logs lined up with it, or ', Hoot
// only' when there's no data log.
export function logCompanions(log: SignalLogFile): string {
  if (!log.localPath) return `, ${log.hoots.length ? 'Hoot' : 'DS log'} only`;
  const also = [log.hoots.length ? `${log.hoots.length} Hoot` : '', log.dsLogs.length ? 'DS log' : ''].filter(Boolean);
  return also.length ? ` + ${also.join(' + ')}` : '';
}
