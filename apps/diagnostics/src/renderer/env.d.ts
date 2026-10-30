/// <reference types="vite/client" />

import type { DiagnosticsApi } from '@shared/ipc';

declare global {
  interface Window {
    // Put there by the preload script (src/preload/index.ts).
    diagnostics: DiagnosticsApi;
  }
}
