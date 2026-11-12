/// <reference types="vite/client" />

import type { DiagnosticsApi } from '@shared/ipc';

declare global {
  // The app's version (package.json), put in by Vite (electron.vite.config.ts).
  const __APP_VERSION__: string;
  interface Window {
    // Put there by the preload script (src/preload/index.ts).
    diagnostics: DiagnosticsApi;
    droppedFiles: { pathFor(file: File): string };
  }
}
