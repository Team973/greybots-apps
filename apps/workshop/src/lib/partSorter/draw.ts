// Draws a snapshot with the parts outlined: the current group filled in its
// color, the rest dimmed, and "?" parts dashed yellow.
import type { SorterResult } from './protocol';

// The C++'s group colors (sorter::groupColor), color-blind safe: Okabe-Ito
// less its yellow, then Tol's muted set. Yellow is "?".
export const GROUP_COLORS = [
  '#E69F00', '#56B4E9', '#009E73', '#0072B2', '#D55E00', '#CC79A7',
  '#88CC99', '#44AA99', '#882255', '#999933', '#117733', '#AA4499'
];
export const UNKNOWN_COLOR = '#F0E442';

export const groupColor = (index: number) => GROUP_COLORS[((index % GROUP_COLORS.length) + GROUP_COLORS.length) % GROUP_COLORS.length];

function trace(ctx: CanvasRenderingContext2D, outline: number[]) {
  ctx.beginPath();
  ctx.moveTo(outline[0], outline[1]);
  for (let k = 2; k < outline.length; k += 2) ctx.lineTo(outline[k], outline[k + 1]);
  ctx.closePath();
}

// `current`: the group being sorted, or -1 to show every group in its color.
export function drawResult(canvas: HTMLCanvasElement, photo: ImageBitmap, result: SorterResult, current: number) {
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(photo, 0, 0, result.width, result.height);
  // Dim the photo so the colors stand out.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(0, 0, result.width, result.height);

  const line = Math.max(2, result.width / 500);
  ctx.lineJoin = 'round';
  for (const part of result.parts) {
    if (part.outline.length < 6) continue;
    trace(ctx, part.outline);
    if (part.group < 0) {
      ctx.setLineDash([line * 2.5, line * 2]);
      ctx.strokeStyle = UNKNOWN_COLOR;
      ctx.lineWidth = line;
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (current < 0 || part.group === current) {
      const color = groupColor(part.group);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = line;
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(220, 220, 220, 0.7)';
      ctx.lineWidth = Math.max(1, line / 2);
      ctx.stroke();
    }
  }
}
