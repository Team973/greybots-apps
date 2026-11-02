// Finding a view's or template's signals in a log that names them a little
// differently (#148). Robot code run in simulation logs under
// `/Robot/robot/...` what the robot logs under `/Robot/...`, and another
// robot's code may put the same thing somewhere else entirely. In order:
//
//   1. A mapping for that robot says which signal it is (or that it has none).
//   2. The same name.
//   3. The same end of the path: the most trailing parts in common, if no
//      other signal has as many (two at least, unless the name is one part).
//
// Nothing here may touch Node or the DOM.

export type MatchHow = 'mapped' | 'exact' | 'suffix';

export interface KeyMatch {
  // The log's signal, or null when it hasn't one.
  key: string | null;
  how: MatchHow | null;
  // Mapped to nothing on purpose: flagged as missing for this robot.
  flagged: boolean;
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

export function matchKey(wanted: string, available: readonly string[], mapping?: Record<string, string | null>): KeyMatch {
  if (mapping && Object.prototype.hasOwnProperty.call(mapping, wanted)) {
    const mapped = mapping[wanted];
    if (mapped === null) return { key: null, how: null, flagged: true, ambiguous: [] };
    if (available.includes(mapped)) return { key: mapped, how: 'mapped', flagged: false, ambiguous: [] };
  }
  if (available.includes(wanted)) return { key: wanted, how: 'exact', flagged: false, ambiguous: [] };

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
  if (found.length === 1) return { key: found[0], how: 'suffix', flagged: false, ambiguous: [] };
  return { key: null, how: null, flagged: false, ambiguous: found };
}

// Every wanted name, matched.
export function matchKeys(wanted: readonly string[], available: readonly string[], mapping?: Record<string, string | null>): Map<string, KeyMatch> {
  return new Map(wanted.map((key) => [key, matchKey(key, available, mapping)]));
}

// Words in a name, for telling how alike two are: split at slashes,
// spaces, underscores and case changes, lowercased.
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

// The likeliest of a log's signals for a wanted one, best first, for
// someone choosing a mapping: the end of the path counts most, then words
// in common (the last part's most), then the same unit.
export function suggestKeys(
  wanted: string,
  available: readonly { key: string; unit?: string }[],
  options: { unit?: string; limit?: number } = {}
): { key: string; score: number }[] {
  const wantedWords = words(wanted);
  const wantedLast = words(parts(wanted).pop() ?? wanted);
  const scored = available.map(({ key, unit }) => {
    const tail = sharedTail(wanted, key);
    const keyWords = new Set(words(key));
    const lastWords = new Set(words(parts(key).pop() ?? key));
    const common = wantedWords.filter((w) => keyWords.has(w)).length / Math.max(1, wantedWords.length);
    const lastCommon = wantedLast.filter((w) => lastWords.has(w)).length / Math.max(1, wantedLast.length);
    const sameUnit = options.unit && unit && options.unit === unit ? 1 : 0;
    return { key, score: tail * 10 + lastCommon * 6 + common * 3 + sameUnit * 2 };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, options.limit ?? 8);
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
