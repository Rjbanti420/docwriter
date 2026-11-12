import { splitSentences } from './detect.mjs';

// Event-candidate detection is deliberately narrow: a sentence is proposed only
// when it states a time outright. The author still decides, edits and saves, so
// nothing here can invent a chronology.

const CUES = [
  /\b(?:in|by|during|since|until|before|after|of)\s+(?:the year\s+)?\d{3,4}\b/i,
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|a few|several|many)\s+(?:hours?|days?|weeks?|months?|years?|decades?|centur(?:y|ies))\s+(?:later|earlier|before|after|ago)\b/i,
  /\b(?:hours?|days?|weeks?|months?|years?|decades?|centuries)\s+(?:later|earlier|before|after|ago)\b/i,
  /\b(?:the next|the following|the same)\s+(?:morning|day|night|evening|afternoon|week|month|year)\b/i,
  /\b(?:that|this)\s+(?:morning|day|night|evening|afternoon)\b/i,
  /\b(?:at|by|before|after)\s+(?:dawn|dusk|midnight|noon|sunrise|sunset)\b/i,
];

const MAX_TITLE = 120;

function tidy(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** Shorten at a word boundary so a proposal never ends mid-word. */
function shorten(text, limit = MAX_TITLE) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Propose timeline events from one chapter's text.
 *
 * Returns `{ title, summary, story_time, sentence, start, end }` per distinct
 * sentence that carries an explicit time cue. Questions and very short
 * fragments are ignored: they are not events.
 */
export function extractEventCandidates(text) {
  const source = String(text ?? '');
  if (!source.trim()) return [];
  const seen = new Set();
  const out = [];
  for (const { start, end } of splitSentences(source)) {
    const raw = source.slice(start, end);
    const sentence = tidy(raw);
    if (sentence.length < 12) continue;
    if (sentence.endsWith('?')) continue;
    const words = sentence.split(' ').length;
    if (words < 4) continue;
    const cue = CUES.map((re) => sentence.match(re)).find(Boolean);
    if (!cue) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: shorten(sentence),
      summary: sentence,
      story_time: cue[0],
      sentence,
      start,
      end,
    });
  }
  return out;
}
