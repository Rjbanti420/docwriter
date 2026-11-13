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
  // keys A never touched (image, owners, death, custom notes, …).
  return { ...parse(absorbedRaw), ...parse(survivorRaw) };
}


/**
 * Repoint every reference that names the absorbed entity at the survivor.
 *
 * Handles the item→holder `owners` array (an item may be held by several
 * entities at once) plus the legacy single `owner`, and the organisation's
 * `leader` / `operates_in` scalars and `members` array. References never point
 * at an entity itself, so a self-reference is dropped rather than created.
 *
 * @param {object} rawFields   the entity's parsed `fields` blob
 * @param {object} ids
 * @param {number} ids.survivorId  the entity that absorbs (A)
 * @param {number} ids.absorbedId  the entity being absorbed (B)
 * @param {number} ids.selfId      the id of the entity these fields belong to
 * @returns {{ fields: object, touched: boolean, ownersRepointed: number }}
 */
export function repointReferences(rawFields, { survivorId, absorbedId, selfId }) {
  const fields = { ...(rawFields ?? {}) };
  let touched = false;
  let ownersRepointed = 0;

  if (Array.isArray(fields.owners) && fields.owners.includes(absorbedId)) {
    const next = [...new Set(fields.owners.map((o) => (o === absorbedId ? survivorId : o)))].filter(
      (o) => o !== selfId
    );
    if (next.length > 0) fields.owners = next;
    else delete fields.owners;
    touched = true;
    ownersRepointed += 1;
  }
  // Older books kept a single holder on `owner`; repoint it too (and drop it when
  // the survivor would otherwise hold itself).
  if (fields.owner === absorbedId) {
    if (selfId === survivorId) delete fields.owner;
    else fields.owner = survivorId;
    touched = true;
    ownersRepointed += 1;
  }

  if (fields.leader === absorbedId) {
    if (selfId === survivorId) delete fields.leader;
    else fields.leader = survivorId;
    touched = true;
  }
  if (fields.operates_in === absorbedId) {
    if (selfId === survivorId) delete fields.operates_in;
    else fields.operates_in = survivorId;
    touched = true;
  }
  if (Array.isArray(fields.members) && fields.members.includes(absorbedId)) {
    const next = [...new Set(fields.members.map((m) => (m === absorbedId ? survivorId : m)))].filter(
      (m) => m !== selfId
    );
    if (next.length > 0) fields.members = next;
    else delete fields.members;
    touched = true;
  }

  return { fields, touched, ownersRepointed };
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
