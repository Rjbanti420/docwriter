#!/usr/bin/env node

// Generates a disposable synthetic book for RAM measurement.
//
//   node scripts/gen-ram-book.mjs [path] [chapters] [wordsPerChapter]
//
// Refuses to write outside /tmp and deletes whatever is at the target path, so
// it can never touch a real book. Deterministic: the same arguments produce the
// same text, which keeps measurements comparable between runs.

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] || '/tmp/opencode/ram/large.db');
const chapterCount = Number(process.argv[3] || 2000);
const wordsPerChapter = Number(process.argv[4] || 2500);

if (!target.startsWith('/tmp/')) {
  console.error(`refusing to generate a book at ${target}: only /tmp paths are allowed`);
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true });
process.env.DOCWRITER_DB = target;

// Imported after DOCWRITER_DB is set: db.mjs opens the file at module load.
const { db, migrate } = await import('../server/db.mjs');
migrate();

// --- deterministic prose ----------------------------------------------------

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261117);
const pick = (list) => list[Math.floor(rand() * list.length)];

const CHARACTERS = [
  'Lorvane', 'Alder Ash', 'Baek Rin', 'Mira Holt', 'Cormac Vale', 'Sable Quinn',
  'Ivo Thane', 'Nell Kestrel', 'Rook Alder', 'Tamsin Grey', 'Orin Pike', 'Bryn Hollow',
];
const PLACES = ['Ostmark', 'the Grey Guild', 'St. Orra', 'the harbour', 'Saltmoor', 'the lighthouse', 'Kell Reach', 'the third stair'];
const THINGS = ['ledger', 'lantern', 'rope', 'key', 'bell', 'letter', 'coin', 'map', 'blade', 'coat'];
const VERBS = ['walked', 'waited', 'counted', 'remembered', 'argued', 'listened', 'turned', 'carried', 'burned', 'kept'];
const ADVERBS = ['quietly', 'again', 'before dawn', 'without a word', 'too late', 'in the rain', 'at the gate', 'under the stairs'];
const OPENERS = ['The wind came off', 'There was a sound from', 'Nobody spoke of', 'By morning', 'The road to', 'A light burned over'];

function sentence() {
  const shape = rand();
  if (shape < 0.2) return `${pick(OPENERS)} ${pick(PLACES)} before ${pick(CHARACTERS)} ${pick(VERBS)} ${pick(ADVERBS)}.`;
  if (shape < 0.45) return `${pick(CHARACTERS)} ${pick(VERBS)} ${pick(ADVERBS)} and said nothing about the ${pick(THINGS)}.`;
  if (shape < 0.65) return `The ${pick(THINGS)} was still there, ${pick(ADVERBS)}, and ${pick(CHARACTERS)} knew what it meant.`;
  if (shape < 0.85) return `They met at ${pick(PLACES)}; ${pick(CHARACTERS)} ${pick(VERBS)} while the ${pick(THINGS)} waited.`;
  return `${pick(CHARACTERS)} had promised ${pick(CHARACTERS)} the ${pick(THINGS)} by the time the tide turned at ${pick(PLACES)}.`;
}

function chapterText(words) {
  const parts = [];
  let count = 0;
  while (count < words) {
    const s = sentence();
    parts.push(s);
    count += s.split(/\s+/).length;
  }
  return parts.join(' ');
}

// --- entities ---------------------------------------------------------------

const entityNames = [];
{
  const insert = db.prepare('INSERT INTO entities (name, type_id, summary, fields) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 150; i++) {
    const name =
      i < CHARACTERS.length
        ? CHARACTERS[i]
        : i < CHARACTERS.length + 40
          ? `${pick(['House', 'Order of', 'Port of', 'Guild of'])} ${pick(['Vale', 'Hollow', 'Kestrel', 'Thane', 'Orra'])} ${i}`
          : `${pick(['The', 'A'])} ${pick(THINGS)} of ${pick(PLACES).replace(/^the /, '')} ${i}`;
    entityNames.push(name);
    insert.run(name, (i % 5) + 1, `Synthetic entity ${i} for the RAM fixture.`, '{}');
  }
}

// --- chapters, revisions, mentions -----------------------------------------

const insertChapter = db.prepare(
  'INSERT INTO chapters (number, title, sort_order, word_count, current_revision_id) VALUES (?, ?, ?, ?, ?)'
);
const insertRevision = db.prepare('INSERT INTO revisions (chapter_id, text) VALUES (?, ?)');
const setRevision = db.prepare('UPDATE chapters SET current_revision_id = ? WHERE id = ?');
const insertMention = db.prepare(
  'INSERT INTO mentions (entity_id, chapter_id, revision_id, start_off, end_off, surface_text, context_sentence) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const entityIdByName = new Map(
  db.prepare('SELECT id, name FROM entities').all().map((row) => [row.name, row.id])
);

db.exec('BEGIN');
const started = Date.now();
for (let i = 0; i < chapterCount; i++) {
  const number = String(i + 1);
  const title = i % 7 === 0 ? `The ${pick(THINGS)} at ${pick(PLACES)}` : `Chapter ${number}`;
  const text = chapterText(wordsPerChapter);
  const words = text.split(/\s+/).length;
  const chapterId = Number(insertChapter.run(number, title, i, words, null).lastInsertRowid);
  const revisionId = Number(insertRevision.run(chapterId, text).lastInsertRowid);
  setRevision.run(revisionId, chapterId);

  // Five real mention spans per chapter, so Review and the Bible are not empty.
  for (let m = 0; m < 5; m++) {
    const name = entityNames[(i * 5 + m) % entityNames.length];
    const at = text.indexOf(name);
    if (at < 0) continue;
    insertMention.run(entityIdByName.get(name), chapterId, revisionId, at, at + name.length, name, text.slice(Math.max(0, at - 60), at + name.length + 60));
  }
  if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${chapterCount} chapters`);
}
// No export reminder during measurement, and a name the report can quote.
db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('export_nudge', 'off')").run();
db.exec('COMMIT');

const stat = db.prepare('SELECT COUNT(*) AS chapters, SUM(word_count) AS words FROM chapters').get();
console.log(
  `generated ${target}\n  ${stat.chapters} chapters, ${stat.words} words, ` +
    `${(db.prepare('SELECT COUNT(*) AS n FROM mentions').get().n)} mentions in ${Date.now() - started} ms`
);
