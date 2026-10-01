<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import '@material/web/button/filled-button';
import { useNow } from '@greybots/common/lib/now';
import ScriptChecklistBlock from '@/components/script/ScriptChecklistBlock.vue';
import { useBatteries } from '@/lib/batteries/use-batteries';
import {
  getAdhocChecklists,
  getChecklistSequence,
  getPitRoles,
  getPracticeChecklist,
  type ChecklistDef,
  type ChecklistSequence,
  type PitRole
} from '@/lib/checklists/config';
import { useLiveQuery } from '@/lib/live-query';
import { formatTime } from '@/lib/schedule/dates';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import { defaultMatchPrep, getMatchPrep, type MatchPrep } from '@/lib/schedule/timing';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';
import { buildGenericChecklists, buildMatchScripts, type ScriptMatch } from '@/lib/script/event-script';

// Event script (leads and admins): the rest of the event on paper, one
// checklist per sheet so each can be handed to whoever is doing it. For each
// upcoming match, a sheet per pre-match checklist (with the match's times
// and alliance, worked out for that match) and a sheet per post-match
// checklist, then a blank copy of every checklist. "Print" opens the
// browser's print dialog, which prints it or saves it as a PDF; only the
// script itself prints. Built entirely from what's on the device, so it
// works offline.
const now = useNow(60_000);

const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? '');
const items = useLiveQuery<ScheduleItem[]>(() => (eventKey.value ? listScheduleItems(eventKey.value) : []), [], eventKey);
const sequence = useLiveQuery<ChecklistSequence>(getChecklistSequence, { checklists: [] });
const practice = useLiveQuery<ChecklistDef | null>(getPracticeChecklist, null);
const adhoc = useLiveQuery<ChecklistDef[]>(getAdhocChecklists, []);
const roles = useLiveQuery<PitRole[]>(getPitRoles, []);
const prep = useLiveQuery<MatchPrep>(getMatchPrep, defaultMatchPrep);
const { batteries, uses } = useBatteries();

// --- What to include ---
const includeMatches = ref(true);
const includeGeneric = ref(true);
const includeInstructions = ref(true);

const matchScripts = computed(() =>
  buildMatchScripts({
    matches: items.value,
    now: now.value,
    sequence: sequence.value,
    roles: roles.value,
    prep: prep.value,
    batteries: batteries.value,
    uses: uses.value
  })
);
const generic = computed(() => buildGenericChecklists(sequence.value, practice.value, adhoc.value, roles.value));
const hasChecklists = computed(() => sequence.value.checklists.length > 0);
const nothingToPrint = computed(() => !(includeMatches.value && matchScripts.value.length) && !(includeGeneric.value && generic.value.length));

const printedAt = computed(() =>
  new Date(now.value).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
);
const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'numeric', day: 'numeric' });
const clock = (ms: number) => formatTime(new Date(ms).toISOString());

function bumperLine(match: ScriptMatch): string {
  const { swap, from, to } = match.bumpers;
  if (!to) return 'Alliance not known yet';
  if (swap === true && from) return `SWAP ${from.toUpperCase()} → ${to.toUpperCase()}`;
  if (swap === false) return `Stay ${to.toUpperCase()} (no swap)`;
  return `${to.toUpperCase()} (check what's on the robot)`;
}

// The sheets printed before a match: one per pre-match checklist, or a single
// sheet with just the match's facts when there are none.
const beforeSheets = (match: ScriptMatch) => (match.before.length ? match.before : [null]);

const print = () => window.print();
</script>

<template>
  <div class="script-view">
    <header class="controls no-print">
      <div class="heading">
        <h1>Event script</h1>
        <p class="hint">
          The rest of the event on paper: a page per upcoming match with its checklists already worked out, then a blank copy of every
          checklist. Print it, or choose “Save as PDF” in the print dialog.
        </p>
      </div>
      <div class="options">
        <label><input v-model="includeMatches" type="checkbox" /> Match pages ({{ matchScripts.length }} upcoming)</label>
        <label><input v-model="includeGeneric" type="checkbox" /> Blank checklists ({{ generic.length }})</label>
        <label><input v-model="includeInstructions" type="checkbox" /> Step instructions</label>
        <md-filled-button :disabled="nothingToPrint" @click="print">Print / save as PDF</md-filled-button>
      </div>
      <p v-if="!activeEvent" class="hint">
        No event is set up, so there are no matches to script. <RouterLink to="/schedule" class="panel-link">Set one up on the Schedule page.</RouterLink>
      </p>
      <p v-else-if="!matchScripts.length" class="hint">No upcoming matches on the schedule. Import them from TBA on the Schedule page.</p>
      <p v-if="!hasChecklists" class="hint">
        No pit checklists are set up, so match pages will only have the times. <RouterLink to="/pit-setup" class="panel-link">Add them on Pit setup.</RouterLink>
      </p>
    </header>

    <!-- Everything below is the paper. Always black on white. -->
    <div class="paper">
      <template v-if="includeMatches">
        <!-- One checklist per sheet. A match's pre-match checklists come first,
             each with the match's times and alliance, then its post-match
             ones. (A match with no pre-match checklist still gets its facts.) -->
        <template v-for="match in matchScripts" :key="match.key">
        <article v-for="(checklist, i) in beforeSheets(match)" :key="`b${i}`" class="sheet">
          <header class="sheet-head">
            <div>
              <p class="kicker">{{ activeEvent?.name }} · Team {{ activeEvent?.team_number }} · before the match</p>
              <h2>{{ match.title }}</h2>
            </div>
            <div class="alliance" :class="match.alliance ?? 'unknown'">{{ match.alliance ? match.alliance.toUpperCase() : 'TBD' }}</div>
          </header>

          <dl class="facts">
            <div><dt>Match</dt><dd>{{ match.estimated ? '~' : '' }}{{ formatTime(match.start) }}</dd><dd class="sub">{{ day(match.start) }}</dd></div>
            <div><dt>Start prep by</dt><dd>{{ clock(match.prepAt) }}</dd></div>
            <div><dt>Queue by</dt><dd>{{ clock(match.queueAt) }}</dd></div>
            <div><dt>Bumpers</dt><dd class="text">{{ bumperLine(match) }}</dd></div>
            <div><dt>Battery</dt><dd>{{ match.batteryNumber ?? '—' }}</dd><dd class="sub">next in rotation</dd></div>
          </dl>
          <p v-if="match.alliance" class="teams">
            <strong>With:</strong> {{ match.partners.join(', ') || '—' }} &nbsp; <strong>Against:</strong> {{ match.opponents.join(', ') || '—' }}
          </p>

          <ScriptChecklistBlock v-if="checklist" :checklist="checklist" :show-instructions="includeInstructions" />

          <footer class="sheet-foot">
            Times are as of {{ printedAt }} and move with the field. Notes: <span class="foot-line"></span>
          </footer>
        </article>
        <article v-for="(checklist, i) in match.after" :key="`a${i}`" class="sheet">
          <header class="sheet-head">
            <div>
              <p class="kicker">{{ activeEvent?.name }} · Team {{ activeEvent?.team_number }} · after the match</p>
              <h2>After {{ match.title }}</h2>
            </div>
            <div class="alliance" :class="match.alliance ?? 'unknown'">{{ match.alliance ? match.alliance.toUpperCase() : 'TBD' }}</div>
          </header>
          <p class="fill-in">Robot back in the pit at: <span class="fill short"></span> Result: <span class="fill"></span></p>
          <ScriptChecklistBlock :checklist="checklist" :show-instructions="includeInstructions" />
          <footer class="sheet-foot">Notes: <span class="foot-line"></span></footer>
        </article>
        </template>
      </template>

      <template v-if="includeGeneric">
        <article v-for="item in generic" :key="item.key" class="sheet">
          <header class="sheet-head">
            <div>
              <p class="kicker">{{ item.group }} · blank copy · Team {{ activeEvent?.team_number ?? '' }}</p>
              <h2>{{ item.checklist.name }}</h2>
            </div>
          </header>
          <p class="fill-in">
            Match: <span class="fill"></span> Alliance: <span class="fill short"></span> Bumpers on robot: <span class="fill short"></span>
            Time: <span class="fill short"></span>
          </p>
          <ScriptChecklistBlock :checklist="item.checklist" :show-instructions="includeInstructions" />
          <footer class="sheet-foot">Notes: <span class="foot-line"></span></footer>
        </article>
      </template>

      <p v-if="nothingToPrint" class="nothing no-print">Nothing to print with these options.</p>
    </div>
  </div>
</template>

<style scoped>
.script-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 8.5in;
}

.heading h1 {
  margin: 0;
  font-size: 1.8rem;
}

.hint {
  margin: 4px 0 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

.options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
}

.options label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.options md-filled-button {
  margin-left: auto;
}

/* On screen: a stack of letter-size sheets. On paper: one sheet per page. */
.paper {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 8.5in;
}

.sheet {
  padding: 0.5in;
  box-sizing: border-box;
  background: #fff;
  color: #000;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10pt;
  line-height: 1.25;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}

.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.2in;
}

.kicker {
  margin: 0;
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sheet-head h2 {
  margin: 0;
  font-size: 26pt;
  line-height: 1.05;
}

/* The alliance as a word in a box, so it reads on a black-and-white printer. */
.alliance {
  flex: none;
  padding: 0.04in 0.16in;
  border: 2.5pt solid #000;
  font-size: 20pt;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.alliance.red {
  border-color: #c62828;
  color: #c62828;
}

.alliance.blue {
  border-color: #1565c0;
  color: #1565c0;
}

.facts {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.08in;
  margin: 0.12in 0 0;
}

.facts div {
  padding: 0.05in 0.08in;
  border: 1pt solid #000;
}

.facts dt {
  font-size: 7.5pt;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.facts dd {
  margin: 0;
  font-size: 15pt;
  font-weight: 700;
  line-height: 1.1;
}

.facts dd.text {
  font-size: 10pt;
}

.facts dd.sub {
  font-size: 7.5pt;
  font-weight: 400;
}

.teams {
  margin: 0.08in 0 0;
}

.fill-in {
  margin: 0.14in 0 0;
}

.fill {
  display: inline-block;
  width: 1.6in;
  margin: 0 0.12in 0 0.04in;
  border-bottom: 0.7pt solid #000;
}

.fill.short {
  width: 0.8in;
}

.sheet-foot {
  display: flex;
  align-items: flex-end;
  gap: 0.08in;
  margin-top: 0.2in;
  font-size: 8pt;
}

.foot-line {
  flex: 1;
  border-bottom: 0.7pt solid #000;
}

.nothing {
  opacity: 0.7;
}

@media print {
  .script-view,
  .paper {
    display: block;
    max-width: none;
  }

  /* The page margins come from @page. */
  .sheet {
    padding: 0;
    box-shadow: none;
  }

  /* Every sheet after the first starts a new page: one checklist per page. */
  .sheet + .sheet {
    break-before: page;
    page-break-before: always;
  }
}
</style>

<style>
/* Applies while this page is the one being printed. */
@media print {
  @page {
    size: letter portrait;
    margin: 0.5in;
  }

  /* Paper is white whatever the app theme is. */
  html,
  body,
  #app {
    background: #fff !important;
  }

  .testing-banner,
  .update-banner {
    display: none !important;
  }
}
</style>
