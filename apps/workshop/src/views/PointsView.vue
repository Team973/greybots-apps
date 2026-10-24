<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { errorMessage } from '@/lib/db';
import { formatDate } from '@/lib/dates';
import {
  adjustPoints,
  awardKindLabels,
  awardTitle,
  deleteAward,
  fetchAwards,
  fetchBalances,
  giveRecognition,
  recognitionLevels,
  type PointAward,
  type PointBalance,
  type RecognitionLevel
} from '@/lib/points';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// GreyPoints: your balance and where it came from, the leaderboards (this
// season and all time), and, for leads and admins, team recognitions. Admins
// can also correct a balance, with a reason.
const auth = useAuthStore();
const directory = useDirectoryStore();

const balances = ref<PointBalance[]>([]);
const history = ref<PointAward[]>([]);
const recent = ref<PointAward[]>([]);
const loaded = ref(false);
const error = ref('');
const board = ref<'season' | 'all'>('season');

async function load() {
  error.value = '';
  try {
    const [b, mine, all] = await Promise.all([fetchBalances(), fetchAwards(auth.userId!), fetchAwards(undefined, 30)]);
    balances.value = b;
    history.value = mine;
    recent.value = all.filter((a) => a.kind !== 'ticket');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
onMounted(load);

const me = computed(() => balances.value.find((b) => b.user_id === auth.userId));
const season = new Date().getFullYear();
const leaderboard = computed(() => {
  const key = board.value === 'season' ? 'season_earned' : 'earned';
  const rows = balances.value.filter((b) => b[key] > 0).sort((a, b) => b[key] - a[key] || (a.name ?? '').localeCompare(b.name ?? ''));
  // Ties share a rank.
  let rank = 0;
  return rows.map((row, i) => {
    if (i === 0 || row[key] !== rows[i - 1][key]) rank = i + 1;
    return { row, rank, points: row[key] };
  });
});
const peak = computed(() => Math.max(1, ...leaderboard.value.map((r) => r.points)));

// --- Recognitions (leads and admins) ---
const recipient = ref('');
const level = ref<RecognitionLevel>('shoutout');
const reason = ref('');
const formMessage = ref('');
const formError = ref('');
const saving = ref(false);
const others = computed(() => directory.assignable.filter((p) => p.user_id !== auth.userId));

async function recognize() {
  formError.value = '';
  formMessage.value = '';
  if (!recipient.value) {
    formError.value = 'Pick who to recognize.';
    return;
  }
  saving.value = true;
  try {
    await giveRecognition(recipient.value, level.value, reason.value);
    const points = recognitionLevels.find((l) => l.key === level.value)!.points;
    formMessage.value = `${directory.personName(recipient.value)} got ${points} points.`;
    recipient.value = '';
    reason.value = '';
    await load();
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// --- Adjustments (admins) ---
const adjustWho = ref('');
const adjustPointsValue = ref<number | null>(null);
const adjustNote = ref('');
const adjustError = ref('');
async function adjust() {
  adjustError.value = '';
  if (!adjustWho.value) {
    adjustError.value = 'Pick whose points to adjust.';
    return;
  }
  saving.value = true;
  try {
    await adjustPoints(adjustWho.value, Number(adjustPointsValue.value), adjustNote.value);
    adjustWho.value = '';
    adjustPointsValue.value = null;
    adjustNote.value = '';
    await load();
  } catch (e) {
    adjustError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function undo(award: PointAward) {
  error.value = '';
  try {
    await deleteAward(award.id);
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  }
}
const canUndo = (award: PointAward) => auth.isAdmin && (award.kind === 'recognition' || award.kind === 'adjustment');
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>GreyPoints</h1>
      <RouterLink to="/rewards" class="button">Rewards</RouterLink>
      <p class="hint">Earn points by completing tickets with a bounty and through team recognitions, then spend them on rewards.</p>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>

    <div class="tiles">
      <div class="panel tile">
        <span class="muted">To spend</span>
        <span class="value">{{ me?.balance ?? 0 }}</span>
      </div>
      <div class="panel tile">
        <span class="muted">Earned in {{ season }}</span>
        <span class="value">{{ me?.season_earned ?? 0 }}</span>
      </div>
      <div class="panel tile">
        <span class="muted">Earned all time</span>
        <span class="value">{{ me?.earned ?? 0 }}</span>
      </div>
    </div>

    <section class="panel">
      <div class="panel-header">
        <h2>Leaderboard</h2>
        <div class="segmented" role="group" aria-label="Leaderboard period">
          <button :class="{ on: board === 'season' }" @click="board = 'season'">{{ season }} season</button>
          <button :class="{ on: board === 'all' }" @click="board = 'all'">All time</button>
        </div>
      </div>
      <ol v-if="leaderboard.length" class="board">
        <li v-for="{ row, rank, points } in leaderboard" :key="row.user_id" :class="{ me: row.user_id === auth.userId }">
          <span class="rank">{{ rank }}</span>
          <span class="name">{{ row.name || 'Unnamed' }}</span>
          <span class="bar-track" aria-hidden="true"><span class="bar" :style="{ width: `${(points / peak) * 100}%` }"></span></span>
          <span class="board-points">{{ points }}</span>
        </li>
      </ol>
      <p v-else-if="loaded" class="empty">Nobody has earned points {{ board === 'season' ? 'this season' : '' }} yet.</p>
    </section>

    <section v-if="auth.isLead" class="panel">
      <h2>Give a team recognition</h2>
      <p class="hint">Fixed points for each level. You can't recognize yourself.</p>
      <form class="form-grid" @submit.prevent="recognize">
        <label class="field">
          <span>Who</span>
          <select v-model="recipient">
            <option value="">Pick someone</option>
            <option v-for="p in others" :key="p.user_id" :value="p.user_id">{{ p.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>Level</span>
          <select v-model="level">
            <option v-for="l in recognitionLevels" :key="l.key" :value="l.key">{{ l.label }} · {{ l.points }} pts ({{ l.hint }})</option>
          </select>
        </label>
        <label class="field full">
          <span>For</span>
          <input v-model="reason" type="text" maxlength="200" placeholder="What they did" />
        </label>
        <div class="form-actions">
          <p v-if="formError" class="error-text">{{ formError }}</p>
          <p v-if="formMessage" class="success-text">{{ formMessage }}</p>
          <button type="submit" class="button primary" :disabled="saving">Recognize</button>
        </div>
      </form>
    </section>

    <section v-if="auth.isAdmin" class="panel">
      <h2>Adjust points</h2>
      <p class="hint">For corrections. Use a negative number to take points away. The reason shows in their history.</p>
      <form class="form-grid" @submit.prevent="adjust">
        <label class="field">
          <span>Who</span>
          <select v-model="adjustWho">
            <option value="">Pick someone</option>
            <option v-for="p in directory.assignable" :key="p.user_id" :value="p.user_id">{{ p.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>Points</span>
          <input v-model.number="adjustPointsValue" type="number" step="1" />
        </label>
        <label class="field full">
          <span>Reason</span>
          <input v-model="adjustNote" type="text" maxlength="200" />
        </label>
        <div class="form-actions">
          <p v-if="adjustError" class="error-text">{{ adjustError }}</p>
          <button type="submit" class="button" :disabled="saving">Adjust</button>
        </div>
      </form>
    </section>

    <section class="panel">
      <h2>Your points</h2>
      <ul v-if="history.length" class="history">
        <li v-for="award in history" :key="award.id">
          <span class="award-points" :class="{ negative: award.points < 0 }">{{ award.points > 0 ? '+' : '' }}{{ award.points }}</span>
          <span class="award-what">
            {{ awardTitle(award) }}
            <small class="muted">{{ awardKindLabels[award.kind] }} · {{ formatDate(award.awarded_at) }}</small>
          </span>
        </li>
      </ul>
      <p v-else-if="loaded" class="empty">No points yet. Complete a ticket with a bounty to earn some.</p>
    </section>

    <section v-if="recent.length" class="panel">
      <h2>Recent recognitions</h2>
      <ul class="history">
        <li v-for="award in recent" :key="award.id">
          <span class="award-points" :class="{ negative: award.points < 0 }">{{ award.points > 0 ? '+' : '' }}{{ award.points }}</span>
          <span class="award-what">
            {{ directory.personName(award.user_id) }}: {{ awardTitle(award) }}
            <small class="muted">from {{ directory.personName(award.awarded_by) }} · {{ formatDate(award.awarded_at) }}</small>
          </span>
          <button v-if="canUndo(award)" class="button small danger" @click="undo(award)">Remove</button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.tile {
  gap: 2px;
}

.value {
  font-size: clamp(1.6rem, 4vw, 2.4rem);
  font-weight: 700;
  line-height: 1.1;
}

.board {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.board li {
  display: grid;
  grid-template-columns: 2.2em minmax(90px, 1fr) 2fr 3.5em;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
}

.board li.me {
  background: rgba(176, 87, 3, 0.14);
  font-weight: 600;
}

.rank {
  opacity: 0.6;
  text-align: right;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-track {
  height: 10px;
}

.bar {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: 0 4px 4px 0;
  background: #b05703;
}

.board-points {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-basis: 100%;
}

.history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history li {
  display: flex;
  align-items: center;
  gap: 12px;
}

.award-points {
  min-width: 3em;
  font-weight: 700;
  color: #3a9e3a;
  font-variant-numeric: tabular-nums;
}

.award-points.negative {
  color: #e5534b;
}

.award-what {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 560px) {
  .tiles {
    grid-template-columns: 1fr 1fr;
  }

  .tiles .tile:first-child {
    grid-column: span 2;
  }

  .board li {
    grid-template-columns: 2em 1fr 3em;
  }

  .bar-track {
    display: none;
  }
}
</style>
