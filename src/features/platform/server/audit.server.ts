// audit.record(tx, entry): append-only, inside the caller's transaction (BR7.2). Throws only on
// infrastructure failure, which rolls the caller's transaction back.
import { redact } from '#src/lib/logger.ts';
import type { Clock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { unwrapTx } from '#src/server/db.ts';
import { auditLogEntry } from '#src/server/schema/index.ts';
import { AuditEntry } from '../domain/audit.schema.ts';

export type Audit = { record(tx: TxHandle, entry: AuditEntry): Promise<void> };

export function createAudit(deps: { clock: Clock }): Audit {
  return {
    async record(tx, entry) {
      const parsed = AuditEntry.parse(entry);
      await unwrapTx(tx)
        .insert(auditLogEntry)
        .values({
          actorId: parsed.actorId,
          action: parsed.action,
          subjectType: parsed.subjectType,
          subjectId: parsed.subjectId,
          before: parsed.before === undefined ? null : redact(parsed.before),
          after: parsed.after === undefined ? null : redact(parsed.after),
          reason: parsed.reason ?? null,
          correlationId: parsed.correlationId,
          // Set by the platform clock, never by the caller (entities.md).
          occurredAt: new Date(deps.clock.now()),
        });
    },
  };
}
