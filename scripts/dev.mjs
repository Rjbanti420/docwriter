import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const procs = [];
let shuttingDown = false;

function run(name, cmd, args) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`[${name}] exited with code ${code}`);
    shutdown();
  });
  procs.push(p);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    try {
      p.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', process.execPath, ['--watch', join(root, 'server', 'index.mjs')]);
run('web', join(root, 'node_modules', '.bin', 'vite'), []);
