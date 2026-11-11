// Pure display helpers for a saved duel. Kept out of the component so the
// labels can be tested without a browser, and so an older record (missing the
// point fields added later) still reads correctly.
import type { DuelFighter, DuelFighterScore, DuelOutcome, DuelSideScore, DuelSides } from './types';

/** The chosen abilities in the snapshot's stored order; empty when none. */
export function fighterAbilityLine(fighter: DuelFighter): string {
  const list = Array.isArray(fighter?.abilities) ? fighter.abilities : [];
  return list
    .map((ability) => (typeof ability === 'string' ? ability : ability?.name ?? ''))
    .filter(Boolean)
    .join(' · ');
}

/** 1.5 -> "1.5", 3 -> "3"; never a trailing ".0". */
export function points(value: number | undefined): string {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function sideNames(sides: DuelSides, side: 'A' | 'B'): string {
  return joinNames((sides?.[side] ?? []).map((fighter) => fighter.name));
}

/** The stored date is `YYYY-MM-DD HH:MM:SS`; the card only needs the day. */
export function dateLabel(createdAt: string): string {
  return String(createdAt ?? '').slice(0, 10);
}

/**
 * Point fields fall back to the stored rank/count, so a duel saved before
 * `powerPoints`/`abilityPoints` existed still produces the same readable line.
 */
function fighterPoints(fighter: DuelFighterScore) {
  return {
    powerPoints: fighter.powerPoints ?? (Number(fighter.power) || 0) * 2,
    abilityPoints: fighter.abilityPoints ?? Math.min(Number(fighter.abilities) || 0, 3) * 1.5,
  };
}

export function fighterBreakdownLine(fighter: DuelFighterScore): string {
  const { powerPoints, abilityPoints } = fighterPoints(fighter);
  const base = Number(fighter.base) || 0;
  const attack = Number(fighter.attack) || 0;
  const defence = Number(fighter.defence) || 0;
  const total = fighter.total ?? base + powerPoints + abilityPoints + attack + defence;
  return `${fighter.name}: base ${points(base)} + power ${points(powerPoints)} + abilities ${points(
    abilityPoints
  )} + attack ${points(attack)} + defence ${points(defence)} = ${points(total)}`;
}

/** One side's arithmetic, including the skill multiplier only when it applies. */
export function sideTotalLine(part: DuelSideScore | undefined): string {
  if (!part) return '';
  const multiplier = part.multiplier ?? (part.skilled ? 1.5 : 1);
  const raw = Number(part.raw) || 0;
  const numbers = Number(part.numbers) || 0;
  const sum = raw + numbers;
  const score = part.score ?? sum * multiplier;
  if (multiplier === 1) return `raw ${points(raw)} + numbers ${points(numbers)} = ${points(score)}`;
  return `(raw ${points(raw)} + numbers ${points(numbers)}) × ${points(multiplier)} = ${points(score)}`;
}

/** The winner / skill / audit lines. A chosen result never shows a roll. */
export function outcomeNotes(outcome: DuelOutcome, sides: DuelSides): string[] {
  if (outcome.chosenBy) {
    return ['Winner chosen by you — the scores are for comparison, not a roll.'];
  }

  const notes: string[] = [];
  if (outcome.skillSide) notes.push(`More skilled: ${sideNames(sides, outcome.skillSide)}`);

  const audit: string[] = [];
  if (Number.isFinite(outcome.probabilityA)) {
    audit.push(`Win chance for A: ${(outcome.probabilityA * 100).toFixed(1)}%`);
  }
  if (Number.isInteger(outcome.seed)) audit.push(`seed ${outcome.seed}`);
  if (Number.isFinite(outcome.roll)) audit.push(`roll ${Number(outcome.roll).toFixed(4)}`);
  if (audit.length) notes.push(audit.join(' · '));
  return notes;
}
