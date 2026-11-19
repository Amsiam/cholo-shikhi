// The image-helper process's socket server (INF-201, INF-202, INF-203; plan Step 44, approved by the
// human on 2026-11-17). It runs in its own process (`PROCESS_ROLE=image-helper`, src/image-helper/
// main.ts) and, in production, in its own hardened sidecar container (Step 47, deferred).
// - The only way in or out is the Unix socket, created with mode 0660.
// - A `status` request carries the probe addresses from web; the first one runs the INF-203
//   self-test once per boot, before any job is accepted, and later ones return the same report
//   with this process's boot ID (a restart gives a new boot ID, so web re-checks).
// - A `job` is decoded by the worker pool only when every helper-side check passed; otherwise it is
//   refused with imageUnreadable. Frames over 5,243,904 bytes or malformed frames close the
//   connection. Nothing is written to disk and nothing is logged about the image.
import { randomUUID } from 'node:crypto';
import { chmod, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import type { ImageFormat } from '../domain/image.ts';
import type { HelperSelfReport } from '../domain/image-isolation.ts';
import type { DecodePool } from './image-decode-pool.server.ts';
import { createFrameDecoder, encodeFrame, type Frame, joinVariants } from './image-protocol.ts';
import type { ProbeTargets } from './image-self-test.server.ts';

const FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);

function parseTargets(value: unknown): ProbeTargets | null {
  if (typeof value !== 'object' || value === null) return null;
  const t = value as Record<string, unknown>;
  return typeof t.privateHost === 'string' &&
    typeof t.publicHost === 'string' &&
    typeof t.webEnvFilePath === 'string'
    ? { privateHost: t.privateHost, publicHost: t.publicHost, webEnvFilePath: t.webEnvFilePath }
    : null;
}

export function createHelperServer(deps: {
  pool: DecodePool;
  selfTest(targets: ProbeTargets): Promise<HelperSelfReport>;
  bootId?: string;
}) {
  const bootId = deps.bootId ?? randomUUID();
  let report: Promise<HelperSelfReport> | null = null;
  let isPassed = false;
  let server: Server | undefined;

  async function status(header: Record<string, unknown>): Promise<Uint8Array> {
    const targets = parseTargets(header.targets);
    if (!report) {
      if (!targets) return encodeFrame({ type: 'status', bootId, report: null });
      report = deps.selfTest(targets);
      isPassed = Object.values((await report).checks).every(Boolean);
    }
    return encodeFrame({ type: 'status', bootId, report: await report });
  }

  async function job(frame: Frame): Promise<Uint8Array> {
    const jobId = typeof frame.header.jobId === 'string' ? frame.header.jobId : '';
    const refuse = (reason: string) => encodeFrame({ type: 'result', jobId, ok: false, reason });
    if (!isPassed) return refuse('imageUnreadable');
    const format = frame.header.sniffedFormat;
    if (typeof format !== 'string' || !FORMATS.has(format)) return refuse('imageType');
    const outcome = await deps.pool.run({
      jobId,
      bytes: frame.body,
      sniffedFormat: format as ImageFormat,
    });
    if (!outcome.ok) return refuse(outcome.reason);
    const { body, layout } = joinVariants(outcome.value.variants);
    return encodeFrame(
      {
        type: 'result',
        jobId,
        ok: true,
        format: 'webp',
        width: outcome.value.width,
        height: outcome.value.height,
        variants: layout,
        timings: { decodeMs: outcome.decodeMs },
      },
      body,
    );
  }

  function onConnection(socket: Socket) {
    const decoder = createFrameDecoder();
    let queue = Promise.resolve();
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: Buffer) => {
      let frames: Frame[];
      try {
        frames = decoder.push(new Uint8Array(chunk));
      } catch {
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        queue = queue.then(async () => {
          const reply =
            frame.header.type === 'status'
              ? await status(frame.header)
              : frame.header.type === 'job'
                ? await job(frame)
                : null;
          if (reply === null) socket.destroy();
          else if (!socket.destroyed) socket.write(reply);
        });
      }
    });
  }

  return {
    bootId,
    async listen(socketPath: string): Promise<void> {
      await rm(socketPath, { force: true });
      server = createServer(onConnection);
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(socketPath, () => resolve());
      });
      await chmod(socketPath, 0o660);
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },
  };
}
