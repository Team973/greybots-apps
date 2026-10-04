/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Where each app lives. Set these in the deployment (or a .env.local) to
  // override the defaults in src/lib/apps.ts.
  readonly VITE_GREYSCOUT_URL?: string;
  readonly VITE_PREFLIGHT_URL?: string;
}
