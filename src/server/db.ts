// Pooled PostgreSQL client and the only place a TxHandle is created (contract 1). Server-only.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { getEnv } from '#src/lib/env.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import * as schema from './schema/index.ts';

export type Database = NodePgDatabase<typeof schema>;
/** Anything that can run queries: the database itself or an open transaction. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export function createPool(
  connectionString: string,
  options: { searchPath?: string; max?: number } = {},
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    ...(options.searchPath ? { options: `-c search_path=${options.searchPath}` } : {}),
  });
  // An idle client error must not crash the process; it is surfaced to the logger by the caller.
  pool.on('error', () => undefined);
  return pool;
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

/** Runs fn in one database transaction and hands it an opaque TxHandle. */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: TxHandle) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => fn(tx as unknown as TxHandle));
}

/** Unwraps a TxHandle. Only *.repository.ts and *.server.ts files may call this. */
export function unwrapTx(tx: TxHandle): Executor {
  return tx as unknown as Executor;
}

let shared: { pool: pg.Pool; db: Database } | undefined;

export function getDb(): Database {
  if (!shared) {
    const pool = createPool(getEnv().DATABASE_URL);
    shared = { pool, db: createDb(pool) };
  }
  return shared.db;
}

export function getPool(): pg.Pool {
  getDb();
  return (shared as { pool: pg.Pool }).pool;
}

export async function closeDb(): Promise<void> {
  if (shared) {
    await shared.pool.end();
    shared = undefined;
  }
}
