export const appName = "Preflight";
export const appVersion = __APP_VERSION__;

// IndexedDB database holding everything Preflight stores on the device.
export const databaseName = "preflight";

// How often to attempt a background sync while the app is open.
export const syncIntervalMs = 60_000;
// Delay after a local edit before pushing it, so bursts of edits batch up.
export const localChangeSyncDelayMs = 3_000;
// Timeout for the "can we actually reach the server" probe.
export const reachabilityTimeoutMs = 5_000;

// Kiosk mode defaults.
export const defaultIdleLockMinutes = 10;
export const minPinLength = 4;
export const maxPinLength = 8;

// Tab-scoped key remembering the signed-in kiosk user across page reloads.
export const kioskSessionKey = "preflight_kiosk_user";

// Schedule defaults.
export const defaultTeamNumber = 973;
// Length of the calendar block drawn for each match.
export const matchBlockMinutes = 8;
// How often a lead/admin device with the schedule open re-imports from TBA.
export const tbaAutoImportMs = 5 * 60_000;

// Build target. Web builds (Vercel) always run in personal/web mode and go
// straight to sign-in; desktop builds (`--mode desktop`) let the device be
// set up as a shared kiosk or a personal device.
export const isDesktopBuild = import.meta.env.VITE_DEPLOY_TARGET === 'desktop';
