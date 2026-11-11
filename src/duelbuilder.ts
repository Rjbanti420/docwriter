// Pure rules for the duel builder. No React, no fetch, no database: the card
// imports these directly, the builder only renders the result, and the tests
// exercise the same functions.
//
// Keep these limits in step with the server: MAX_FIGHTERS_PER_SIDE in
// server/duel.mjs and MAX_DUEL_TERRAIN in server/index.mjs.

export type DuelSideKey = 'A' | 'B';
export type TerrainMode = 'random' | 'custom';
export type WinnerAnswer = DuelSideKey | 'none';
export type SkillAnswer = DuelSideKey | 'neither';

export interface BuilderFighter {
  characterId: number;
  abilityIds: string[];
  itemIds: number[];
}

export interface BuilderSides {
  A: BuilderFighter[];
  B: BuilderFighter[];
}

export interface BuilderTerrain {
  mode: TerrainMode;
  randomName: string;
  custom: string;
}

export interface BuilderState {
  sides: BuilderSides;
  terrain: BuilderTerrain;
  chosenWinner: DuelSideKey | null;
  skilledSide: DuelSideKey | null;
}

/** The part of a Character the builder needs to keep a selection valid. */
export interface BuilderInventory {
  id: number;
  abilityIds: string[];
  itemIds: number[];
}

export interface DuelPayload {
  sides: [
    { fighters: Array<{ characterId: number; abilityIds: string[]; itemIds: number[] }> },
    { fighters: Array<{ characterId: number; abilityIds: string[]; itemIds: number[] }> },
  ];
  terrain: string;
  chosenWinner: DuelSideKey | null;
  skilledSide: DuelSideKey | null;
}

export const MAX_FIGHTERS_PER_SIDE = 3;
export const MAX_ABILITIES = 3;
export const MAX_TERRAIN = 80;

/** Used when the book has no Location cards yet. */
export const TERRAIN_FALLBACK = [
  'a muddy crossroads',
  'a ruined hall',
  'a narrow bridge',
  'a wind-cut ridge',
  'a rain-soaked street',
];

export function emptyBuilderState(randomName = ''): BuilderState {
  return {
    sides: { A: [], B: [] },
    terrain: { mode: 'random', randomName, custom: '' },
    chosenWinner: null,
    skilledSide: null,
  };
}

function withSide(sides: BuilderSides, side: DuelSideKey, fighters: BuilderFighter[]): BuilderSides {
  return side === 'A' ? { ...sides, A: fighters } : { ...sides, B: fighters };
}

export function addFighter(state: BuilderState, side: DuelSideKey, characterId: number): BuilderState {
  if (!Number.isFinite(characterId)) throw new Error('a fighter needs a character id');
  if (state.sides[side].length >= MAX_FIGHTERS_PER_SIDE) {
    throw new Error(`a side can have at most ${MAX_FIGHTERS_PER_SIDE} fighters`);
  }
  if ([...state.sides.A, ...state.sides.B].some((fighter) => fighter.characterId === characterId)) {
    throw new Error('that character is already in the duel');
  }
  const fighter: BuilderFighter = { characterId, abilityIds: [], itemIds: [] };
  return { ...state, sides: withSide(state.sides, side, [...state.sides[side], fighter]) };
}

export function removeFighter(state: BuilderState, side: DuelSideKey, characterId: number): BuilderState {
  const fighters = state.sides[side];
  const next = fighters.filter((fighter) => fighter.characterId !== characterId);
  if (next.length === fighters.length) return state;
  return { ...state, sides: withSide(state.sides, side, next) };
}

function updateFighter(
  state: BuilderState,
  side: DuelSideKey,
  characterId: number,
  update: (fighter: BuilderFighter) => BuilderFighter
): BuilderState {
  const fighters = state.sides[side];
  let changed = false;
  const next = fighters.map((fighter) => {
    if (fighter.characterId !== characterId) return fighter;
    changed = true;
    return update(fighter);
  });
  if (!changed) return state;
  return { ...state, sides: withSide(state.sides, side, next) };
}

/** Tick or untick an ability. A fourth ability is refused silently. */
export function toggleAbility(
  state: BuilderState,
  side: DuelSideKey,
  characterId: number,
  abilityId: string | number
): BuilderState {
  const id = String(abilityId);
  return updateFighter(state, side, characterId, (fighter) => {
    if (fighter.abilityIds.includes(id)) {
      return { ...fighter, abilityIds: fighter.abilityIds.filter((ability) => ability !== id) };
    }
    if (fighter.abilityIds.length >= MAX_ABILITIES) return fighter;
    return { ...fighter, abilityIds: [...fighter.abilityIds, id] };
  });
}

export function itemUsedByOtherSide(state: BuilderState, side: DuelSideKey, itemId: number): boolean {
  const other = side === 'A' ? 'B' : 'A';
  return state.sides[other].some((fighter) => fighter.itemIds.includes(itemId));
}

/** True when another fighter on the same side has already ticked this Item. */
export function itemSharedOnSide(
  state: BuilderState,
  side: DuelSideKey,
  itemId: number,
  characterId: number
): boolean {
  return state.sides[side].some(
    (fighter) => fighter.characterId !== characterId && fighter.itemIds.includes(itemId)
  );
}

/** Tick or untick an Item. An Item already ticked by the other side stays put. */
export function toggleItem(
  state: BuilderState,
  side: DuelSideKey,
  characterId: number,
  itemId: number
): BuilderState {
  if (itemUsedByOtherSide(state, side, itemId)) return state;
  return updateFighter(state, side, characterId, (fighter) => {
    if (fighter.itemIds.includes(itemId)) {
      return { ...fighter, itemIds: fighter.itemIds.filter((id) => id !== itemId) };
    }
    return { ...fighter, itemIds: [...fighter.itemIds, itemId] };
  });
}

/**
 * Drop selections that no longer exist: a character removed from the book, an
 * ability deleted in the editor, or an Item no longer held. A fighter whose
 * character is gone is dropped too, so the payload can never name a missing id.
 */
export function pruneBuilder(state: BuilderState, inventory: BuilderInventory[]): BuilderState {
  const byId = new Map(inventory.map((character) => [character.id, character]));
  let changed = false;

  const pruneSide = (fighters: BuilderFighter[]) => {
    const next: BuilderFighter[] = [];
    for (const fighter of fighters) {
      const character = byId.get(fighter.characterId);
      if (!character) {
        changed = true;
        continue;
      }
      const abilities = new Set(character.abilityIds.map(String));
      const items = new Set(character.itemIds);
      const abilityIds = fighter.abilityIds.filter((id) => abilities.has(id));
      const itemIds = fighter.itemIds.filter((id) => items.has(id));
      if (abilityIds.length !== fighter.abilityIds.length || itemIds.length !== fighter.itemIds.length) {
        changed = true;
        next.push({ ...fighter, abilityIds, itemIds });
      } else {
        next.push(fighter);
      }
    }
    return next;
  };

  const A = pruneSide(state.sides.A);
  const B = pruneSide(state.sides.B);
  if (!changed) return state;
  return { ...state, sides: { A, B } };
}

/** Pick from Location names, falling back to a small built-in list. */
export function pickTerrain(names: readonly string[], random: () => number = Math.random): string {
  const clean = names.map((name) => String(name ?? '').trim()).filter(Boolean);
  const pool = clean.length ? clean : TERRAIN_FALLBACK;
  const roll = Number(random());
  const value = Number.isFinite(roll) ? Math.min(0.999999999, Math.max(0, roll)) : 0;
  return pool[Math.floor(value * pool.length)].slice(0, MAX_TERRAIN);
}

export function withRandomTerrain(
  state: BuilderState,
  names: readonly string[],
  random: () => number = Math.random
): BuilderState {
  return {
    ...state,
    terrain: { ...state.terrain, mode: 'random', randomName: pickTerrain(names, random) },
  };
}

export function setTerrainMode(state: BuilderState, mode: TerrainMode): BuilderState {
  return { ...state, terrain: { ...state.terrain, mode } };
}

/** Custom text is capped as it is typed; the payload trims it again. */
export function setCustomTerrain(state: BuilderState, text: string): BuilderState {
  return {
    ...state,
    terrain: { ...state.terrain, mode: 'custom', custom: String(text ?? '').slice(0, MAX_TERRAIN) },
  };
}

export function terrainText(state: BuilderState): string {
  const raw = state.terrain.mode === 'random' ? state.terrain.randomName : state.terrain.custom;
  return String(raw ?? '').trim().slice(0, MAX_TERRAIN);
}

/**
 * The two popup answers, folded into the two fields the route understands.
 * A chosen winner skips the skill question entirely; "no" plus "neither" is a
 * fully weighted random duel with both fields null.
 */
export function resolveOutcome(
  winnerAnswer: WinnerAnswer,
  skillAnswer: SkillAnswer | null = null
): { chosenWinner: DuelSideKey | null; skilledSide: DuelSideKey | null } {
  if (winnerAnswer === 'A' || winnerAnswer === 'B') {
    return { chosenWinner: winnerAnswer, skilledSide: null };
  }
  const skilledSide = skillAnswer === 'A' || skillAnswer === 'B' ? skillAnswer : null;
  return { chosenWinner: null, skilledSide };
}

export interface KnownDuelNames {
  items?: ReadonlyMap<number, string>;
  abilities?: ReadonlyMap<string, string>;
}

/**
 * The route sends JSON `{ error }` after its status text; show the sentence, not
 * the envelope. When the sentence names an id, replace it with the name the
 * builder already knows; an unknown id keeps the server's wording.
 */
export function readableServerError(error: unknown, names: KnownDuelNames = {}): string {
  const text = error instanceof Error ? error.message : String(error);
  let message = text;
  const json = text.match(/\{[\s\S]*\}$/)?.[0];
  if (json) {
    try {
      const body = JSON.parse(json) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.trim()) message = body.error;
    } catch {
      // Not JSON; keep the original message.
    }
  }
  return message
    .replace(/\bitem (\d+) is missing or in Trash\b/g, (match, id) => {
      const name = names.items?.get(Number(id));
      return name ? `'${name}' is missing or in Trash` : match;
    })
    .replace(/\bability (\S+) does not belong to /g, (match, id) => {
      const name = names.abilities?.get(String(id));
      return name ? `ability '${name}' does not belong to ` : match;
    });
}

export function missingForDuel(state: BuilderState): string[] {
  const missing: string[] = [];
  if (state.sides.A.length === 0) missing.push('Side A needs a fighter');
  if (state.sides.B.length === 0) missing.push('Side B needs a fighter');
  return missing;
}

/**
 * The exact body `POST /api/duels` expects. The guards mirror the route's own
 * checks so a broken builder state fails here, before the request, rather than
 * as a 400 from the server.
 */
export function buildDuelPayload(state: BuilderState): DuelPayload {
  for (const side of ['A', 'B'] as const) {
    const count = state.sides[side].length;
    if (count < 1 || count > MAX_FIGHTERS_PER_SIDE) {
      throw new Error(`each side needs 1 to ${MAX_FIGHTERS_PER_SIDE} fighters`);
    }
  }

  const characterSide = new Map<number, DuelSideKey>();
  const itemSide = new Map<number, DuelSideKey>();

  const fighters = (side: DuelSideKey) =>
    state.sides[side].map((fighter) => {
      if (characterSide.has(fighter.characterId)) {
        throw new Error('a character cannot appear twice in one duel');
      }
      characterSide.set(fighter.characterId, side);

      if (fighter.abilityIds.length > MAX_ABILITIES) {
        throw new Error(`a fighter can use at most ${MAX_ABILITIES} abilities`);
      }
      for (const itemId of fighter.itemIds) {
        const previous = itemSide.get(itemId);
        if (previous && previous !== side) throw new Error('an item cannot be used on both sides');
        itemSide.set(itemId, side);
      }

      return {
        characterId: fighter.characterId,
        abilityIds: [...fighter.abilityIds],
        itemIds: [...fighter.itemIds],
      };
    });

  const A = fighters('A');
  const B = fighters('B');

  return {
    sides: [{ fighters: A }, { fighters: B }],
    terrain: terrainText(state),
    chosenWinner: state.chosenWinner,
    skilledSide: state.chosenWinner ? null : state.skilledSide,
  };
}
