// Reports as files outside the app: exported (a PDF of each, and each
// report's own JSON, as the data folder keeps it) and imported back.
// Nothing here may touch Node or the DOM.

import type { Report } from './library';
import { describeMatch } from './offload';

export interface ReportExport {
  // The folder made for them.
  folder: string;
  count: number;
  errors: string[];
}

export interface ReportImport {
  imported: number;
  // Already in the data folder (the same report).
  already: number;
  // Files that aren't reports, or couldn't be read.
  invalid: string[];
}

// A file name for a report's PDF: "mttd Q12 - Match Review.pdf". Names
// that would be the same get " (2)", " (3)"...
export function reportFileNames(reports: Pick<Report, 'id' | 'name' | 'logLabel' | 'match' | 'template'>[], extension = 'pdf'): Map<string, string> {
  const safe = (text: string) => text.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  const used = new Map<string, number>();
  const names = new Map<string, string>();
  for (const report of reports) {
    const log = report.match ? describeMatch(report.match) : report.logLabel;
    const base = safe(`${log} - ${report.template?.name || report.name}`) || 'Report';
    const count = (used.get(base.toLowerCase()) ?? 0) + 1;
    used.set(base.toLowerCase(), count);
    names.set(report.id, `${count > 1 ? `${base} (${count})` : base}.${extension}`);
  }
  return names;
}

// Whether something read from a file is a report the app can keep and show.
// Checked before an imported report goes in the data folder.
export function isReport(raw: unknown): raw is Report {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  const template = r.template as Record<string, unknown> | null;
  return typeof r.id === 'string' && /^[0-9a-f-]{8,64}$/i.test(r.id)
    && typeof r.name === 'string'
    && typeof r.generated === 'string' && !Number.isNaN(Date.parse(r.generated))
    && typeof r.by === 'string'
    && typeof r.templateId === 'string'
    && typeof r.logId === 'string'
    && typeof r.logLabel === 'string'
    && typeof r.robot === 'string'
    && !!template && typeof template === 'object' && typeof template.name === 'string' && Array.isArray(template.sections)
    && Array.isArray(r.spans) && Array.isArray(r.phases) && Array.isArray(r.sections) && Array.isArray(r.missing);
}
