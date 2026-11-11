// Chekhov's-gun detector. Precision-first: a chapter gets at most two primary
// suggestions, and only when the prose gives the object a reason to come back
// (it is handled, described, repeated, or wrapped in promise language).
//
// This is deliberately pure. The route supplies known entities and the titles
// already tracked, so the same function runs in tests without a database.

import { ITEM_KW, normalizeKey, splitSentences } from './detect.mjs';

// Everyday objects the entity detector's fantasy-leaning list does not cover.
const OBJECT_NOUNS = new Set([
  ...ITEM_KW,
  'bag', 'ball', 'bandage', 'basin', 'basket', 'battery', 'bead', 'bell', 'belt', 'bicycle',
  'bottle', 'box', 'bracelet', 'brick', 'briefcase', 'brush', 'bucket', 'button',
  'camera', 'candle', 'cane', 'card', 'carpet', 'cart', 'case', 'chain', 'chair',
  'chest', 'cigarette', 'clock', 'clothes', 'coat', 'comb', 'compass', 'cord',
  'cup', 'curtain', 'cushion', 'dagger', 'desk', 'diary', 'doll', 'door', 'dress',
  'drink', 'earring', 'envelope', 'flask', 'food', 'fork', 'frame', 'gear',
  'glass', 'glove', 'gun', 'hairpin', 'hammer', 'handkerchief', 'hat', 'helmet',
  'hook', 'horn', 'horse', 'ink', 'jar', 'jewel', 'journal', 'key', 'knife', 'knob',
  'ladder', 'lamp', 'lantern', 'letter', 'lock', 'locket', 'magnet', 'mask', 'match',
  'medal', 'meter', 'mirror', 'necklace', 'needle', 'note', 'paint', 'paper', 'pen',
  'pencil', 'pendant', 'penny', 'phone', 'photograph', 'picture', 'pill', 'pin', 'pipe',
  'pistol', 'plate', 'potion', 'purse', 'radio', 'rag', 'ribbon',
  'ring', 'rope', 'rose', 'sack', 'scarf', 'scissors', 'screw', 'scroll',
  'seal', 'shirt', 'shoe', 'shovel', 'sign', 'sketch', 'skull', 'soap', 'sock',
  'spade', 'spoon', 'statue', 'stick', 'stocking', 'stone', 'suit', 'sword',
  'ticket', 'tie', 'towel', 'toy', 'tray', 'umbrella', 'vase', 'vest', 'watch',
  'weapon', 'wheel', 'whistle', 'wire', 'wristband',
]);

// Abstract things can be guns too, but only with an explicit promise or repeat.
const ABSTRACT_NOUNS = new Set([
  'ability', 'answer', 'bargain', 'clue', 'contract', 'curse', 'debt', 'favor',
  'fear', 'gift', 'grudge', 'information', 'lie', 'memory', 'mystery', 'name',
  'oath', 'password', 'plan', 'promise', 'prophecy', 'recipe', 'rule', 'secret',
  'skill', 'song', 'story', 'talent', 'technique', 'truth', 'weakness', 'word',
]);

// Setting and body words. They are real nouns, but they are everywhere in prose
// and make terrible primary suggestions.
const GENERIC = new Set([
  'air', 'arm', 'back', 'bed', 'blood', 'body', 'chair', 'chest', 'city', 'corridor',
  'country', 'day', 'desk', 'door', 'dream', 'earth', 'eye', 'face', 'fire', 'floor',
  'food', 'foot', 'ground', 'hair', 'hand', 'head', 'heart', 'house', 'land', 'leg',
  'light', 'man', 'moon', 'morning', 'night', 'object', 'place', 'rain', 'road',
  'room', 'sky', 'sound', 'star', 'street', 'sun', 'table', 'thing', 'time', 'town',
  'voice', 'wall', 'water', 'window', 'woman', 'world',
]);

const DETERMINERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'his', 'her', 'their', 'my',
  'your', 'our', 'its',
]);

const CONSUMABLE = new Set(['soap', 'food', 'drink', 'cigarette', 'pill']);

const MODIFIERS = new Set([
  'ancient', 'black', 'blue', 'brass', 'brand', 'bright', 'broken', 'brown', 'chipped',
  'cold', 'copper', 'cracked', 'dark', 'dead', 'dirty', 'dry', 'dusty', 'empty',
  'faded', 'familiar', 'fine', 'folded', 'fresh', 'glass', 'gold', 'golden', 'gray',
  'great', 'green', 'heavy', 'hidden', 'holy', 'iron', 'large', 'leather', 'little',
  'locked', 'long', 'loose', 'metallic', 'moist', 'new', 'old', 'ornate', 'pale', 'paper',
  'plain', 'red', 'rich', 'rough', 'rusted', 'silver', 'small', 'smooth', 'soft',
  'steel', 'stone', 'strange', 'tattered', 'thin', 'tiny', 'top', 'torn',
  'transparent', 'warm', 'white', 'wood', 'wooden', 'worn', 'yellow', 'yellowed', 'exposed',
]);

const COMPOUND = new Set([
  'bath', 'bed', 'belt', 'bottle', 'brass', 'candle', 'chain', 'copper', 'desk',
  'door', 'dressing', 'drinking', 'gas', 'glass', 'hand', 'ink', 'iron', 'kitchen', 'lamp',
  'leather', 'meal', 'moon', 'paint', 'paper', 'pocket', 'rain', 'silver', 'steel',
  'stone', 'table', 'tea', 'wall', 'walking', 'water', 'window', 'wood', 'writing',
]);

const ACTION_WORDS =
  /\b(took|take|taking|picked|pick|pocketed|pocket|tucked|tuck|slipped|slip|carried|carry|held|hold|kept|keep|wore|wear|gripped|grip|grabbed|grab|clutched|clutch|reached|reach|placed|place|put|hid|hide|found|find|gave|give|handed|hand|opened|open|closed|close|locked|lock|unlocked|drew|draw|pulled|pull|inspected|inspect|examined|examine|studied|study|checked|check|twisted|twist|turned|turn|used|use|lit|light|ignited|ignite)\b/i;
const ACQUIRE_WORDS =
  /\b(took|take|picked|pulled|drew|grabbed|snatched|received|found|bought|stole|handed|gave)\b/i;

const PROMISE_WORDS =
  /\b(will|would|shall|should|must|might|could|one day|someday|soon|later|again|still|never|ever|if|until|unless|remember|forgot|forgotten|kept|keep|need|needed|only|important|promise|promised|warned|warn|owe|owed|return|returned|pay|paid|waiting|waited|ready|yet)\b/i;

const SIMILE_WORDS = /\b(like|as if|as though)\b/i;
const PART_WORDS =
  /\b(part of|inside|internals|front of|right of|left of|beneath|above|behind|connected to|edge of|surface of|side of|bottom of|top of)\b/i;
const DESCRIPTIVE_WORDS =
  /\b(old|new|small|tiny|little|large|big|heavy|light|sharp|blunt|brass|copper|silver|gold|golden|iron|steel|wooden|glass|paper|leather|black|white|red|blue|green|yellow|dark|bright|cold|warm|worn|tattered|chipped|cracked|broken|locked|sealed|ornate|plain|strange|odd|familiar|brand|beautiful|ugly|dirty|clean|ancient|holy|cursed)\b/i;

const POSSESSIVE = /^\p{L}[\p{L}\p{M}'’-]*['’]s$/u;

function singular(word) {
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes') || word.endsWith('ches') || word.endsWith('shes'))
    return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function objectKind(word) {
  const base = singular(word);
  if (OBJECT_NOUNS.has(word) || OBJECT_NOUNS.has(base)) return 'object';
  if (ABSTRACT_NOUNS.has(word) || ABSTRACT_NOUNS.has(base)) return 'abstract';
  return null;
}

function isModifier(word) {
  const w = word.toLowerCase();
  return DETERMINERS.has(w) || MODIFIERS.has(w) || COMPOUND.has(w) || POSSESSIVE.test(word);
}

function tokenize(str) {
  const re = /\p{L}[\p{L}\p{M}'’-]*/gu;
  const out = [];
  let m;
  while ((m = re.exec(str))) out.push({ word: m[0], offset: m.index });
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// splitSentences returns sorted, non-overlapping ranges; binary search keeps a
// chapter with hundreds of name matches off a linear sentence scan per match.
function sentenceAt(sentences, offset) {
  let lo = 0;
  let hi = sentences.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].start <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  const sentence = sentences[found];
  return offset < sentence.end ? sentence : null;
}

/** Comparison form used for global ignore and duplicate suppression. */
export function normalizeGunTitle(text) {
  const words = normalizeKey(String(text ?? ''))
    .replace(/\b(?:his|her|their|my|your|our|its)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  // A rejected plural must also keep its singular out of later scans, and vice
  // versa ("Weapons" then "A weapon").
  const last = words.at(-1) ?? '';
  const single = singular(last);
  if (single !== last && (OBJECT_NOUNS.has(single) || ABSTRACT_NOUNS.has(single))) words[words.length - 1] = single;
  return words.join(' ');
}

function phraseTitle(words) {
  const title = words.join(' ').replace(/\s+/g, ' ').trim();
  return title ? title[0].toUpperCase() + title.slice(1) : '';
}

/**
 * Find the few objects in a chapter that look planted rather than scenery.
 *
 * @param {string} text
 * @param {{
 *   entities?: Array<{name: string, typeName?: string, aliases?: string[]}>,
 *   excluded?: string[],
 *   existingGuns?: string[],
 * }} [opts]
 * @returns {Array<{title: string, normalized: string, excerpt: string, score: number,
 *   signals: string[], tier: 'primary'|'more', occurrences: number}>}
 */
export function detectGunCandidates(text, opts = {}) {
  const src = String(text ?? '');
  const entities = Array.isArray(opts.entities) ? opts.entities : [];
  const excluded = new Set((opts.excluded ?? []).map(normalizeGunTitle).filter(Boolean));
  const existing = (opts.existingGuns ?? []).map(normalizeGunTitle).filter(Boolean);
  const isTrackedGun = (normalized) =>
    existing.some((title) => title === normalized || title.includes(normalized));

  const sentences = splitSentences(src);
  const groups = new Map();

  const add = (candidate) => {
    const norm = normalizeGunTitle(candidate.title);
    if (!norm || excluded.has(norm) || isTrackedGun(norm)) return;
    const prev = groups.get(norm);
    if (prev) {
      prev.occurrences += 1;
      prev.score = Math.max(prev.score, candidate.score);
      for (const s of candidate.signals) if (!prev.signals.includes(s)) prev.signals.push(s);
      return;
    }
    groups.set(norm, { ...candidate, normalized: norm, occurrences: 1 });
  };

  // Known Items, locations and organisations are high-precision mentions. One
  // combined alternation scans the chapter once instead of once per entity name;
  // longest names come first so a title is not cut short by its own prefix.
  const known = [];
  for (const e of entities) {
    if (e?.typeName === 'Character') continue;
    const type = String(e?.typeName ?? '');
    const base = type === 'Item' ? 5 : type === 'Location' ? 2.5 : 1.5;
    const names = [e?.name, ...(e?.aliases ?? [])].map((x) => String(x ?? '').trim()).filter(Boolean);
    const seen = new Set();
    for (const name of names) {
      const n = normalizeGunTitle(name);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      known.push({ entity: e, type, base, name, normalized: n });
    }
  }
  known.sort((a, b) => b.name.length - a.name.length);
  if (known.length) {
    const alternatives = known.map((entry) => `(${escapeRe(entry.name).replace(/\s+/g, '\\s+')})`);
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`,
      'giu'
    );
    let m;
    while ((m = re.exec(src))) {
      const index = m.slice(1).findIndex((part) => part !== undefined);
      if (index < 0) continue;
      const entry = known[index];
      const sentence = sentenceAt(sentences, m.index);
      if (!sentence) continue;
      const context = src.slice(sentence.start, sentence.end).trim();
      const lower = context.toLowerCase();
      signalCandidate({
        title: String(entry.entity.name),
        base: entry.base,
        category: entry.type === 'Item' ? 'object' : 'place',
        head: `${entry.type === 'Item' ? 'object' : 'place'}:${entry.normalized}`,
        context,
        sentence,
        start: m.index,
        end: m.index + m[0].length,
        add,
        extra: {
          sim: SIMILE_WORDS.test(lower),
          promise: PROMISE_WORDS.test(lower),
          action: ACTION_WORDS.test(lower),
          dialogue: /["“”]/.test(context),
          paragraphEnd: /^\s*\n\s*\n/.test(src.slice(sentence.end)) || src.slice(sentence.end).trim() === '',
          detailed: DESCRIPTIVE_WORDS.test(lower),
          part: PART_WORDS.test(lower),
          known: true,
        },
      });
    }
  }

  for (const sentence of sentences) {
    const raw = src.slice(sentence.start, sentence.end);
    const tokens = tokenize(raw);
    if (!tokens.length) continue;
    const context = raw.trim();
    const lower = context.toLowerCase();
    const sim = SIMILE_WORDS.test(lower);
    const promise = PROMISE_WORDS.test(lower);
    const action = ACTION_WORDS.test(lower);
    const dialogue = /["“”]/.test(context);
    const paragraphEnd = /^\s*\n\s*\n/.test(src.slice(sentence.end)) || src.slice(sentence.end).trim() === '';

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const kind = objectKind(token.word.toLowerCase());
      if (!kind) continue;

      // "ink bottle", "wall lamp": the first noun is a compound modifier, not
      // the thing itself.
      const next = tokens[i + 1];
      if (next) {
        const between = raw.slice(token.offset + token.word.length, next.offset);
        const nextWord = next.word.toLowerCase();
        if (/^[\s'’-]*$/.test(between) && (objectKind(nextWord) || GENERIC.has(singular(nextWord)))) continue;
      }

      let start = i;
      let j = i - 1;
      while (j >= 0 && i - j <= 3) {
        const prev = tokens[j];
        if (!isModifier(prev.word)) break;
        // A modifier needs a determiner or another modifier in front of it;
        // otherwise "gas lamp" still works through COMPOUND.
        start = j;
        j -= 1;
      }
      if (start === i && !OBJECT_NOUNS.has(singular(token.word.toLowerCase()))) continue;

      const words = tokens.slice(start, i + 1).map((t) => t.word);
      const title = phraseTitle(words);
      const head = token.word.toLowerCase();
      if (GENERIC.has(singular(head))) continue;
      const base = kind === 'object' ? 3 : 2;
      signalCandidate({
        title,
        base,
        category: kind,
        head: `${kind}:${singular(head)}`,
        context,
        sentence,
        start: sentence.start + tokens[start].offset,
        end: sentence.start + token.offset + token.word.length,
        add,
        extra: {
          sim,
          promise,
          action,
          dialogue,
          paragraphEnd,
          detailed: words.length >= 3 || DESCRIPTIVE_WORDS.test(lower),
          plural: /s$/.test(head) && !/ss$/.test(head),
          part: PART_WORDS.test(lower),
          bare: !DETERMINERS.has(tokens[start].word.toLowerCase()) && !POSSESSIVE.test(tokens[start].word),
        },
      });
    }
  }

  // A known character's name may still be a substring of an object phrase
  // ("Klein's gas lamp"); only the object survives because characters are skipped.
  let out = [...groups.values()];
  const byHead = new Map();
  for (const candidate of out) {
    const prev = byHead.get(candidate.head);
    if (!prev) {
      byHead.set(candidate.head, { ...candidate, signals: [...candidate.signals] });
      continue;
    }
    prev.occurrences += candidate.occurrences;
    if (candidate.score > prev.score) {
      prev.title = candidate.title;
      prev.normalized = candidate.normalized;
      prev.excerpt = candidate.excerpt;
    }
    prev.score = Math.max(prev.score, candidate.score);
    for (const s of candidate.signals) if (!prev.signals.includes(s)) prev.signals.push(s);
  }
  out = [...byHead.values()].map((c) => {
    const repeat = c.occurrences >= 2 ? 2.5 + Math.min(1.5, (c.occurrences - 2) * 0.5) : 0;
    const signals = repeat && !c.signals.includes('repeated') ? [...c.signals, 'repeated'] : c.signals;
    return { ...c, signals, score: Number((c.score + repeat).toFixed(2)), tier: 'more' };
  });
  out.sort((a, b) => b.score - a.score || b.occurrences - a.occurrences || a.title.localeCompare(b.title));
  const pluralTitle = (c) => {
    const last = c.title.trim().split(/\s+/).at(-1)?.toLowerCase() ?? '';
    return /s$/.test(last) && !/ss$/.test(last);
  };
  const primary = out
    .filter(
      (c) =>
        c.score >= 6 &&
        !pluralTitle(c) &&
        (c.occurrences >= 2 || c.signals.includes('known') || c.signals.includes('promise'))
    )
    .slice(0, 2);
  // No anchor candidate means no suggestion at all. Weak objects alone would
  // turn the review list into scenery.
  if (primary.length === 0) return [];
  const more = out.filter((c) => !primary.includes(c) && c.score >= 4).slice(0, 4);
  return [...primary, ...more].map((c) => ({ ...c, tier: primary.includes(c) ? 'primary' : 'more' }));
}

function signalCandidate({ title, base, category, head, context, sentence, start, end, add, extra = {} }) {
  const lower = context.toLowerCase();
  const sim = extra.sim ?? SIMILE_WORDS.test(lower);
  const promise = extra.promise ?? PROMISE_WORDS.test(lower);
  const action = extra.action ?? ACTION_WORDS.test(lower);
  const dialogue = extra.dialogue ?? /["“”]/.test(context);
  const paragraphEnd =
    extra.paragraphEnd ?? (/^\s*\n\s*\n/.test(context) || context.trim() === '');
  const detailed = extra.detailed ?? DESCRIPTIVE_WORDS.test(lower);
  const words = title.trim().split(/\s+/).length;
  const firstWord = title.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const possessed =
    /^(his|her|their|my|your|our|its)$/.test(firstWord) || /['’]s\b/.test(title);
  const headWord = String(head ?? '').split(':')[1] ?? '';
  const acquired = ACQUIRE_WORDS.test(lower);
  const signals = [];
  let score = base;

  if (extra.known) signals.push('known');
  if (possessed) {
    score += 2;
    signals.push('possessed');
  }
  if (action) {
    score += 2;
    signals.push('handled');
  }
  if (acquired) {
    score += 1.5;
    signals.push('acquired');
  }
  if (detailed) {
    score += words >= 4 ? 2 : 1.2;
    signals.push('described');
  }
  if (promise) {
    score += 2.5;
    signals.push('promise');
  }
  if (paragraphEnd) {
    score += 1.5;
    signals.push('paragraph-end');
  }
  if (dialogue) {
    score += 0.5;
    signals.push('dialogue');
  }
  if (sim) {
    score -= 3;
    signals.push('simile');
  }
  if (extra.plural) {
    score -= 1.2;
    signals.push('plural');
  }
  if (extra.part) {
    score -= 1.2;
    signals.push('part');
  }
  if (extra.bare) {
    score -= 2.5;
    signals.push('bare');
  }
  if (CONSUMABLE.has(headWord)) {
    score -= 1;
    signals.push('consumable');
  }
  if (category === 'abstract' && !promise) score -= 2;
  if (category === 'place' && !promise && action === false) score -= 1;

  add({
    title,
    head,
    excerpt: context.slice(0, 320),
    score,
    signals,
    start,
    end,
  });
}
