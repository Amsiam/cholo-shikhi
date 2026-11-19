// pnpm db:migrate — applies pending forward-only migrations to the database in DATABASE_URL.
import { getEnv } from '../src/lib/env.ts';
import { createPool } from '../src/server/db.ts';
import { migrate } from '../src/server/migrations.ts';

const pool = createPool(getEnv().DATABASE_URL, { max: 1 });
try {
  const ran = await migrate(pool);
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
