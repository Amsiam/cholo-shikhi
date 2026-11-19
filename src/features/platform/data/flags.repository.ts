import { asc, eq } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { featureFlag } from '#src/server/schema/index.ts';

export function createFlagsRepository() {
  return {
    async get(db: Executor, flagKey: string) {
      const [row] = await db
        .select()
        .from(featureFlag)
        .where(eq(featureFlag.flagKey, flagKey))
        .limit(1);
      return row;
    },
    async getForUpdate(db: Executor, flagKey: string) {
      const [row] = await db
        .select()
        .from(featureFlag)
        .where(eq(featureFlag.flagKey, flagKey))
        .for('update')
        .limit(1);
      return row;
    },
    async list(db: Executor) {
      return db.select().from(featureFlag).orderBy(asc(featureFlag.flagKey));
    },
    async upsert(db: Executor, row: typeof featureFlag.$inferInsert) {
      await db
        .insert(featureFlag)
        .values(row)
        .onConflictDoUpdate({ target: featureFlag.flagKey, set: row });
    },
  };
}
