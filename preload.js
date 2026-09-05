'use strict';
// The single renderer↔main surface. No ipcRenderer is ever leaked —
// every channel is exposed as a promise-shaped function here.

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
  setDockIcon: (dataUrl) => ipcRenderer.invoke('dock:set-icon', { dataUrl }),

  createNotebook: (name, universeId) => ipcRenderer.invoke('notebook:create', { name, universeId }),
  renameNotebook: (id, name) => ipcRenderer.invoke('notebook:rename', { id, name }),
  deleteNotebook: (id) => ipcRenderer.invoke('notebook:delete', { id }),

  createUniverse: (name) => ipcRenderer.invoke('universe:create', { name }),
  renameUniverse: (id, name) => ipcRenderer.invoke('universe:rename', { id, name }),
  deleteUniverse: (id) => ipcRenderer.invoke('universe:delete', { id }),
  purgeUniverse: (id) => ipcRenderer.invoke('universe:purge', { id }),

  createSection: (notebookId, name, objectiveId) => ipcRenderer.invoke('section:create', { notebookId, name, objectiveId }),
  renameSection: (id, name) => ipcRenderer.invoke('section:rename', { id, name }),
  reorderSections: (order) => ipcRenderer.invoke('section:reorder', { order }),
  saveSection: (id, patch) => ipcRenderer.invoke('section:save', { id, patch }),
  deleteSection: (id) => ipcRenderer.invoke('section:delete', { id }),

  createPage: (sectionId, title) => ipcRenderer.invoke('page:create', { sectionId, title }),
  deletePage: (id) => ipcRenderer.invoke('page:delete', { id }),
  movePage: (id, toSectionId) => ipcRenderer.invoke('page:move', { id, toSectionId }),
  loadPage: (id) => ipcRenderer.invoke('page:load', { id }),
  savePage: (id, payload) => ipcRenderer.invoke('page:save', { id, ...payload }),
  pageVersions: (id) => ipcRenderer.invoke('page:versions', { id }),
  loadVersion: (id, versionId) => ipcRenderer.invoke('page:version:load', { id, versionId }),
  restoreVersion: (id, versionId) => ipcRenderer.invoke('page:version:restore', { id, versionId }),

  saveHunt: (notebookId, patch) => ipcRenderer.invoke('hunt:save', { notebookId, patch }),
  saveObjective: (notebookId, objective) => ipcRenderer.invoke('objective:save', { notebookId, objective }),
  deleteObjective: (notebookId, objectiveId) => ipcRenderer.invoke('objective:delete', { notebookId, objectiveId }),
  saveTask: (notebookId, task, sectionId) => ipcRenderer.invoke('task:save', { notebookId, task, sectionId }),
  deleteTask: (notebookId, taskId) => ipcRenderer.invoke('task:delete', { notebookId, taskId }),
  moveTask: (notebookId, taskId, toSectionId) => ipcRenderer.invoke('task:move', { notebookId, taskId, toSectionId }),
  taskDrop: (opts) => ipcRenderer.invoke('task:drop', opts),
  saveGroup: (group) => ipcRenderer.invoke('group:save', { group }),
  deleteGroup: (id) => ipcRenderer.invoke('group:delete', { id }),
  setBigPicture: (projectId, text) => ipcRenderer.invoke('bigpicture:set', { projectId, text }),
  resolveBigPicture: (projectId, text) => ipcRenderer.invoke('bigpicture:resolve', { projectId, text }),

  backupStatus: () => ipcRenderer.invoke('backup:status'),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  backupSetDest: (dest) => ipcRenderer.invoke('backup:setDest', { dest }),
  backupSync: () => ipcRenderer.invoke('backup:sync'),
  chooseDirectory: () => ipcRenderer.invoke('dialog:openDir'),


  listActivity: (limit, offset) => ipcRenderer.invoke('activity:list', { limit, offset }),
  listPages: () => ipcRenderer.invoke('pages:list'),
  search: (q) => ipcRenderer.invoke('search:query', { q }),
  threadsTimeline: (days) => ipcRenderer.invoke('threads:timeline', { days }),

  logToday: () => ipcRenderer.invoke('log:today'),
  stampGet: () => ipcRenderer.invoke('log:stamp:get'),
  stampSet: (date, patch) => ipcRenderer.invoke('log:stamp:set', { date, patch }),
  inboxCapture: (text) => ipcRenderer.invoke('inbox:capture', { text }),
  backlinks: (pageId) => ipcRenderer.invoke('pages:backlinks', { pageId }),
  onThisDay: () => ipcRenderer.invoke('activity:onThisDay'),
  debrief: (days) => ipcRenderer.invoke('activity:debrief', { days }),

  pasteImage: () => ipcRenderer.invoke('clipboard:readImage'),
  readClipboardText: () => ipcRenderer.invoke('clipboard:readText'),
  readClipboardHtml: () => ipcRenderer.invoke('clipboard:readHtml'),
  addAttachmentData: (bytes, ext, name) => ipcRenderer.invoke('attachment:addData', { bytes, ext, name }),
  addAttachmentFile: (filePath) => ipcRenderer.invoke('attachment:addFile', { filePath }),
  revealAttachment: (attachmentId) => ipcRenderer.invoke('attachment:reveal', { attachmentId }),
  openAttachment: (attachmentId) => ipcRenderer.invoke('attachment:open', { attachmentId }),
  openFileDialog: (filters) => ipcRenderer.invoke('dialog:open', { filters }),

  exportMarkdown: (name, markdown) => ipcRenderer.invoke('export:markdown', { name, markdown }),
  exportPdf: (name, html) => ipcRenderer.invoke('export:pdf', { name, html }),
};

contextBridge.exposeInMainWorld('api', api);