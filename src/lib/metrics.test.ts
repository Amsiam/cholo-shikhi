import { describe, expect, it } from 'vitest';
import { createMetrics } from './metrics.ts';

describe('metrics hooks', () => {
  it('counts per label set regardless of label order', () => {
    const m = createMetrics();
    m.increment('x_total', { a: '1', b: '2' });
    m.increment('x_total', { b: '2', a: '1' }, 2);
    expect(m.counterValue('x_total', { a: '1', b: '2' })).toBe(3);
    expect(m.counterValue('x_total')).toBe(0);
  });
  it('stores gauges and bounded histograms', () => {
    const m = createMetrics();
    m.setGauge('backlog_age_seconds', 4, { partition: '0' });
    expect(m.gaugeValue('backlog_age_seconds', { partition: '0' })).toBe(4);
    for (let i = 0; i < 1005; i++) m.observe('latency_ms', i);
    expect(m.observations('latency_ms')).toHaveLength(1000);
    expect(m.snapshot().gauges).toHaveProperty('backlog_age_seconds{partition=0}', 4);
  });
});
