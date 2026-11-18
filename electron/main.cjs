'use strict';

// Electron main process for DocWriter.
//
// It boots the existing Express + node:sqlite server in-process on a free
// localhost port, then opens a native window pointed at it. The renderer is the
// same Vite build as the web app and talks to the server over /api, so no
// Node/Electron APIs are exposed to the page (contextIsolation stays on).

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DEV = process.env.DOCWRITER_DEV === '1';
const projectRoot = path.join(__dirname, '..');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

// Where the book lives:
//   1. DOCWRITER_DB env (explicit override)
//   2. the book chosen via the Book menu (Open book… / New book…)
//   3. a data/docwriter.db next to the app in dev (so `npm run desktop`
//      opens the book you have been working on)
//   4. the per-user data dir (packaged default)
function resolveDbPath() {
  if (process.env.DOCWRITER_DB) return process.env.DOCWRITER_DB;
  const chosen = readSettings().dbPath;
  if (chosen) return chosen;
  const devDb = path.join(projectRoot, 'data', 'docwriter.db');
  if (!app.isPackaged && fs.existsSync(devDb)) return devDb;
  return path.join(app.getPath('userData'), 'docwriter.db');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/types`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`server did not become ready on port ${port}`);
}

async function startServer() {
  process.env.DOCWRITER_DB = resolveDbPath();
  const port = await freePort();
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  await import(pathToFileURL(path.join(projectRoot, 'server', 'index.mjs')).href);
  await waitForServer(port);
  console.log(`[docwriter] book: ${process.env.DOCWRITER_DB}`);
  console.log(`[docwriter] ui:   http://127.0.0.1:${port}`);
  return port;
}

let win = null;

// Export as Markdown, seen from the renderer: a native Save dialog in front of
// the window, then the bytes on disk. The suggested name is reduced to its
// basename, so a renderer cannot steer the dialog at a directory of its choosing.
ipcMain.handle('docwriter:save-text', async (_event, name, text) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export as Markdown',
    defaultPath: path.join(app.getPath('documents'), path.basename(String(name || 'docwriter-export.md'))),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (canceled || !filePath) return { saved: false };
  await fs.promises.writeFile(filePath, String(text ?? ''), 'utf8');
  return { saved: true, filePath };
});

// --- book switching ---------------------------------------------------------
//
// The page picks the file (so it can ask about unsaved work first), then asks
// for the restart. Both paths stay inside the main process: the renderer never
// receives a directory handle or a writable path it can invent.

ipcMain.handle('docwriter:choose-book', () => pickBook());
ipcMain.handle('docwriter:choose-new-book', () => pickNewBook());

ipcMain.handle('docwriter:open-book-at', (_event, filePath) => {
  const resolved = typeof filePath === 'string' ? path.resolve(filePath) : '';
  if (!/\.db$/i.test(resolved)) return { ok: false, error: 'That is not a DocWriter book file.' };
  try {
    if (!fs.statSync(resolved).isFile()) return { ok: false, error: 'That is not a file.' };
  } catch {
    return { ok: false, error: 'That file is gone.' };
  }
  relaunchWithDb(resolved);
  return { ok: true };
});

// --- keybindings ------------------------------------------------------------

ipcMain.handle('docwriter:get-keys', () => keymap);

ipcMain.handle('docwriter:set-key', (_event, id, accelerator) => {
  if (!keys || !keys.KEY_ACTIONS.some((action) => action.id === id)) {
    return { ok: false, error: 'Unknown shortcut.' };
  }
  if (typeof accelerator !== 'string') return { ok: false, error: 'Unknown key.' };
  const checked = keys.validateKeymap({ ...keymap, [id]: accelerator }, process.platform === 'darwin');
  if (!checked.ok) return { ok: false, error: checked.error };
  keymap = checked.keys;
  writeSettings({ keybindings: keymap });
  return { ok: true, keys: keymap };
});

ipcMain.handle('docwriter:reset-keys', () => {
  if (!keys) return { ok: false, keys: keymap };
  keymap = { ...keys.DEFAULT_KEYS };
  writeSettings({ keybindings: keymap });
  return { ok: true, keys: keymap };
});

async function createWindow() {
  const url = DEV
    ? process.env.DOCWRITER_DEV_URL || 'http://localhost:5173'
    : `http://127.0.0.1:${await startServer()}`;

  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#14120f',
    title: 'DocWriter',
    // Windows/taskbars that read the window icon rather than the desktop entry.
    icon: path.join(projectRoot, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Gives the page window.docwriter.saveTextFile — nothing else. See preload.cjs.
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false);
    wireShortcuts(win);
  }

  // Optional memory log for measurement runs: DOCWRITER_MEM=1 prints Electron's
  // own per-process metrics every 5 s. Nothing runs unless the env var is set.
  if (process.env.DOCWRITER_MEM === '1') {
    const timer = setInterval(() => {
      if (!win) return clearInterval(timer);
      const rows = app.getAppMetrics().map(
        (m) => `${m.type}#${m.pid}=${Math.round(m.memory.workingSetSize / 1024)}MB`
      );
      console.log(`[mem] ${rows.join(' ')}`);
    }, 5000);
    win.on('closed', () => clearInterval(timer));
  }

  win.loadURL(url);
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
    console.error(`[window] failed to load ${failedUrl}: ${desc} (${code})`);
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    win = null;
  });
}

function relaunchWithDb(dbPath) {
  writeSettings({ dbPath });
  app.relaunch();
  app.exit(0);
}

// --- keyboard ---------------------------------------------------------------
//
// server/keys.mjs owns the table and the matcher (the page imports the same
// file), so a binding shown in Settings is the binding this window obeys. It is
// ESM and main is CJS, so it arrives through one dynamic import at boot.

let keys = null;
let keymap = {};

async function loadKeys() {
  keys = await import(pathToFileURL(path.join(projectRoot, 'server', 'keys.mjs')).href);
  // Anything unreadable in the settings file falls back to the defaults as a
  // whole: a half-applied keyboard is worse than a known one.
  const checked = keys.validateKeymap(
    { ...keys.DEFAULT_KEYS, ...(readSettings().keybindings ?? {}) },
    process.platform === 'darwin'
  );
  keymap = checked.ok ? checked.keys : { ...keys.DEFAULT_KEYS };
  return keymap;
}

async function pickBook() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open a DocWriter book',
    filters: [{ name: 'DocWriter book', extensions: ['db'] }],
    properties: ['openFile'],
  });
  return canceled || !filePaths[0] ? null : filePaths[0];
}

async function pickNewBook() {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Create a new book',
    defaultPath: path.join(app.getPath('documents'), 'my-book.db'),
    filters: [{ name: 'DocWriter book', extensions: ['db'] }],
  });
  return canceled || !filePath ? null : filePath;
}

// The macOS menu still calls these directly; the page goes through the two
// pickers first so it can ask about unsaved work before the window restarts.
async function openBook() {
  const filePath = await pickBook();
  if (filePath) relaunchWithDb(filePath);
}

async function newBook() {
  const filePath = await pickNewBook();
  if (filePath) relaunchWithDb(filePath);
}

function wireShortcuts(window) {
  const zoomBy = (factor) => {
    const wc = window.webContents;
    wc.setZoomFactor(Math.min(3, Math.max(0.5, wc.getZoomFactor() * factor)));
  };

  // Only the actions the page cannot perform for itself run here. The rest fall
  // through untouched, so the page's handler — and its unsaved-changes guard —
  // sees the key exactly as typed.
  const windowActions = {
    quit: () => app.quit(),
    zoomIn: () => zoomBy(1.1),
    zoomOut: () => zoomBy(1 / 1.1),
    zoomReset: () => window.webContents.setZoomFactor(1),
    fullscreen: () => window.setFullScreen(!window.isFullScreen()),
  };

  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    // Developer keys are not rebindable and never exist in a packaged build.
    if (!app.isPackaged) {
      const devLetter = input.key.toLowerCase();
      if (input.key === 'F12' && !input.control && !input.alt) {
        event.preventDefault();
        window.webContents.toggleDevTools();
        return;
      }
      if (input.control && !input.alt && !input.meta) {
        if (devLetter === 'r' && input.shift) {
          event.preventDefault();
          window.webContents.reloadIgnoringCache();
          return;
        }
        if (devLetter === 'r' && !input.shift) {
          event.preventDefault();
          window.webContents.reload();
          return;
        }
        if (devLetter === 'i' && input.shift) {
          event.preventDefault();
          window.webContents.toggleDevTools();
          return;
        }
      }
    }

    const action = keys?.findAction(
      {
        key: input.key,
        ctrlKey: input.control,
        metaKey: input.meta,
        altKey: input.alt,
        shiftKey: input.shift,
      },
      keymap
    );
    const run = action ? windowActions[action] : null;
    if (!run) return;
    event.preventDefault();
    run();
  });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Book…',
          accelerator: 'CmdOrCtrl+O',
          click: openBook,
        },
        {
          label: 'New Book…',
          accelerator: 'CmdOrCtrl+N',
          click: newBook,
        },
        { type: 'separator' },
        {
          label: 'Reveal Book File',
          click: () => shell.showItemInFolder(process.env.DOCWRITER_DB || resolveDbPath()),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About DocWriter',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'DocWriter',
              message: `DocWriter ${app.getVersion()}`,
              detail: `Offline paste-to-worldbible.\n\nBook file:\n${process.env.DOCWRITER_DB || resolveDbPath()}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One window per book; a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app
    .whenReady()
    .then(async () => {
      await loadKeys();
      if (process.platform === 'darwin') buildMenu();
      else Menu.setApplicationMenu(null);
      return createWindow();
    })
    .catch((err) => {
      dialog.showErrorBox('DocWriter could not start', String((err && err.stack) || err));
      app.quit();
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
