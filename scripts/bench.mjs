// Baseline timings for a very long book. Not part of `npm test`.
//
//   npm run bench            # seed once, then measure
//   npm run bench -- --reseed
//
// Sizes: BENCH_CHAPTERS (2000), BENCH_ENTITIES (300), BENCH_CANDIDATES (50000).
// The seed database is cached under BENCH_DIR (default: the OS temp dir), so
// later runs only copy it and measure. The real book is never touched.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAPTERS = Number(process.env.BENCH_CHAPTERS ?? 2000);
const ENTITIES = Number(process.env.BENCH_ENTITIES ?? 300);
const CANDIDATES = Number(process.env.BENCH_CANDIDATES ?? 50_000);
const BENCH_DIR = resolve(process.env.BENCH_DIR ?? join(tmpdir(), 'docwriter-bench'));
const basePath = join(BENCH_DIR, `base-${CHAPTERS}-${ENTITIES}-${CANDIDATES}.db`);
const reseed = process.argv.includes('--reseed');

const WORDS = (
  'the a of and to in was he she it that his her as with had not but from they at ' +
  'which on were for one all this would there their what out up about into his her ' +
  'room door light water hand voice night morning road window table letter river stone'
).split(' ');

function makeText(seed) {
  let x = seed >>> 0;
  const next = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const words = [];
  for (let i = 0; i < 2500; i += 1) {
    words.push(WORDS[Math.floor(next() * WORDS.length)]);
    if (i % 15 === 14) words[words.length - 1] += '.';
  }
  return `${words.join(' ')}\n`;
}

function json(value) {
  return JSON.stringify(value);
}

async function seed() {
  process.env.DOCWRITER_DB = basePath;
  const { db, migrate } = await import('../server/db.mjs');
  migrate();

  const typeIds = Object.fromEntries(db.prepare('SELECT name, id FROM types').all().map((t) => [t.name, t.id]));
  const chapterIds = [];
  const chapterRevisions = new Map();
  const insChapter = db.prepare('INSERT INTO chapters (number, title, sort_order, word_count) VALUES (?, ?, ?, ?)');
  const insRevision = db.prepare('INSERT INTO revisions (chapter_id, text) VALUES (?, ?)');
  const setRevision = db.prepare('UPDATE chapters SET current_revision_id = ? WHERE id = ?');

  db.exec('BEGIN');
  for (let i = 0; i < CHAPTERS; i += 1) {
    const text = makeText(i + 1);
    const info = insChapter.run(String(i + 1), `Chapter ${i + 1}`, i, 2500);
    const chapterId = Number(info.lastInsertRowid);
    const revisionId = Number(insRevision.run(chapterId, text).lastInsertRowid);
    setRevision.run(revisionId, chapterId);
    chapterIds.push(chapterId);
    chapterRevisions.set(chapterId, revisionId);
  }
  db.exec('COMMIT');

  const image = `data:image/jpeg;base64,${'A'.repeat(60_000)}`;
  const insEntity = db.prepare(
    'INSERT INTO entities (name, type_id, summary, fields, tracking, gap_threshold) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const entityIds = [];
  db.exec('BEGIN');
  for (let i = 0; i < ENTITIES; i += 1) {
    const typeName = ['Character', 'Item', 'Location', 'Organisation', 'Country'][i % 5];
    const fields = {};
    // 60 portraits reproduce the ~3.7 MB list payload from the audit.
    if (i < 60) fields.image = image;
    // One dead Character keeps the posthumous pass busy.
    if (i === 0) fields.death = { chapter: chapterIds[10] };
    const tracking = i > 0 && i <= 5 ? 'reappearance' : 'off';
    const info = insEntity.run(
      `Person ${i + 1}`,
      typeIds[typeName],
      `Bench entity ${i + 1}`,
      json(fields),
      tracking,
      tracking === 'off' ? null : 3
    );
    entityIds.push(Number(info.lastInsertRowid));
  }
  db.exec('COMMIT');

  // 60 mentions per chapter: the protagonist in every chapter, the rest spread.
  const insMention = db.prepare(
    'INSERT INTO mentions (entity_id, chapter_id, revision_id, start_off, end_off, surface_text, context_sentence) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  chapterIds.forEach((chapterId, ci) => {
    const revisionId = chapterRevisions.get(chapterId);
    insMention.run(entityIds[0], chapterId, revisionId, 0, 7, 'Person 1', 'Person 1 was there.');
    for (let j = 1; j < 60; j += 1) {
      const entityId = entityIds[(ci * 59 + j) % (ENTITIES - 1) + 1];
      insMention.run(entityId, chapterId, revisionId, j * 10, j * 10 + 5, 'name', 'A name appeared.');
    }
  });
  db.exec('COMMIT');

  const insCandidate = db.prepare(
    `INSERT INTO candidates (chapter_id, revision_id, surface_text, normalized, occurrences, positions, contexts,
       suggested_type_id, confidence, signals, possible_entity_id, tier, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  );
  const perChapter = Math.ceil(CANDIDATES / CHAPTERS);
  db.exec('BEGIN');
  chapterIds.forEach((chapterId, ci) => {
    const revisionId = chapterRevisions.get(chapterId);
    for (let j = 0; j < perChapter; j += 1) {
      const label = `Candidate ${ci + 1}-${j + 1}`;
      insCandidate.run(
        chapterId,
        revisionId,
        label,
        label.toLowerCase(),
        3,
        json([{ start: 0, end: 5 }, { start: 100, end: 105 }, { start: 200, end: 205 }]),
        json([`${label} appeared near the river.`, `Later, ${label} was gone.`, `${label} again.`]),
        typeIds.Character,
        0.5,
        json(['repeated']),
        null,
        'primary'
      );
    }
    // One same-name candidate per chapter makes accept link 2000 mentions.
    insCandidate.run(
      chapterId,
      revisionId,
      'Bench Protagonist',
      'bench protagonist',
      1,
      json([{ start: 0, end: 16 }]),
      json(['Bench Protagonist entered.']),
      typeIds.Character,
      0.9,
      json(['handled']),
      null,
      'primary'
    );
  });
  // A merge target with mentions in every chapter.
  insCandidate.run(
    chapterIds[0],
    chapterRevisions.get(chapterIds[0]),
    'Bench Merge',
    'bench merge',
    1,
    json([{ start: 300, end: 310 }]),
    json(['Bench Merge arrived.']),
    typeIds.Character,
    0.9,
    json(['handled']),
    entityIds[0],
    'primary'
  );
  db.exec('COMMIT');

  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}

async function copyBaseTo(runDir) {
  const runPath = join(runDir, 'book.db');
  copyFileSync(basePath, runPath);
  for (const suffix of ['-wal', '-shm']) rmSync(`${runPath}${suffix}`, { force: true });
  return runPath;
}

async function startServer(runDir, dbPath) {
  const child = spawn(process.execPath, [join(root, 'server', 'index.mjs')], {
    cwd: root,
    env: { ...process.env, HOME: runDir, DOCWRITER_DB: dbPath, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const base = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`server never started:\n${log}`)), 30_000);
    child.stdout.on('data', (chunk) => {
      log += chunk;
      const match = log.match(/listening on (http:\/\/[\d.]+:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolvePromise(match[1]);
      }
    });
    child.stderr.on('data', (chunk) => {
      log += chunk;
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited (${code}):\n${log}`));
    });
  });
  return {
    base,
    stop: () => {
      child.kill();
    },
  };
}

async function call(base, path, { method = 'GET', body } = {}) {
  const t0 = performance.now();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bytes = (await res.arrayBuffer()).byteLength;
  const ms = performance.now() - t0;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return { ms, bytes };
}

function report(label, { ms, bytes }) {
  const size = bytes > 0 ? `${(bytes / 1e6).toFixed(1)} MB` : '';
  console.log(`  ${label.padEnd(42)} ${ms.toFixed(0).padStart(6)} ms  ${size}`);
}

async function main() {
  if (!existsSync(basePath) || reseed) {
    console.log(`Seeding ${CHAPTERS} chapters / ${ENTITIES} entities / ${CANDIDATES} candidates…`);
    mkdirSync(BENCH_DIR, { recursive: true });
    rmSync(basePath, { force: true });
    rmSync(`${basePath}-wal`, { force: true });
    rmSync(`${basePath}-shm`, { force: true });
    await seed();
    console.log(`Seed ready: ${basePath}`);
  } else {
    console.log(`Using cached seed: ${basePath}`);
  }

  const runDir = mkdtempSync(join(tmpdir(), 'docwriter-bench-run-'));
  const dbPath = await copyBaseTo(runDir);
  const server = await startServer(runDir, dbPath);
  try {
    console.log('\nRead endpoints');
    report('GET /api/entities', await call(server.base, '/api/entities'));
    report('GET /api/review', await call(server.base, '/api/review'));
    report('GET /api/chapters', await call(server.base, '/api/chapters'));
    report('GET /api/chapters/1', await call(server.base, '/api/chapters/1'));
    report('GET /api/entities/1', await call(server.base, '/api/entities/1'));

    console.log('\nWrite paths');
    const fixtureDb = new DatabaseSync(dbPath, { readOnly: true });
    const acceptId = fixtureDb
      .prepare("SELECT id FROM candidates WHERE normalized = 'bench protagonist' LIMIT 1")
      .get().id;
    const mergeId = fixtureDb
      .prepare("SELECT id FROM candidates WHERE normalized = 'bench merge' LIMIT 1")
      .get().id;
    fixtureDb.close();
    report(
      'accept a name present in every chapter',
      await call(server.base, `/api/candidates/${acceptId}/resolve`, {
        method: 'POST',
        body: { action: 'accept', typeId: 1 },
      })
    );

    report(
      'merge into an entity in every chapter',
      await call(server.base, `/api/candidates/${mergeId}/resolve`, {
        method: 'POST',
        body: { action: 'merge', entityId: 1 },
      })
    );

    // Chunked so undici's response timeout cannot fire on a slow baseline.
    const chapterIds = Array.from({ length: CHAPTERS }, (_, i) => i + 1);
    const chunkSize = 200;
    let scanMs = 0;
    let scanBytes = 0;
    console.log(`\nGun scan (${CHAPTERS} chapters, ${chunkSize} per request)`);
    for (let i = 0; i < chapterIds.length; i += chunkSize) {
      const chunk = chapterIds.slice(i, i + chunkSize);
      const result = await call(server.base, '/api/guns/scan', {
        method: 'POST',
        body: { chapterIds: chunk },
      });
      scanMs += result.ms;
      scanBytes += result.bytes;
      process.stdout.write(`  ${Math.min(i + chunkSize, chapterIds.length)}/${chapterIds.length}\r`);
    }
    report('gun scan total', { ms: scanMs, bytes: scanBytes });

    console.log('\nWhole-book work');
    report('GET /api/export', await call(server.base, '/api/export'));
    report('GET /api/backup', await call(server.base, '/api/backup'));
  } finally {
    server.stop();
    rmSync(runDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
