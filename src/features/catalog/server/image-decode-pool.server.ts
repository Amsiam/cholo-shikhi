// The decode-worker pool of the image-helper process (SD-216, RD-210, PD-211; plan Step 44).
// - 2 workers, each forked with Node's built-in child_process.fork, an env of exactly
//   { UV_THREADPOOL_SIZE: '2' } and no inherited execArgv (no new dependency, no --permission:
//   INF-201 §3.1 explains why that flag gives no protection to a native addon).
// - One job per worker. The supervisor, not the decoder, enforces the cut-offs: a 10 s timer
//   (SIGKILL, imageTimeout) and a resident-memory watchdog read from /proc/<pid>/statm every 100 ms
//   (SIGKILL above 256 MB, imageUnreadable). An exit during a job answers imageUnreadable.
// - In every failure case the job's bytes are dropped and a replacement worker is forked at once.
import { type ChildProcess, fork } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { ImageFormat } from '../domain/image.ts';
import type { DecodeResult } from './image-decode.server.ts';

export const DECODE_WORKERS = 2;
export const DECODE_TIMEOUT_MS = 10_000;
export const DECODE_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
export const WATCHDOG_POLL_MS = 100;
const PAGE_BYTES = 4096;

export type DecodeJob = { jobId: string; bytes: Uint8Array; sniffedFormat: ImageFormat };
export type PoolOutcome =
  | DecodeResult
  | { ok: false; reason: 'imageTimeout' | 'imageUnreadable'; cause: 'timeout' | 'memory' | 'exit' };

export type DecodePoolOptions = {
  workerPath: string | URL;
  size?: number;
  timeoutMs?: number;
  memoryLimitBytes?: number;
  pollMs?: number;
  /** Resident bytes of a process, or null when unknown. Defaults to /proc/<pid>/statm. */
  readRssBytes?: (pid: number) => Promise<number | null>;
  /** Called once per worker failure with the cause, for the OD-204 log line. */
  onFailure?: (cause: 'timeout' | 'memory' | 'exit') => void;
};

export async function readStatmRssBytes(pid: number): Promise<number | null> {
  try {
    const [, resident] = (await readFile(`/proc/${pid}/statm`, 'utf8')).trim().split(/\s+/);
    const pages = Number(resident);
    return Number.isFinite(pages) ? pages * PAGE_BYTES : null;
  } catch {
    return null;
  }
}

type Slot = {
  child: ChildProcess;
  envKeys: string[] | null;
  busy: ((outcome: PoolOutcome) => void) | null;
};

export function createDecodePool(options: DecodePoolOptions) {
  const size = options.size ?? DECODE_WORKERS;
  const timeoutMs = options.timeoutMs ?? DECODE_TIMEOUT_MS;
  const memoryLimit = options.memoryLimitBytes ?? DECODE_MEMORY_LIMIT_BYTES;
  const pollMs = options.pollMs ?? WATCHDOG_POLL_MS;
  const readRss = options.readRssBytes ?? readStatmRssBytes;
  const slots: Slot[] = [];
  const waiting: Array<{ job: DecodeJob; resolve: (outcome: PoolOutcome) => void }> = [];
  let isStopped = false;

  function spawn(): Promise<Slot> {
    const child = fork(options.workerPath, [], {
      env: { UV_THREADPOOL_SIZE: '2' },
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const slot: Slot = { child, envKeys: null, busy: null };
    slots.push(slot);
    child.on('exit', () => {
      const index = slots.indexOf(slot);
      if (index >= 0) slots.splice(index, 1);
      if (slot.busy) {
        const finish = slot.busy;
        slot.busy = null;
        options.onFailure?.('exit');
        finish({ ok: false, reason: 'imageUnreadable', cause: 'exit' });
      }
      if (!isStopped) void spawn().then(drain);
    });
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.on('message', (message: { type: string; envKeys?: string[] }) => {
        if (message.type === 'ready') {
          slot.envKeys = message.envKeys ?? [];
          resolve(slot);
        }
      });
    });
  }

  function dispatch(slot: Slot, job: DecodeJob, resolve: (outcome: PoolOutcome) => void) {
    let isSettled = false;
    const settle = (outcome: PoolOutcome) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      slot.child.off('message', onMessage);
      resolve(outcome);
    };
    const kill = (cause: 'timeout' | 'memory') => {
      slot.busy = null;
      // Out of the pool at once, so no job reaches a dying worker; its exit forks the replacement.
      const index = slots.indexOf(slot);
      if (index >= 0) slots.splice(index, 1);
      options.onFailure?.(cause);
      slot.child.kill('SIGKILL');
      settle(
        cause === 'timeout'
          ? { ok: false, reason: 'imageTimeout', cause }
          : { ok: false, reason: 'imageUnreadable', cause },
      );
    };
    const onMessage = (message: { type: string; jobId?: string; result?: DecodeResult }) => {
      if (message.type !== 'result' || message.jobId !== job.jobId || !message.result) return;
      slot.busy = null;
      settle(message.result);
      drain();
    };
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    const watchdog = setInterval(() => {
      const pid = slot.child.pid;
      if (pid === undefined) return;
      void readRss(pid).then((rss) => {
        if (rss !== null && rss > memoryLimit && !isSettled) kill('memory');
      });
    }, pollMs);
    slot.busy = settle;
    slot.child.on('message', onMessage);
    slot.child.send({ type: 'job', ...job });
  }

  function drain() {
    for (const slot of slots) {
      if (slot.busy || slot.envKeys === null) continue;
      const next = waiting.shift();
      if (!next) return;
      dispatch(slot, next.job, next.resolve);
    }
  }

  return {
    /** Forks every worker and waits until each reported ready. */
    async start(): Promise<void> {
      await Promise.all(Array.from({ length: size }, () => spawn()));
    },
    run(job: DecodeJob): Promise<PoolOutcome> {
      return new Promise((resolve) => {
        waiting.push({ job, resolve });
        drain();
      });
    },
    /** INF-203 check 2 input: each live worker's env keys. */
    workerEnvKeys(): string[][] {
      return slots.map((slot) => slot.envKeys ?? []);
    },
    async stop(): Promise<void> {
      isStopped = true;
      await Promise.all(
        slots.map(
          (slot) =>
            new Promise<void>((resolve) => {
              slot.child.once('exit', () => resolve());
              slot.child.kill('SIGKILL');
            }),
        ),
      );
    },
  };
}

export type DecodePool = ReturnType<typeof createDecodePool>;
