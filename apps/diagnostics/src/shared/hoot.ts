// CTRE Hoot logs: what the window is told about them, and what their names
// say. Read by converting with CTRE's owlet tool (see docs/design.md).
// Nothing here may touch Node or the DOM.

// CTRE's licence, which a person accepts before owlet is downloaded.
export const ctreLicenseUrl = 'https://raw.githubusercontent.com/CrossTheRoadElec/Phoenix-Releases/refs/heads/master/CTRE_LICENSE.txt';

export interface OwletVersion {
  // Which Hoot logs it reads: a Hoot log says which compliancy wrote it.
  compliancy: number;
  version: string;
}

export interface OwletStatus {
  licenseAccepted: boolean;
  // The owlet builds on this computer.
  installed: OwletVersion[];
  downloading: boolean;
  // When it last checked CTRE for owlet (ISO), and what went wrong, if anything.
  checkedAt: string | null;
  error: string;
}

// The CAN bus a Hoot log is from, from its name: `rio`, or a CANivore's
// name or id (17E61D98...).
export function hootBus(fileName: string): string {
  const base = fileName.replace(/\.hoot$/i, '');
  // <event>_<Q42>_<bus>_<date>_<time>, or <bus>_<date>_<time> outside a match.
  const found = /(?:^|_)([^_]+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.exec(base);
  return found ? found[1] : base;
}

// For people: `rio`, or `CANivore 17E61D98` for a long id.
export function hootBusLabel(bus: string): string {
  if (bus.toLowerCase() === 'rio') return 'rio';
  return /^[0-9A-F]{16,}$/i.test(bus) ? `CANivore ${bus.slice(0, 8)}` : bus;
}

// When the Hoot log started, from its name (UTC, to the second), or null.
export function hootStartTime(fileName: string): Date | null {
  const found = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.hoot$/i.exec(fileName);
  if (!found) return null;
  const [year, month, day, hour, minute, second] = found.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

// How a Hoot log's times were put on the session's timeline.
export type HootAlignment =
  // The robot's first enable, in both logs.
  | 'enable'
  // The start times in the file names, to the second.
  | 'name'
  // The Hoot log is the session's own timeline.
  | 'base';

export type HootState =
  // Signals listed; ready to plot.
  | 'ready'
  // Not readable until CTRE's licence is accepted in Settings.
  | 'license'
  // No owlet for this log's compliancy yet (download it in Settings).
  | 'owlet'
  // Listing signals and lining the log up.
  | 'opening'
  | 'error';

export interface HootLogStatus {
  localPath: string;
  bus: string;
  label: string;
  size: number;
  state: HootState;
  message: string;
  // Whether the log has a Phoenix Pro device. Without one, owlet only
  // exports some signals. Null until known.
  pro: boolean | null;
  alignment: HootAlignment | null;
  // Seconds added to the Hoot log's times to put them on the session's.
  offset: number | null;
}

export interface HootProgress {
  label: string;
  // What's being extracted, for people.
  signals: number;
  percent: number;
}
