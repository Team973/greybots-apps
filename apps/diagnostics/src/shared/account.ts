// Signing in to a greybots-apps account, to share the library with the
// team (#148).
//
// Nothing here may touch Node or the DOM.

import type { AppRole } from '@greybots/common/lib/user-roles';

export interface AccountStatus {
  signedIn: boolean;
  email: string | null;
  name: string | null;
  // The account's Diagnostics role.
  role: AppRole | null;
  syncing: boolean;
  // When the library last synced (ISO), this run of the app.
  lastSync: string | null;
  // Why the last sign-in or sync failed, or ''.
  problem: string;
  // False when the team's database hasn't had the Diagnostics migration.
  cloudReady: boolean;
}
