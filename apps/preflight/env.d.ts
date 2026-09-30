/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vue" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  // 'desktop' for pit laptop/kiosk builds (`--mode desktop`); unset for web.
  readonly VITE_DEPLOY_TARGET?: string;
}
