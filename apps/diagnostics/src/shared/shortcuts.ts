// Keyboard shortcuts that work from anywhere in the app, set on the Settings
// page. Written as people read them: 'Ctrl+Shift+K'. '' turns one off.
//
// Nothing here may touch Node or the DOM.

export type ShortcutAction = 'liveRobot' | 'liveSim';

export type Shortcuts = Record<ShortcutAction, string>;

export const shortcutActions: { id: ShortcutAction; label: string; default: string }[] = [
  { id: 'liveRobot', label: "Show the robot's live signals", default: 'Ctrl+K' },
  { id: 'liveSim', label: "Show a simulator's live signals", default: 'Ctrl+Shift+K' }
];

export const defaultShortcuts = Object.fromEntries(shortcutActions.map((a) => [a.id, a.default])) as Shortcuts;

// The parts of a KeyboardEvent a shortcut is made of.
export interface KeyPress {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const modifierCodes = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

// The key's name by where it is on the keyboard (`code`), so a shortcut
// is the same key whatever the keyboard layout.
function keyName(code: string): string | null {
  let found: RegExpExecArray | null;
  if ((found = /^Key([A-Z])$/.exec(code))) return found[1];
  if ((found = /^Digit(\d)$/.exec(code))) return found[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if ((found = /^Arrow(Up|Down|Left|Right)$/.exec(code))) return found[1];
  return /^[A-Za-z]+$/.test(code) ? code : null;
}

// The shortcut a key press makes, or null if it can't be one: a modifier
// alone, or no Ctrl, Alt or Cmd (a plain key is for typing).
export function shortcutFromPress(press: KeyPress): string | null {
  if (modifierCodes.test(press.code)) return null;
  if (!press.ctrlKey && !press.altKey && !press.metaKey) return null;
  const key = keyName(press.code);
  if (!key) return null;
  const parts: string[] = [];
  if (press.ctrlKey) parts.push('Ctrl');
  if (press.metaKey) parts.push('Cmd');
  if (press.altKey) parts.push('Alt');
  if (press.shiftKey) parts.push('Shift');
  return [...parts, key].join('+');
}

const shortcutPattern = /^((Ctrl|Cmd|Alt|Shift)\+)+[A-Za-z0-9]+$/;

export function normalizeShortcuts(raw: unknown): Shortcuts {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...defaultShortcuts };
  for (const action of shortcutActions) {
    const value = input[action.id];
    if (typeof value === 'string' && (value === '' || shortcutPattern.test(value))) out[action.id] = value;
  }
  return out;
}

// What's wrong with a set of shortcuts, or ''.
export function shortcutErrors(shortcuts: Shortcuts): string {
  const seen = new Map<string, string>();
  for (const action of shortcutActions) {
    const shortcut = shortcuts[action.id];
    if (!shortcut) continue;
    const other = seen.get(shortcut);
    if (other) return `${shortcut} is set for both "${other}" and "${action.label}".`;
    seen.set(shortcut, action.label);
  }
  return '';
}
