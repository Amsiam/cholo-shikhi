// [LT] Step 7: migrations apply from empty; storage-level rules hold (BR7.3, BR2.3, BR4.8, BR12.2).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '#src/server/migrations.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';

let t: TestDatabase;

async function insertUser(email = `u.${randomUUID()}@example.test`): Promise<string> {
  const { rows } = await t.pool.query<{ user_id: string }>(
    'INSERT INTO user_account (email_normalised) VALUES ($1) RETURNING user_id',
    [email],
  );
  return (rows[0] as { user_id: string }).user_id;
}

async function insertAudit(occurredAt = new Date().toISOString()): Promise<string> {
  const { rows } = await t.pool.query<{ audit_entry_id: string }>(
    `INSERT INTO audit_log_entry (actor_id, action, subject_type, subject_id, correlation_id, occurred_at)
     VALUES ('system', 'test.action', 'test', 's-1', 'c-1', $1) RETURNING audit_entry_id`,
    [occurredAt],
  );
  return (rows[0] as { audit_entry_id: string }).audit_entry_id;
}

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe('migrations', () => {
  it('apply cleanly from an empty schema and create every U1 table', async () => {
    const { rows } = await t.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [t.schemaName],
    );
    const tables = new Set(rows.map((r) => r.table_name));
    for (const name of [
      'user_account',
      'auth_session',
      'auth_account',
      'auth_verification',
      'auth_rate_limit',
      'verification_token',
      'rate_limit_bucket',
      'staff_role_assignment',
      'two_factor_credential',
      'recovery_code',
      'feature_flag',
      'setting_version',
      'job_run',
      'outbox_event',
      'outbox_delivery',
      'processed_event',
      'partition_lease',
      'instrumentation_event',
      'health_check_result',
      'rendered_document',
      'audit_log_entry',
      'notification',
      'notification_delivery',
      'delivery_attempt',
      'notification_preference',
      'push_subscription',
    ]) {
      expect(tables.has(name), name).toBe(true);
    }
  });

  it('are idempotent: a second run applies nothing', async () => {
    expect(await migrate(t.pool, t.schemaName)).toEqual([]);
  });

  it('refuse to run when an applied migration file was edited (forward-only)', async () => {
    const table = `"${t.schemaName}"."__app_migrations"`;
    const { rows } = await t.pool.query<{ hash: string }>(
      `SELECT hash FROM ${table} WHERE tag = '0000_u1_foundation'`,
    );
    const original = (rows[0] as { hash: string }).hash;
    await t.pool.query(`UPDATE ${table} SET hash = 'tampered' WHERE tag = '0000_u1_foundation'`);
    await expect(migrate(t.pool, t.schemaName)).rejects.toThrow(/edited after it was applied/);
    await t.pool.query(`UPDATE ${table} SET hash = $1 WHERE tag = '0000_u1_foundation'`, [
      original,
    ]);
    expect(await migrate(t.pool, t.schemaName)).toEqual([]);
  });

  it('seed 32 outbox partition leases', async () => {
    const { rows } = await t.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM partition_lease',
    );
    expect(rows[0]?.n).toBe('32');
  });
});

describe('audit log storage rules (BR7.3)', () => {
  it('accepts inserts', async () => {
    expect(await insertAudit()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses UPDATE at the database level, even for the application role', async () => {
    const id = await insertAudit();
    await expect(
      t.pool.query("UPDATE audit_log_entry SET action = 'x' WHERE audit_entry_id = $1", [id]),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses DELETE and TRUNCATE', async () => {
    const id = await insertAudit();
    await expect(
      t.pool.query('DELETE FROM audit_log_entry WHERE audit_entry_id = $1', [id]),
    ).rejects.toThrow(/append-only/);
    await expect(t.pool.query('TRUNCATE audit_log_entry')).rejects.toThrow(/append-only/);
  });

  it('routes entries into yearly partitions', async () => {
    await insertAudit('2031-06-01T00:00:00Z');
    const { rows } = await t.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM audit_log_entry_y2031',
    );
    expect(rows[0]?.n).toBe('1');
  });
});

describe('identity constraints', () => {
  it('BR2.3: creating an account writes identity.AccountCreated in the same transaction', async () => {
    const client = await t.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ user_id: string }>(
        'INSERT INTO user_account (email_normalised) VALUES ($1) RETURNING user_id',
        [`tx.${randomUUID()}@example.test`],
      );
      const userId = (rows[0] as { user_id: string }).user_id;
      await client.query('ROLLBACK');
      const after = await t.pool.query('SELECT 1 FROM outbox_event WHERE aggregate_key = $1', [
        userId,
      ]);
      expect(after.rowCount).toBe(0);
    } finally {
      client.release();
    }
    const userId = await insertUser();
    const { rows } = await t.pool.query<{
      event_type: string;
      payload: Record<string, unknown>;
      partition: number;
    }>('SELECT event_type, payload, partition FROM outbox_event WHERE aggregate_key = $1', [
      userId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('identity.AccountCreated');
    expect(rows[0]?.payload).toMatchObject({
      userId,
      referralCode: null,
      deviceFingerprintHash: null,
    });
    expect(Object.keys(rows[0]?.payload ?? {}).sort()).toEqual([
      'createdAt',
      'deviceFingerprintHash',
      'referralCode',
      'userId',
    ]);
    expect(rows[0]?.partition).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.partition).toBeLessThan(32);
  });

  it('assigns a system-generated student number', async () => {
    const userId = await insertUser();
    const { rows } = await t.pool.query<{ student_number: string }>(
      'SELECT student_number FROM user_account WHERE user_id = $1',
      [userId],
    );
    expect(rows[0]?.student_number).toMatch(/^CS\d{6,}$/);
  });

  it('keeps emails unique', async () => {
    const email = `dup.${randomUUID()}@example.test`;
    await insertUser(email);
    await expect(insertUser(email)).rejects.toThrow(/user_account_email_uq/);
  });

  it('BR4.8: a staff role is held at most once at a time, and instructors need a type', async () => {
    const admin = await insertUser();
    const user = await insertUser();
    await t.pool.query(
      "INSERT INTO staff_role_assignment (user_id, role, assigned_by) VALUES ($1, 'finance', $2)",
      [user, admin],
    );
    await expect(
      t.pool.query(
        "INSERT INTO staff_role_assignment (user_id, role, assigned_by) VALUES ($1, 'finance', $2)",
        [user, admin],
      ),
    ).rejects.toThrow(/staff_role_active_uq/);
    await expect(
      t.pool.query(
        "INSERT INTO staff_role_assignment (user_id, role, assigned_by) VALUES ($1, 'instructor', $2)",
        [user, admin],
      ),
    ).rejects.toThrow(/staff_role_instructor_type/);
    await t.pool.query(
      "UPDATE staff_role_assignment SET revoked_at = now() WHERE user_id = $1 AND role = 'finance'",
      [user],
    );
    await t.pool.query(
      "INSERT INTO staff_role_assignment (user_id, role, assigned_by) VALUES ($1, 'finance', $2)",
      [user, admin],
    );
  });
});

describe('platform and notification constraints', () => {
  it('BR8.7: a targeted flag needs a restriction and a 0-100 rollout', async () => {
    await expect(
      t.pool.query(
        "INSERT INTO feature_flag (flag_key, description, state) VALUES ('a.b', 'd', 'targeted')",
      ),
    ).rejects.toThrow(/feature_flag_targeted_restriction/);
    await expect(
      t.pool.query(
        "INSERT INTO feature_flag (flag_key, description, rollout_percent) VALUES ('a.c', 'd', 101)",
      ),
    ).rejects.toThrow(/feature_flag_rollout_range/);
  });

  it('BR12.2: one notification per (recipient, dedupeKey)', async () => {
    const user = await insertUser();
    const insert = () =>
      t.pool.query(
        `INSERT INTO notification (recipient_user_id, type_key, dedupe_key, params, requested_channels, resolved_channels, status, source_event_id)
         VALUES ($1, 'notify.test.x', 'dedupe-key-1', '{}', '{in_app}', '{in_app}', 'created', gen_random_uuid())`,
        [user],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/notification_dedupe_uq/);
  });

  it('a discarded dead letter needs a written justification', async () => {
    const user = await insertUser();
    const { rows } = await t.pool.query<{ outbox_event_id: string; seq: number }>(
      'SELECT outbox_event_id, seq FROM outbox_event WHERE aggregate_key = $1',
      [user],
    );
    const event = rows[0] as { outbox_event_id: string; seq: number };
    await expect(
      t.pool.query(
        `INSERT INTO outbox_delivery (outbox_event_id, event_seq, consumer_name, aggregate_key, partition, status)
         VALUES ($1, $2, 'c', 'k', 0, 'discarded')`,
        [event.outbox_event_id, event.seq],
      ),
    ).rejects.toThrow(/outbox_delivery_discard_reason/);
  });
});
