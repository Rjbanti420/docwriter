// Markdown export renderer — pure formatting, no database.
//
// The route hands it display-ready strings (names already resolved from ids, so
// the file never contains a bare "#7"), and this file owns every heading, bullet
// and blank line. Keeping it separate is what makes the shape of the export
// testable without starting a server.
//
// A "card" is one Bible entry or one Chekhov's gun:
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

export function renderBookMarkdown(data) {
  const {
    exportedAt = '',
    chapters = [],
    groups = [],
    guns = [],
    questions = [],
    powerLevels = [],
    types = [],
  } = data ?? {};

  const words = chapters.reduce((n, c) => n + (Number(c.wordCount) || 0), 0);
  const entities = groups.reduce((n, g) => n + g.cards.length, 0);
  const plural = (n, word, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

  const out = ['# DocWriter export'];
  const counts = [
    plural(chapters.length, 'chapter'),
    `${comma(words)} words`,
    plural(entities, 'entity', 'entities'),
    plural(guns.length, 'gun'),
    plural(questions.length, 'question'),
  ];
  if (exportedAt) counts.push(`exported ${exportedAt}`);
  out.push('', `_${counts.join(' · ')}_`);

  out.push('', '## Manuscript');
  if (chapters.length === 0) out.push('', '_No chapters yet._');
  for (const chapter of chapters) {
    const label = [chapter.number, chapter.title]
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .join('. ');
    out.push('', `### ${label || 'Untitled chapter'}`);
    if (chapter.wordCount) out.push('', `_${comma(chapter.wordCount)} words_`);
    const text = prose(chapter.text);
    if (text) out.push('', text);
  }

  out.push('', '## Bible');
  if (entities === 0) out.push('', '_No entities yet._');
  for (const group of groups) {
    out.push('', `### ${group.typeName}`);
    for (const card of group.cards) out.push('', cardMarkdown(card));
  }

  out.push('', '## Planning', '', "### Chekhov's Guns");
  if (guns.length === 0) out.push('', '_No guns yet._');
  for (const gun of guns) out.push('', cardMarkdown(gun));

  out.push('', '### Questions');
  if (questions.length === 0) out.push('', '_No questions yet._');
  for (const q of questions) {
    out.push('', `- **[${q.status}]** ${inline(q.text)}`);
    if (q.source) out.push(`  - Raised in ${q.source}`);
    if (q.delivered) out.push(`  - Delivered in ${q.delivered}`);
    const answer = inline(q.answer);
    if (answer) out.push(`  - **Answer:** ${answer}`);
  }

  out.push('', '## Appendix');
  out.push('', '**Power levels**', '', powerLevels.length ? powerLevels.join(' · ') : '_None defined._');
  out.push('', '**Types**', '', types.length ? types.join(' · ') : '_None defined._');

  return `${out.join('\n').trim()}\n`;
}
