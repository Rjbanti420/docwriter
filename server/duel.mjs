// Duel rules engine — deterministic, offline, no database.
//
// Everything here works on plain objects, so `node --test` exercises the whole
// engine (see duel.test.mjs) without opening a project database. A route builds
// the fighters with snapshotCombatants(), picks a seed, and calls resolveDuel().
// Nothing here reads the clock, the disk or the network.
//
// Narration is template prose, not AI. buildNarrative() is deliberately separate
// so a different narrator could be plugged in later. The engine cannot judge
// strategy — abilities are prose with no potency — so it only knows stored order
// and the item rank ladder.

// Item rank ladder, lowest first.
// CHANGE BOTH OR DUEL SCORING SILENTLY CHANGES: keep in step with ITEM_RANKS in
// src/components/EntityPanel.tsx.
export const ITEM_RANKS = ['Mundane', 'Elusive', 'Hazardous', 'Desolating', 'Cataclysmic', 'Singular'];

const ROLES = new Set(['offense', 'defense', 'both', 'none']);

/** A duel side holds one to three fighters (1v1 up to 3v3). */
export const MAX_FIGHTERS_PER_SIDE = 3;

/** An Item's fields.role; absent or unknown means "both" (the versatile default). */
export function normalizeRole(value) {
  const role = String(value ?? '').trim().toLowerCase();
  return ROLES.has(role) ? role : 'both';
}

/** Ladder value 1..6, or 0 when the item is unranked or the rank is unknown. */
export function itemRankValue(rank) {
  const index = ITEM_RANKS.indexOf(String(rank ?? '').trim());
  return index < 0 ? 0 : index + 1;
}

/**
 * Map power-level id -> rank (position in the ordered ladder + 1).
 * sort_order is MAX+1 on create and a delete leaves a gap, so position — not
 * sort_order + 1 — is the only stable rank. A missing level scores 0.
 */
export function powerRankMap(powerLevels = []) {
  const ordered = [...powerLevels].sort(
    (a, b) =>
      (Number(a?.sort_order) || 0) - (Number(b?.sort_order) || 0) ||
      (Number(a?.id) || 0) - (Number(b?.id) || 0)
  );
  const ranks = new Map();
  ordered.forEach((level, index) => ranks.set(Number(level.id), index + 1));
  return ranks;
}

/** mulberry32: one 32-bit integer in, a repeatable stream of floats in [0,1). */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- scoring ----------

function bestRank(items, accepts) {
  let best = 0;
  for (const item of items ?? []) {
    if (!accepts(normalizeRole(item?.role))) continue;
    const value = itemRankValue(item?.rank);
    if (value > best) best = value;
  }
  return best;
}

/**
 * One fighter's contribution. Attack and defence take the single best ranked
 * Item, not a sum: a second sword must not stack.
 */
export function scoreFighter(fighter = {}) {
  const power = Number(fighter.powerRank) || 0;
  const abilities = Math.min(Array.isArray(fighter.abilities) ? fighter.abilities.length : 0, 3);
  const attack = bestRank(fighter.items, (role) => role === 'offense' || role === 'both');
  const defence = bestRank(fighter.items, (role) => role === 'defense' || role === 'both');
  const powerPoints = power * 2;
  const abilityPoints = abilities * 1.5;
  return {
    total: 10 + powerPoints + abilityPoints + attack + defence,
    base: 10,
    power,
    powerPoints,
    abilities,
    abilityPoints,
    attack,
    defence,
  };
}

/** One side's score. The numbers edge and the skill multiplier apply in that order. */
export function scoreSide(fighters = [], { skilled = false } = {}) {
  const parts = fighters.map(scoreFighter);
  const raw = parts.reduce((sum, part) => sum + part.total, 0);
  const numbers = Math.max(0, fighters.length - 1) * 2;
  const multiplier = skilled ? 1.5 : 1;
  return {
    fighters: parts,
    raw,
    numbers,
    skilled,
    multiplier,
    score: (raw + numbers) * multiplier,
  };
}

const NARRATIVE_CAP = 220;
const NARRATIVE_CAP_THREE = 280;

/** A side of three gets more room to name every selected ability; smaller duels keep 220. */
export function narrativeWordCap(sides) {
  const a = Array.isArray(sides?.A) ? sides.A.length : 0;
  const b = Array.isArray(sides?.B) ? sides.B.length : 0;
  return Math.max(a, b) >= 3 ? NARRATIVE_CAP_THREE : NARRATIVE_CAP;
}

/** Weighted probability that side A wins, clamped so no input can make it absolute. */
export function winProbability(scoreA, scoreB) {
  const a = Math.max(0, Number(scoreA) || 0);
  const b = Math.max(0, Number(scoreB) || 0);
  if (a === 0 && b === 0) return 0.5;
  return Math.min(0.85, Math.max(0.15, a / (a + b)));
}

// ---------- snapshots ----------

/**
 * Freeze the fighters as they entered the duel.
 * sides:      { A: [{ characterId, abilityIds? }], B: [...] }  (abilityIds absent = all)
 * characters: [{ id, name, fields }] with fields already parsed
 * items:      [{ id, name, fields }] with fields already parsed; fields.owners decides who holds it
 */
export function snapshotCombatants({ sides, characters = [], items = [], powerLevels = [] } = {}) {
  const sideA = Array.isArray(sides?.A) ? sides.A : [];
  const sideB = Array.isArray(sides?.B) ? sides.B : [];
  if (sideA.length > MAX_FIGHTERS_PER_SIDE || sideB.length > MAX_FIGHTERS_PER_SIDE) {
    throw new Error(`a side can have at most ${MAX_FIGHTERS_PER_SIDE} fighters`);
  }

  const byId = new Map(characters.map((character) => [Number(character.id), character]));
  const ranks = powerRankMap(powerLevels);

  const build = (pick) => {
    const characterId = Number(pick?.characterId);
    const character = byId.get(characterId);
    if (!character) throw new Error(`character ${pick?.characterId} not found`);

    const fields = character.fields ?? {};
    const pool = Array.isArray(fields.abilities) ? fields.abilities : [];
    const wanted = Array.isArray(pick.abilityIds) ? new Set(pick.abilityIds.map(String)) : null;
    const abilities = pool
      .filter((ability) => ability && typeof ability === 'object')
      .filter((ability) => !wanted || wanted.has(String(ability.id)))
      .map((ability) => ({ id: String(ability.id ?? ''), name: String(ability.name ?? '').trim() }))
      .filter((ability) => ability.name);

    const held = (items ?? [])
      .filter((item) => {
        const owners = Array.isArray(item?.fields?.owners) ? item.fields.owners.map(Number) : [];
        return owners.includes(characterId);
      })
      .map((item) => ({
        id: Number(item.id),
        name: String(item.name ?? ''),
        rank: typeof item.fields?.rank === 'string' ? item.fields.rank : '',
        role: normalizeRole(item.fields?.role),
      }));

    return {
      characterId,
      name: String(character.name ?? ''),
      dead: Boolean(fields.death),
      powerRank: ranks.get(Number(fields.power_level)) ?? 0,
      abilities,
      items: held,
    };
  };

  return {
    A: sideA.map(build),
    B: sideB.map(build),
  };
}

// ---------- validation ----------

function validateSides(sides) {
  const A = Array.isArray(sides?.A) ? sides.A : null;
  const B = Array.isArray(sides?.B) ? sides.B : null;
  if (!A || !B || A.length === 0 || B.length === 0) {
    throw new Error('both sides need at least one fighter');
  }
  if (A.length > MAX_FIGHTERS_PER_SIDE || B.length > MAX_FIGHTERS_PER_SIDE) {
    throw new Error(`a side can have at most ${MAX_FIGHTERS_PER_SIDE} fighters`);
  }

  // A character can appear once in the whole duel, so never on both sides.
  const characterSide = new Map();
  for (const [side, list] of [
    ['A', A],
    ['B', B],
  ]) {
    for (const fighter of list) {
      const id = Number(fighter?.characterId);
      if (!Number.isFinite(id)) continue;
      if (characterSide.has(id)) throw new Error(`character ${id} appears more than once in the duel`);
      characterSide.set(id, side);
    }
  }

  // An Item may be shared inside one side, never across sides.
  const itemSide = new Map();
  for (const [side, list] of [
    ['A', A],
    ['B', B],
  ]) {
    for (const fighter of list) {
      for (const item of fighter?.items ?? []) {
        const id = Number(item?.id);
        if (!Number.isFinite(id)) continue;
        const owner = itemSide.get(id);
        if (owner && owner !== side) throw new Error(`item ${id} cannot be used on both sides`);
        itemSide.set(id, side);
      }
    }
  }

  return { A, B };
}

function assertChoice(value, label, allowed) {
  if (value != null && !allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')}`);
}

// ---------- outcome ----------

/**
 * Decide the duel and narrate it.
 * chosenWinner  'A' | 'B' | null  — guaranteed winner; the skill question is not asked
 * skilledSide   'A' | 'B' | null  — ×1.5 score edge; ignored when a winner was chosen
 */
export function resolveDuel({ sides, seed, chosenWinner = null, skilledSide = null, terrain = '' } = {}) {
  const { A, B } = validateSides(sides);
  if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
  assertChoice(chosenWinner, 'chosenWinner', ['A', 'B']);
  assertChoice(skilledSide, 'skilledSide', ['A', 'B']);

  const chosen = chosenWinner ?? null;
  const skill = chosen ? null : (skilledSide ?? null);

  const scorecard = {
    A: scoreSide(A, { skilled: skill === 'A' }),
    B: scoreSide(B, { skilled: skill === 'B' }),
  };
  const probabilityA = winProbability(scorecard.A.score, scorecard.B.score);
  const rng = mulberry32(seed);
  const roll = rng();
  const winnerSide = chosen ?? (roll < probabilityA ? 'A' : 'B');

  const outcome = {
    winnerSide,
    skillSide: skill,
    chosenBy: chosen,
    seed,
    scores: { A: scorecard.A.score, B: scorecard.B.score },
  };

  return {
    scorecard,
    outcome,
    probabilityA,
    roll,
    narrative: buildNarrative({ sides: { A, B }, outcome, terrain, rng }),
  };
}

/**
 * Three beats — opening, turning point, aftermath — from stored facts only.
 *
 * Every slot has several phrasings drawn from the seeded PRNG, so a duel
 * replays word for word and two seeds read differently. The tone comes from the
 * outcome alone: a picked "more skilled" side is narrated as exact and
 * anticipating, the other as competent but reactive; a chosen winner is
 * narrated at its best, and the loser is still allowed a real near-win.
 *
 * Swappable: a different narrator may replace this without touching the rules.
 */
export function buildNarrative({ sides, outcome, terrain = '', rng = mulberry32(0) } = {}) {
  const pick = (rows) => rows[Math.min(rows.length - 1, Math.floor(rng() * rows.length))];
  const lines = [];
  // `drop` marks a line the hard word cap may remove when a large side runs long.
  const add = (text, drop = null) => {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (clean) lines.push({ text: clean, drop });
  };
  /** Sentence-initial capital, for lines that begin with a lower-case Item name. */
  const cap = (text) => {
    const s = String(text ?? '');
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  };

  const joined = (list) => {
    const names = (list ?? []).map((fighter) => fighter?.name || 'the fighter');
    if (names.length <= 1) return names[0] ?? 'no one';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  };
  const v = (list, one, many) => ((list?.length ?? 0) > 1 ? many : one);

  const A = Array.isArray(sides?.A) ? sides.A : [];
  const B = Array.isArray(sides?.B) ? sides.B : [];
  const bySide = { A, B };
  const winnerSide = outcome?.winnerSide === 'B' ? 'B' : 'A';
  const loserSide = winnerSide === 'A' ? 'B' : 'A';
  const winner = bySide[winnerSide];
  const loser = bySide[loserSide];
  const winnerNames = joined(winner);
  const loserNames = joined(loser);

  const chosen = outcome?.chosenBy === 'A' || outcome?.chosenBy === 'B' ? outcome.chosenBy : null;
  const skilled = outcome?.skillSide === 'A' || outcome?.skillSide === 'B' ? outcome.skillSide : null;
  const toneFor = (side) => {
    if (chosen === side) return 'best';
    if (skilled === side) return 'master';
    if (skilled) return 'ordinary';
    return 'neutral';
  };
  const winnerTone = toneFor(winnerSide);
  const loserTone = toneFor(loserSide);

  /** Every fighter on a side that has an ability in this stored position. */
  const entriesAt = (list, index) =>
    (list ?? [])
      .map((fighter) => ({
        owner: fighter?.name || 'the fighter',
        name: String((fighter?.abilities ?? [])[index]?.name ?? '').trim(),
      }))
      .filter((entry) => entry.name);

  const abilityLine = (entries, tone, mode) => {
    if (entries.length === 0) return '';
    if (entries.length === 1) {
      const { owner, name } = entries[0];
      if (mode === 'open') {
        if (tone === 'master')
          return pick([
            `${owner} opens with ${name}, without wasted motion.`,
            `${owner} commits to ${name} first, exactly as intended.`,
          ]);
        if (tone === 'ordinary')
          return pick([
            `${owner} hesitates, then falls back on ${name}.`,
            `${owner} opens with ${name}, workmanlike rather than inspired.`,
          ]);
        if (tone === 'best')
          return pick([
            `${owner} opens with ${name}, and it lands clean.`,
            `The first move is ${name}, from ${owner}, and it is exactly right.`,
          ]);
        return pick([`${owner} opens with ${name}.`, `It starts with ${name}, from ${owner}.`]);
      }
      if (mode === 'answer') {
        if (tone === 'master') return `${owner} answers with ${name}, as though it were expected.`;
        if (tone === 'ordinary') return `${owner} answers with ${name}, a moment late.`;
        return `${owner} answers with ${name}.`;
      }
      if (tone === 'master')
        return pick([
          `${owner} spends ${name} at the right moment, economically.`,
          `${owner} returns with ${name}, nothing wasted.`,
        ]);
      if (tone === 'ordinary') return `${owner} reaches for ${name}, late.`;
      if (tone === 'best') return `${owner} calls on ${name} at the turning point, and it tells.`;
      return pick([`${owner} returns with ${name}.`, `${name} follows, from ${owner}.`]);
    }

    const rest = entries
      .slice(1)
      .map((entry) => `${entry.owner} with ${entry.name}`)
      .join('; ');
    if (mode === 'answer') return `${entries[0].owner} answers with ${entries[0].name}; ${rest}.`;
    if (mode === 'second')
      return `${entries.map((entry) => `${entry.owner} with ${entry.name}`).join(', ')}: they hold nothing back.`;
    return `${entries[0].owner} opens with ${entries[0].name}; ${rest}.`;
  };

  const strongestItem = (list, accepts) => {
    let best = null;
    for (const fighter of list) {
      for (const item of fighter?.items ?? []) {
        if (!accepts(normalizeRole(item.role))) continue;
        if (!best || itemRankValue(item.rank) > itemRankValue(best.item.rank)) {
          best = { item, owner: fighter?.name || 'the fighter' };
        }
      }
    }
    return best;
  };
  const offensive = (role) => role === 'offense' || role === 'both';
  const defensive = (role) => role === 'defense' || role === 'both';

  // "Random" is resolved by the caller; if it ever arrives raw, treat it as none.
  const rawGround = String(terrain ?? '').trim();
  const ground = /^random$/i.test(rawGround) ? '' : rawGround;

  // ---- opening ----
  if (ground) {
    add(
      pick([
        `The fight takes place at ${ground}.`,
        `They meet at ${ground}, and the place gives nothing away either.`,
        `It begins at ${ground}, with both sides still finding their footing.`,
      ])
    );
  }

  add(
    pick([
      `${winnerNames} ${v(winner, 'takes', 'take')} one side, ${loserNames} the other.`,
      `On one side ${winnerNames}; on the other, ${loserNames}.`,
      ground
        ? `${winnerNames} ${v(winner, 'faces', 'face')} ${loserNames} across it.`
        : `${winnerNames} ${v(winner, 'faces', 'face')} ${loserNames}.`,
    ])
  );

  const dead = [...winner, ...loser].filter((fighter) => fighter?.dead);
  if (dead.length) add(`This is a fight out of memory, with ${joined(dead)} still on their feet.`);

  const winnerFirst = rng() < 0.5;
  const opener = winnerFirst ? { list: winner, tone: winnerTone } : { list: loser, tone: loserTone };
  const answerer = winnerFirst ? { list: loser, tone: loserTone } : { list: winner, tone: winnerTone };
  add(abilityLine(entriesAt(opener.list, 0), opener.tone, 'open'));
  add(abilityLine(entriesAt(answerer.list, 0), answerer.tone, 'answer'));
  add(
    pick([
      'The first clash settles nothing, and both sides keep their shape.',
      'The first pass ends with both sides still standing, and no one has given ground.',
      'Neither side gives more than it has to in the opening, and neither takes a risk.',
      'The opening exchange is quick, and it decides very little either way.',
    ]),
    'first-filler'
  );

  // ---- turning beat ----
  if (winnerTone === 'master') {
    add(`${winnerNames} ${v(winner, 'gives', 'give')} nothing away; every answer is already waiting.`);
  } else if (winnerTone === 'best') {
    add(`${winnerNames} ${v(winner, 'is', 'are')} at their best here, every choice landing where it should.`);
  } else if (winnerTone === 'ordinary') {
    add(`${winnerNames} ${v(winner, 'takes', 'take')} ground by weight rather than craft.`);
  } else {
    add(
      pick([
        'Neither side finds an easy opening.',
        'The exchange is even for a while, and neither side commits too far.',
        'For a time it is simply work, and neither side gets the better of it.',
      ])
    );
  }

  if (loserTone === 'ordinary') {
    add(
      `${loserNames} ${v(loser, 'is', 'are')} competent, but a beat behind, and ${v(loser, 'knows', 'know')} it.`
    );
  } else if (loserTone === 'master') {
    add(
      `${loserNames} ${v(loser, 'is', 'are')} the more economical of the two, and it is still not enough to break the fight open.`
    );
  }

  const loserSeconds = entriesAt(loser, 1);
  const loserOffence = strongestItem(loser, offensive);
  if (loserSeconds.length) {
    const first = loserSeconds[0];
    const rest = loserSeconds
      .slice(1)
      .map((entry) => `${entry.owner} with ${entry.name}`)
      .join('; ');
    if (rest) {
      add(
        `${first.owner} nearly turns it with ${first.name}; ${rest}. For a moment ${winnerNames} ${v(winner, 'is', 'are')} in trouble.`
      );
    } else {
      add(
        `${first.owner} nearly turns it with ${first.name}, and for a moment ${winnerNames} ${v(winner, 'is', 'are')} in trouble.`
      );
    }
  } else if (loserOffence) {
    add(
      `${loserOffence.owner} comes close with ${loserOffence.item.name}, close enough that the next exchange matters.`
    );
  } else {
    add(`${loserNames} ${v(loser, 'has', 'have')} one good moment, and it is not enough to hold.`);
  }

  add(
    pick([
      `${loserNames} ${v(loser, 'keeps', 'keep')} fighting, and the next exchange costs both sides.`,
      'The fight has turned, and both sides know it.',
      'Neither side can afford another mistake.',
    ]),
    'push'
  );

  add(abilityLine(entriesAt(winner, 1), winnerTone, 'second'), 'second-abilities');

  const winnerOffence = strongestItem(winner, offensive);
  if (winnerOffence) {
    add(
      pick([
        `${winnerOffence.owner} brings ${winnerOffence.item.name} to bear at the moment that decides it, and ${loserNames} cannot answer.`,
        `${cap(winnerOffence.item.name)} decides it, in ${winnerOffence.owner}'s hands.`,
        `${winnerOffence.owner} sets ${winnerOffence.item.name} against the last opening, and it holds.`,
      ])
    );
  } else {
    add(`${winnerNames} ${v(winner, 'finds', 'find')} the gap without gear and ${v(winner, 'takes', 'take')} it.`);
  }

  const loserDefence = strongestItem(loser, defensive);
  const winnerDefence = strongestItem(winner, defensive);
  const armour =
    loserDefence && (!winnerDefence || itemRankValue(loserDefence.item.rank) >= itemRankValue(winnerDefence.item.rank))
      ? { ...loserDefence, side: 'loser' }
      : winnerDefence
        ? { ...winnerDefence, side: 'winner' }
        : null;
  if (armour) {
    if (armour.side === 'loser') {
      add(
        pick([
          `${cap(armour.item.name)} takes a blow that should have ended it for ${armour.owner}, and the fight goes on longer than it should.`,
          `${armour.owner} is still there because of ${armour.item.name}, though it only delays the end.`,
        ]),
        'armour'
      );
    } else {
      add(
        pick([
          `${cap(armour.item.name)} turns the decisive blow for ${armour.owner}.`,
          `${armour.owner} is still standing because of ${armour.item.name}, and the opening is gone.`,
        ]),
        'armour'
      );
    }
  }

  // ---- aftermath ----
  if (ground) {
    add(
      pick([
        `When it is over, ${ground} is the only thing unchanged.`,
        `The ground at ${ground} keeps the marks of it.`,
        `They will remember ${ground} longer than they remember the blows.`,
      ]),
      'terrain-echo'
    );
  }
  if (chosen) add(`${winnerNames} will be remembered for this one.`);

  add(
    pick([
      'By the end both sides are tired, and the fight is decided on small things.',
      'There is a moment when either side could still have won it.',
      'The last exchange is shorter than the ones before it.',
    ]),
    'aftermath-filler'
  );

  add(
    pick([
      `${loserNames} ${v(loser, 'is', 'are')} out of the contest; ${winnerNames} ${v(winner, 'holds', 'hold')} the field.`,
      `It ends with ${loserNames} giving ground, and ${winnerNames} ${v(winner, 'holds', 'hold')} it.`,
      `${winnerNames} ${v(winner, 'holds', 'hold')} the field; ${loserNames} ${v(loser, 'has', 'have')} nothing left to answer with.`,
    ])
  );

  // The cap is part of the contract (280 when a side has three, 220 otherwise).
  // If a large side still runs past it, drop connective lines first, then the
  // second-ability line, then the armour/terrain echoes — never the winner, the
  // signature moves or the decisive Item. Deterministic, and only when needed.
  const wordCap = narrativeWordCap(sides);
  const words = () => lines.reduce((n, line) => n + line.text.split(/\s+/).filter(Boolean).length, 0);
  for (const drop of [
    'aftermath-filler',
    'first-filler',
    'push',
    'second-abilities',
    'armour',
    'terrain-echo',
  ]) {
    if (words() <= wordCap) break;
    const index = lines.findIndex((line) => line.drop === drop);
    if (index >= 0) lines.splice(index, 1);
  }

  return lines.map((line) => line.text).join(' ');
}
