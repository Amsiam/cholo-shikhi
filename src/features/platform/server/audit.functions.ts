// Admin audit search (UC10). Server-side pagination; Admin with two-step only.
import { createServerFn } from '@tanstack/react-start';
import { ok } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { AuditListInput } from './audit.schema.ts';
import { createAuditLog } from './audit-log.server.ts';

export const listAuditLog = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof AuditListInput>())
  .handler(
    roleFn('admin', AuditListInput, async ({ input }) =>
      ok(await createAuditLog({ db: getDb(), clock: systemClock }).list(input)),
    ),
  );
