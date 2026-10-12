'use strict';

// Electron main process for DocWriter.
//
// It boots the existing Express + node:sqlite server in-process on a free
// localhost port, then opens a native window pointed at it. The renderer is the
// same Vite build as the web app and talks to the server over /api, so no
// Node/Electron APIs are exposed to the page (contextIsolation stays on).

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
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
//   2. the book chosen via File -> Open/New Book
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
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Book…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
              title: 'Open a DocWriter book',
              filters: [{ name: 'DocWriter book', extensions: ['db'] }],
              properties: ['openFile'],
            });
            if (!canceled && filePaths[0]) relaunchWithDb(filePaths[0]);
          },
        },
        {
          label: 'New Book…',
          accelerator: 'CmdOrCtrl+N',
          click: async () => {
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
              title: 'Create a new book',
              defaultPath: path.join(app.getPath('documents'), 'my-book.db'),
              filters: [{ name: 'DocWriter book', extensions: ['db'] }],
            });
            if (!canceled && filePath) relaunchWithDb(filePath);
          },
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
    .then(() => {
      buildMenu();
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
