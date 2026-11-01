// A NetworkTables 4 client: connects to the robot (or a simulator), learns
// its topics, and passes on every value change. The protocol:
// https://github.com/wpilibsuite/allwpilib/blob/main/ntcore/doc/networktables4.adoc
//
// Version 4.0 is asked for rather than 4.1, which wants the client to send
// WebSocket pings (which Node's WebSocket can't). A dead connection is
// found by time sync replies stopping instead.

import { packIntegers, unpackAll, type PackValue } from './msgpack';

export interface Nt4Topic {
  id: number;
  name: string;
  // NT4's type string: 'double', 'boolean[]', 'struct:Pose2d', 'structschema', ...
  type: string;
  properties: Record<string, unknown>;
}

export interface Nt4Handlers {
  // Once connected and the server's clock is known: values come after this.
  connected(serverTimeUs: number): void;
  announce(topic: Nt4Topic): void;
  unannounce(name: string): void;
  value(topic: Nt4Topic, timeUs: number, value: PackValue): void;
  closed(reason: string): void;
}

export const nt4Port = 5810;

const protocol = 'networktables.first.wpi.edu';
// Time sync: how often, and how long without a reply means the connection's dead.
const syncEveryMs = 2000;
const deadAfterMs = 6000;
// NT4's type number for an integer, used in time sync messages.
const intType = 2;

const nowUs = () => Math.round(performance.now() * 1000);

// Node's own WebSocket (Node 22 and up; Electron's main process has it).
// The @types/node here is older and doesn't describe it, so this is the
// part used.
interface Socket {
  binaryType: string;
  readyState: number;
  send(data: Uint8Array | string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { reason: string }) => void) | null;
}
const NodeWebSocket = (globalThis as unknown as { WebSocket: new (url: string, protocols: string[]) => Socket }).WebSocket;
const open = 1;

export class Nt4Client {
  private socket: Socket;
  private topics = new Map<number, Nt4Topic>();
  // Server time minus local time, µs; null until the first time sync reply.
  private offset: number | null = null;
  private lastHeard = Date.now();
  private timer: ReturnType<typeof setInterval>;
  private closedAlready = false;

  constructor(readonly host: string, private handlers: Nt4Handlers, port = nt4Port) {
    const name = `greybots-diagnostics-${Math.floor(Math.random() * 1e6)}`;
    this.socket = new NodeWebSocket(`ws://${host.includes(':') ? `[${host}]` : host}:${port}/nt/${name}`, [protocol]);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = () => this.sync();
    this.socket.onmessage = (event) => this.receive(event.data);
    this.socket.onerror = () => this.close(this.offset === null ? "Couldn't connect to NetworkTables." : 'Lost the connection.');
    this.socket.onclose = (event) => this.close(event.reason || 'Lost the connection.');
    this.timer = setInterval(() => {
      if (Date.now() - this.lastHeard > deadAfterMs) this.close('The robot stopped answering.');
      else if (this.socket.readyState === open) this.sync();
    }, syncEveryMs);
  }

  // The server's clock now, in µs, once known.
  serverTime(): number | null {
    return this.offset === null ? null : nowUs() + this.offset;
  }

  close(reason = 'Closed.') {
    if (this.closedAlready) return;
    this.closedAlready = true;
    clearInterval(this.timer);
    this.socket.onclose = this.socket.onerror = this.socket.onmessage = null;
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
    this.handlers.closed(reason);
  }

  private sync() {
    this.socket.send(packIntegers([-1, 0, intType, nowUs()]));
  }

  private receive(data: unknown) {
    this.lastHeard = Date.now();
    if (typeof data === 'string') {
      this.receiveText(data);
      return;
    }
    let messages: PackValue[];
    try {
      messages = unpackAll(new Uint8Array(data as ArrayBuffer));
    } catch {
      return;
    }
    for (const message of messages) {
      if (!Array.isArray(message) || message.length < 4) continue;
      const [id, time, , value] = message as [number, number, number, PackValue];
      if (id === -1) {
        this.synced(time, value as number);
        continue;
      }
      const topic = this.topics.get(id);
      if (topic) this.handlers.value(topic, time, value);
    }
  }

  // The server's answer to a time sync: its time when it got ours.
  private synced(serverUs: number, sentUs: number) {
    const now = nowUs();
    const first = this.offset === null;
    this.offset = serverUs + (now - sentUs) / 2 - now;
    if (!first) return;
    this.handlers.connected(this.serverTime()!);
    // Every topic, and every change to each (not only the latest each
    // period), so nothing between two reads is missed.
    this.socket.send(JSON.stringify([{
      method: 'subscribe',
      params: { topics: [''], subuid: 1, options: { prefix: true, all: true } }
    }]));
  }

  private receiveText(text: string) {
    let messages: unknown;
    try {
      messages = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(messages)) return;
    for (const message of messages as { method?: string; params?: Record<string, unknown> }[]) {
      const params = message.params ?? {};
      if (message.method === 'announce' && typeof params.id === 'number' && typeof params.name === 'string') {
        const topic: Nt4Topic = {
          id: params.id,
          name: params.name,
          type: String(params.type ?? ''),
          properties: (params.properties as Record<string, unknown>) ?? {}
        };
        this.topics.set(topic.id, topic);
        this.handlers.announce(topic);
      } else if (message.method === 'unannounce' && typeof params.id === 'number') {
        const topic = this.topics.get(params.id);
        this.topics.delete(params.id);
        if (topic) this.handlers.unannounce(topic.name);
      } else if (message.method === 'properties' && typeof params.name === 'string') {
        const topic = [...this.topics.values()].find((t) => t.name === params.name);
        if (topic && params.update && typeof params.update === 'object') {
          for (const [key, value] of Object.entries(params.update as Record<string, unknown>)) {
            if (value === null) delete topic.properties[key];
            else topic.properties[key] = value;
          }
        }
      }
    }
  }
}
