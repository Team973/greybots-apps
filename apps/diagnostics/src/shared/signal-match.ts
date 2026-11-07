// Finding a view's or template's signals in a log that names them a little
// differently (#148). Robot code run in simulation logs under
// `/Robot/robot/...` what the robot logs under `/Robot/...`. In order:
//
//   1. The same name.
//   2. The same end of the path: the most trailing parts in common, if no
//      other signal has as many (two at least, unless the name is one part).
//
// Nothing here may touch Node or the DOM.

export type MatchHow = 'exact' | 'suffix';

export interface KeyMatch {
  // The log's signal, or null when it hasn't one.
  key: string | null;
  how: MatchHow | null;
  // When the end of the path fits more than one equally well.
  ambiguous: string[];
}

const parts = (key: string) => key.split(/[/:]/).filter(Boolean);

// How many trailing parts two names share (case aside).
export function sharedTail(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  let n = 0;
  while (n < x.length && n < y.length && x[x.length - 1 - n].toLowerCase() === y[y.length - 1 - n].toLowerCase()) n++;
  return n;
}

export function matchKey(wanted: string, available: readonly string[]): KeyMatch {
  if (available.includes(wanted)) return { key: wanted, how: 'exact', ambiguous: [] };

  const need = Math.min(2, parts(wanted).length);
  let best = 0;
  let found: string[] = [];
  for (const key of available) {
    const n = sharedTail(wanted, key);
    if (n < need || n < best) continue;
    if (n > best) {
      best = n;
      found = [key];
    } else {
      found.push(key);
    }
  }
  if (found.length === 1) return { key: found[0], how: 'suffix', ambiguous: [] };
  return { key: null, how: null, ambiguous: found };
}

// Every wanted name, matched.
export function matchKeys(wanted: readonly string[], available: readonly string[]): Map<string, KeyMatch> {
  return new Map(wanted.map((key) => [key, matchKey(key, available)]));
}

// For a search box over views and templates: whether a name or any of
// its signals has the words searched for. A signal matches by any of its
// parts, so "BatteryVoltage" finds a view whether it was saved from the
// robot (`/Robot/SystemStats/BatteryVoltage`) or a simulation.
export function searchMatches(query: string, name: string, keys: readonly string[]): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [name, ...keys.flatMap((key) => parts(key))].join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
