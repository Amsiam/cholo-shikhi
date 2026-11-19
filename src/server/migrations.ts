// Forward-only migration runner for the drizzle-kit SQL in /drizzle (TS-03). The same runner applies
// migrations to `public` and to per-test-file schemas, so tests run exactly the shipped SQL.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';

const DRIZZLE_DIR = new URL('../../drizzle/', import.meta.url);

type Journal = { entries: Array<{ idx: number; tag: string }> };

export type Migration = { tag: string; hash: string; statements: string[] };

export function loadMigrations(): Migration[] {
  const journal = JSON.parse(
    readFileSync(new URL('meta/_journal.json', DRIZZLE_DIR), 'utf8'),
  ) as Journal;
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => {
      const sql = readFileSync(new URL(`${tag}.sql`, DRIZZLE_DIR), 'utf8');
      return {
        tag,
        hash: createHash('sha256').update(sql).digest('hex'),
        statements: sql
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    });
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Applies every migration not yet recorded in <schema>.__app_migrations, each in its own
 * transaction. A recorded migration whose file changed is refused: migrations are forward-only.
 */
export async function migrate(
  client: pg.Pool | pg.Client,
  schemaName = 'public',
): Promise<string[]> {
  if (!SCHEMA_NAME.test(schemaName)) throw new Error(`Invalid schema name: ${schemaName}`);
  const q = `"${schemaName}"`;
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${q}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${q}."__app_migrations" (tag text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const applied = new Map(
    (
      await client.query<{ tag: string; hash: string }>(
        `SELECT tag, hash FROM ${q}."__app_migrations"`,
      )
    ).rows.map((r) => [r.tag, r.hash]),
  );
  const ran: string[] = [];
  for (const migration of loadMigrations()) {
    const recorded = applied.get(migration.tag);
    if (recorded) {
      if (recorded !== migration.hash) {
        throw new Error(
          `Migration ${migration.tag} was edited after it was applied; add a new migration instead.`,
        );
      }
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL search_path TO ${q}`);
      for (const statement of migration.statements) {
        await client.query(statement.replaceAll('"public".', `${q}.`));
      }
      await client.query(`INSERT INTO ${q}."__app_migrations" (tag, hash) VALUES ($1, $2)`, [
        migration.tag,
        migration.hash,
      ]);
      await client.query('COMMIT');
      ran.push(migration.tag);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  return ran;
}
