import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_KEYS,
  KEY_ACTIONS,
  acceleratorFromEvent,
  canonicalAccelerator,
  findAction,
  formatAccelerator,
  matchesAccelerator,
  validateAccelerator,
  validateKeymap,
} from './keys.mjs';

const ev = (key, mods = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

test('every action has a default that validates, and defaults do not collide', () => {
  assert.equal(KEY_ACTIONS.length, Object.keys(DEFAULT_KEYS).length);
  for (const action of KEY_ACTIONS) {
    assert.deepEqual(validateAccelerator(action.default), { value: action.default });
  }
  assert.equal(validateKeymap(DEFAULT_KEYS).ok, true);
});

test('canonical form is order- and case-independent', () => {
  assert.equal(canonicalAccelerator('ctrl+o'), 'Mod+O');
  assert.equal(canonicalAccelerator('shift+alt+arrowleft'), 'Alt+Shift+ArrowLeft');
  assert.equal(canonicalAccelerator('Mod+-'), 'Mod+-');
  assert.equal(canonicalAccelerator('nonsense+Foo'), null);
  assert.equal(canonicalAccelerator(''), null);
});

test('shift matters for letters but not for symbols', () => {
  assert.equal(matchesAccelerator(ev('k', { ctrl: true }), 'Mod+K'), true);
  assert.equal(matchesAccelerator(ev('K', { ctrl: true, shift: true }), 'Mod+K'), false);
  assert.equal(matchesAccelerator(ev('k', { ctrl: true, shift: true }), 'Mod+Shift+K'), true);
  assert.equal(matchesAccelerator(ev('k', { ctrl: true }), 'Mod+Shift+K'), false);
  // Ctrl+Shift+= is "+" on a US layout, and still means zoom in.
  assert.equal(matchesAccelerator(ev('+', { ctrl: true, shift: true }), 'Mod+='), true);
  assert.equal(matchesAccelerator(ev('=', { ctrl: true }), 'Mod+='), true);
});

test('named keys ignore a stray shift, and modifiers must match exactly', () => {
  assert.equal(matchesAccelerator(ev('ArrowLeft', { alt: true }), 'Alt+ArrowLeft'), true);
  assert.equal(matchesAccelerator(ev('ArrowLeft', { alt: true, shift: true }), 'Alt+ArrowLeft'), true);
  assert.equal(matchesAccelerator(ev('ArrowLeft'), 'Alt+ArrowLeft'), false);
  assert.equal(matchesAccelerator(ev('ArrowLeft', { alt: true, ctrl: true }), 'Alt+ArrowLeft'), false);
  assert.equal(matchesAccelerator(ev('F11'), 'F11'), true);
});

test('findAction picks the bound action and nothing else', () => {
  assert.equal(findAction(ev('k', { ctrl: true }), DEFAULT_KEYS), 'quickOpen');
  assert.equal(findAction(ev('o', { ctrl: true }), DEFAULT_KEYS), 'openBook');
  assert.equal(findAction(ev('k'), DEFAULT_KEYS), null);
  assert.equal(findAction(ev('z', { ctrl: true }), DEFAULT_KEYS), null);
});

test('reserved editing keys and developer keys are refused', () => {
  for (const key of ['Mod+C', 'Mod+V', 'Mod+X', 'Mod+Z', 'Mod+A', 'Mod+R', 'Mod+Shift+I', 'F12']) {
    assert.ok(validateAccelerator(key).error, key);
  }
  assert.equal(validateAccelerator('Mod+Q').value, 'Mod+Q');
});

test('a chord needs Ctrl, Alt or an F-key', () => {
  assert.match(validateAccelerator('K').error, /Ctrl, Alt/);
  assert.match(validateAccelerator('Shift+K').error, /Ctrl, Alt/);
  assert.equal(validateAccelerator('F5').value, 'F5');
});

test('validateKeymap rejects duplicates and bad values, and ignores unknown ids', () => {
  const dup = { ...DEFAULT_KEYS, nextChapter: 'Mod+O' };
  assert.equal(validateKeymap(dup).ok, false);
  assert.match(validateKeymap(dup).error, /already used by Open book/);

  const bad = { ...DEFAULT_KEYS, saveChapter: 'Mod+A' };
  assert.equal(validateKeymap(bad).ok, false);

  const extra = validateKeymap({ ...DEFAULT_KEYS, notAnAction: 'Mod+J' });
  assert.equal(extra.ok, true);
  assert.equal('notAnAction' in extra.keys, false);
});

test('capture waits on bare modifiers and reports what it would store', () => {
  assert.equal(acceleratorFromEvent(ev('Shift', { shift: true })), null);
  assert.equal(acceleratorFromEvent(ev('Control', { ctrl: true })), null);
  assert.deepEqual(acceleratorFromEvent(ev('j', { ctrl: true })), { value: 'Mod+J' });
  assert.deepEqual(acceleratorFromEvent(ev('ArrowDown', { alt: true, shift: true })), {
    value: 'Alt+ArrowDown',
  });
  assert.equal(acceleratorFromEvent(ev('j')).error !== undefined, true);
  assert.equal(acceleratorFromEvent(ev('c', { ctrl: true })).error !== undefined, true);
});

test('display form is readable on both platforms', () => {
  assert.equal(formatAccelerator('Mod+O'), 'Ctrl+O');
  assert.equal(formatAccelerator('Mod+O', true), '⌘O');
  assert.equal(formatAccelerator('Alt+ArrowLeft'), 'Alt+Left');
  assert.equal(formatAccelerator('Mod+Shift+K'), 'Ctrl+Shift+K');
  // Parsing is lenient about key names (media keys exist); validation is not.
  assert.equal(validateAccelerator('Nonsense').error !== undefined, true);
});
