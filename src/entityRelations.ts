// Entity ↔ Item relations, and an entity's fate (alive / dead).
//
// Possession is stored as a *single owner* on the item's own `fields` JSON blob
// (`fields.owner` = the owning entity's id) — the same schema-free, backup-safe
// approach used for entity images. A character's possessions are therefore
// derived by scanning the already-loaded entity list for items that point back
// at it, which also keeps "who holds this" unambiguous (one owner per item).
//
// Death is likewise a `fields.death = { chapter, at }` marker, so it needs no
// schema change and is reversible (Kill ⇄ Resurrect).

import { parseFields } from './entityMedia';

export function getOwnerId(raw: string | null | undefined): number | null {
  const owner = parseFields(raw).owner;
  return typeof owner === 'number' && Number.isFinite(owner) ? owner : null;
}

export interface EntityDeath {
  /** The chapter the entity died in, or null when it was left blank. */
  chapter: number | null;
  /** When the death was recorded (ISO string). */
  at: string | null;
}

/** Returns the entity's death marker, or null when the entity is alive. */
export function getDeath(raw: string | null | undefined): EntityDeath | null {
  const v = parseFields(raw).death;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  const chapter = typeof rec.chapter === 'number' && Number.isFinite(rec.chapter) ? rec.chapter : null;
  const at = typeof rec.at === 'string' ? rec.at : null;
  return { chapter, at };
}

// Organisation relations.
//
// Like ownership, these live on the organisation's own `fields` blob: a single
// `leader` id, an `operates_in` id and a `members` array of ids. They are plain
// forward references (the organisation points at the people and the place), so
// they need no schema and survive export/backup unchanged.

function asId(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The organisation's leader (a Character id), or null. */
export function getLeaderId(raw: string | null | undefined): number | null {
  return asId(parseFields(raw).leader);
}

/** Where the organisation operates (a Location or Country id), or null. */
export function getOperatesInId(raw: string | null | undefined): number | null {
  return asId(parseFields(raw).operates_in);
}

/** The organisation's members (Character ids), in stored order, deduped. */
export function getMemberIds(raw: string | null | undefined): number[] {
  const v = parseFields(raw).members;
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(asId).filter((x): x is number => x != null))];
}
