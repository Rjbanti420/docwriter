#!/usr/bin/env node

// Measures DocWriter's memory for one scenario, then writes samples to CSV.
//
//   node scripts/measure-ram.mjs --scenario cold   --idle 60
//   node scripts/measure-ram.mjs --scenario large  --db /tmp/opencode/ram/large.db --idle 60
//   node scripts/measure-ram.mjs --scenario nav    --db /tmp/opencode/ram/large.db --idle 30
//   node scripts/measure-ram.mjs --scenario soak   --db /tmp/opencode/ram/large.db --soak 900 --idle 0
//
// One scenario per launch, because each scenario needs a fresh app process.
// PSS is read from smaps_rollup (shared pages counted once per process), RSS
// from status, and CPU% from the stat jiffy deltas between samples.
//
// Everything here is measurement only: no app behaviour is changed, and the
// database it opens is always a temp file you pass in.

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
}

const scenario = arg('scenario', 'cold');
const app = resolve(arg('app', resolve(repo, 'release/DocWriter-0.1.0.AppImage')));
const db = resolve(arg('db', '/tmp/opencode/ram/empty.db'));
const out = resolve(arg('out', '/tmp/opencode/ram/samples.csv'));
const metaOut = resolve(arg('meta', '/tmp/opencode/ram/meta.jsonl'));
const idleSeconds = Number(arg('idle', 60));
const soakSeconds = Number(arg('soak', 0));
const intervalMs = Number(arg('interval', 2000));
const port = Number(arg('port', 9650));
const userData = `/tmp/opencode/ram/ud-${scenario}`;
const logPath = `/tmp/opencode/ram/${scenario}.log`;

mkdirSync(dirname(out), { recursive: true });
mkdirSync(dirname(db), { recursive: true });
rmSync(userData, { recursive: true, force: true });

if (!existsSync(db)) {
  console.error(`no database at ${db} — run scripts/gen-ram-book.mjs first (or pass an empty --db path)`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- process tree and per-process numbers -----------------------------------

function procCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
  } catch {
    return '';
  }
}

function roleOf(pid) {
  const cmd = procCmdline(pid);
  if (cmd.includes('--type=renderer')) return 'renderer';
  if (cmd.includes('--type=gpu-process')) return 'gpu';
  if (cmd.includes('--type=zygote')) return 'zygote';
  if (cmd.includes('--type=utility')) {
    if (cmd.includes('network.mojom.NetworkService')) return 'utility-network';
    if (cmd.includes('node.mojom.NodeService')) return 'utility-node';
    return 'utility';
  }
  if (cmd.includes('crashpad')) return 'crashpad';
  return cmd.includes('docwriter') ? 'main' : 'other';
}

function processTable() {
  const table = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const fields = stat.slice(close + 2).split(' ');
      table.set(pid, { ppid: Number(fields[1]), jiffies: Number(fields[11]) + Number(fields[12]) });
    } catch {
      /* process went away */
    }
  }
  return table;
}

function descendants(rootPid, table) {
  const children = new Map();
  for (const [pid, info] of table) {
    if (!children.has(info.ppid)) children.set(info.ppid, []);
    children.get(info.ppid).push(pid);
  }
  const result = [];
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    result.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return result;
}

function kbFrom(file, key) {
  try {
    const match = readFileSync(file, 'utf8').match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

// --- launch ----------------------------------------------------------------

const logFd = openSync(logPath, 'a');
const spawnedAt = Date.now();
const child = spawn(
  app,
  ['--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  {
    env: { ...process.env, DOCWRITER_DB: db },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  }
);
child.unref();

let firstSampleAt = null;
let readyAt = null;
let prevJiffies = new Map();
let lastSampleAt = Date.now();
let stopped = false;

if (!existsSync(out)) writeFileSync(out, 'timestamp,scenario,pid,role,pss_mb,rss_mb,cpu_pct\n');

function sample() {
  if (stopped || !child.pid) return;
  const now = Date.now();
  const dt = (now - lastSampleAt) / 1000;
  if (dt <= 0) return;
  lastSampleAt = now;
  const table = processTable();
  const pids = descendants(child.pid, table);
  const at = new Date(now).toISOString();
  let totalPss = 0;
  let totalRss = 0;
  let totalCpu = 0;
  let rows = 0;
  const nextJiffies = new Map();

  for (const pid of pids) {
    const pssKb = kbFrom(`/proc/${pid}/smaps_rollup`, 'Pss');
    if (pssKb == null) continue;
    const rssKb = kbFrom(`/proc/${pid}/status`, 'VmRSS') ?? 0;
    const jiffies = table.get(pid)?.jiffies;
    let cpu = '';
    if (jiffies != null) {
      nextJiffies.set(pid, jiffies);
      const prev = prevJiffies.get(pid);
      if (prev != null) cpu = ((jiffies - prev) / (100 * dt)) * 100;
    }
    const row = [
      at,
      scenario,
      pid,
      roleOf(pid),
      (pssKb / 1024).toFixed(1),
      (rssKb / 1024).toFixed(1),
      cpu === '' ? '' : cpu.toFixed(1),
    ].join(',');
    appendFileSync(out, row + '\n');
    totalPss += pssKb;
    totalRss += rssKb;
    if (cpu !== '') totalCpu += cpu;
    rows++;
  }
  prevJiffies = nextJiffies;
  if (rows > 0) {
    appendFileSync(
      out,
      [at, scenario, 'total', 'total', (totalPss / 1024).toFixed(1), (totalRss / 1024).toFixed(1), totalCpu.toFixed(1)].join(',') +
        '\n'
    );
    if (!firstSampleAt) firstSampleAt = now;
  }
  return rows;
}

const sampler = setInterval(sample, intervalMs);

// --- CDP helpers ------------------------------------------------------------

async function findPage(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (page) return page;
    } catch {
      /* not listening yet */
    }
    await sleep(300);
  }
  throw new Error('the app never exposed a page on the debug port');
}

function connect(page) {
  return new Promise((resolveConnection, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const api = {
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const n = ++id;
          pending.set(n, { res, rej });
          ws.send(JSON.stringify({ id: n, method, params }));
        });
      },
      async ev(expression) {
        const r = await api.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
        return r.result.value;
      },
      close: () => ws.close(),
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    };
    ws.onerror = () => reject(new Error('CDP websocket failed'));
    ws.onopen = () => resolveConnection(api);
  });
}

async function waitFor(api, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await api.ev(expression)) return true;
    await sleep(250);
  }
  return false;
}

// --- scenarios --------------------------------------------------------------

async function navigate(api, chapterCount) {
  // 50 different chapters, spread across the book rather than the first 50.
  const stride = Math.max(1, Math.floor(chapterCount / 50));
  for (let i = 0; i < Math.min(50, chapterCount); i++) {
    const index = (i * stride) % chapterCount;
    await api.ev(
      `(() => { const b=[...document.querySelectorAll('.dw-chapter')][${index}]; if (!b) return false; b.click(); return true; })()`
    );
    await sleep(450);
  }
  for (const label of ['Read', 'Review', 'Planning', 'Timeline', 'Bible']) {
    await api.ev(
      `(() => { const b=[...document.querySelectorAll('.dw-nav__item')].find(e=>(e.textContent||'').trim()===${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`
    );
    await sleep(1200);
  }
  // DocWriter has no Relationships graph; the Timeline Map and the Bible grid
  // are the closest graph-like surfaces, so they stand in for it.
  await api.ev(`[...document.querySelectorAll('.dw-nav__item')].find(e=>(e.textContent||'').trim()==='Timeline')?.click()`);
  await sleep(1500);
  await api.ev(`[...document.querySelectorAll('.tabs [role=tab]')].find(e=>e.textContent.includes('Story'))?.click()`);
  await sleep(1200);
  await api.ev(`[...document.querySelectorAll('.tabs [role=tab]')].find(e=>e.textContent.includes('Map'))?.click()`);
  await sleep(1200);
  await api.ev(`[...document.querySelectorAll('.dw-nav__item')].find(e=>(e.textContent||'').trim()==='Bible')?.click()`);
  await sleep(1500);
  await api.ev(`document.querySelector('.entity-card')?.click()`);
  await sleep(1200);
  await api.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await api.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await sleep(400);
}

async function soak(api, chapterCount, seconds) {
  const deadline = Date.now() + seconds * 1000;
  const views = ['Read', 'Review', 'Planning', 'Timeline', 'Bible'];
  let iteration = 0;
  while (Date.now() < deadline) {
    const index = (iteration * 97) % chapterCount;
    await api.ev(
      `(() => { const b=[...document.querySelectorAll('.dw-chapter')][${index}]; if (!b) return false; b.click(); return true; })()`
    );
    await sleep(200);
    await api.ev(`document.querySelector('.main')?.scrollBy(0, 900)`);
    await sleep(120);
    await api.ev(`document.querySelector('.main')?.scrollBy(0, 900)`);
    if (iteration % 3 === 0) {
      const view = views[Math.floor(iteration / 3) % views.length];
      await api.ev(
        `(() => { const b=[...document.querySelectorAll('.dw-nav__item')].find(e=>(e.textContent||'').trim()===${JSON.stringify(view)}); if (!b) return false; b.click(); return true; })()`
      );
    }
    iteration++;
    await sleep(150);
  }
  return iteration;
}

// --- run --------------------------------------------------------------------

(async () => {
  try {
    const page = await findPage();
    const api = await connect(page);
    await api.send('Page.enable');
    await api.send('Page.bringToFront');
    if (await waitFor(api, `!!document.querySelector('.dw-sidebar')`, 60000)) readyAt = Date.now();
    await sleep(400);
    await api.ev(`document.querySelector('[aria-label="Close reminder"]')?.click()`);

    if (scenario === 'nav') {
      const chapters = await api.ev(`document.querySelectorAll('.dw-chapter').length`);
      await navigate(api, chapters);
    } else if (scenario === 'soak') {
      const chapters = await api.ev(`document.querySelectorAll('.dw-chapter').length`);
      const iterations = await soak(api, chapters, soakSeconds);
      console.log(`soak: ${iterations} iterations`);
    }

    await sleep(idleSeconds * 1000);
    api.close();
  } catch (error) {
    console.error(`[${scenario}] ${error.message}`);
    process.exitCode = 1;
  } finally {
    stopped = true;
    clearInterval(sampler);
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    await sleep(4000);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    const meta = {
      scenario,
      app,
      db,
      spawnedAt: new Date(spawnedAt).toISOString(),
      msToFirstSample: firstSampleAt ? firstSampleAt - spawnedAt : null,
      msToReady: readyAt ? readyAt - spawnedAt : null,
      durationSeconds: Math.round((Date.now() - spawnedAt) / 1000),
      intervalMs,
      idleSeconds,
      soakSeconds,
      electronVersion: JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')).devDependencies.electron,
      appBytes: statSync(app).size,
    };
    appendFileSync(metaOut, JSON.stringify(meta) + '\n');
    console.log(JSON.stringify(meta));
  }
})();
