import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';

import type { DiagnosticsApi } from '@shared/ipc';
import { normalizeSettings, settingsErrors } from '@shared/settings';
import { checkConnection } from './connection-check';
import { offloadedFiles, offloadStatus, runOffload, watchForRobot } from './offload-service';
import { loadSettings, storeSettings } from './settings-store';
import {
  acceptCtreLicense,
  downloadOwlet,
  hootStatus,
  openSignalLog,
  owletStatus,
  readSignal,
  signalLogs,
  watchOwlet
} from './signals-service';
import { dataDirectory, ensureStorageLayout, openDataDirectory, storageInfo } from './storage';

let mainWindow: BrowserWindow | null = null;

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
  async getOffloadedFiles() {
    return offloadedFiles(await loadSettings());
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
  async getHootStatus(id) {
    return hootStatus(await loadSettings(), id);
  },
  async getOwletStatus() {
    return owletStatus();
  },
  async acceptCtreLicense() {
    return acceptCtreLicense();
  },
  async downloadOwlet() {
    return downloadOwlet();
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
    // the app from opening: the Overview page reports it.
    await ensureStorageLayout(dataDirectory(await loadSettings())).catch((error) => console.error(error));

    createWindow();
    watchForRobot();
    watchOwlet();

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
