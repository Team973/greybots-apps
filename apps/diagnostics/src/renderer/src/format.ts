import type { SignalLogFile } from '@shared/ipc';

// Shared with the main process.
export { formatBytes } from '@shared/bytes';

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
