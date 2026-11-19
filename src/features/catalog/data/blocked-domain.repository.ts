// The Admin-maintained blocked-domain list (security-design SD-211; NFR6.210). Stored once in the
// Bangladesh database and read on every save and publish: there is no cache, so a change applies to
// the very next save. Domains are stored ASCII-normalised (SD-210).
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { blockedDomain, lessonVersion } from '#src/server/schema/index.ts';

export type BlockedDomainRow = typeof blockedDomain.$inferSelect;

/** Upper bound for the A9 list page (SC-209). */
export const MAX_BLOCKED_PAGE = 100;

export function createBlockedDomainRepository() {
  return {
    async list(exec: Executor, page: { limit: number; offset: number }) {
      const rows = await exec
        .select()
        .from(blockedDomain)
        .orderBy(asc(blockedDomain.domain))
        .limit(Math.min(page.limit, MAX_BLOCKED_PAGE))
        .offset(page.offset);
      const [total] = await exec.select({ n: count() }).from(blockedDomain);
      return { rows, total: total?.n ?? 0 };
    },
    /** Inserts the domain; undefined when it is already on the list. */
    async insert(
      exec: Executor,
      values: { domain: string; createdBy: string; createdAt: Date },
    ): Promise<BlockedDomainRow | undefined> {
      const [row] = await exec
        .insert(blockedDomain)
        .values(values)
        .onConflictDoNothing()
        .returning();
      return row;
    },
    async getForUpdate(exec: Executor, id: string): Promise<BlockedDomainRow | undefined> {
      const [row] = await exec
        .select()
        .from(blockedDomain)
        .where(eq(blockedDomain.blockedDomainId, id))
        .limit(1)
        .for('update');
      return row;
    },
    async remove(exec: Executor, id: string, expectedVersion: number): Promise<boolean> {
      const rows = await exec
        .delete(blockedDomain)
        .where(
          and(eq(blockedDomain.blockedDomainId, id), eq(blockedDomain.version, expectedVersion)),
        )
        .returning({ id: blockedDomain.blockedDomainId });
      return rows.length === 1;
    },
    /** SD-211 check at save: the list entries matching any of the candidates (one query). */
    async matching(exec: Executor, candidates: readonly string[]): Promise<BlockedDomainRow[]> {
      if (candidates.length === 0) return [];
      return exec
        .select()
        .from(blockedDomain)
        .where(inArray(blockedDomain.domain, [...new Set(candidates)]))
        .limit(candidates.length);
    },
    /**
     * SD-212 check at publish: the lesson versions (of the given section versions) whose
     * precomputed link candidates meet the list, with the matching entries. One join, no parsing.
     */
    async blockedInSectionVersions(exec: Executor, sectionVersionIds: readonly string[]) {
      if (sectionVersionIds.length === 0) return [];
      return exec
        .select({
          lessonVersionId: lessonVersion.lessonVersionId,
          lessonId: lessonVersion.lessonId,
          sectionVersionId: lessonVersion.sectionVersionId,
          blockedDomainId: blockedDomain.blockedDomainId,
          domain: blockedDomain.domain,
        })
        .from(lessonVersion)
        .innerJoin(
          blockedDomain,
          sql`${blockedDomain.domain} = ANY(${lessonVersion.linkDomainCandidates})`,
        )
        .where(inArray(lessonVersion.sectionVersionId, [...sectionVersionIds]))
        .limit(1000);
    },
  };
}

export type BlockedDomainRepository = ReturnType<typeof createBlockedDomainRepository>;
