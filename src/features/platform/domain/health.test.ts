import { describe, expect, it } from 'vitest';
import { evaluatePaymentSli, publishedStatus } from './health.ts';

describe('publishedStatus (BR15.3)', () => {
  it('changes only after three consecutive agreeing results', () => {
    expect(publishedStatus('operational', ['down', 'down'])).toBe('operational');
    expect(publishedStatus('operational', ['operational', 'down', 'down', 'down'])).toBe('down');
    expect(publishedStatus('down', ['operational', 'down', 'operational'])).toBe('down');
  });
});

describe('evaluatePaymentSli edges', () => {
  const policy = { sliPercent: 90, windowMinutes: 5 };
  it('does not alert without samples covering the whole window', () => {
    expect(
      evaluatePaymentSli(
        [{ at: '2026-11-13T10:03:00.000Z', successRate: 0 }],
        '2026-11-13T10:05:00.000Z',
        policy,
      ),
    ).toEqual({ shouldAlert: false });
    expect(evaluatePaymentSli([], '2026-11-13T10:05:00.000Z', policy)).toEqual({
      shouldAlert: false,
    });
  });
  it('treats exactly 90% as meeting the SLI', () => {
    const samples = [0, 5].map((m) => ({ at: `2026-11-13T10:0${m}:00.000Z`, successRate: 0.9 }));
    expect(evaluatePaymentSli(samples, '2026-11-13T10:05:00.000Z', policy)).toEqual({
      shouldAlert: false,
    });
  });
});
