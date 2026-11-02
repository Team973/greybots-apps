import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import type { DiagnosticsApi } from '@shared/ipc';
import { libraryKinds, type LibraryKind } from '@shared/library';
import { starterLibrary } from '@shared/starters';
import { normalizeSettings, settingsErrors, type Settings } from '@shared/settings';
import { accountName, accountStatus, deleteItem, signIn, signOut, startCloudSync, syncLibrary, syncSoon } from './cloud-sync';
import { checkConnection } from './connection-check';
import { chooseImport, importStatus, runImport } from './import-service';
import { earlierRuns, liveStatus } from './live-service';
import { getLibraryItem, listLibrary, saveLibraryItem, storeLibraryItem } from './library-store';
import { offloadedFiles, offloadStatus, runOffload, watchForRobot } from './offload-service';
import { deleteNote, saveNote } from './notes-store';
import { addModel, listModels, readModelFile, removeModel } from './robot-models';
import { deleteReport, generateReport, listReports, loadReport, pipelineStatus, runPipelines } from './reports';
import { loadSettings, storeSettings } from './settings-store';
import {
  acceptCtreLicense,
  downloadOwlet,
  hootStatus,
  openSignalLog,
  readValues,
  owletStatus,
  readRecords,
  readSignal,
  sessionEvents,
  signalLogs,
  watchOwlet
} from './signals-service';
import { dataDirectory, ensureStorageLayout, openDataDirectory, storageInfo } from './storage';

let mainWindow: BrowserWindow | null = null;

// The most values one readRecords sends.
const maxRecords = 20000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    title: 'Greybots Diagnostics',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The window is a web page and is treated like one: no Node, and only
      // the functions the preload script hands it.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Nothing in the app opens another window or leaves the app's own page.
  // Web links go to the person's browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  // electron-vite sets this while `npm run dev` is serving the window.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

// One handler per function the window can call (see shared/ipc.ts).
// Notes go only on logs in the data folder: the window names the log.
async function knownLog(settings: Settings, id: string) {
  if (!(await signalLogs(settings)).some((log) => log.id === id)) throw new Error('That log is not in the data folder.');
}

function libraryKind(kind: unknown): LibraryKind {
  if (!libraryKinds.includes(kind as LibraryKind)) throw new Error('There is no such kind of library item.');
  return kind as LibraryKind;
}

const handlers: DiagnosticsApi = {
  async getAppInfo() {
    return { version: app.getVersion(), platform: process.platform };
  },
  async getSettings() {
    return loadSettings();
  },
  async saveSettings(settings) {
    // Accepting CTRE's licence is its own step (acceptCtreLicense), not
    // something a Save from an older copy of the settings can undo.
    const next = { ...normalizeSettings(settings), ctreLicenseAccepted: (await loadSettings()).ctreLicenseAccepted };
    const errors = settingsErrors(next);
    if (Object.keys(errors).length > 0) return { settings: await loadSettings(), errors };

    await storeSettings(next);
    return { settings: next, errors };
  },
  async importLogs(paths, fallbackTeam) {
    return runImport(paths, fallbackTeam);
  },
  async getImportStatus() {
    return importStatus();
  },
  async chooseImport(folders) {
    return chooseImport(folders);
  },
  async chooseDataDirectory() {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose where diagnostics data is kept',
      defaultPath: dataDirectory(await loadSettings()),
      properties: ['openDirectory', 'createDirectory']
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  },
  async getStorageInfo() {
    return storageInfo(await loadSettings());
  },
  async openDataDirectory() {
    return openDataDirectory(await loadSettings());
  },
  async checkConnection() {
    return checkConnection(await loadSettings());
  },
  async getOffloadStatus() {
    return offloadStatus();
  },
  async startOffload() {
    return runOffload(false);
  },
  async getOffloadedFiles(query) {
    return offloadedFiles(await loadSettings(), query);
  },
  async getSignalLogs() {
    return signalLogs(await loadSettings());
  },
  async openSignalLog(id) {
    return openSignalLog(await loadSettings(), id);
  },
  async readSignal(id, key, range) {
    return readSignal(await loadSettings(), id, key, range);
  },
  async readRecords(id, key, range, max) {
    return readRecords(await loadSettings(), id, String(key), range, Math.max(1, Math.min(Number(max) || 1, maxRecords)));
  },
  async getHootStatus(id) {
    return hootStatus(await loadSettings(), id);
  },
  async readValues(id, keys, time) {
    return readValues(await loadSettings(), id, keys, time);
  },
  async getEvents(id) {
    return sessionEvents(await loadSettings(), id);
  },
  async saveNote(id, note) {
    const settings = await loadSettings();
    await knownLog(settings, id);
    return saveNote(settings, id, { id: typeof note.id === 'string' ? note.id : undefined, time: Number(note.time), text: String(note.text) });
  },
  async deleteNote(id, noteId) {
    const settings = await loadSettings();
    await knownLog(settings, id);
    return deleteNote(settings, id, String(noteId));
  },
  async copyImage(png) {
    // Only a PNG: the window says what goes on the clipboard, not anything.
    const bytes = new Uint8Array(png);
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!signature.every((byte, i) => bytes[i] === byte)) return "That isn't an image.";
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    return '';
  },
  async getLiveStatus(id) {
    return liveStatus(id);
  },
  async getEarlierRuns() {
    return earlierRuns();
  },
  async getOwletStatus() {
    return owletStatus();
  },
  async acceptCtreLicense() {
    return acceptCtreLicense();
  },
  async downloadOwlet() {
    return downloadOwlet();
  },
  async getLibrary<K extends LibraryKind>(kind: K) {
    return listLibrary(await loadSettings(), libraryKind(kind) as K);
  },
  async saveLibraryItem(item) {
    libraryKind((item as { kind?: unknown })?.kind);
    const saved = await saveLibraryItem(await loadSettings(), item, accountName());
    syncSoon();
    return saved;
  },
  async deleteLibraryItem(kind, id) {
    return deleteItem(await loadSettings(), libraryKind(kind), String(id));
  },
  async addStarters() {
    const settings = await loadSettings();
    let added = 0;
    for (const item of starterLibrary()) {
      if (await getLibraryItem(settings, item.kind, item.id)) continue;
      await storeLibraryItem(settings, item);
      added += 1;
    }
    if (added) syncSoon();
    return added;
  },
  async getReports() {
    return listReports(await loadSettings());
  },
  async getReport(id) {
    return loadReport(await loadSettings(), String(id));
  },
  async generateReport(templateId, logId) {
    const settings = await loadSettings();
    await knownLog(settings, logId);
    return generateReport(settings, String(templateId), logId);
  },
  async deleteReport(id) {
    return deleteReport(await loadSettings(), String(id));
  },
  async runPipeline(pipelineId, logIds) {
    const settings = await loadSettings();
    for (const id of logIds) await knownLog(settings, id);
    return runPipelines(logIds, 'manual', String(pipelineId));
  },
  async getPipelineStatus() {
    return pipelineStatus();
  },
  async getRobotModels() {
    return listModels(await loadSettings());
  },
  async addRobotModel() {
    const options: Electron.OpenDialogOptions = {
      title: "Choose a robot model's folder (with model.glb in it)",
      properties: ['openDirectory']
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return addModel(await loadSettings(), result.filePaths[0]);
  },
  async removeRobotModel(id) {
    return removeModel(await loadSettings(), String(id));
  },
  async readModelFile(id, file) {
    return readModelFile(await loadSettings(), String(id), String(file));
  },
  async savePdf(suggestedName) {
    if (!mainWindow) return '';
    const name = `${String(suggestedName).replace(/[<>:"/\|?* -]/g, '_').slice(0, 150) || 'Report'}.pdf`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save the report as a PDF',
      defaultPath: join(app.getPath('documents'), name),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return '';
    const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    await fs.writeFile(result.filePath, pdf);
    return result.filePath;
  },
  async getAccount() {
    return accountStatus();
  },
  async signIn(email, password) {
    return signIn(String(email), String(password));
  },
  async signOut() {
    return signOut();
  },
  async syncLibrary() {
    return syncLibrary();
  }
};

// A second copy would fight the first over the robot and the data folder, so
// starting the app again just brings the running one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.handle(channel, (_event, ...args: unknown[]) => (handler as (...a: unknown[]) => unknown)(...args));
    }

    // A data folder that can't be made (a missing drive, say) mustn't stop
    // the app from opening: the Storage page reports it.
    await ensureStorageLayout(dataDirectory(await loadSettings())).catch((error) => console.error(error));

    createWindow();
    watchForRobot();
    watchOwlet();
    startCloudSync().catch((error) => console.error(error));

    // macOS: clicking the dock icon with no windows open makes one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Everywhere but macOS, closing the window quits the app.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
