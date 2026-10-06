// CSV for the event data export. One row per record, one column per field.

export type CsvRow = Record<string, unknown>;

// Local bookkeeping that means nothing outside the device.
const hidden = new Set(['_dirty']);
// Sync bookkeeping goes last, after the fields people care about.
const trailing = ['updated_by_name', 'updated_at', 'synced_at', 'deleted'];

// Every field that appears in any row: `id` first, then in the order the
// fields are first seen, then the bookkeeping.
export function csvColumns(rows: CsvRow[]): string[] {
    const seen = new Set<string>();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!hidden.has(key)) seen.add(key);
        }
    }
    const rank = (key: string) => (key === 'id' ? -1 : trailing.includes(key) ? 1 + trailing.indexOf(key) : 0);
    return [...seen].sort((a, b) => rank(a) - rank(b));
}

function cell(value: unknown): string {
    if (value === null || value === undefined) return '';
    // Nested values (a match's teams, a checklist snapshot) are kept whole.
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// `columns` defaults to every field in the rows. Starts with a byte order
// mark so spreadsheet apps read it as UTF-8.
export function toCsv(rows: CsvRow[], columns: string[] = csvColumns(rows)): string {
    const lines = [columns.map(cell).join(',')];
    for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(','));
    return `﻿${lines.join('\r\n')}\r\n`;
}
