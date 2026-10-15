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
