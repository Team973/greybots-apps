// The chart as a PNG, drawn off screen: a caption, the chart's own SVG, its
// pinned readout, and a legend. Nothing on the page moves or flashes while
// it's made.

export interface ChartSnapshot {
  svg: SVGSVGElement;
  // A pinned moment's readout, where it sits over the chart (CSS pixels from
  // the chart's top left).
  pinned: { title: string; left: number; bottom: number; rows: ReadoutRow[] } | null;
}

export interface ReadoutRow {
  color: string;
  label: string;
  value: string;
}

export interface LegendItem {
  color: string;
  label: string;
  // Its band or axis, when that's worth saying.
  note: string;
  value: string;
}

// Pixels to a CSS pixel in the picture: sharp on a high-density screen,
// where it'll likely be looked at.
const scale = 2;

// The styles the chart's parts get from the page's style sheets, which an
// SVG drawn on its own doesn't have: copied onto each part.
const styleProperties = [
  'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'dominant-baseline', 'text-anchor', 'visibility'
];

function standaloneSvg(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  originals.forEach((original, i) => {
    const style = getComputedStyle(original);
    const target = copies[i] as SVGElement;
    target.setAttribute('style', styleProperties.map((p) => `${p}:${style.getPropertyValue(p)}`).join(';'));
  });
  // The pointer's crosshair and a drag's selection aren't part of the picture.
  copy.querySelectorAll('.hover, .selection').forEach((element) => element.remove());
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Drawn at the picture's scale, so it's as sharp as the rest.
  copy.setAttribute('viewBox', `0 0 ${svg.clientWidth} ${svg.clientHeight}`);
  copy.setAttribute('width', String(svg.clientWidth * scale));
  copy.setAttribute('height', String(svg.clientHeight * scale));
  return new XMLSerializer().serializeToString(copy);
}

function loadImage(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't draw the chart."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
}

// Shortened with … to fit.
function fit(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 0 && context.measureText(`${text.slice(0, end)}…`).width > width) end -= 1;
  return `${text.slice(0, end)}…`;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

export interface ImageOptions {
  caption: string;
  legend: LegendItem[];
  // The card's colours, so the picture matches the theme.
  background: string;
  text: string;
  fontFamily: string;
}

const padding = 16;

export async function chartPng(snapshot: ChartSnapshot, options: ImageOptions): Promise<Uint8Array> {
  const chart = await loadImage(standaloneSvg(snapshot.svg));
  const chartWidth = snapshot.svg.clientWidth;
  const chartHeight = snapshot.svg.clientHeight;
  const width = chartWidth + padding * 2;
  const font = (size: number, weight = 400) => `${weight} ${size}px ${options.fontFamily}`;

  // The legend's items flow into rows, like words.
  const measure = document.createElement('canvas').getContext('2d')!;
  const legendRows: { item: LegendItem; x: number; width: number }[][] = [[]];
  let x = 0;
  for (const item of options.legend) {
    measure.font = font(13);
    let itemWidth = 16 + measure.measureText(item.label).width;
    if (item.note) itemWidth += 6 + measure.measureText(item.note).width;
    measure.font = font(13, 600);
    if (item.value) itemWidth += 8 + measure.measureText(item.value).width;
    itemWidth = Math.min(itemWidth, width - padding * 2);
    if (x > 0 && x + itemWidth > width - padding * 2) {
      legendRows.push([]);
      x = 0;
    }
    legendRows[legendRows.length - 1].push({ item, x, width: itemWidth });
    x += itemWidth + 20;
  }
  const captionHeight = 26;
  const legendLine = 22;
  const legendHeight = options.legend.length ? legendRows.length * legendLine + 8 : 0;
  const height = padding + captionHeight + chartHeight + legendHeight + padding;

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

  const chartTop = padding + captionHeight;
  context.drawImage(chart, padding, chartTop, chartWidth, chartHeight);

  // The pinned readout, where it is on screen.
  if (snapshot.pinned) {
    const { pinned } = snapshot;
    const boxWidth = 260;
    const rowHeight = 20;
    const boxHeight = 12 + 20 + pinned.rows.length * rowHeight;
    const boxX = padding + pinned.left;
    const boxY = chartTop + chartHeight - pinned.bottom - boxHeight;
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.3)';
    context.shadowBlur = 10;
    context.shadowOffsetY = 2;
    context.fillStyle = options.background;
    roundedRect(context, boxX, boxY, boxWidth, boxHeight, 6);
    context.fill();
    context.restore();
    context.strokeStyle = 'rgba(127, 127, 127, 0.5)';
    roundedRect(context, boxX, boxY, boxWidth, boxHeight, 6);
    context.stroke();
    context.fillStyle = options.text;
    context.font = font(12, 600);
    context.globalAlpha = 0.85;
    context.fillText(pinned.title, boxX + 8, boxY + 16);
    context.globalAlpha = 1;
    pinned.rows.forEach((row, i) => {
      const y = boxY + 16 + 20 + i * rowHeight;
      context.fillStyle = row.color;
      context.fillRect(boxX + 8, y - 5, 10, 10);
      context.font = font(12, 600);
      const valueWidth = context.measureText(row.value).width;
      context.fillStyle = options.text;
      context.textAlign = 'right';
      context.fillText(row.value, boxX + boxWidth - 8, y);
      context.textAlign = 'left';
      context.font = font(12);
      context.fillText(fit(context, row.label, boxWidth - 40 - valueWidth), boxX + 24, y);
    });
  }

  // The legend.
  legendRows.forEach((row, line) => {
    const y = chartTop + chartHeight + 8 + line * legendLine + legendLine / 2;
    for (const { item, x: left, width: itemWidth } of row) {
      let at = padding + left;
      context.fillStyle = item.color;
      context.fillRect(at, y - 5, 10, 10);
      at += 16;
      context.font = font(13);
      context.fillStyle = options.text;
      const label = fit(context, item.label, itemWidth - 16);
      context.fillText(label, at, y);
      at += context.measureText(label).width;
      if (item.note) {
        context.globalAlpha = 0.65;
        context.fillText(item.note, at + 6, y);
        at += 6 + context.measureText(item.note).width;
        context.globalAlpha = 1;
      }
      if (item.value) {
        context.font = font(13, 600);
        context.fillText(item.value, at + 8, y);
      }
    }
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error("Couldn't make the image.");
  return new Uint8Array(await blob.arrayBuffer());
}
