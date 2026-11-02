// Reading what the other plots under the chart show (#144): whole values
// (poses) or series, for a span, read again when the session, the signals
// or the span change. A few changes close together are one read, and a read
// overtaken by a newer one is dropped.

import { onUnmounted, ref, shallowRef, watch, type Ref } from 'vue';

import type { SignalRecords } from '@shared/plots';
import type { SignalSeries } from '@shared/signals';

const settleMs = 60;

const cleanError = (error: Error) => error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function useReads<T>(
  session: Ref<string>,
  keys: Ref<string[]>,
  span: Ref<[number, number]>,
  read: (session: string, key: string, span: [number, number]) => Promise<T | null>,
  // Anything else that, changed, means reading again.
  also: () => unknown = () => null
) {
  const data = shallowRef(new Map<string, T | null>());
  const error = ref('');
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load() {
    const mine = ++request;
    const id = session.value;
    const wanted = [...new Set(keys.value.filter(Boolean))];
    if (!id || wanted.length === 0) {
      data.value = new Map();
      return;
    }
    const range: [number, number] = [span.value[0], span.value[1]];
    const errors: string[] = [];
    const results = await Promise.all(wanted.map((key) => read(id, key, range).catch((e: Error) => {
      errors.push(cleanError(e));
      return null;
    })));
    if (mine !== request) return;
    error.value = [...new Set(errors)].join(' ');
    data.value = new Map(wanted.map((key, i) => [key, results[i]]));
  }

  watch([session, () => keys.value.join('\n'), () => span.value[0], () => span.value[1], also], () => {
    clearTimeout(timer);
    timer = setTimeout(load, settleMs);
  }, { immediate: true });
  onUnmounted(() => clearTimeout(timer));

  return { data, error };
}

// Every value of each signal over the span, whole.
export function useRecords(session: Ref<string>, keys: Ref<string[]>, span: Ref<[number, number]>, max = 20000) {
  const { data, error } = useReads<SignalRecords>(session, keys, span, (id, key, [start, end]) =>
    window.diagnostics.readRecords(id, key, { start, end }, max));
  return { records: data, error };
}

// Each signal's series over the span: with no `maxPoints`, every value (for
// text and states).
export function useSeries(session: Ref<string>, keys: Ref<string[]>, span: Ref<[number, number]>, maxPoints?: Ref<number | undefined>) {
  const { data, error } = useReads<SignalSeries>(session, keys, span, (id, key, [start, end]) =>
    window.diagnostics.readSignal(id, key, { start, end, ...(maxPoints?.value ? { maxPoints: maxPoints.value } : {}) }),
  () => maxPoints?.value);
  return { series: data, error };
}
