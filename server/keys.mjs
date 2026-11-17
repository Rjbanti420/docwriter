// Keyboard shortcuts: one table and one matcher for both processes.
//
// The Electron main process sees keystrokes first and owns the actions that
// belong to the window (zoom, full screen, quit). The renderer owns the ones
// that need page state (search, chapter movement, saving a draft) and matches
// the same bindings, so the two sides cannot drift apart. Settings renders this
// table and writes overrides through the main process into its settings file.
//
// "Mod" is Ctrl on Linux and Windows, Cmd on macOS. Contextual keys (Escape,
// Tab, the arrows inside a list) are deliberately absent: they belong to
// whatever has focus, not to the application.

export const KEY_ACTIONS = [
  { id: 'openBook', label: 'Open book', group: 'Book', default: 'Mod+O' },
  { id: 'newBook', label: 'New book', group: 'Book', default: 'Mod+N' },
  { id: 'quickOpen', label: 'Quick open', group: 'Chapter', default: 'Mod+K' },
  { id: 'prevChapter', label: 'Previous chapter', group: 'Chapter', default: 'Alt+ArrowLeft' },
  { id: 'nextChapter', label: 'Next chapter', group: 'Chapter', default: 'Alt+ArrowRight' },
  { id: 'saveChapter', label: 'Save chapter', group: 'Chapter', default: 'Mod+S' },
  { id: 'zoomIn', label: 'Zoom in', group: 'Window', default: 'Mod+=' },
  { id: 'zoomOut', label: 'Zoom out', group: 'Window', default: 'Mod+-' },
  { id: 'zoomReset', label: 'Actual size', group: 'Window', default: 'Mod+0' },
  { id: 'fullscreen', label: 'Full screen', group: 'Window', default: 'F11' },
  { id: 'quit', label: 'Quit DocWriter', group: 'Window', default: 'Mod+Q' },
];

export const DEFAULT_KEYS = Object.freeze(
  Object.fromEntries(KEY_ACTIONS.map((action) => [action.id, action.default]))
);

// Copy, paste, undo and the developer keys belong to someone else. A binding
// that shadowed them would break editing with no way back, so they are refused
// at the capture box and again before anything is written.
const RESERVED = [
  'mod+c',
  'mod+v',
  'mod+x',
  'mod+z',
  'mod+y',
  'mod+a',
  'mod+r',
  'mod+shift+r',
  'mod+shift+i',
  'f12',
];

const MODIFIERS = new Set(['shift', 'control', 'alt', 'meta', 'os', 'altgraph', 'capslock', 'fn']);

// Words, not glyphs: an arrow at 11px reads as a dash, and these are the keys
// the writer uses most.
const KEY_LABELS = {
  arrowleft: 'Left',
  arrowright: 'Right',
  arrowup: 'Up',
  arrowdown: 'Down',
  escape: 'Esc',
  enter: 'Enter',
  backspace: '⌫',
  delete: 'Del',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  space: 'Space',
};

/** One spelling for matching: single characters lowercase, names lowercase. */
export function normalizeKey(key) {
  const raw = String(key ?? '');
  if (!raw) return '';
  if (raw === ' ') return 'space';
  if (raw === '+') return '='; // Ctrl+Shift+= types "+"; both mean zoom in.
  return raw.toLowerCase();
}

/** { mod, alt, shift, key } or null when the text is not a chord. */
export function parseAccelerator(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const parts = raw.split('+').map((part) => part.trim());
  const key = parts.pop();
  if (!key) return null;
  const parsed = { mod: false, alt: false, shift: false, key: normalizeKey(key) };
  for (const part of parts) {
    const token = part.toLowerCase();
    if (token === 'mod' || token === 'cmdorctrl' || token === 'ctrl' || token === 'cmd' || token === 'meta') {
      parsed.mod = true;
    } else if (token === 'alt') {
      parsed.alt = true;
    } else if (token === 'shift') {
      parsed.shift = true;
    } else {
      return null; // "Ctrl+Foo" and friends
    }
  }
  return parsed.key ? parsed : null;
}

function displayKey(key) {
  if (key.length === 1) return key.toUpperCase();
  if (key === 'space') return 'Space';
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  const named = {
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    backspace: 'Backspace',
    delete: 'Delete',
    enter: 'Enter',
    escape: 'Escape',
    tab: 'Tab',
  };
  return named[key] ?? key;
}

/** "ctrl+o" and "Mod+O" both become "Mod+O", which is what gets stored. */
export function canonicalAccelerator(text) {
  const parsed = parseAccelerator(text);
  if (!parsed) return null;
  const parts = [];
  if (parsed.mod) parts.push('Mod');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  parts.push(displayKey(parsed.key));
  return parts.join('+');
}

export function validateAccelerator(text) {
  const value = canonicalAccelerator(text);
  if (!value) return { error: 'That is not a key combination DocWriter can use.' };
  const parsed = parseAccelerator(value);
  const isFunctionKey = /^f\d{1,2}$/.test(parsed.key);
  if (!parsed.mod && !parsed.alt && !isFunctionKey) {
    return { error: 'Add Ctrl, Alt or use an F-key.' };
  }
  if (RESERVED.includes(value.toLowerCase())) {
    return { error: 'That key belongs to the system (copy, paste, undo, reload).' };
  }
  return { value };
}

/**
 * The trust boundary: everything that is written to disk passes through here.
 * Unknown actions are ignored (the table is the whole vocabulary), bad values
 * come back as one readable sentence.
 */
export function validateKeymap(input, isMac = false) {
  const keys = {};
  for (const action of KEY_ACTIONS) {
    const raw = input && typeof input === 'object' ? input[action.id] ?? action.default : action.default;
    const check = validateAccelerator(raw);
    if (check.error) return { ok: false, error: `${action.label}: ${check.error}` };
    keys[action.id] = check.value;
  }
  const taken = new Map();
  for (const action of KEY_ACTIONS) {
    const fingerprint = keys[action.id].toLowerCase();
    if (taken.has(fingerprint)) {
      return {
        ok: false,
        error: `${formatAccelerator(keys[action.id], isMac)} is already used by ${taken.get(fingerprint)}.`,
      };
    }
    taken.set(fingerprint, action.label);
  }
  return { ok: true, keys };
}

/** Works for a DOM KeyboardEvent and for Electron's `input` (mapped first). */
export function matchesAccelerator(event, accelerator) {
  const parsed = parseAccelerator(accelerator);
  if (!parsed || !event || !event.key) return false;
  if (normalizeKey(event.key) !== parsed.key) return false;
  const mod = !!(event.ctrlKey || event.metaKey);
  if (mod !== parsed.mod || !!event.altKey !== parsed.alt) return false;
  // Shift is part of the binding for letters and digits. For named keys and
  // symbols it only changes what the key types, so Ctrl+Shift+= still zooms in.
  if (/^[a-z0-9]$/.test(parsed.key) && !!event.shiftKey !== parsed.shift) return false;
  return true;
}

export function findAction(event, keymap) {
  for (const action of KEY_ACTIONS) {
    if (matchesAccelerator(event, keymap?.[action.id] ?? action.default)) return action.id;
  }
  return null;
}

/**
 * Turns a keypress into a binding. null means "keep waiting" (only modifiers
 * are down); an { error } means the chord is not allowed.
 */
export function acceleratorFromEvent(event) {
  const key = normalizeKey(event.key);
  if (!key || MODIFIERS.has(key)) return null;
  const shift = !!event.shiftKey && /^[a-z0-9]$/.test(key);
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (shift) parts.push('Shift');
  parts.push(displayKey(key));
  return validateAccelerator(parts.join('+'));
}

/** For display only: "Ctrl+O" on Linux, "⌘O" on a Mac. */
export function formatAccelerator(text, isMac = false) {
  const parsed = parseAccelerator(text);
  if (!parsed) return '';
  const parts = [];
  if (parsed.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  if (parsed.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (parsed.shift) parts.push(isMac ? '⇧' : 'Shift');
  parts.push(KEY_LABELS[parsed.key] ?? parsed.key.toUpperCase());
  return parts.join(isMac ? '' : '+');
}
