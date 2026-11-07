// The Reports page's cards: one per log, with that log's reports and the
// errors and warnings they found, and the filters over them.

import type { SignalLogFile } from './ipc';
import type { ReportProblem, ReportSummary } from './library';
import { describeMatch, type MatchInfo } from './offload';
import { searchMatches } from './signal-match';

export interface LogCard {
  // The log's id (also what its reports name).
  id: string;
  // Null when the log isn't in the data folder any more: its reports stay.
  log: SignalLogFile | null;
  title: string;
  robot: string;
  // When the log was recorded, or for a log that's gone, its newest report.
  recorded: string;
  match: MatchInfo | null;
  // Newest first.
  reports: ReportSummary[];
  // Each problem once, however many of its reports found it.
  errors: ReportProblem[];
  warnings: ReportProblem[];
  // The most signals any one of its reports was missing.
  missing: number;
}

export interface CardFilter {
  query: string;
  // An FMS event code (MTTD), or null for all.
  event: string | null;
  // Only matches FMS named (practice, qualification, playoff).
  realMatches: boolean;
  // Only logs with at least one report.
  analyzedOnly: boolean;
}

export const defaultCardFilter: CardFilter = { query: '', event: null, realMatches: false, analyzedOnly: true };

// One card per log, newest first (the logs' order), then cards for logs
// that are gone but still have reports.
export function logCards(logs: SignalLogFile[], reports: ReportSummary[]): LogCard[] {
  const byLog = new Map<string, ReportSummary[]>();
  for (const report of [...reports].sort((a, b) => b.generated.localeCompare(a.generated))) {
    byLog.set(report.logId, [...(byLog.get(report.logId) ?? []), report]);
  }

  const card = (id: string, log: SignalLogFile | null, own: ReportSummary[]): LogCard => {
    const problems = new Map<string, ReportProblem>();
    for (const report of own) for (const problem of report.problems) if (!problems.has(problem.id)) problems.set(problem.id, problem);
    const match = log?.match ?? own.find((r) => r.match)?.match ?? null;
    return {
      id,
      log,
      title: match ? describeMatch(match) : log?.name ?? own[0]?.logLabel ?? id,
      robot: log?.robot ?? own[0]?.robot ?? '',
      recorded: log?.recorded ?? own[0]?.generated ?? '',
      match,
      reports: own,
      errors: [...problems.values()].filter((p) => p.severity === 'error'),
      warnings: [...problems.values()].filter((p) => p.severity === 'warning'),
      missing: Math.max(0, ...own.map((r) => r.missing))
    };
  };

  const cards = logs.map((log) => card(log.id, log, byLog.get(log.id) ?? []));
  const known = new Set(logs.map((log) => log.id));
  const gone = [...byLog.entries()].filter(([id]) => !known.has(id)).map(([id, own]) => card(id, null, own));
  return [...cards, ...gone.sort((a, b) => b.recorded.localeCompare(a.recorded))];
}

export function filterCards(cards: LogCard[], filter: CardFilter): LogCard[] {
  return cards.filter((card) => {
    if (filter.analyzedOnly && card.reports.length === 0) return false;
    if ((filter.realMatches || filter.event) && !card.match) return false;
    if (filter.event && card.match!.event.toUpperCase() !== filter.event.toUpperCase()) return false;
    const text = [card.title, card.robot, card.log?.name ?? '', ...card.reports.map((r) => `${r.name} ${r.by}`)].join(' ');
    return searchMatches(filter.query, text, []);
  });
}
