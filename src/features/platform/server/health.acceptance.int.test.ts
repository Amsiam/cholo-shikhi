// [AT] US9.5 (local part: health probes and the status payload) and US9.6 (P1 alert rule).
// The hosted status page and phone paging are deferred by the human's decision of 2026-11-13.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMetrics } from '#src/lib/metrics.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { evaluatePaymentSli } from '../domain/health.ts';
import { createHealth } from './health.server.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

const clock = fixedClock('2026-11-13T10:00:00.000Z');
const healthy = () =>
  createHealth({
    db: t.db,
    clock,
    metrics: createMetrics(),
    pingValkey: async () => true,
    relayBacklogSeconds: async () => 1,
  });

describe('US9.5 Status page fed by our health checks (local part)', () => {
  it('AC9.5.1 Given all services are healthy, When the status is read, Then every component is operational with the time of the last check', async () => {
    const status = await healthy().checkAndRecord();
    expect(status.overall).toBe('operational');
    expect(
      status.components.every(
        (c) => c.status === 'operational' && c.checkedAt === '2026-11-13T10:00:00.000Z',
      ),
    ).toBe(true);
  });

  it('AC9.5.3 Given the data sent to the status provider, When inspected, Then it holds only component states and check times', async () => {
    const payload = (await healthy().checkAndRecord()).components;
    for (const component of payload)
      expect(Object.keys(component).sort()).toEqual(['checkedAt', 'component', 'status']);
  });

  it('readiness reports down when the database or Valkey is unreachable', async () => {
    const broken = createHealth({
      db: t.db,
      clock,
      metrics: createMetrics(),
      pingValkey: async () => false,
      relayBacklogSeconds: async () => 1,
    });
    const status = await broken.readiness();
    expect(status.isReady).toBe(false);
    expect(status.checks.valkey).toBe('down');
    expect(status.checks.database).toBe('up');
  });
});

describe('US9.6 Get alerted to revenue-affecting incidents', () => {
  const at = (minute: number) => `2026-11-13T10:${String(minute).padStart(2, '0')}:00.000Z`;

  it('AC9.6.1 Given payment confirmation below 90% for 5 minutes, When monitoring evaluates, Then a P1 alert is raised with the incident name and links', () => {
    const samples = [0, 1, 2, 3, 4, 5].map((m) => ({ at: at(m), successRate: 0.7 }));
    const decision = evaluatePaymentSli(samples, at(5), { sliPercent: 90, windowMinutes: 5 });
    expect(decision).toMatchObject({
      shouldAlert: true,
      incident: 'payment_confirmation_degraded',
      severity: 'P1',
    });
    expect(decision.shouldAlert && decision.links.runbook).toMatch(/^\/docs\/runbooks\//);
  });

  it('AC9.6.2 Given a 2-minute blip that recovers, When monitoring evaluates, Then no P1 alert fires', () => {
    const samples = [0, 1, 2, 3, 4, 5].map((m) => ({
      at: at(m),
      successRate: m === 1 || m === 2 ? 0.5 : 0.99,
    }));
    expect(evaluatePaymentSli(samples, at(5), { sliPercent: 90, windowMinutes: 5 })).toEqual({
      shouldAlert: false,
    });
  });

  it('raises the P1 hook as a logged event (paging deferred)', async () => {
    const onP1 = vi.fn();
    clock.set(at(5));
    const h = createHealth({
      db: t.db,
      clock,
      metrics: createMetrics(),
      pingValkey: async () => true,
      relayBacklogSeconds: async () => 1,
      onP1,
    });
    h.evaluatePayments([0, 1, 2, 3, 4, 5].map((m) => ({ at: at(m), successRate: 0.1 })));
    expect(onP1).toHaveBeenCalledWith(
      expect.objectContaining({ incident: 'payment_confirmation_degraded' }),
    );
  });
});
