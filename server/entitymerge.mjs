// Entity merge — the policy half, kept DB-free (like server/planning.mjs) so it
// can be unit-tested without opening a project database.
//
// A absorbs B. The survivor is always the card the merge was started from: A's
// own opinions win wherever it has one, and every value B has that A leaves
// blank is copied over. Nothing of B's identity survives as a card — its name
// (and aliases) become A's aliases, so both spellings keep resolving to A.

import { normalizeKey } from './detect.mjs';

function parse(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * Merge B's `fields` blob into A's.
 *
 * @param {string} survivorRaw  the absorbing entity's `fields` JSON
 * @param {string} absorbedRaw  the absorbed entity's `fields` JSON
 * @returns {object} A's fields, with every blank filled from B
 */
export function mergeFields(survivorRaw, absorbedRaw) {
  // B first, then A on top: A wins any key both sides set, B still fills the
  // keys A never touched (image, owner, death, custom notes, …).
  return { ...parse(absorbedRaw), ...parse(survivorRaw) };
}

/** True when the blob parses to a non-empty object (i.e. the card "has" a field). */
export function hasFields(raw) {
  return Object.keys(parse(raw)).length > 0;
}

/**
 * Which of B's names are genuinely new for A: B's own name first, then B's
 * aliases, deduped by the normalised key the scanner uses — so an already
 * known spelling (A's name, or an alias A carries) is not added twice.
 *
 * @param {string} survivorName
 * @param {string[]} survivorAliases
 * @param {string} absorbedName
 * @param {string[]} absorbedAliases
 * @returns {string[]} alias strings to insert, in order
 */
export function newAliasList(survivorName, survivorAliases, absorbedName, absorbedAliases) {
  const known = new Set([normalizeKey(String(survivorName ?? ''))]);
  for (const a of survivorAliases || []) known.add(normalizeKey(String(a ?? '')));

  const out = [];
  for (const raw of [absorbedName, ...(absorbedAliases || [])]) {
    const name = String(raw ?? '').trim();
    const key = normalizeKey(name);
    if (!key || known.has(key)) continue; // blank, or already covered
    known.add(key);
    out.push(name);
  }
  return out;
}
