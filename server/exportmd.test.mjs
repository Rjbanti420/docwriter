// Unit tests for the Markdown template. Run with `npm test`
// (node --test server/*.test.mjs). No database is touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBookMarkdown, renderBookMarkdownChunks } from './exportmd.mjs';

const card = (patch) => ({ name: 'Tomas Rell', lines: [], sections: [], ...patch });

test('an empty book still renders every section, with a placeholder', () => {
  const md = renderBookMarkdown({ exportedAt: '2026-10-18' });
  assert.match(md, /^# DocWriter export\n/);
  assert.match(md, /^## Manuscript\n\n_No chapters yet\._$/m);
  assert.match(md, /^## Bible\n\n_No entities yet\._$/m);
  assert.match(md, /^### Chekhov's Guns\n\n_No guns yet\._$/m);
  assert.match(md, /^### Questions\n\n_No questions yet\._$/m);
  assert.match(md, /^## Appendix$/m);
  assert.match(md, /^_0 chapters · 0 words · 0 entities · 0 guns · 0 questions · exported 2026-10-18_$/m);
});

test('a chapter keeps its blank lines and hides the word count when unknown', () => {
  const md = renderBookMarkdown({
    chapters: [
      { number: '1', title: 'The Long Road', wordCount: 1204, text: 'A line.\n\n\nA line after a gap.\n' },
      { number: '', title: '', wordCount: 0, text: 'Untitled.' },
    ],
  });
  assert.match(md, /^### 1\. The Long Road$/m);
  assert.match(md, /^_1,204 words_$/m);
  assert.ok(md.includes('A line.\n\n\nA line after a gap.'), 'prose keeps the writer’s spacing');
  assert.match(md, /^### Untitled chapter$/m);
});

test('a card renders its lines, drops blank sections and keeps custom rows', () => {
  const md = renderBookMarkdown({
    groups: [
      {
        typeName: 'Character',
        cards: [
          card({
            lines: ['Aliases: Tom', 'Mentions: 12 · Ch 1–Ch 4', 'Power level: Primor', 'Died in Ch 4'],
            sections: [
              { heading: 'Summary', body: '' },
              { heading: 'System', items: [{ name: 'Bloodline', body: 'Rell line' }, { name: '', body: '' }] },
              { heading: 'Abilities', items: [] },
            ],
          }),
        ],
      },
    ],
  });
  assert.match(md, /^### Character$/m);
  assert.match(md, /^#### Tomas Rell$/m);
  // "1 entity", not "1 entities" — a new book often has exactly one.
  assert.match(md, /^_0 chapters · 0 words · 1 entity · 0 guns · 0 questions_$/m);
  assert.match(md, /^- Aliases: Tom$/m);
  assert.match(md, /^- Power level: Primor$/m);
  assert.match(md, /^\*\*System\*\*$/m);
  assert.match(md, /^- \*\*Bloodline\*\* — Rell line$/m);
  assert.ok(!md.includes('**Summary**'), 'a blank body section is dropped');
  assert.ok(!md.includes('**Abilities**'), 'a section with no usable rows is dropped');
});

test('a gun renders its status, history and outcome', () => {
  const md = renderBookMarkdown({
    guns: [
      {
        name: 'The rusted key',
        lines: ['Status: active', 'Appears: Ch 2 — Ash', 'Planned payoff: Ch 7 — The Vault', 'Impact: chapter'],
        sections: [
          { heading: 'Explanation', body: 'Shown early so the lock pays off.' },
          { heading: 'Outcome', body: '' },
          { heading: 'History', items: [{ name: 'Discussed', body: 'Ch 5 — Ash · moved to Ch 8' }] },
        ],
      },
    ],
  });
  assert.match(md, /^- Status: active$/m);
  assert.match(md, /^- Planned payoff: Ch 7 — The Vault$/m);
  assert.match(md, /^\*\*Explanation\*\*$/m);
  assert.ok(!md.includes('**Outcome**'));
  assert.match(md, /^- \*\*Discussed\*\* — Ch 5 — Ash · moved to Ch 8$/m);
});

test('questions show their derived status and sub-bullets', () => {
  const md = renderBookMarkdown({
    questions: [
      { status: 'open', text: 'Who killed the king?', source: 'Ch 3 — Ash', delivered: '', answer: '' },
      { status: 'answered', text: 'Why the gate?', source: '', delivered: '', answer: 'It was never locked.' },
    ],
  });
  assert.match(md, /^- \*\*\[open\]\*\* Who killed the king\?$/m);
  assert.match(md, /^ {2}- Raised in Ch 3 — Ash$/m);
  assert.match(md, /^ {2}- \*\*Answer:\*\* It was never locked\.$/m);
});

const duelSides = {
  terrain: 'the Rusted Pass',
  A: [
    {
      characterId: 1,
      name: 'Kael',
      dead: false,
      powerRank: 2,
      abilities: [
        { id: 'k1', name: 'Ashfall' },
        { id: 'k2', name: 'The Long Count' },
      ],
      items: [{ id: 10, name: 'a chipped sword', rank: 'Hazardous', role: 'offense' }],
    },
  ],
  B: [
    {
      characterId: 2,
      name: 'Mira',
      dead: false,
      powerRank: 1,
      abilities: [{ id: 'm1', name: 'Mirror Step' }],
      items: [{ id: 11, name: 'a boiled-leather shield', rank: 'Elusive', role: 'defense' }],
    },
  ],
};

const duelOutcome = {
  winnerSide: 'A',
  skillSide: null,
  chosenBy: null,
  seed: 141183972,
  roll: 0.0691,
  probabilityA: 0.4345,
  scores: { A: 18, B: 25.5 },
  breakdown: {
    A: {
      score: 18,
      fighters: [{ name: 'Kael', base: 10, power: 2, abilities: 2, attack: 3, defence: 0 }],
    },
    B: {
      score: 25.5,
      fighters: [{ name: 'Mira', base: 10, power: 1, abilities: 1, attack: 0, defence: 2 }],
    },
  },
};

const duel = (patch = {}) => ({
  title: 'Kael vs Mira',
  created_at: '2026-10-21 12:00:00',
  sides: duelSides,
  outcome: duelOutcome,
  narrative: 'Kael opens with Ashfall. Mira answers with Mirror Step.',
  ...patch,
});

test('a rolled duel exports its snapshot, result and audit line', () => {
  const md = renderBookMarkdown({ duels: [duel()] });
  assert.match(md, /^### Duels$/m);
  assert.match(md, /^#### Kael vs Mira$/m);
  assert.match(md, /^- Created: 2026-10-21 · Terrain: the Rusted Pass$/m);
  assert.match(
    md,
    /^- Side A: Kael — Abilities: Ashfall, The Long Count — Items: a chipped sword \(offense, Hazardous\)$/m
  );
  assert.match(
    md,
    /^- Side B: Mira — Abilities: Mirror Step — Items: a boiled-leather shield \(defense, Elusive\)$/m
  );
  assert.match(md, /^- Winner: Kael$/m);
  assert.match(md, /^- Scores: 18 vs 25\.5$/m);
  assert.match(md, /^- Win chance for A 43\.5% · seed 141183972 · roll 0\.0691$/m);
  assert.match(md, /Kael opens with Ashfall\. Mira answers with Mirror Step\./);
  assert.doesNotMatch(md, /Winner chosen by you|More skilled:/);
});

test('a chosen-winner duel says so and omits the roll audit', () => {
  const md = renderBookMarkdown({
    duels: [duel({ outcome: { ...duelOutcome, chosenBy: 'A', skillSide: null } })],
  });
  assert.match(md, /^- Winner: Kael$/m);
  assert.match(md, /^- Winner chosen by you$/m);
  assert.match(md, /^- Scores: 18 vs 25\.5$/m);
  assert.doesNotMatch(md, /More skilled:|Win chance for A|seed 141183972|roll 0\.0691/);
});

test('a skilled-side duel names the side and keeps its audit', () => {
  const md = renderBookMarkdown({
    duels: [duel({ outcome: { ...duelOutcome, winnerSide: 'B', skillSide: 'B' } })],
  });
  assert.match(md, /^- Winner: Mira$/m);
  assert.match(md, /^- More skilled: Mira$/m);
  assert.match(md, /^- Win chance for A 43\.5% · seed 141183972 · roll 0\.0691$/m);
  assert.doesNotMatch(md, /Winner chosen by you/);
});

test('a 3v3 with a dead fighter keeps one line per fighter', () => {
  const sides = {
    ...duelSides,
    A: [
      ...duelSides.A,
      { name: 'Ren', dead: false, abilities: [{ id: 'r1', name: 'Nine Breaths' }], items: [] },
      { name: 'Tamsin', dead: false, abilities: [], items: [] },
    ],
    B: [
      ...duelSides.B,
      {
        name: 'Vane',
        dead: true,
        abilities: [{ id: 'v1', name: 'Iron Verdict' }],
        items: [{ id: 12, name: 'a long grey blade', rank: 'Desolating', role: 'offense' }],
      },
      { name: 'Sable', dead: false, abilities: [{ id: 's1', name: 'Salt Wind' }], items: [] },
    ],
  };
  const md = renderBookMarkdown({
    duels: [
      duel({
        title: 'Kael + Ren + Tamsin vs Mira + Vane + Sable',
        sides,
        outcome: { ...duelOutcome, chosenBy: 'A' },
      }),
    ],
  });
  assert.equal((md.match(/^- Side [AB]: /gm) ?? []).length, 6);
  assert.match(md, /^- Side A: Ren — Abilities: Nine Breaths$/m);
  assert.match(md, /^- Side A: Tamsin$/m);
  assert.match(
    md,
    /^- Side B: Vane \(dead\) — Abilities: Iron Verdict — Items: a long grey blade \(offense, Desolating\)$/m
  );
  assert.match(md, /^- Side B: Sable — Abilities: Salt Wind$/m);
});

test('a legacy-shaped duel exports without the newer breakdown fields', () => {
  const sides = {
    terrain: '',
    A: [
      {
        name: 'Kael',
        dead: false,
        abilities: ['Old Trick'],
        items: [{ name: 'a plain ring', rank: '' }],
      },
    ],
    B: [{ name: 'Mira', dead: false, abilities: [], items: [] }],
  };
  const outcome = {
    winnerSide: 'B',
    skillSide: null,
    chosenBy: null,
    seed: 7,
    roll: 0.9,
    probabilityA: 0.4,
    scores: { A: 17, B: 20 },
    breakdown: {
      A: { score: 17, fighters: [{ name: 'Kael', base: 10, power: 2, abilities: 1, attack: 0, defence: 2 }] },
      B: { score: 20, fighters: [{ name: 'Mira', base: 10, power: 1, abilities: 1, attack: 0, defence: 2 }] },
    },
  };
  const md = renderBookMarkdown({ duels: [duel({ sides, outcome })] });
  assert.match(md, /^- Created: 2026-10-21$/m);
  assert.match(md, /^- Side A: Kael — Abilities: Old Trick — Items: a plain ring \(both, Unranked\)$/m);
  assert.match(md, /^- Side B: Mira$/m);
  assert.match(md, /^- Winner: Mira$/m);
  assert.match(md, /^- Scores: 17 vs 20$/m);
  assert.match(md, /^- Win chance for A 40\.0% · seed 7 · roll 0\.9000$/m);
});

test('special characters in names cannot break the export structure', () => {
  const sides = {
    terrain: 'a *strange* # place',
    A: [
      {
        name: 'Kael #1',
        dead: false,
        abilities: [{ id: 'k1', name: '- Ashfall *now*' }],
        items: [{ name: '*a chipped sword*', rank: 'Hazardous', role: 'offense' }],
      },
    ],
    B: [{ name: 'Mira', dead: false, abilities: [], items: [] }],
  };
  const md = renderBookMarkdown({
    duels: [duel({ title: '# The *Fall*\n## Not a heading', sides })],
  });
  assert.equal((md.match(/^#### /gm) ?? []).length, 1);
  assert.doesNotMatch(md, /^## Not a heading$/m);
  assert.match(md, /^#### # The \*Fall\* ## Not a heading$/m);
  assert.match(
    md,
    /^- Side A: Kael #1 — Abilities: - Ashfall \*now\* — Items: \*a chipped sword\* \(offense, Hazardous\)$/m
  );
  assert.match(md, /^- Created: 2026-10-21 · Terrain: a \*strange\* # place$/m);
});

test('no duels means no Duels heading', () => {
  const md = renderBookMarkdown({ chapters: [], groups: [], guns: [], questions: [], duels: [] });
  assert.ok(!md.includes('### Duels'));
});

test('duels export in the order handed to the renderer', () => {
  const md = renderBookMarkdown({
    duels: [duel({ title: 'Newest first' }), duel({ title: 'Older second' })],
  });
  assert.ok(md.indexOf('#### Newest first') < md.indexOf('#### Older second'));
});

test('the streaming chunks join to exactly the same Markdown', () => {
  const data = {
    exportedAt: '2026-11-11',
    chapters: [
      { number: '1', title: 'One', wordCount: 3, text: 'A line.\n\nAnother.' },
      { number: '', title: '', wordCount: 0, text: '' },
    ],
    groups: [{ typeName: 'Character', cards: [card({ lines: ['Aliases: Tom'] })] }],
    guns: [card({ name: 'The Brass Key' })],
    questions: [{ status: 'open', text: 'Who took it?', source: 'Ch 1', answer: '' }],
    duels: [duel()],
    powerLevels: ['Primor', 'Seeker'],
    types: ['Character', 'Item'],
  };
  let streamed = '';
  let first = true;
  for (const chunk of renderBookMarkdownChunks(data)) {
    streamed += (first ? '' : '\n') + chunk.join('\n');
    first = false;
  }
  assert.equal(streamed + '\n', renderBookMarkdown(data));

  let empty = '';
  first = true;
  for (const chunk of renderBookMarkdownChunks({})) {
    empty += (first ? '' : '\n') + chunk.join('\n');
    first = false;
  }
  assert.equal(empty + '\n', renderBookMarkdown({}));
});
