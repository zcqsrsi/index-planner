'use strict';
// Export: save Markdown and PDF copies of pages / sub-objectives / projects.
// The renderer builds the content (it owns the block vocabulary); this
// module only asks where to put it and writes the bytes.

const { ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const store = require('./store');

function sanitizeName(name) {
  const clean = String(name || 'Export').replace(/[\\/:*?"<>|]/g, '-').trim();
  return clean || 'Export';
}

async function askDestination(win, defaultName, filters) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters,
  });
  return canceled ? null : filePath;
}

function registerExportIpc() {
  ipcMain.handle('export:markdown', async (e, { name, markdown }) => {
    const dest = await askDestination(BrowserWindow.fromWebContents(e.sender),
      `${sanitizeName(name)}.md`, [{ name: 'Markdown', extensions: ['md'] }]);
    if (!dest) return null;
    await fsp.writeFile(dest, String(markdown || ''), 'utf8');
    await store.appendActivity({ type: 'export', summary: `Exported “${path.basename(dest)}” as Markdown` });
    return dest;
  });

  // The PDF is printed from an offscreen window so the page's own layout
  // never leaks into it: the renderer hands over a full standalone HTML
  // document, we print it, and the temp file is gone immediately after.
  ipcMain.handle('export:pdf', async (e, { name, html }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const dest = await askDestination(win, `${sanitizeName(name)}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
    if (!dest) return null;
    const tmp = path.join(os.tmpdir(), `index-export-${Date.now()}.html`);
    await fsp.writeFile(tmp, String(html || ''), 'utf8');
    const print = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    try {
      await print.loadFile(tmp);
      const pdf = await print.webContents.printToPDF({
        printBackground: true,
        margin: { top: 0.8, bottom: 0.8, left: 0.7, right: 0.7 },
      });
      await fsp.writeFile(dest, pdf);
    } finally {
      print.destroy();
      fs.rm(tmp, { force: true }, () => {});
    }
    await store.appendActivity({ type: 'export', summary: `Exported “${path.basename(dest)}” as PDF` });
    return dest;
  });
}

module.exports = { registerExportIpc };