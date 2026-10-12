// Entity detector. Precision-first: it prefers to miss a name than to flood the
// triage queue. Everything here is heuristic and deliberately simple to tune.

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

// Single capitalized words that should never become an entity on their own.
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
    'monday tuesday wednesday thursday friday saturday sunday ' +
    'january february april june july august september october november december ' +
    'one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty ' +
    'hundred thousand million billion first second third last next other another same such ' +
    'chapter prologue epilogue part section scene act book volume story tale ' +
    'north south east west northern southern eastern western ' +
    'heaven hell earth sun moon stars sky world ' +
    'each every both few many much more most less least several all any some ' +
    'new old good bad great big small long short high low young little large ' +
    'god gods lord lords king kings queen queens prince princess '
  ).split(/\s+/).filter(Boolean)
);

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

const ITEM_KW = new Set([
  'sword', 'blade', 'amulet', 'ring', 'crown', 'stone', 'book', 'scroll',
  'staff', 'wand', 'shield', 'armor', 'armour', 'dagger', 'spear', 'bow',
  'arrow', 'potion', 'elixir', 'tome', 'orb', 'gem', 'jewel', 'relic',
  'artifact', 'artefact', 'key', 'map', 'coin', 'chalice', 'grail', 'hammer',
  'axe', 'helm', 'cloak', 'mask', 'scepter', 'sceptre', 'throne',
]);

const DIALOGUE_VERBS = new Set([
  'said', 'says', 'asked', 'replied', 'answered', 'shouted', 'whispered',
  'muttered', 'murmured', 'told', 'called', 'exclaimed', 'cried', 'laughed',
  'sighed', 'breathed', 'repeated', 'added', 'continued', 'responded',
  'snapped', 'grunted', 'growled', 'hissed', 'barked', 'yelled', 'screamed',
  'mumbled', 'stammered', 'began', 'agreed', 'insisted', 'admitted',
  'announced', 'declared', 'demanded', 'warned', 'noted', 'offered',
  'pleaded', 'promised', 'roared', 'thought', 'wondered', 'mused', 'recalled',
]);

function isCapitalized(w) {
  return /^[A-Z][a-zA-Z'’-]+$/.test(w) && !/^[A-Z]+$/.test(w);
}

function isConnector(w) {
  return CONNECTORS.has(w.toLowerCase());
}

const ABBREVIATIONS = /^(mr|mrs|ms|dr|st|jr|sr|vs|etc|prof|gen|col|sgt|capt|ltd|inc)\.$/i;

function splitSentences(text) {
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
        const lastWord = (before.match(/[A-Za-z]+\.$/) || [])[0];
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
  const re = /[A-Za-z][A-Za-z'’-]*/g;
  const out = [];
  let m;
  while ((m = re.exec(str))) out.push({ word: m[0], offset: m.index });
  return out;
}

export function normalizeKey(phrase) {
  return phrase
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^a-z0-9\s'’-]/g, ' ')
    .replace(/[\s\-_]+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

function contextFor(text, sentence) {
  return text.slice(sentence.start, sentence.end).trim();
}

/**
 * @param {string} text
 * @param {Map<string, number>} entityKeys normalized name/alias -> entity id
 * @param {Set<string>} ignoredKeys
 * @returns {{ candidates: object[], mentions: object[] }}
 */
export function detect(text, entityKeys, ignoredKeys) {
  const sentences = splitSentences(text);
  const groups = new Map();

  for (const sentence of sentences) {
    const slice = text.slice(sentence.start, sentence.end);
    const tokens = tokenize(slice).map((t) => ({ ...t, offset: t.offset + sentence.start }));
    const context = contextFor(text, sentence);
    const hasQuote = /["“”]/.test(slice);
    const dialogueVerb = [...slice.matchAll(/[A-Za-z]+/g)].some((m) =>
      DIALOGUE_VERBS.has(m[0].toLowerCase())
    );

    let i = 0;
    while (i < tokens.length) {
      if (!isCapitalized(tokens[i].word)) {
        i += 1;
        continue;
      }
      const parts = [tokens[i]];
      let j = i + 1;
      while (j < tokens.length) {
        const w = tokens[j].word;
        if (isCapitalized(w)) {
          parts.push(tokens[j]);
          j += 1;
          continue;
        }
        if (isConnector(w)) {
          let k = j;
          while (k < tokens.length && isConnector(tokens[k].word)) k += 1;
          if (k < tokens.length && isCapitalized(tokens[k].word)) {
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

      const firstTok = kept[0];
      const lastTok = kept[kept.length - 1];
      const occurrence = {
        start: firstTok.offset,
        end: lastTok.offset + lastTok.word.length,
        surface: text.slice(firstTok.offset, lastTok.offset + lastTok.word.length),
        context,
        sentenceInitial: firstTok.offset === sentence.start,
        dialogue: hasQuote && dialogueVerb,
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
      for (const o of occurrences) {
        mentions.push({ key: g.key, ...o });
      }
      continue;
    }
    if (ignoredKeys.has(g.key)) continue;

    const words = g.key.split(' ');
    const midSentence = occurrences.some((o) => !o.sentenceInitial);
    const dialogue = occurrences.some((o) => o.dialogue);

    let keywordType = null;
    if (words.some((w) => COUNTRY_KW.has(w))) keywordType = 'Country';
    else if (words.some((w) => ORG_KW.has(w))) keywordType = 'Organisation';
    else if (words.some((w) => LOC_KW.has(w))) keywordType = 'Location';
    else if (words.some((w) => ITEM_KW.has(w))) keywordType = 'Item';

    const signals = [];
    if (occurrences.length >= 5) signals.push('frequent');
    if (midSentence) signals.push('mid-sentence');
    if (dialogue) signals.push('dialogue');
    if (g.words > 1) signals.push('multi-word');
    if (keywordType) signals.push(`keyword:${keywordType.toLowerCase()}`);

    let confidence = 0.25;
    if (occurrences.length >= 3) confidence += 0.15;
    if (occurrences.length >= 8) confidence += 0.15;
    if (midSentence) confidence += 0.2;
    if (dialogue) confidence += 0.2;
    if (g.words > 1) confidence += 0.1;
    if (keywordType) confidence += 0.2;
    confidence = Math.min(0.98, Number(confidence.toFixed(2)));

    candidates.push({
      key: g.key,
      display: g.display,
      occurrences: occurrences.length,
      positions: occurrences,
      contexts: g.contexts,
      signals,
      suggestedType: keywordType || 'Character',
      confidence,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences);
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
export function findLookalike(key, entityKeys) {
  if (key.length < 4) return null;
  for (const known of entityKeys.keys()) {
    if (known === key) return entityKeys.get(known);
    if (Math.abs(known.length - key.length) > 2) continue;
    if (levenshtein(known, key) <= 2 && known.length >= 4) return entityKeys.get(known);
  }
  return null;
}
