// The roboRIO's console: what the robot code prints, and the errors and
// warnings it reports, as the Driver Station and WPILib's RioLog get them
// (TCP port 1741). A data log has the same text as its `console` entry;
// live, it's added to the session under that name (live-service.ts).
//
// Each frame is a 2-byte big-endian length, then a tag and its body:
// 12 is a print (float32 timestamp, uint16 sequence number, the text), 11
// an error or warning (timestamp, sequence, uint16 occurrences, int32 code,
// uint8 flags, then three uint16-length strings: details, location, call
// stack). A zero length is a keepalive. From vscode-wpilib's riolog.

import { Socket } from 'node:net';

export const netConsolePort = 1741;

const retryMs = 2000;
const connectTimeoutMs = 2000;

export interface ConsoleLine {
  text: string;
  // An error or a warning, not a print.
  problem: 'error' | 'warning' | null;
}

// Frames out of the bytes as they come; what's left over waits for more.
export class FrameReader {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): ConsoleLine[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const lines: ConsoleLine[] = [];
    let at = 0;
    while (at + 2 <= this.pending.length) {
      const length = this.pending.readUInt16BE(at);
      if (at + 2 + length > this.pending.length) break;
      const frame = this.pending.subarray(at + 2, at + 2 + length);
      at += 2 + length;
      const line = length === 0 ? null : parseFrame(frame);
      if (line) lines.push(line);
    }
    this.pending = this.pending.subarray(at);
    return lines;
  }
}

function sized(frame: Buffer, at: number): { text: string; next: number } {
  if (at + 2 > frame.length) return { text: '', next: frame.length };
  const size = frame.readUInt16BE(at);
  const end = Math.min(frame.length, at + 2 + size);
  return { text: frame.toString('utf8', at + 2, end), next: end };
}

export function parseFrame(frame: Buffer): ConsoleLine | null {
  const tag = frame[0];
  const body = frame.subarray(1);
  if (tag === 12) {
    // Timestamp (4) and sequence number (2), then the text.
    if (body.length < 6) return null;
    return { text: body.toString('utf8', 6).replace(/\r?\n$/, ''), problem: null };
  }
  if (tag === 11) {
    if (body.length < 13) return null;
    const code = body.readInt32BE(8);
    const flags = body[12];
    const details = sized(body, 13);
    const location = sized(body, details.next);
    const problem = (flags & 1) !== 0 ? 'error' : 'warning';
    const where = location.text ? ` (${location.text})` : '';
    return { text: `${problem === 'error' ? 'ERROR' : 'Warning'} ${code}: ${details.text}${where}`, problem };
  }
  return null;
}

// Stays connected to one roboRIO until closed, trying again when it can't.
export class NetConsole {
  private socket: Socket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(readonly host: string, private onLine: (line: ConsoleLine) => void, private port = netConsolePort) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const reader = new FrameReader();
    const socket = new Socket();
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 500);
    socket.setTimeout(connectTimeoutMs);
    socket.once('connect', () => socket.setTimeout(0));
    socket.on('timeout', () => socket.destroy());
    socket.on('data', (chunk) => {
      for (const line of reader.push(chunk)) this.onLine(line);
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      if (!this.closed) this.retry = setTimeout(() => this.connect(), retryMs);
    });
    socket.connect(this.port, this.host);
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.socket?.destroy();
    this.socket = null;
  }
}
