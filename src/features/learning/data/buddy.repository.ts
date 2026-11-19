// Study buddy invites and pairs. Reads are scoped by the caller's user ID; a pair is visible only to
// its two members. Pairing changes run inside a transaction holding both Students' account locks.
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { buddyInvite, buddyMember, buddyPair } from '#src/server/schema/index.ts';

export type InviteRow = typeof buddyInvite.$inferSelect;
export type PairRow = typeof buddyPair.$inferSelect;
export type PairWithBuddy = PairRow & { buddyId: string };

export function createBuddyRepository() {
  /** The caller's pairs (with the other member), newest first, optionally only those still counting. */
  async function pairsOf(
    exec: Executor,
    userId: string,
    filter: { activeAfterDay?: string; endedBy?: string },
  ): Promise<PairWithBuddy[]> {
    const other = sql<string>`(select m2.user_id from buddy_member m2
      where m2.pair_id = ${buddyPair.pairId} and m2.user_id <> ${userId} limit 1)`;
    const rows = await exec
      .select({ pair: buddyPair, buddyId: other })
      .from(buddyPair)
      .innerJoin(buddyMember, eq(buddyMember.pairId, buddyPair.pairId))
      .where(
        and(
          eq(buddyMember.userId, userId),
          filter.activeAfterDay
            ? or(isNull(buddyPair.endsDay), gt(buddyPair.endsDay, filter.activeAfterDay))
            : undefined,
          filter.endedBy ? lte(buddyPair.endsDay, filter.endedBy) : undefined,
        ),
      )
      .orderBy(desc(buddyPair.createdAt));
    return rows.map((r) => ({ ...r.pair, buddyId: r.buddyId }));
  }

  return {
    pairsOf,

    /** The pair still counting today or later (not yet past its end day), if any. */
    async currentPair(exec: Executor, userId: string, today: string) {
      return (await pairsOf(exec, userId, { activeAfterDay: today }))[0] ?? null;
    },

    /** The most recent pair whose last counted day has passed. */
    async lastEndedPair(exec: Executor, userId: string, today: string) {
      return (await pairsOf(exec, userId, { endedBy: today }))[0] ?? null;
    },

    async createPair(
      exec: Executor,
      input: { segmentId: string; startsDay: string; userIds: readonly [string, string] },
    ): Promise<PairRow> {
      const [pair] = await exec
        .insert(buddyPair)
        .values({ segmentId: input.segmentId, startsDay: input.startsDay })
        .returning();
      const created = pair as PairRow;
      await exec
        .insert(buddyMember)
        .values(input.userIds.map((userId) => ({ pairId: created.pairId, userId })));
      return created;
    },

    async endPair(exec: Executor, pairId: string, endsDay: string, by: string): Promise<void> {
      await exec
        .update(buddyPair)
        .set({ endsDay, endedBy: by })
        .where(and(eq(buddyPair.pairId, pairId), isNull(buddyPair.endsDay)));
      await exec.update(buddyMember).set({ isOpen: false }).where(eq(buddyMember.pairId, pairId));
    },

    async openInviteOf(exec: Executor, inviterId: string, now: Date): Promise<InviteRow | null> {
      const rows = await exec
        .select()
        .from(buddyInvite)
        .where(
          and(
            eq(buddyInvite.inviterId, inviterId),
            isNull(buddyInvite.closedAt),
            gt(buddyInvite.expiresAt, now),
          ),
        )
        .orderBy(desc(buddyInvite.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async inviteByCode(exec: Executor, code: string, now: Date): Promise<InviteRow | null> {
      const rows = await exec
        .select()
        .from(buddyInvite)
        .where(
          and(
            eq(buddyInvite.code, code),
            isNull(buddyInvite.closedAt),
            gt(buddyInvite.expiresAt, now),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async codeTaken(exec: Executor, code: string): Promise<boolean> {
      const rows = await exec
        .select({ id: buddyInvite.inviteId })
        .from(buddyInvite)
        .where(and(eq(buddyInvite.code, code), isNull(buddyInvite.closedAt)))
        .limit(1);
      return rows.length > 0;
    },

    async insertInvite(
      exec: Executor,
      row: { inviterId: string; code: string; segmentId: string; createdAt: Date; expiresAt: Date },
    ): Promise<InviteRow> {
      const [created] = await exec.insert(buddyInvite).values(row).returning();
      return created as InviteRow;
    },

    /** Closes the caller's open invites (accepted by someone, cancelled, or replaced). */
    async closeInvites(
      exec: Executor,
      inviterId: string,
      at: Date,
      acceptedBy: string | null = null,
    ): Promise<void> {
      await exec
        .update(buddyInvite)
        .set({ closedAt: at, ...(acceptedBy ? { acceptedBy } : {}) })
        .where(and(eq(buddyInvite.inviterId, inviterId), isNull(buddyInvite.closedAt)));
    },

    /** Closes stale open invites whose code someone wants to reuse (expired ones keep the index). */
    async closeExpired(exec: Executor, now: Date): Promise<void> {
      await exec
        .update(buddyInvite)
        .set({ closedAt: now })
        .where(and(isNull(buddyInvite.closedAt), lte(buddyInvite.expiresAt, now)));
    },
  };
}
