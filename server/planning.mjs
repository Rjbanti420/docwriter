// Pure planning logic for Chekhov's Guns and Questions.
//
// Deliberately free of any database import: everything here works on plain
// rows, so it can be unit-tested with `node --test` (see planning.test.mjs)
// without opening a project database.

import { splitSentences } from './detect.mjs';

// ---------- chapters ----------

// The number a chapter is shown under. Mirrors the reader's fallback: a blank
// `number` falls back to its 1-based position.
export function effectiveNumber(chapter) {
  const n = String(chapter?.number ?? '').trim();
  if (n) return n;
  const order = Number(chapter?.sort_order);
  return Number.isFinite(order) ? String(order + 1) : '';
}

// Short human label, e.g. "Ch 12" or "Ch 12 — The Gate".
export function chapterLabel(chapter) {
  if (!chapter) return '';
  const num = effectiveNumber(chapter);
  const title = String(chapter?.title ?? '').trim();
  const head = num ? `Ch ${num}` : 'Chapter';
  return title ? `${head} — ${title}` : head;
}

// ---------- Chekhov's Guns ----------

// The chapter a gun's planned payoff resolves to right now, or null when that
// chapter does not exist yet. A gun that already resolved to a real chapter
// stays linked to it by id, so renumbering the chapter does not lose the link;
// until then (or if that chapter is deleted) we fall back to the intended
// number/rank, which may name a chapter the author has not written yet.
export function resolvePlanned(gun, chapters = []) {
  const id = Number(gun?.planned_chapter_id);
  if (Number.isFinite(id) && id > 0) {
    const linked = chapters.find((c) => Number(c.id) === id);
    if (linked) return linked;
  }
  const target = String(gun?.planned_number ?? '').trim();
  if (!target) return null;
  return chapters.find((c) => effectiveNumber(c) === target) ?? null;
}

// A gun is settled once its payoff has been recorded (Used) or the author has
// closed it (Fired); settled guns never notify again. Only Fired is permanent:
// a Used decision can be reopened (`gunReopen`), so it stops the nagging but
// does not lock the gun away.
export function isGunSettled(gun) {
  return !gun || gun.status === 'fired' || gun.outcome === 'used';
}

// True when the gun's planned chapter is now available for review.
export function isGunReady(gun, chapters = []) {
  if (isGunSettled(gun)) return false;
  return resolvePlanned(gun, chapters) != null;
}

// True when this specific chapter is the one the gun was waiting on. A gun
// whose payoff already happened (Used) or that was fired stays quiet.
export function plannedMatchesChapter(gun, chapter) {
  if (isGunSettled(gun)) return false;
  const planned = String(gun?.planned_number ?? '').trim();
  return planned !== '' && planned === effectiveNumber(chapter);
}

// Numeric successor of a chapter number ("14" -> "15"); non-numeric is left
// alone so the author can type the next value.
export function incrementNumber(value) {
  const n = String(value ?? '').trim();
  return /^\d+$/.test(n) ? String(Number(n) + 1) : '';
}

// Apply the outcome of the planned chapter arriving.
//   used      — the gun was paid off; outcome recorded, no more notifications.
//   discussed — raised but not paid off; the plan shifts to the next chapter
//               (default: current number + 1) and the gun re-arms.
// Returns the next gun row plus the history row describing the decision.
export function gunDecide(gun, decision, newNumber = '', chapter = null) {
  const dec = decision === 'used' ? 'used' : 'discussed';
  const from = String(gun?.planned_number ?? '').trim();
  const history = {
    chapter_id: chapter?.id ?? null,
    chapter_label: chapterLabel(chapter),
    decision: dec,
    from_number: from,
    to_number: '',
  };

  if (dec === 'used') {
    return {
      gun: {
        ...gun,
        outcome: 'used',
        planned_chapter_id: chapter?.id ?? gun?.planned_chapter_id ?? null,
      },
      history,
    };
  }

  const to = String(newNumber ?? '').trim() || incrementNumber(from);
  history.to_number = to;
  return {
    gun: { ...gun, outcome: 'discussed', planned_number: to, planned_chapter_id: null },
    history,
  };
}

// Undo a Used decision: the payoff record is revisitable, so the gun goes back
// in play (and will notify again if its planned chapter is still due). Firing
// is the permanent one; it has its own `unfire` reversal.
// Returns the next gun row plus the history row describing the reopen.
export function gunReopen(gun) {
  return {
    gun: { ...gun, outcome: null },
    history: {
      chapter_id: null,
      chapter_label: '',
      decision: 'reopened',
      from_number: String(gun?.planned_number ?? '').trim(),
      to_number: '',
    },
  };
}

// Active guns first, ordered by their planned chapter; fired guns last.
export function sortGuns(guns = []) {
  const numeric = (g) => {
    const n = String(g?.planned_number ?? '').trim();
    return /^\d+$/.test(n) ? Number(n) : null;
  };
  return [...guns].sort((a, b) => {
    const firedA = a?.status === 'fired' ? 1 : 0;
    const firedB = b?.status === 'fired' ? 1 : 0;
    if (firedA !== firedB) return firedA - firedB;

    const na = numeric(a);
    const nb = numeric(b);
    if (na !== null && nb !== null) {
      if (na !== nb) return na - nb;
    } else if (na !== null) {
      return -1;
    } else if (nb !== null) {
      return 1;
    }

    const sa = String(a?.planned_number ?? '').trim();
    const sb = String(b?.planned_number ?? '').trim();
    if (sa !== sb) return sa < sb ? -1 : 1;
    return (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });
}

// ---------- Questions ----------

// Comparison form for dedup: lowercased, punctuation collapsed to spaces.
export function normalizeQuestion(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Open (nothing written), Answered (answer written but not yet delivered), or
// Delivered (the chapter that answers it is set).
export function questionStatus(q) {
  const delivered = q?.delivered_chapter_id;
  if (delivered !== null && delivered !== undefined && delivered !== '') return 'delivered';
  if (String(q?.answer ?? '').trim() !== '') return 'answered';
  return 'open';
}

// Questions a chunk of prose raises: sentences that end in a question mark.
// Dialogue and interior monologue count. Implied mysteries are out of reach of
// this heuristic and are deliberately not guessed at. Returns
// { text, start, end, normalized } spans, deduped within the chunk.
export function detectQuestions(text, splitter = splitSentences) {
  const src = String(text ?? '');
  const out = [];
  const seen = new Set();
  for (const s of splitter(src)) {
    const raw = src.slice(s.start, s.end).trim();
    if (!raw) continue;
    // A question ends in "?", possibly trailed by a closing quote or bracket.
    if (!/\?["'”’)\]]*$/.test(raw)) continue;
    const normalized = normalizeQuestion(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ text: raw, start: s.start, end: s.end, normalized });
  }
  return out;
}

// Keep only candidates whose normalised text is not already known, dropping
// duplicates within the batch as well. `knownNormalized` is the normalised text
// of questions/candidates already stored for the source chapter.
export function dedupeQuestions(candidates = [], knownNormalized = []) {
  const seen = new Set(knownNormalized);
  const kept = [];
  for (const c of candidates) {
    const text = typeof c === 'string' ? c : String(c?.text ?? '');
    const normalized = normalizeQuestion(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    kept.push({ text, normalized });
  }
  return kept;
}
