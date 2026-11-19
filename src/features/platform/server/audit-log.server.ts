// The audit log service: the contract 3 record() port, the Admin read query and the retention job.
import type { Json } from '#src/lib/json.ts';
import { getLogger } from '#src/lib/logger.ts';
import type { Clock } from '#src/lib/time.ts';
import type { Database } from '#src/server/db.ts';
import { createAuditRepository } from '../data/audit.repository.ts';
import {
  effectiveRetentionYears,
  partitionsDueForDrop,
  partitionsToEnsure,
} from '../domain/audit-retention.ts';
import { createAudit } from './audit.server.ts';

export type AuditRow = {
  auditEntryId: string;
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  before: Json;
  after: Json;
  reason: string | null;
  correlationId: string;
  occurredAt: string;
};

export function createAuditLog(deps: { db: Database; clock: Clock }) {
  const repo = createAuditRepository();
  const audit = createAudit({ clock: deps.clock });
  return {
    record: audit.record,

    async list(filter: {
      page: number;
      pageSize: number;
      subjectType?: string;
      subjectId?: string;
      action?: string;
    }) {
      const { rows, total } = await repo.list(deps.db, filter);
      const mapped: AuditRow[] = rows.map((r) => ({
        ...r,
        before: (r.before ?? null) as Json,
        after: (r.after ?? null) as Json,
        occurredAt: r.occurredAt.toISOString(),
      }));
      return { rows: mapped, total, page: filter.page, pageSize: filter.pageSize };
    },

    /** Retention job (BR7.4): ensures upcoming partitions and drops whole expired years. */
    async runRetention(options: { retentionYears?: number } = {}) {
      const retentionYears = effectiveRetentionYears(options.retentionYears);
      const now = deps.clock.now();
      for (const year of partitionsToEnsure(now)) await repo.ensurePartition(deps.db, year);
      const dropped = partitionsDueForDrop(await repo.listPartitions(deps.db), now, retentionYears);
      for (const name of dropped) await repo.dropPartition(deps.db, name);
      if (dropped.length > 0)
        getLogger().info({ dropped, retentionYears }, 'audit retention dropped partitions');
      return { retentionYears, dropped };
    },
  };
}
