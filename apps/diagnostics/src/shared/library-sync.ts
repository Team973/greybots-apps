// What a sync does (#148), worked out from the items here and in the cloud
// before anything's changed, so the rules can be tested on their own. By
// whether an item changed here and there since it was last synced (`cloud`
// on the item says when, and what it was then):
//   - in the cloud only: brought here;
//   - here only, never synced: sent (members and above);
//   - here only, synced before: deleted in the cloud by a lead, so deleted here;
//   - changed on one side: that side's copy wins;
//   - changed on both: the one changed last wins.
//
// Nothing here may touch Node or the DOM.

import type { LibraryItem } from './library';

export interface SyncPlan {
  // From the cloud, to keep here.
  bring: LibraryItem[];
  // From here, to send.
  send: LibraryItem[];
  // Gone from the cloud: to delete here.
  remove: LibraryItem[];
}

export const changedHere = (item: LibraryItem) => !item.cloud || item.changed !== item.cloud.changedAtSync;

export function planSync(local: readonly LibraryItem[], remote: readonly LibraryItem[], canSend: boolean): SyncPlan {
  const plan: SyncPlan = { bring: [], send: [], remove: [] };
  const there = new Map(remote.map((item) => [item.id, item]));
  for (const item of local) {
    const theirs = there.get(item.id);
    there.delete(item.id);
    if (!theirs) {
      if (item.cloud) plan.remove.push(item);
      else if (canSend) plan.send.push(item);
      continue;
    }
    const changedThere = !item.cloud || theirs.changed !== item.cloud.changedAtSync;
    if (changedHere(item) && (!changedThere || item.changed > theirs.changed)) {
      if (canSend) plan.send.push(item);
    } else if (changedThere) {
      plan.bring.push(theirs);
    }
  }
  plan.bring.push(...there.values());
  return plan;
}
