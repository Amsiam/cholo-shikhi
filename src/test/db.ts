// Integration-test database harness: each test FILE gets its own schema with the shipped migrations
// applied (unit-test instructions), and drops it afterwards. Never mocked.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { createDb, createPool, type Database } from '#src/server/db.ts';
import { migrate } from '#src/server/migrations.ts';

export type TestDatabase = {
  db: Database;
  pool: pg.Pool;
  schemaName: string;
  connectionString: string;
  drop(): Promise<void>;
};

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set; run `pnpm env:init && pnpm db:up` first.');
  return url;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const connectionString = testDatabaseUrl();
  const schemaName = `t_${randomBytes(6).toString('hex')}`;
  const admin = createPool(connectionString, { max: 1 });
  await migrate(admin, schemaName);
  await admin.end();
  const pool = createPool(connectionString, { searchPath: schemaName, max: 8 });
  return {
    db: createDb(pool),
    pool,
    schemaName,
    connectionString,
    async drop() {
      await pool.end();
      const cleanup = createPool(connectionString, { max: 1 });
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await cleanup.end();
    },
  };
}
