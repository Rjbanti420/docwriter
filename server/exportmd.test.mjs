// Unit tests for the Markdown template. Run with `npm test`
// (node --test server/*.test.mjs). No database is touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBookMarkdown } from './exportmd.mjs';

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
