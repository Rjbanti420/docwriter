// Markdown export renderer — pure formatting, no database.
//
// The route hands it display-ready strings (names already resolved from ids, so
// the file never contains a bare "#7"), and this file owns every heading, bullet
// and blank line. Keeping it separate is what makes the shape of the export
// testable without starting a server.
//
// A "card" is one Bible entry or one Chekhov's gun; a duel uses its own compact
// snapshot block:
//   { name, lines: [string], sections: [{ heading, body?, items?: [{name?, body?}] }] }
// Everything blank is dropped, so an empty book still produces a valid file.

function comma(n) {
  return String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Trim a text body, normalising line endings; '' when there is nothing to show. */
function prose(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

/** Collapse a value onto one line, for a bullet. */
function inline(text) {
  return prose(text).replace(/\s*\n\s*/g, ' ');
}

/** 18 -> "18", 25.5 -> "25.5"; matches the card's score labels. */
function numberLabel(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function sideNames(sides, side) {
  const fighters = Array.isArray(sides?.[side]) ? sides[side] : [];
  return joinNames(fighters.map((fighter) => inline(fighter?.name)).filter(Boolean));
}

/** One fighter on one line: name, abilities in stored order, then Items. */
function duelFighterLine(side, fighter) {
  const name = inline(fighter?.name) || 'the fighter';
  const dead = fighter?.dead ? ' (dead)' : '';
  const abilities = (Array.isArray(fighter?.abilities) ? fighter.abilities : [])
    .map((ability) => (typeof ability === 'string' ? ability : ability?.name))
    .map(inline)
    .filter(Boolean);
  const items = (Array.isArray(fighter?.items) ? fighter.items : [])
    .map((item) => {
      const itemName = inline(item?.name);
      if (!itemName) return '';
      const role = ['offense', 'defense', 'both', 'none'].includes(String(item?.role ?? '').toLowerCase())
        ? String(item.role).toLowerCase()
        : 'both';
      const rank = inline(item?.rank) || 'Unranked';
      return `${itemName} (${role}, ${rank})`;
    })
    .filter(Boolean);

  const parts = [`Side ${side}: ${name}${dead}`];
  if (abilities.length) parts.push(`Abilities: ${abilities.join(', ')}`);
  if (items.length) parts.push(`Items: ${items.join(', ')}`);
  return `- ${parts.join(' — ')}`;
}

function duelMarkdown(duel) {
  const sides = duel?.sides ?? {};
  const outcome = duel?.outcome ?? {};
  const out = [`#### ${inline(duel?.title) || 'Duel'}`];

  const created = String(duel?.created_at ?? '').slice(0, 10);
  const terrain = inline(sides?.terrain);
  const meta = [];
  if (created) meta.push(`Created: ${created}`);
  if (terrain) meta.push(`Terrain: ${terrain}`);
  if (meta.length) out.push(`- ${meta.join(' · ')}`);

  for (const side of ['A', 'B']) {
    const fighters = Array.isArray(sides?.[side]) ? sides[side] : [];
    for (const fighter of fighters) out.push(duelFighterLine(side, fighter));
  }

  const winnerSide = outcome?.winnerSide === 'B' ? 'B' : 'A';
  out.push(`- Winner: ${sideNames(sides, winnerSide) || `Side ${winnerSide}`}`);
  if (outcome?.chosenBy) {
    out.push('- Winner chosen by you');
  } else if (outcome?.skillSide) {
    out.push(`- More skilled: ${sideNames(sides, outcome.skillSide) || `Side ${outcome.skillSide}`}`);
  }

  const scores = outcome?.scores ?? {
    A: outcome?.breakdown?.A?.score,
    B: outcome?.breakdown?.B?.score,
  };
  if (scores?.A != null && scores?.B != null) {
    out.push(`- Scores: ${numberLabel(scores.A)} vs ${numberLabel(scores.B)}`);
  }

  if (!outcome?.chosenBy) {
    const audit = [];
    if (outcome?.probabilityA != null && Number.isFinite(Number(outcome.probabilityA))) {
      audit.push(`Win chance for A ${(Number(outcome.probabilityA) * 100).toFixed(1)}%`);
    }
    if (outcome?.seed != null && Number.isInteger(Number(outcome.seed))) audit.push(`seed ${outcome.seed}`);
    if (outcome?.roll != null && Number.isFinite(Number(outcome.roll))) {
      audit.push(`roll ${Number(outcome.roll).toFixed(4)}`);
    }
    if (audit.length) out.push(`- ${audit.join(' · ')}`);
  }

  const narrative = prose(duel?.narrative);
  if (narrative) out.push('', narrative);
  return out.join('\n');
}

function cardMarkdown(card) {
  const out = [`#### ${card.name}`];
  for (const line of card.lines ?? []) out.push(`- ${line}`);
  for (const section of card.sections ?? []) {
    const body = prose(section.body);
    const items = (section.items ?? []).filter((i) => prose(i.name) || prose(i.body));
    if (!body && items.length === 0) continue;
    out.push('', `**${section.heading}**`);
    if (body) out.push('', body);
    for (const item of items) {
      const name = inline(item.name);
      const text = inline(item.body);
      if (name && text) out.push(`- **${name}** — ${text}`);
      else out.push(`- ${name || text}`);
    }
  }
  return out.join('\n');
}

export function* renderBookMarkdownChunks(data) {
  const {
    exportedAt = '',
    chapters = [],
    groups = [],
    guns = [],
    questions = [],
    duels = [],
    powerLevels = [],
    types = [],
  } = data ?? {};

  const words = chapters.reduce((n, c) => n + (Number(c.wordCount) || 0), 0);
  const entities = groups.reduce((n, g) => n + g.cards.length, 0);
  const plural = (n, word, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

  const counts = [
    plural(chapters.length, 'chapter'),
    `${comma(words)} words`,
    plural(entities, 'entity', 'entities'),
    plural(guns.length, 'gun'),
    plural(questions.length, 'question'),
  ];
  if (exportedAt) counts.push(`exported ${exportedAt}`);

  const manuscript = ['# DocWriter export', '', `_${counts.join(' · ')}_`, '', '## Manuscript'];
  if (chapters.length === 0) manuscript.push('', '_No chapters yet._');
  yield manuscript;
  for (const chapter of chapters) {
    const label = [chapter.number, chapter.title]
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .join('. ');
    const lines = ['', `### ${label || 'Untitled chapter'}`];
    if (chapter.wordCount) lines.push('', `_${comma(chapter.wordCount)} words_`);
    const text = prose(chapter.text);
    if (text) lines.push('', text);
    yield lines;
  }

  if (entities === 0) {
    yield ['', '## Bible', '', '_No entities yet._'];
  } else {
    yield ['', '## Bible'];
    for (const group of groups) {
      yield ['', `### ${group.typeName}`];
      for (const card of group.cards) yield ['', cardMarkdown(card)];
    }
  }

  if (guns.length === 0) {
    yield ['', '## Planning', '', "### Chekhov's Guns", '', '_No guns yet._'];
  } else {
    yield ['', '## Planning', '', "### Chekhov's Guns"];
    for (const gun of guns) yield ['', cardMarkdown(gun)];
  }

  if (questions.length === 0) {
    yield ['', '### Questions', '', '_No questions yet._'];
  } else {
    yield ['', '### Questions'];
    for (const q of questions) {
      const lines = ['', `- **[${q.status}]** ${inline(q.text)}`];
      if (q.source) lines.push(`  - Raised in ${q.source}`);
      if (q.delivered) lines.push(`  - Delivered in ${q.delivered}`);
      const answer = inline(q.answer);
      if (answer) lines.push(`  - **Answer:** ${answer}`);
      yield lines;
    }
  }

  // Unlike the other Planning subsections, no duels means no heading at all.
  if (duels.length > 0) {
    yield ['', '### Duels'];
    for (const duel of duels) yield ['', duelMarkdown(duel)];
  }

  yield [
    '',
    '## Appendix',
    '',
    '**Power levels**',
    '',
    powerLevels.length ? powerLevels.join(' · ') : '_None defined._',
    '',
    '**Types**',
    '',
    types.length ? types.join(' · ') : '_None defined._',
  ];
}

export function renderBookMarkdown(data) {
  const lines = [];
  for (const chunk of renderBookMarkdownChunks(data)) lines.push(...chunk);
  return `${lines.join('\n').trim()}\n`;
}
