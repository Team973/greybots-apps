// The event list as a PNG, drawn off screen like the chart (chart-image.ts):
// a caption, then every event listed (not just those scrolled into view),
// each with its mark, time, title and details, wrapped to fit.

import { canvasPng, fit, scale } from './chart-image';

export interface EventRow {
  color: string;
  time: string;
  title: string;
  // Shown quieter after the title: its detail, how long it lasted.
  notes: string[];
}

export interface EventsImageOptions {
  caption: string;
  // Under the caption: the counts, and which kinds are shown.
  subtitle: string;
  rows: EventRow[];
  background: string;
  text: string;
  fontFamily: string;
}

const width = 900;
const padding = 16;
const timeWidth = 160;
const lineHeight = 18;
// Past this many the picture's too long to be read; the rest are counted.
const maxRows = 200;

// Lines of at most `room` pixels, broken between words (or inside a word
// too long for a line).
function wrap(context: CanvasRenderingContext2D, text: string, room: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width <= room) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (context.measureText(line).width > room) {
        let end = line.length - 1;
        while (end > 1 && context.measureText(line.slice(0, end)).width > room) end -= 1;
        lines.push(line.slice(0, end));
        line = line.slice(end);
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function eventsPng(options: EventsImageOptions): Promise<Uint8Array> {
  const font = (size: number, weight = 400) => `${weight} ${size}px ${options.fontFamily}`;
  const textX = padding + 18 + timeWidth;
  const room = width - padding - textX;

  // Each row's lines first, to know the picture's height.
  const measure = document.createElement('canvas').getContext('2d')!;
  const shown = options.rows.slice(0, maxRows);
  // The details go beside the title, as in the list, when they fit there.
  const laid = shown.map((row) => {
    measure.font = font(13);
    const title = wrap(measure, row.title, room);
    const titleEnd = measure.measureText(title[title.length - 1]).width;
    measure.font = font(12);
    const text = row.notes.filter(Boolean).join('  ·  ');
    const beside = !!text && !text.includes('\n') && titleEnd + 10 + measure.measureText(text).width <= room;
    const notes = !text || beside ? [] : wrap(measure, text.replace(/ {2}· {2}/g, '\n'), room);
    return { row, title, beside: beside ? { text, x: titleEnd + 10 } : null, notes, height: (title.length + notes.length) * lineHeight + 10 };
  });
  const more = options.rows.length - shown.length;
  const headHeight = 26 + 22 + 8;
  const listHeight = laid.reduce((sum, r) => sum + r.height, 0) + (more > 0 || laid.length === 0 ? 28 : 0);
  const height = padding + headHeight + listHeight + padding;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext('2d')!;
  context.scale(scale, scale);
  context.fillStyle = options.background;
  context.fillRect(0, 0, width, height);
  context.textBaseline = 'middle';

  context.fillStyle = options.text;
  context.font = font(15, 600);
  context.fillText(fit(context, options.caption, width - padding * 2), padding, padding + 10);
  context.font = font(12);
  context.globalAlpha = 0.7;
  context.fillText(fit(context, options.subtitle, width - padding * 2), padding, padding + 26 + 8);
  context.globalAlpha = 1;

  let y = padding + headHeight;
  const rule = (at: number) => {
    context.fillStyle = 'rgba(127, 127, 127, 0.25)';
    context.fillRect(padding, at, width - padding * 2, 1);
  };
  rule(y);
  for (const { row, title, beside, notes, height: rowHeight } of laid) {
    const first = y + 5 + lineHeight / 2;
    context.fillStyle = row.color;
    context.beginPath();
    context.roundRect(padding + 2, first - 5, 10, 10, 2);
    context.fill();
    context.fillStyle = options.text;
    context.font = font(12);
    context.globalAlpha = 0.8;
    context.fillText(fit(context, row.time, timeWidth - 8), padding + 18, first);
    context.globalAlpha = 1;
    context.font = font(13);
    title.forEach((line, i) => context.fillText(line, textX, first + i * lineHeight));
    context.font = font(12);
    context.globalAlpha = 0.7;
    if (beside) context.fillText(beside.text, textX + beside.x, first + (title.length - 1) * lineHeight);
    notes.forEach((line, i) => context.fillText(line, textX, first + (title.length + i) * lineHeight));
    context.globalAlpha = 1;
    y += rowHeight;
    rule(y);
  }
  if (more > 0 || laid.length === 0) {
    context.fillStyle = options.text;
    context.font = font(12);
    context.globalAlpha = 0.7;
    context.fillText(laid.length === 0 ? 'No events of the kinds shown.' : `And ${more} more.`, padding, y + 14);
    context.globalAlpha = 1;
  }

  return canvasPng(canvas);
}
