// [LT] Step 44: the decode-worker pool on real child processes (SD-216, RD-210). The real worker
// decodes the corpus; test-only workers hang or crash; the memory watchdog is driven through its
// injectable resident-memory reader. Short timeouts keep the run fast.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { isCleanWebp } from '../domain/image.ts';
import {
  createDecodePool,
  type DecodePool,
  readStatmRssBytes,
} from './image-decode-pool.server.ts';

const REAL = new URL('./image-decode-worker.server.ts', import.meta.url);
const HANG = new URL('../test-fixtures/decode-workers/hang-worker.ts', import.meta.url);
const CRASH = new URL('../test-fixtures/decode-workers/crash-worker.ts', import.meta.url);
const jpeg = new Uint8Array(
  readFileSync(new URL('../test-fixtures/images/jpeg-large.jpg', import.meta.url)),
);

let pool: DecodePool | undefined;
afterEach(async () => {
  await pool?.stop();
  pool = undefined;
});

describe('the decode pool', () => {
  it('decodes with the real worker, whose env is exactly { UV_THREADPOOL_SIZE }', async () => {
    pool = createDecodePool({ workerPath: REAL });
    await pool.start();
    expect(pool.workerEnvKeys()).toEqual([['UV_THREADPOOL_SIZE'], ['UV_THREADPOOL_SIZE']]);
    const outcome = await pool.run({ jobId: 'j1', bytes: jpeg, sniffedFormat: 'jpeg' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.variants.map((v) => v.width)).toEqual([400, 800, 1600]);
      expect(outcome.value.variants.every((v) => isCleanWebp(v.bytes))).toBe(true);
    }
  });

  it('runs more jobs than workers, one job per worker at a time', async () => {
    pool = createDecodePool({ workerPath: REAL });
    await pool.start();
    const outcomes = await Promise.all(
      ['a', 'b', 'c', 'd'].map((jobId) => pool?.run({ jobId, bytes: jpeg, sniffedFormat: 'jpeg' })),
    );
    expect(outcomes.every((o) => o?.ok)).toBe(true);
  });

  it('kills a worker past the deadline with imageTimeout and forks a replacement', async () => {
    const failures: string[] = [];
    pool = createDecodePool({
      workerPath: HANG,
      size: 1,
      timeoutMs: 200,
      onFailure: (cause) => failures.push(cause),
    });
    await pool.start();
    expect(await pool.run({ jobId: 't', bytes: jpeg, sniffedFormat: 'jpeg' })).toEqual({
      ok: false,
      reason: 'imageTimeout',
      cause: 'timeout',
    });
    expect(failures).toEqual(['timeout']);
    // The replacement takes the next job (and times out the same way).
    expect(await pool.run({ jobId: 't2', bytes: jpeg, sniffedFormat: 'jpeg' })).toMatchObject({
      reason: 'imageTimeout',
    });
  });

  it('kills a worker above the memory limit with imageUnreadable', async () => {
    pool = createDecodePool({
      workerPath: HANG,
      size: 1,
      pollMs: 20,
      readRssBytes: async () => 300 * 1024 * 1024,
    });
    await pool.start();
    expect(await pool.run({ jobId: 'm', bytes: jpeg, sniffedFormat: 'jpeg' })).toEqual({
      ok: false,
      reason: 'imageUnreadable',
      cause: 'memory',
    });
  });

  it('answers imageUnreadable when the worker exits during a job, then recovers', async () => {
    pool = createDecodePool({ workerPath: CRASH, size: 1 });
    await pool.start();
    expect(await pool.run({ jobId: 'c', bytes: jpeg, sniffedFormat: 'jpeg' })).toEqual({
      ok: false,
      reason: 'imageUnreadable',
      cause: 'exit',
    });
    expect(await pool.run({ jobId: 'c2', bytes: jpeg, sniffedFormat: 'jpeg' })).toMatchObject({
      reason: 'imageUnreadable',
    });
  });

  it('reads resident memory from /proc/<pid>/statm, null for an unknown process', async () => {
    expect(await readStatmRssBytes(process.pid)).toBeGreaterThan(0);
    expect(await readStatmRssBytes(2 ** 30)).toBeNull();
  });
});
