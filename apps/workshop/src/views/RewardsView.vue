<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import { errorMessage } from '@/lib/db';
import { formatDate } from '@/lib/dates';
import {
  fetchBalances,
  fetchRedemptions,
  fetchRewards,
  redeem,
  redemptionStatusLabels,
  resolveRedemption,
  saveReward,
  type Redemption,
  type Reward
} from '@/lib/points';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// The rewards marketplace: spend GreyPoints on what leads and admins put up
// (a McFlurry, first pick of shop music...). Redeeming takes the points
// straight away; a lead hands the reward over and marks it received, and a
// cancelled redemption gives the points back.
const auth = useAuthStore();
const directory = useDirectoryStore();

const rewards = ref<Reward[]>([]);
const redemptions = ref<Redemption[]>([]);
const balance = ref(0);
const loaded = ref(false);
const error = ref('');
const message = ref('');
const busy = ref(false);

async function load() {
  error.value = '';
  try {
    const [r, all, balances] = await Promise.all([fetchRewards(), fetchRedemptions(), fetchBalances()]);
    rewards.value = r;
    redemptions.value = all;
    balance.value = balances.find((b) => b.user_id === auth.userId)?.balance ?? 0;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
onMounted(load);

const redeemedCount = computed(() => {
  const counts = new Map<string, number>();
  for (const r of redemptions.value) if (r.status !== 'cancelled' && r.reward_id) counts.set(r.reward_id, (counts.get(r.reward_id) ?? 0) + 1);
  return counts;
});
const left = (reward: Reward) => (reward.stock === null ? null : Math.max(0, reward.stock - (redeemedCount.value.get(reward.id) ?? 0)));
const onOffer = computed(() => rewards.value.filter((r) => r.active));
const mine = computed(() => redemptions.value.filter((r) => r.user_id === auth.userId));
const waiting = computed(() => redemptions.value.filter((r) => r.status === 'requested').reverse());

async function act(action: () => Promise<unknown>, done?: string) {
  error.value = '';
  message.value = '';
  busy.value = true;
  try {
    await action();
    if (done) message.value = done;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

// Redeeming takes two taps: Redeem, then Confirm.
const confirming = ref<string | null>(null);
const doRedeem = (reward: Reward) =>
  act(() => redeem(reward.id), `Redeemed ${reward.name}. A lead will hand it over.`).finally(() => (confirming.value = null));

// --- Managing rewards (leads and admins) ---
const editingReward = ref<Partial<Reward> | null>(null);
// A number input's v-model gives a number once something is typed, and ''
// while it's empty (no limit).
const stockText = ref<string | number>('');
const dialogError = ref('');
function openReward(reward?: Reward) {
  editingReward.value = reward ? { ...reward } : { name: '', description: '', cost: 50, stock: null, active: true };
  stockText.value = reward?.stock != null ? String(reward.stock) : '';
  dialogError.value = '';
}
async function saveEditing() {
  const reward = editingReward.value!;
  dialogError.value = '';
  const stock = String(stockText.value).trim() === '' ? null : Number(stockText.value);
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
    dialogError.value = 'Leave the quantity empty for no limit, or enter a whole number.';
    return;
  }
  try {
    await saveReward({ ...reward, name: reward.name ?? '', cost: Number(reward.cost), stock });
    editingReward.value = null;
    await load();
  } catch (e) {
    dialogError.value = errorMessage(e);
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Rewards</h1>
      <button v-if="auth.isLead" class="button primary" @click="openReward()">Add reward</button>
      <p class="hint">You have <strong>{{ balance }}</strong> GreyPoints to spend.</p>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="message" class="success-text">{{ message }}</p>

    <section v-if="auth.isLead && waiting.length" class="panel">
      <h2>To hand over ({{ waiting.length }})</h2>
      <ul class="list">
        <li v-for="r in waiting" :key="r.id">
          <span class="what">
            <span><strong>{{ directory.personName(r.user_id) }}</strong>: {{ r.reward_name }}</span>
            <small class="muted">{{ r.cost }} pts · {{ formatDate(r.requested_at) }}</small>
          </span>
          <button class="button small primary" :disabled="busy" @click="act(() => resolveRedemption(r.id, 'fulfilled'))">Handed over</button>
          <button class="button small" :disabled="busy" @click="act(() => resolveRedemption(r.id, 'cancelled'))">Cancel</button>
        </li>
      </ul>
    </section>

    <p v-if="!loaded" class="empty">Loading…</p>
    <div v-else-if="onOffer.length" class="rewards">
      <article v-for="reward in onOffer" :key="reward.id" class="panel reward">
        <div class="panel-header">
          <h2>{{ reward.name }}</h2>
          <span class="chip points">{{ reward.cost }} pts</span>
        </div>
        <p v-if="reward.description" class="description">{{ reward.description }}</p>
        <p v-if="left(reward) !== null" class="muted stock">{{ left(reward) }} left</p>
        <div class="reward-actions">
          <button v-if="auth.isLead" class="button small" @click="openReward(reward)">Edit</button>
          <span class="actions-spacer"></span>
          <template v-if="auth.isMember">
            <span v-if="left(reward) === 0" class="muted">Sold out</span>
            <span v-else-if="balance < reward.cost" class="muted">{{ reward.cost - balance }} more points</span>
            <button v-else-if="confirming !== reward.id" class="button primary" :disabled="busy" @click="confirming = reward.id">Redeem</button>
            <template v-else>
              <button class="button" @click="confirming = null">Back</button>
              <button class="button primary" :disabled="busy" @click="doRedeem(reward)">Confirm: spend {{ reward.cost }}</button>
            </template>
          </template>
        </div>
      </article>
    </div>
    <p v-else class="empty">No rewards on offer yet.<template v-if="auth.isLead"> Add one for people to work toward.</template></p>

    <section class="panel">
      <h2>Your redemptions</h2>
      <ul v-if="mine.length" class="list">
        <li v-for="r in mine" :key="r.id">
          <span class="what">
            {{ r.reward_name }}
            <small class="muted">{{ r.cost }} pts · {{ formatDate(r.requested_at) }} · {{ redemptionStatusLabels[r.status] }}</small>
          </span>
          <button v-if="r.status === 'requested'" class="button small" :disabled="busy" @click="act(() => resolveRedemption(r.id, 'cancelled'), 'Cancelled. Your points are back.')">
            Cancel
          </button>
        </li>
      </ul>
      <p v-else-if="loaded" class="empty">You haven't redeemed anything yet.</p>
    </section>

    <section v-if="auth.isLead && rewards.some((r) => !r.active)" class="panel">
      <h2>Hidden rewards</h2>
      <ul class="list">
        <li v-for="reward in rewards.filter((r) => !r.active)" :key="reward.id">
          <span class="what">{{ reward.name }} <small class="muted">{{ reward.cost }} pts</small></span>
          <button class="button small" @click="openReward(reward)">Edit</button>
        </li>
      </ul>
    </section>

    <AppDialog :open="!!editingReward" :title="editingReward?.id ? 'Edit reward' : 'Add a reward'" @close="editingReward = null">
      <form v-if="editingReward" id="reward-form" class="form-grid" @submit.prevent="saveEditing">
        <label class="field full">
          <span>Name</span>
          <input v-model="editingReward.name" type="text" maxlength="100" placeholder="e.g. McFlurry" required />
        </label>
        <label class="field full">
          <span>Description</span>
          <textarea v-model="editingReward.description" rows="2"></textarea>
        </label>
        <label class="field">
          <span>Cost (points)</span>
          <input v-model.number="editingReward.cost" type="number" min="1" step="1" required />
        </label>
        <label class="field">
          <span>How many (empty for no limit)</span>
          <input v-model="stockText" type="number" min="0" step="1" />
        </label>
        <label class="check">
          <input v-model="editingReward.active" type="checkbox" />
          On offer (untick to hide it)
        </label>
      </form>
      <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
      <template #actions>
        <button class="button" @click="editingReward = null">Cancel</button>
        <button type="submit" form="reward-form" class="button primary">Save</button>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
.rewards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}

.reward .description {
  margin: 0;
  white-space: pre-wrap;
}

.stock {
  margin: 0;
  font-size: 0.85rem;
}

.reward-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: auto;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.what {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 160px;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-basis: 100%;
}
</style>
