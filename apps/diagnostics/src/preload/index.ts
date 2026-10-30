import { contextBridge, ipcRenderer } from 'electron';

import { ipcChannels, type DiagnosticsApi } from '@shared/ipc';

// The only way from the window to the main process: each function in
// DiagnosticsApi becomes a call on the channel of the same name. The window
// never gets ipcRenderer itself.
const api = Object.fromEntries(
  ipcChannels.map((channel) => [channel, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])
) as unknown as DiagnosticsApi;

contextBridge.exposeInMainWorld('diagnostics', api);
