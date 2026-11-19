// Battle reads and writes (U7). A player's row is read and changed only through the caller's own
// user ID; the room-wide reads return what a scoreboard needs.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { battle, battlePlayer } from '#src/server/schema/index.ts';

export type BattleRow = typeof battle.$inferSelect;
export type PlayerRow = typeof battlePlayer.$inferSelect;

export function createBattleRepository() {
  return {
    async byId(exec: Executor, battleId: string): Promise<BattleRow | null> {
      const rows = await exec.select().from(battle).where(eq(battle.battleId, battleId)).limit(1);
      return rows[0] ?? null;
    },
    async forUpdate(exec: Executor, battleId: string): Promise<BattleRow | null> {
      const rows = await exec
        .select()
        .from(battle)
        .where(eq(battle.battleId, battleId))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async byOpenCode(exec: Executor, code: string): Promise<BattleRow | null> {
      const rows = await exec
        .select()
        .from(battle)
        .where(and(eq(battle.code, code), eq(battle.status, 'waiting')))
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * A waiting quick match in this band with the same settings and one player who is not the
     * caller, locked so two Students never both take the same seat.
     */
    async claimQuickSeat(
      exec: Executor,
      input: {
        band: string;
        topicId: string | null;
        source: 'bank' | 'vault';
        userId: string;
        since: Date;
      },
    ): Promise<BattleRow | null> {
      const rows = await exec
        .select()
        .from(battle)
        .where(
          and(
            eq(battle.mode, 'quick'),
            eq(battle.status, 'waiting'),
            eq(battle.band, input.band),
            eq(battle.source, input.source),
            input.topicId ? eq(battle.topicId, input.topicId) : isNull(battle.topicId),
            sql`${battle.createdAt} > ${input.since}`,
            sql`${battle.hostId} <> ${input.userId}`,
            sql`(select count(*) from battle_player p where p.battle_id = ${battle.battleId}) < ${battle.maxPlayers}`,
          ),
        )
        .orderBy(asc(battle.createdAt))
        .for('update', { skipLocked: true })
        .limit(1);
      return rows[0] ?? null;
    },
    async insert(
      exec: Executor,
      row: Omit<typeof battle.$inferInsert, 'battleId'>,
    ): Promise<BattleRow> {
      const [created] = await exec.insert(battle).values(row).returning();
      return created as BattleRow;
    },
    async update(exec: Executor, battleId: string, patch: Partial<typeof battle.$inferInsert>) {
      await exec.update(battle).set(patch).where(eq(battle.battleId, battleId));
    },

    async players(exec: Executor, battleId: string): Promise<PlayerRow[]> {
      return exec
        .select()
        .from(battlePlayer)
        .where(eq(battlePlayer.battleId, battleId))
        .orderBy(asc(battlePlayer.joinedAt));
    },
    async player(exec: Executor, battleId: string, userId: string): Promise<PlayerRow | null> {
      const rows = await exec
        .select()
        .from(battlePlayer)
        .where(and(eq(battlePlayer.battleId, battleId), eq(battlePlayer.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },
    async playerForUpdate(
      exec: Executor,
      battleId: string,
      userId: string,
    ): Promise<PlayerRow | null> {
      const rows = await exec
        .select()
        .from(battlePlayer)
        .where(and(eq(battlePlayer.battleId, battleId), eq(battlePlayer.userId, userId)))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async addPlayer(exec: Executor, battleId: string, userId: string): Promise<void> {
      await exec.insert(battlePlayer).values({ battleId, userId }).onConflictDoNothing();
    },
    async removePlayer(exec: Executor, battleId: string, userId: string): Promise<void> {
      await exec
        .delete(battlePlayer)
        .where(and(eq(battlePlayer.battleId, battleId), eq(battlePlayer.userId, userId)));
    },
    async updatePlayer(
      exec: Executor,
      battleId: string,
      userId: string,
      patch: Partial<typeof battlePlayer.$inferInsert>,
    ): Promise<void> {
      await exec
        .update(battlePlayer)
        .set(patch)
        .where(and(eq(battlePlayer.battleId, battleId), eq(battlePlayer.userId, userId)));
    },

    /** The caller's recent battles. */
    async battlesOf(exec: Executor, userId: string, limit: number): Promise<BattleRow[]> {
      return exec
        .select({ b: battle })
        .from(battle)
        .innerJoin(battlePlayer, eq(battlePlayer.battleId, battle.battleId))
        .where(eq(battlePlayer.userId, userId))
        .orderBy(desc(battle.createdAt))
        .limit(limit)
        .then((rows) => rows.map((r) => r.b));
    },
    /** Hosted battles of a band that have not finished. */
    async openHosted(exec: Executor, band: string): Promise<BattleRow[]> {
      return exec
        .select()
        .from(battle)
        .where(
          and(
            eq(battle.mode, 'hosted'),
            eq(battle.band, band),
            inArray(battle.status, ['waiting', 'running']),
            sql`${battle.endsAt} > now()`,
          ),
        )
        .orderBy(asc(battle.startsAt))
        .limit(20);
    },
    async hostedBy(exec: Executor, hostId: string | null): Promise<BattleRow[]> {
      return exec
        .select()
        .from(battle)
        .where(and(eq(battle.mode, 'hosted'), hostId ? eq(battle.hostId, hostId) : undefined))
        .orderBy(desc(battle.startsAt))
        .limit(100);
    },
    async playerCounts(exec: Executor, battleIds: readonly string[]) {
      if (battleIds.length === 0) return new Map<string, number>();
      const rows = await exec
        .select({ battleId: battlePlayer.battleId, n: sql<number>`count(*)::int` })
        .from(battlePlayer)
        .where(inArray(battlePlayer.battleId, [...battleIds]))
        .groupBy(battlePlayer.battleId);
      return new Map(rows.map((r) => [r.battleId, r.n]));
    },
  };
}
