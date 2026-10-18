'use strict';

// The renderer's only door to the desktop. Everything else still goes over /api,
// and contextIsolation stays on. A sandboxed preload may require('electron'), so
// no other node modules are needed here.
//
// Why a bridge at all: a browser cannot say "save this file here" without a
// picker, and only the main process can put a real Save dialog on screen.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('docwriter', {
  // Resolves { saved: boolean, filePath? }; saved is false when the writer cancels.
  saveTextFile: (name, text) => ipcRenderer.invoke('docwriter:save-text', name, text),
});
