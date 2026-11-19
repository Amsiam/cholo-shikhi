import { and, desc, eq } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { settingVersion } from '#src/server/schema/index.ts';

export function createSettingsRepository() {
  return {
    async versions(db: Executor, settingKey: string) {
      return db
        .select()
        .from(settingVersion)
        .where(eq(settingVersion.settingKey, settingKey))
        .orderBy(desc(settingVersion.version));
    },
    async latestForUpdate(db: Executor, settingKey: string, scopeKey: string) {
      const [row] = await db
        .select()
        .from(settingVersion)
        .where(
          and(eq(settingVersion.settingKey, settingKey), eq(settingVersion.scopeKey, scopeKey)),
        )
        .orderBy(desc(settingVersion.version))
        .limit(1)
        .for('update');
      return row;
    },
    async insert(db: Executor, row: typeof settingVersion.$inferInsert) {
      const [inserted] = await db.insert(settingVersion).values(row).returning();
      return inserted as typeof settingVersion.$inferSelect;
    },
  };
}
