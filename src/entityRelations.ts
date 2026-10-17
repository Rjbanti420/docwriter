// Entity ↔ Item relations, and an entity's fate (alive / dead).
//
// Possession is stored on the item's own `fields` JSON blob as `fields.owners`
// (an array of holding entity ids) — the same schema-free, backup-safe approach
// used for entity images. An item may be held by several people or entities at
// once (never by another Item). Older books stored a single `fields.owner`, so
// that is still read as a one-element list. A holder's possessions are derived
// by scanning the already-loaded entity list for items that point back at it.
//
// Death is likewise a `fields.death = { chapter, at }` marker, so it needs no
// schema change and is reversible (Kill ⇄ Resurrect).

import { parseFields } from './entityMedia';

function asId(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The ids that hold this item, deduped and in stored order (empty when unheld). */
export function getOwnerIds(raw: string | null | undefined): number[] {
  const fields = parseFields(raw);
  const list = Array.isArray(fields.owners) ? fields.owners : [];
  const ids = list.map(asId).filter((x): x is number => x != null);
  // Older books kept a single holder on `owner`; fold it in for back-compat.
  const legacy = asId(fields.owner);
  if (legacy != null) ids.push(legacy);
  return [...new Set(ids)];
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
