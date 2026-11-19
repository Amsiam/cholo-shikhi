// Health probes (US9.5 local part, UC23): liveness, readiness (DB, Valkey, relay lag) and
// HealthCheckResult rows. The hosted status page and paging are deferred (human decision 2026-11-13);
// the P1 hook is a logged event.
import { sql } from 'drizzle-orm';
import { getLogger } from '#src/lib/logger.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import type { Clock } from '#src/lib/time.ts';
import type { Database } from '#src/server/db.ts';
import { healthCheckResult } from '#src/server/schema/index.ts';
import {
  type ComponentStatus,
  evaluatePaymentSli,
  type P1Decision,
  type SliSample,
  type StatusComponent,
} from '../domain/health.ts';

export const RELAY_LAG_LIMIT_SECONDS = 30;

export type HealthDeps = {
  db: Database;
  clock: Clock;
  metrics: Metrics;
  pingValkey: () => Promise<boolean>;
  relayBacklogSeconds: () => Promise<number>;
  onP1?: (decision: Extract<P1Decision, { shouldAlert: true }>) => void;
};

export type Readiness = {
  isReady: boolean;
  checks: { database: 'up' | 'down'; valkey: 'up' | 'down'; relay: 'up' | 'lagging' | 'unknown' };
};
export type StatusSnapshot = {
  overall: ComponentStatus;
  components: Array<{ component: StatusComponent; status: ComponentStatus; checkedAt: string }>;
};

export function createHealth(deps: HealthDeps) {
  const log = getLogger().child({ component: 'health' });

  async function databaseUp(): Promise<boolean> {
    try {
      await deps.db.execute(sql`select 1`);
      return true;
    } catch (error) {
      log.warn({ err: error, code: 'HEALTH_DB_DOWN' }, 'database check failed');
      return false;
    }
  }

  function liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async function readiness(): Promise<Readiness> {
    const [database, valkey] = await Promise.all([databaseUp(), deps.pingValkey()]);
    let relay: Readiness['checks']['relay'] = 'unknown';
    if (database) {
      try {
        relay = (await deps.relayBacklogSeconds()) > RELAY_LAG_LIMIT_SECONDS ? 'lagging' : 'up';
      } catch (error) {
        log.warn({ err: error, code: 'HEALTH_RELAY_UNKNOWN' }, 'relay lag check failed');
      }
    }
    return {
      isReady: database && valkey,
      checks: { database: database ? 'up' : 'down', valkey: valkey ? 'up' : 'down', relay },
    };
  }

  /** Probes the U1-owned components and stores one HealthCheckResult per component (no personal data). */
  async function checkAndRecord(): Promise<StatusSnapshot> {
    const started = Date.now();
    const ready = await readiness();
    const latencyMs = Date.now() - started;
    const checkedAt = deps.clock.now();
    const app: ComponentStatus = ready.checks.database === 'down' ? 'down' : 'operational';
    const signIn: ComponentStatus =
      ready.checks.database === 'down'
        ? 'down'
        : ready.checks.valkey === 'down'
          ? 'degraded'
          : 'operational';
    const notifications: ComponentStatus =
      ready.checks.database === 'down'
        ? 'down'
        : ready.checks.relay === 'up'
          ? 'operational'
          : 'degraded';
    const components: StatusSnapshot['components'] = [
      { component: 'app', status: app, checkedAt },
      { component: 'sign_in', status: signIn, checkedAt },
      { component: 'notifications', status: notifications, checkedAt },
    ];
    if (ready.checks.database === 'up') {
      await deps.db.insert(healthCheckResult).values(
        components.map((c) => ({
          checkName: `probe.${c.component}`,
          statusComponent: c.component,
          status: c.status,
          latencyMs,
          checkedAt: new Date(checkedAt),
        })),
      );
    }
    for (const c of components)
      deps.metrics.setGauge('health_component_up', c.status === 'operational' ? 1 : 0, {
        component: c.component,
      });
    const overall: ComponentStatus = components.some((c) => c.status === 'down')
      ? 'down'
      : components.some((c) => c.status === 'degraded')
        ? 'degraded'
        : 'operational';
    return { overall, components };
  }

  /** US9.6: evaluates the payment-confirmation SLI; a breach raises the P1 hook (a logged event for now). */
  function evaluatePayments(
    samples: readonly SliSample[],
    policy = { sliPercent: 90, windowMinutes: 5 },
  ): P1Decision {
    const decision = evaluatePaymentSli(samples, deps.clock.now(), policy);
    if (decision.shouldAlert) {
      log.error(
        { code: 'P1_ALERT', incident: decision.incident, links: decision.links },
        'P1: payment confirmation below SLI',
      );
      deps.onP1?.(decision);
    }
    return decision;
  }

  return { liveness, readiness, checkAndRecord, evaluatePayments };
}
