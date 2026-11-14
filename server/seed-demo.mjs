// Throwaway demo data for the relationship graph.
//
//   npm run seed:demo      (writes data/demo.db)
//   npm run dev:demo       (dev server pointed at that file)
//
// It refuses to run without DOCWRITER_DB so it can never touch the real book,
// and refuses to overwrite a non-empty database unless --force is passed.

import { db, migrate } from './db.mjs';

const dbPath = process.env.DOCWRITER_DB;
if (!dbPath) {
  console.error('Refusing to seed: set DOCWRITER_DB to a throwaway path.');
  console.error('Use `npm run seed:demo` for the demo database.');
  process.exit(1);
}

migrate();

const force = process.argv.includes('--force');
const existing = db.prepare('SELECT COUNT(*) AS n FROM entities').get().n;
if (existing > 0 && !force) {
  console.error(`Refusing to seed: ${dbPath} already has ${existing} entities.`);
  console.error('Pass --force to wipe its cards and relationships first.');
  process.exit(1);
}

// Deterministic, so every seed produces the same graph.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261114);
const pick = (list) => list[Math.floor(rand() * list.length)];

const FIRST = ['Alder', 'Bryn', 'Calla', 'Dain', 'Edda', 'Fen', 'Galen', 'Hilde', 'Ivo', 'Jorunn',
  'Kaelen', 'Lira', 'Mara', 'Nero', 'Orla', 'Pell', 'Quin', 'Rhea', 'Soren', 'Tamsin',
  'Ulric', 'Vesna', 'Wren', 'Yara', 'Zeph'];
const LAST = ['Ash', 'Barrow', 'Crane', 'Dusk', 'Ember', 'Frost', 'Gale', 'Hollow', 'Ironside', 'Jade',
  'Kestrel', 'Lark', 'Mire', 'North', 'Oak', 'Pike', 'Quill', 'Rook', 'Salt', 'Thorn',
  'Vale', 'Wick', 'Yew', 'Zale'];
const PLACE_A = ['Grey', 'Black', 'Salt', 'Ashen', 'Moon', 'Iron', 'Amber', 'Silver', 'Drowned', 'High',
  'Low', 'Old', 'North', 'South', 'Glass', 'Mist'];
const PLACE_B = ['Harbor', 'Keep', 'Vale', 'Marsh', 'Reach', 'Crossing', 'Isle', 'Gate'];
const COUNTRY = ['Aldemar', 'Brenland', 'Calderon', 'Dunmoor', 'Esterhold', 'Farrow', 'Gildara',
  'Hestria', 'Ilyria', 'Korvath', 'Lorvane', 'Mirelund', 'Norhaven', 'Ostmark'];
const ORG_A = ['Grey', 'Ferry', 'Silver', 'Ashen', 'Lantern', 'Tide', 'Crown', 'Raven', 'Copper', 'Cinder',
  'Verdant', 'Hollow'];
const ORG_B = ['Ledger', 'Guild', 'Order', 'Choir', 'Council', 'Company', 'Watch', 'Circle'];
const ITEM_A = ['Ashen', 'Moon', 'Salt', 'Iron', 'Grey', 'Ember', 'Frost', 'Gilded', 'Whisper', 'Bone',
  'Widow', 'Star', 'Hollow', 'Thorn'];
const ITEM_B = ['Blade', 'Key', 'Lamp', 'Ring', 'Crown', 'Compass', 'Scepter', 'Mask'];
const NOTES = ['', '', '', '', 'Bound by an old promise.', 'Owed a debt from the war.',
  'Trust is thin since the river crossing.', 'Only mentioned in the last act.',
  'Cut from draft two but still true.', 'The bargain was never explained.'];

const TYPES = Object.fromEntries(
  db.prepare('SELECT id, name FROM types').all().map((t) => [t.name, t.id])
);
for (const required of ['Character', 'Location', 'Country', 'Organisation', 'Item']) {
  if (!TYPES[required]) {
    console.error(`Missing built-in type "${required}". Run the app once first.`);
    process.exit(1);
  }
}

const names = new Set();
function unique(base) {
  let name = base;
  let n = 2;
  while (names.has(name)) name = `${base} ${n++}`;
  names.add(name);
  return name;
}

const entities = [];
function add(type, base, summary) {
  entities.push({ name: unique(base), type, summary });
}

for (let i = 0; i < 55; i += 1) {
  add('Character', `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]}`,
    `${pick(['A traveller', 'A scholar', 'A soldier', 'A smuggler', 'A healer', 'A noble'])} of the ${pick(['grey coast', 'inner isles', 'old road', 'river marches'])}.`);
}
for (let i = 0; i < 20; i += 1) {
  add('Location', `${PLACE_A[i % PLACE_A.length]} ${PLACE_B[Math.floor(i / PLACE_A.length) % PLACE_B.length]}`,
    'A place the story keeps returning to.');
}
for (let i = 0; i < 14; i += 1) {
  add('Country', COUNTRY[i], 'A nation with its own interests in the ledger.');
}
for (let i = 0; i < 18; i += 1) {
  add('Organisation', `${ORG_A[i % ORG_A.length]} ${ORG_B[Math.floor(i / ORG_A.length) % ORG_B.length]}`,
    'An organisation that outlives its members.');
}
for (let i = 0; i < 30; i += 1) {
  add('Item', `${ITEM_A[i % ITEM_A.length]} ${ITEM_B[Math.floor(i / ITEM_A.length) % ITEM_B.length]}`,
    'An object people are willing to fight over.');
}

if (force) {
  db.exec('DELETE FROM entities');
  db.exec('DELETE FROM relationships');
}

const byType = new Map();
entities.forEach((e, index) => {
  const info = db
    .prepare('INSERT INTO entities (name, type_id, summary, fields) VALUES (?, ?, ?, ?)')
    .run(e.name, TYPES[e.type], e.summary, '{}');
  e.id = Number(info.lastInsertRowid);
  if (!byType.has(e.type)) byType.set(e.type, []);
  byType.get(e.type).push(e);
  e.index = index;
});

const people = byType.get('Character');
const places = byType.get('Location');
const nations = byType.get('Country');
const orgs = byType.get('Organisation');
const items = byType.get('Item');

const seen = new Set();
let relationshipCount = 0;
const insertEdge = db.prepare('INSERT OR IGNORE INTO relationships (source_id, target_id, label, notes) VALUES (?, ?, ?, ?)');
function edge(a, b, label, notes = '') {
  if (!a || !b || a.id === b.id) return;
  const key = `${a.id}|${b.id}|${label}`;
  if (seen.has(key)) return;
  seen.add(key);
  insertEdge.run(a.id, b.id, label, notes);
  relationshipCount += 1;
}

const reverse = {
  'parent of': 'child of',
  'child of': 'parent of',
  'sibling of': 'sibling of',
  'spouse of': 'spouse of',
  'ally of': 'ally of',
  'rival of': 'rival of',
  'friend of': 'friend of',
  'serves': 'commands',
  'commands': 'serves',
  'advises': 'is advised by',
  'leads': 'is led by',
  'member of': 'has member',
  'wields': 'is wielded by',
  'owns': 'is owned by',
  'lives in': 'is home to',
  'operates in': 'hosts',
  'found in': 'holds',
  'allied with': 'allied with',
};

const between = {
  person: ['ally of', 'rival of', 'sibling of', 'parent of', 'spouse of', 'friend of', 'serves', 'advises', 'betrayed'],
  personOrg: ['member of', 'leads', 'works for', 'founded', 'hunts'],
  personPlace: ['lives in', 'born in', 'fled from', 'guards'],
  personItem: ['wields', 'owns', 'seeks', 'lost'],
  orgPlace: ['operates in', 'headquartered in', 'abandoned'],
  orgOrg: ['rival of', 'allied with', 'funds', 'splintered from'],
  orgItem: ['hoards', 'forged', 'lost'],
  itemPlace: ['found in', 'hidden in', 'buried at'],
  nationOrg: ['charters', 'outlaws', 'taxes'],
  nationPlace: ['rules', 'claims', 'borders'],
  nationPerson: ['honours', 'exiles', 'employs'],
};

// Backbone: every person belongs to a guild, every guild sits somewhere.
for (let i = 0; i < people.length; i += 1) {
  const person = people[i];
  const org = orgs[i % orgs.length];
  edge(person, org, 'member of', pick(NOTES));
  const place = places[(i * 3) % places.length];
  edge(person, place, 'lives in');
}
orgs.forEach((org, i) => {
  edge(org, places[(i * 5 + 2) % places.length], 'operates in', pick(NOTES));
  edge(org, nations[i % nations.length], 'chartered by');
});
nations.forEach((nation, i) => {
  edge(nation, places[(i * 7) % places.length], 'rules');
  edge(nation, orgs[(i + 4) % orgs.length], 'outlaws');
});
items.forEach((item, i) => {
  edge(item, places[(i * 11 + 1) % places.length], 'found in', pick(NOTES));
  edge(people[(i * 13) % people.length], item, pick(['wields', 'owns', 'seeks']), pick(NOTES));
});

// Character webs: each person links to two others, plus a few longer jumps.
people.forEach((person, i) => {
  for (let k = 0; k < 2; k += 1) {
    const other = people[(i * 7 + k * 11 + 3) % people.length];
    const label = pick(between.person);
    edge(person, other, label, pick(NOTES));
    if (label in reverse && reverse[label] !== label && rand() < 0.35) {
      edge(other, person, reverse[label]);
    }
  }
});
for (let i = 0; i < 45; i += 1) {
  const a = pick(people);
  const b = pick(people);
  edge(a, b, pick(between.person), pick(NOTES));
}
for (let i = 0; i < 35; i += 1) {
  edge(pick(people), pick(orgs), pick(between.personOrg), pick(NOTES));
}
for (let i = 0; i < 30; i += 1) {
  edge(pick(orgs), pick(orgs), pick(between.orgOrg), pick(NOTES));
}
for (let i = 0; i < 30; i += 1) {
  edge(pick(people), pick(places), pick(between.personPlace), pick(NOTES));
}
for (let i = 0; i < 25; i += 1) {
  edge(pick(people), pick(items), pick(between.personItem), pick(NOTES));
}
for (let i = 0; i < 18; i += 1) {
  edge(pick(orgs), pick(items), pick(between.orgItem), pick(NOTES));
}
for (let i = 0; i < 24; i += 1) {
  edge(pick(items), pick(places), pick(between.itemPlace), pick(NOTES));
}
for (let i = 0; i < 20; i += 1) {
  edge(pick(nations), pick(people), pick(between.nationPerson), pick(NOTES));
}
for (let i = 0; i < 15; i += 1) {
  edge(pick(orgs), pick(places), pick(between.orgPlace), pick(NOTES));
}

// A few trashed cards so "Hide trashed" has something to do.
for (const person of [people[9], people[31], items[6], orgs[5]]) {
  db.prepare("UPDATE entities SET trashed_at = datetime('now') WHERE id = ?").run(person.id);
}

const counts = db.prepare('SELECT COUNT(*) AS n FROM entities').get().n;
console.log(`Demo database: ${dbPath}`);
console.log(`Seeded ${counts} entities and ${relationshipCount} relationships (4 in Trash).`);
console.log('Open it with: npm run dev:demo');
