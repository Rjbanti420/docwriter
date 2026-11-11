// Entity detector. Precision-first: it prefers to miss a name than to flood the
// triage queue. Candidates are split into two tiers:
//   primary  — has a reason to be a name (dialogue, a type keyword, recurs, or is
//              an unusual capitalised word)
//   demoted  — plausible but weak (usually a capitalised common word); hidden
//              behind "Show more" so a real name is never lost.

const TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'madam', 'madame', 'lord', 'lady',
  'captain', 'commander', 'general', 'colonel', 'sergeant', 'lieutenant',
  'king', 'queen', 'prince', 'princess', 'duke', 'duchess', 'earl', 'count',
  'countess', 'baron', 'baroness', 'father', 'mother', 'brother', 'sister',
  'saint', 'st', 'professor', 'master', 'sheikh', 'emperor', 'empress', 'tsar',
  'sultan', 'president', 'chancellor', 'admiral', 'major', 'private',
]);

const ARTICLES = new Set(['the', 'a', 'an']);

const CONNECTORS = new Set([
  'of', 'de', 'van', 'von', 'der', 'la', 'le', 'da', 'di', 'al', 'el', 'the',
  'and', 'del', 'dos', 'das', 'bin', 'ibn', 'ap', 'mac', 'o', 'y',
]);

// Single capitalised words that should never become an entity on their own.
const STOPWORDS = new Set(
  (
    'the a an and but or nor for yet so if then than that this these those there here ' +
    'when where why how what which who whom whose whenever wherever however ' +
    'he she it they we you i him her them us me my your our their his its ' +
    'is are was were be been being am do does did done doing ' +
    'will would shall should can could may might must ought ' +
    'not no yes nor none nothing something anything everything someone anyone everyone nobody ' +
    'at by in into on onto to from with without within about above across after against along ' +
    'among around as before behind below beneath beside between beyond during except inside near ' +
    'off out outside over past since through throughout till toward towards under underneath until up upon via ' +
    'also even still just only very too well now again once soon later always never often sometimes ' +
    'usually really quite rather almost already perhaps maybe probably certainly indeed instead ' +
    'oh ah eh hmm mm um uh hey hi hello goodbye alright okay ok yeah yep nope please thanks thank welcome sorry ' +
    'ahh ahhh ohh ohhh huh tsk argh arghh ugh oof ouch whoa gah meh ha haha hmph shh mhm ' +
    'monday tuesday wednesday thursday friday saturday sunday ' +
    'january february april june july august september october november december ' +
    'one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty ' +
    'hundred thousand million billion first second third last next other another same such ' +
    'chapter prologue epilogue part section scene act book volume story tale ' +
    'north south east west northern southern eastern western ' +
    'heaven hell earth sun moon stars sky world ' +
    'each every both few many much more most less least several all any some ' +
    'new old good bad great big small long short high low young little large ' +
    'god gods lord lords king kings queen queens prince princess ' +
    "i'm i've i'll i'd you're you've it's that's there's we're they're he's she's " +
    "let's don't didn't doesn't can't won't isn't wasn't aren't weren't couldn't wouldn't shouldn't"
  )
    .split(/\s+/)
    .filter(Boolean)
);

const FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
  'as', 'and', 'or', 'but', 'if', 'not', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'am', 'has', 'have', 'had', 'do', 'does', 'did', 'will',
  'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'your',
  'my', 'his', 'her', 'their', 'our', 'its', 'you', 'we', 'they', 'he', 'she',
  'it', 'this', 'that', 'these', 'those', 'there', 'here', 'when', 'where',
  'why', 'how', 'what', 'which', 'who', 'then', 'than', 'so',
]);

const COUNTRY_KW = new Set([
  'kingdom', 'empire', 'republic', 'federation', 'union', 'nation', 'country',
  'duchy', 'sultanate', 'caliphate', 'dominion', 'principality', 'khanate',
  'emirate', 'commonwealth', 'realm', 'state',
]);
const ORG_KW = new Set([
  'guild', 'order', 'council', 'company', 'church', 'legion', 'house', 'clan',
  'bureau', 'agency', 'ministry', 'academy', 'college', 'school', 'bank',
  'syndicate', 'cartel', 'army', 'navy', 'corps', 'society', 'brotherhood',
  'sisterhood', 'temple', 'cult', 'covenant', 'alliance', 'coalition',
  'faction', 'tribe', 'committee', 'board', 'department', 'watch', 'guard',
  'senate', 'assembly', 'parliament', 'tribunal', 'inquisition', 'conclave',
  'league', 'confederacy', 'foundation', 'institute', 'firm', 'trust',
]);
const LOC_KW = new Set([
  'mount', 'river', 'sea', 'ocean', 'forest', 'wood', 'woods', 'city', 'town',
  'village', 'vale', 'valley', 'mountain', 'mountains', 'lake', 'isle',
  'island', 'port', 'bay', 'road', 'bridge', 'keep', 'castle', 'fort', 'tower',
  'gate', 'harbor', 'harbour', 'desert', 'plain', 'plains', 'swamp', 'marsh',
  'peak', 'ridge', 'coast', 'shore', 'cove', 'glen', 'grove', 'meadow',
  'field', 'fields', 'hill', 'hills', 'canyon', 'pass', 'reef', 'peninsula',
  'falls', 'springs', 'moor', 'heath', 'cavern', 'cave', 'citadel', 'palace',
  'manor', 'estate', 'district', 'quarter', 'street', 'square', 'market',
  'dock', 'docks', 'outpost', 'camp', 'settlement', 'colony', 'province',
  'region', 'frontier', 'wastes', 'barrens',
]);
export const ITEM_KW = new Set([
  'sword', 'blade', 'amulet', 'ring', 'crown', 'stone', 'book', 'scroll',
  'staff', 'wand', 'shield', 'armor', 'armour', 'dagger', 'spear', 'bow',
  'arrow', 'potion', 'elixir', 'tome', 'orb', 'gem', 'jewel', 'relic',
  'artifact', 'artefact', 'key', 'map', 'coin', 'chalice', 'grail', 'hammer',
  'axe', 'helm', 'cloak', 'mask', 'scepter', 'sceptre', 'throne',
]);

const DIALOGUE_VERBS = new Set([
  'said', 'says', 'asked', 'replied', 'answered', 'shouted', 'whispered',
  'muttered', 'murmured', 'told', 'exclaimed', 'cried', 'laughed',
  'sighed', 'breathed', 'repeated', 'added', 'continued', 'responded',
  'snapped', 'grunted', 'growled', 'hissed', 'barked', 'yelled', 'screamed',
  'mumbled', 'stammered', 'began', 'agreed', 'insisted', 'admitted',
  'announced', 'declared', 'demanded', 'warned', 'noted', 'offered',
  'pleaded', 'promised', 'roared', 'thought', 'wondered', 'mused', 'recalled',
]);

const ADVERBS = new Set([
  'softly', 'quietly', 'loudly', 'calmly', 'angrily', 'quickly', 'slowly',
  'coldly', 'warmly', 'sharply', 'flatly', 'tersely', 'sadly', 'happily',
  'nervously', 'anxiously', 'eagerly', 'firmly', 'gently', 'simply',
  'finally', 'suddenly', 'carefully', 'bluntly', 'dryly', 'grimly',
]);

function isCapitalized(w) {
  return /^\p{Lu}[\p{L}\p{M}'’-]+$/u.test(w) && !/^\p{Lu}+$/u.test(w);
}

function isConnector(w) {
  return CONNECTORS.has(w.toLowerCase());
}

// Is this a common English word (including simple inflections and contractions)?
function commonWord(w, dict) {
  if (!w) return false;
  if (dict.has(w)) return true;
  if (/n['’]t$/.test(w)) {
    const b = w.replace(/n['’]t$/, '');
    if (b && (dict.has(b) || STOPWORDS.has(b))) return true;
    const irregular = { ca: 'can', wo: 'will', sha: 'shall' };
    if (irregular[b] && (dict.has(irregular[b]) || STOPWORDS.has(irregular[b]))) return true;
  }
  if (/['’]/.test(w)) {
    const base = w.split(/['’]/)[0];
    if (base && (dict.has(base) || STOPWORDS.has(base))) return true;
  }
  const forms = [];
  if (w.endsWith('ies')) forms.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) forms.push(w.slice(0, -2));
  if (w.endsWith('s')) forms.push(w.slice(0, -1));
  if (w.endsWith('ed')) {
    forms.push(w.slice(0, -2));
    forms.push(w.slice(0, -1));
  }
  if (w.endsWith('ing')) {
    forms.push(w.slice(0, -3));
    forms.push(w.slice(0, -3) + 'e');
  }
  if (w.endsWith('ly')) forms.push(w.slice(0, -2));
  return forms.some((f) => f.length > 1 && dict.has(f));
}

const ABBREVIATIONS = /^(mr|mrs|ms|dr|st|jr|sr|vs|etc|prof|gen|col|sgt|capt|ltd|inc)\.$/i;

export function splitSentences(text) {
  const out = [];
  let start = 0;
  let i = 0;
  const isEnd = (c) => c === '.' || c === '!' || c === '?';
  const push = (s, e) => {
    if (text.slice(s, e).trim()) out.push({ start: s, end: e });
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') {
      push(start, i);
      i += 1;
      start = i;
      continue;
    }
    if (isEnd(c)) {
      let j = i + 1;
      while (j < text.length && '"\')]”’'.includes(text[j])) j += 1;
      const next = j < text.length ? text[j] : '';
      if (next === '' || /\s/.test(next)) {
        const before = text.slice(start, i + 1);
        const lastWord = (before.match(/\p{L}+\.$/u) || [])[0];
        if (!(lastWord && ABBREVIATIONS.test(lastWord))) {
          push(start, j);
          i = j;
          start = j;
          continue;
        }
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  push(start, text.length);
  return out;
}

function tokenize(str) {
  const re = /\p{L}[\p{L}\p{M}'’-]*/gu;
  const out = [];
  let m;
  while ((m = re.exec(str))) out.push({ word: m[0], offset: m.index });
  return out;
}

export function normalizeKey(phrase) {
  return phrase
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ')
    .replace(/[\s\-_]+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

/**
 * @param {string} text
 * @param {Map<string, number>} entityKeys normalized name/alias -> entity id
 * @param {Set<string>} ignoredKeys
 * @param {Set<string>} dictionary
 * @returns {{ candidates: object[], mentions: object[] }}
 */
export function detect(text, entityKeys, ignoredKeys, dictionary = new Set()) {
  const sentences = splitSentences(text);
  const groups = new Map();

  // Whitespace only between two tokens keeps them in one name; punctuation breaks it.
  const adjacent = (a, b) => !/[^\s]/.test(text.slice(a.offset + a.word.length, b.offset));

  for (const sentence of sentences) {
    const slice = text.slice(sentence.start, sentence.end);
    const tokens = tokenize(slice).map((t) => ({ ...t, offset: t.offset + sentence.start }));
    const context = text.slice(sentence.start, sentence.end).trim();
    // Dialogue attribution only: a dialogue verb within two tokens of the name
    // ("Kael said", "said Kael"). A quote somewhere in the sentence is too coarse
    // and would tag every common word in dialogue-heavy prose.
    const dialogueNear = (idx) =>
      idx >= 0 && idx < tokens.length && DIALOGUE_VERBS.has(tokens[idx].word.toLowerCase());
    const isAdverb = (idx) =>
      idx >= 0 &&
      idx < tokens.length &&
      (/ly$/.test(tokens[idx].word.toLowerCase()) || ADVERBS.has(tokens[idx].word.toLowerCase()));

    let i = 0;
    while (i < tokens.length) {
      if (!isCapitalized(tokens[i].word)) {
        i += 1;
        continue;
      }
      // A sentence-initial common word must not swallow the next capitalised
      // word ("Then Kael ..." is not the entity "Then Kael").
      if (i === 0 && STOPWORDS.has(tokens[i].word.toLowerCase())) {
        i += 1;
        continue;
      }
      const parts = [tokens[i]];
      let j = i + 1;
      while (j < tokens.length) {
        const prev = parts[parts.length - 1];
        const cur = tokens[j];
        if (!adjacent(prev, cur)) break; // punctuation ends the name
        const w = cur.word;
        if (isCapitalized(w)) {
          parts.push(cur);
          j += 1;
          continue;
        }
        if (isConnector(w)) {
          let k = j;
          let last = prev;
          let ok = true;
          while (k < tokens.length && isConnector(tokens[k].word)) {
            if (!adjacent(last, tokens[k])) {
              ok = false;
              break;
            }
            last = tokens[k];
            k += 1;
          }
          if (ok && k < tokens.length && isCapitalized(tokens[k].word) && adjacent(last, tokens[k])) {
            for (let x = j; x <= k; x += 1) parts.push(tokens[x]);
            j = k + 1;
            continue;
          }
        }
        break;
      }

      // Strip a leading title/article ("Captain Kael" -> "Kael").
      let first = 0;
      while (
        parts.length - first > 1 &&
        (TITLES.has(parts[first].word.toLowerCase()) || ARTICLES.has(parts[first].word.toLowerCase()))
      ) {
        first += 1;
      }
      const kept = parts.slice(first);
      const surfaceWords = kept.map((p) => p.word);
      const phrase = surfaceWords.join(' ');
      const key = normalizeKey(phrase);

      if (!key) {
        i = j;
        continue;
      }
      const single = kept.length === 1;
      if (single && STOPWORDS.has(key)) {
        i = j;
        continue;
      }
      // Stammers like "T-There", "H-he", "I-I" are not names.
      if (single && /-/.test(kept[0].word) && kept[0].word.split('-')[0].length <= 1) {
        i = j;
        continue;
      }

      const firstTok = kept[0];
      const lastTok = kept[kept.length - 1];
      const keptStart = i + first;
      const keptEnd = keptStart + kept.length - 1;
      const attributed =
        dialogueNear(keptEnd + 1) ||
        dialogueNear(keptStart - 1) ||
        (isAdverb(keptEnd + 1) && dialogueNear(keptEnd + 2)) ||
        (isAdverb(keptStart - 1) && dialogueNear(keptStart - 2));
      const occurrence = {
        start: firstTok.offset,
        end: lastTok.offset + lastTok.word.length,
        surface: text.slice(firstTok.offset, lastTok.offset + lastTok.word.length),
        context,
        sentenceInitial: firstTok.offset === sentence.start,
        dialogue: attributed,
      };

      let g = groups.get(key);
      if (!g) {
        g = { key, display: phrase, words: kept.length, occurrences: [], contexts: [] };
        groups.set(key, g);
      }
      g.occurrences.push(occurrence);
      if (g.contexts.length < 3 && !g.contexts.includes(context)) g.contexts.push(context);

      i = j;
    }
  }

  const candidates = [];
  const mentions = [];

  for (const g of groups.values()) {
    const occurrences = g.occurrences;
    if (entityKeys.has(g.key)) {
      for (const o of occurrences) mentions.push({ key: g.key, ...o });
      continue;
    }
    if (ignoredKeys.has(g.key)) continue;

    const words = g.key.split(' ');
    const isSingle = g.words === 1;
    const midSentence = occurrences.some((o) => !o.sentenceInitial);
    const dialogue = occurrences.some((o) => o.dialogue);

    let keywordType = null;
    if (words.some((w) => COUNTRY_KW.has(w))) keywordType = 'Country';
    else if (words.some((w) => ORG_KW.has(w))) keywordType = 'Organisation';
    else if (words.some((w) => LOC_KW.has(w))) keywordType = 'Location';
    else if (words.some((w) => ITEM_KW.has(w))) keywordType = 'Item';

    const isDict = isSingle
      ? commonWord(g.key, dictionary)
      : words.every((w) => CONNECTORS.has(w) || commonWord(w, dictionary));
    const anyNonDict = words.some((w) => w.length >= 3 && !CONNECTORS.has(w) && !commonWord(w, dictionary));
    const sentenceLike = words.some((w) => FUNCTION_WORDS.has(w));

    // Level 1 (dictionary) + Level 2 (signal gating).
    const strong =
      dialogue ||
      !!keywordType ||
      (isSingle && !isDict && g.key.length >= 3 && (midSentence || occurrences.length >= 2)) ||
      (isSingle && isDict && occurrences.length >= 4) ||
      (!isSingle && anyNonDict && !sentenceLike);

    const signals = [];
    if (occurrences.length >= 5) signals.push('frequent');
    if (midSentence) signals.push('mid-sentence');
    if (dialogue) signals.push('dialogue');
    if (g.words > 1) signals.push('multi-word');
    if (isDict) signals.push('common-word');
    if (keywordType) signals.push(`keyword:${keywordType.toLowerCase()}`);
    if (!strong) signals.push('weak');

    let confidence = 0.25;
    if (occurrences.length >= 3) confidence += 0.15;
    if (occurrences.length >= 8) confidence += 0.15;
    if (midSentence) confidence += 0.2;
    if (dialogue) confidence += 0.2;
    if (g.words > 1) confidence += 0.1;
    if (keywordType) confidence += 0.2;
    if (isDict) confidence -= 0.15;
    if (!strong) confidence -= 0.2;
    confidence = Math.max(0.05, Math.min(0.98, Number(confidence.toFixed(2))));

    candidates.push({
      key: g.key,
      display: g.display,
      occurrences: occurrences.length,
      positions: occurrences,
      contexts: g.contexts,
      signals,
      suggestedType: keywordType || 'Character',
      confidence,
      tier: strong ? 'primary' : 'demoted',
    });
  }

  const rank = { primary: 0, demoted: 1 };
  candidates.sort(
    (a, b) =>
      rank[a.tier] - rank[b.tier] || b.confidence - a.confidence || b.occurrences - a.occurrences
  );
  return { candidates, mentions };
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// Candidate names that look like something we already know (typo / variant).
//
// Only a *unique* best match is offered. Two names within the same distance of
// the candidate (Kael / Kaela, Aria / Aryan) mean we cannot tell which one the
// writer meant, and "same thing" merges two cards with no undo — so an ambiguous
// match is dropped rather than guessed at.
// Known keys grouped by length once per scan. A candidate can only match a key
// within two characters, so each call then walks at most five small buckets
// instead of every live name.
export function buildLookalikeIndex(entityKeys) {
  const byLength = new Map();
  for (const known of entityKeys.keys()) {
    if (known.length < 4) continue;
    const bucket = byLength.get(known.length);
    if (bucket) bucket.push(known);
    else byLength.set(known.length, [known]);
  }
  return byLength;
}

export function findLookalike(key, entityKeys, index = buildLookalikeIndex(entityKeys)) {
  if (key.length < 4) return null;
  if (entityKeys.has(key)) return entityKeys.get(key);

  let best = Infinity;
  let bestId = null;
  const tied = new Set();
  for (let length = key.length - 2; length <= key.length + 2; length += 1) {
    for (const known of index.get(length) ?? []) {
      const d = levenshtein(known, key);
      if (d > 2) continue;
      const id = entityKeys.get(known);
      if (d < best) {
        best = d;
        bestId = id;
        tied.clear();
        tied.add(id);
      } else if (d === best) {
        tied.add(id); // same entity reached twice is fine; a different one is not
      }
    }
  }
  return tied.size === 1 ? bestId : null;
}
