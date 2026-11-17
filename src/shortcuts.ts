// The live keymap. The table and the matcher live in server/keys.mjs because
// the Electron main process needs the same rules; the page keeps the current
// values here so a keypress is matched against what Settings last saved.
//
// Deliberately a module, not React state: shortcuts are read inside event
// handlers, which must not close over a stale render.

import {
  DEFAULT_KEYS,
  KEY_ACTIONS,
  acceleratorFromEvent,
  formatAccelerator,
  matchesAccelerator,
} from '../server/keys.mjs';
import { desktop } from './desktop';

export { KEY_ACTIONS, acceleratorFromEvent, formatAccelerator, matchesAccelerator };

export type KeyResult = { ok: boolean; keys?: Record<string, string>; error?: string };

let current: Record<string, string> = { ...DEFAULT_KEYS };

export function bindings(): Record<string, string> {
  return current;
}

/** Called once at boot; the defaults stand if the bridge is missing or unwell. */
export async function loadBindings(): Promise<void> {
  const bridge = desktop();
  if (!bridge) return;
  try {
    const saved = await bridge.getKeys();
    if (saved && typeof saved === 'object') current = { ...current, ...saved };
  } catch {
    /* defaults */
  }
}

export async function setBinding(id: string, accelerator: string): Promise<KeyResult> {
  const bridge = desktop();
  if (!bridge) return { ok: false, error: 'Shortcuts can be changed in the desktop app.' };
  const result = await bridge.setKey(id, accelerator);
  if (result.ok && result.keys) current = result.keys;
  return result;
}

export async function resetBindings(): Promise<KeyResult> {
  const bridge = desktop();
  if (!bridge) return { ok: false, error: 'Shortcuts can be changed in the desktop app.' };
  const result = await bridge.resetKeys();
  if (result.ok) current = result.keys;
  return result;
}

/** "⌘" on a Mac, "Ctrl" everywhere else, for the labels in Settings and menus. */
export function isMac(): boolean {
  return /mac/i.test(navigator.platform || '');
}

export function keyLabel(id: string): string {
  return formatAccelerator(current[id] ?? DEFAULT_KEYS[id], isMac());
}
