// In-process metrics hooks (counters, gauges, histograms). The production exporter
// (OpenTelemetry / Prometheus) is deferred by the human's decision of 2026-11-13; this registry
// is the hook it will read from. Labels must be low-cardinality enums or names, never personal data.

type Labels = Readonly<Record<string, string>>;

function keyOf(name: string, labels: Labels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`);
  return `${name}{${parts.join(',')}}`;
}

export type Metrics = {
  increment(name: string, labels?: Labels, by?: number): void;
  setGauge(name: string, value: number, labels?: Labels): void;
  observe(name: string, value: number, labels?: Labels): void;
  counterValue(name: string, labels?: Labels): number;
  gaugeValue(name: string, labels?: Labels): number | undefined;
  observations(name: string, labels?: Labels): readonly number[];
  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> };
};

export function createMetrics(): Metrics {
  const counters = new Map<string, number>();
  const gauges = new Map<string, number>();
  const histograms = new Map<string, number[]>();
  return {
    increment(name, labels = {}, by = 1) {
      const key = keyOf(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + by);
    },
    setGauge(name, value, labels = {}) {
      gauges.set(keyOf(name, labels), value);
    },
    observe(name, value, labels = {}) {
      const key = keyOf(name, labels);
      const list = histograms.get(key) ?? [];
      list.push(value);
      // Keep memory bounded: only the most recent 1000 observations per series.
      if (list.length > 1000) list.shift();
      histograms.set(key, list);
    },
    counterValue: (name, labels = {}) => counters.get(keyOf(name, labels)) ?? 0,
    gaugeValue: (name, labels = {}) => gauges.get(keyOf(name, labels)),
    observations: (name, labels = {}) => histograms.get(keyOf(name, labels)) ?? [],
    snapshot: () => ({
      counters: Object.fromEntries(counters),
      gauges: Object.fromEntries(gauges),
    }),
  };
}

/** Process-wide registry. */
export const metrics: Metrics = createMetrics();
