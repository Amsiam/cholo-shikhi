// The web side of the image helper (SD-216, INF-202, INF-203; plan Step 44, approved by the human
// on 2026-11-17): a HelperClient over the Unix socket.
// - isReady(): asks the helper for its status, then decides with evaluateIsolation, which includes
//   the one check that does not trust the helper (the socket file's owner UID must differ from this
//   process's UID). The gauge catalog_image_helper_isolation_ok is 1 or 0, and a failure writes one
//   security log line per helper boot. The route calls it before reading the body, so a failed or
//   missing helper means imageUnreadable with no byte read.
// - process(): sends one job and waits at most 10 s (web keeps its own deadline even though the
//   helper's supervisor kills the worker at 10 s): imageTimeout past it, imageUnreadable when the
//   socket fails or the helper refuses.
import { createConnection } from 'node:net';
import type { Logger } from 'pino';
import type { AppError } from '#src/lib/errors.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { type ImageRefusalReason, imageRefusal } from '../domain/image.ts';
import { evaluateIsolation, type HelperSelfReport } from '../domain/image-isolation.ts';
import type { HelperClient, HelperJob, ProcessedImage } from './image-ports.server.ts';
import { createFrameDecoder, encodeFrame, type Frame, splitVariants } from './image-protocol.ts';
import type { ProbeTargets } from './image-self-test.server.ts';

export const WEB_HELPER_DEADLINE_MS = 10_000;
const STATUS_DEADLINE_MS = 5_000;
const REASONS: ReadonlySet<string> = new Set(['imageType', 'imageUnreadable', 'imageTimeout']);

export type SocketHelperDeps = {
  socketPath: string;
  targets: ProbeTargets;
  webUid: number;
  /** SHA-256 of this process's env values for keys outside the helper allow-list. */
  webSecretValueHashes: readonly string[];
  socketOwnerUid(path: string): Promise<number | null>;
  metrics: Metrics;
  log: Logger;
  deadlineMs?: number;
};

class DeadlineError extends Error {}

/** One request, one response frame, on a fresh connection. */
function request(socketPath: string, frame: Uint8Array, deadlineMs: number): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const decoder = createFrameDecoder();
    const finish = (outcome: { frame: Frame } | { error: Error }) => {
      clearTimeout(timer);
      socket.destroy();
      if ('frame' in outcome) resolve(outcome.frame);
      else reject(outcome.error);
    };
    const timer = setTimeout(() => finish({ error: new DeadlineError('deadline') }), deadlineMs);
    socket.once('connect', () => socket.write(frame));
    socket.on('data', (chunk: Buffer) => {
      try {
        const [first] = decoder.push(new Uint8Array(chunk));
        if (first) finish({ frame: first });
      } catch (error) {
        finish({ error: error as Error });
      }
    });
    socket.once('error', (error) => finish({ error }));
    socket.once('close', () => finish({ error: new Error('helper closed the connection') }));
  });
}

export function createSocketHelperClient(deps: SocketHelperDeps): HelperClient {
  const deadlineMs = deps.deadlineMs ?? WEB_HELPER_DEADLINE_MS;
  const loggedBoots = new Set<string>();

  async function isReady(): Promise<boolean> {
    let report: HelperSelfReport | null = null;
    let bootId = 'unreachable';
    try {
      const reply = await request(
        deps.socketPath,
        encodeFrame({ type: 'status', targets: deps.targets }),
        STATUS_DEADLINE_MS,
      );
      bootId = typeof reply.header.bootId === 'string' ? reply.header.bootId : 'unknown';
      report = (reply.header.report as HelperSelfReport | null) ?? null;
    } catch {
      report = null;
    }
    const verdict = evaluateIsolation({
      report,
      socketOwnerUid: await deps.socketOwnerUid(deps.socketPath),
      webUid: deps.webUid,
      webSecretValueHashes: deps.webSecretValueHashes,
    });
    deps.metrics.setGauge('catalog_image_helper_isolation_ok', verdict.isOk ? 1 : 0);
    if (!verdict.isOk && !loggedBoots.has(bootId)) {
      loggedBoots.add(bootId);
      deps.log.warn(
        {
          event: 'catalog.image.helperIsolationFailed',
          security: true,
          bootId,
          failed: verdict.failed,
        },
        'image helper isolation self-test failed; uploads fail closed',
      );
    }
    return verdict.isOk;
  }

  async function process(
    job: HelperJob,
  ): Promise<Result<ProcessedImage, AppError<'VALIDATION_FAILED'>>> {
    let reply: Frame;
    try {
      reply = await request(
        deps.socketPath,
        encodeFrame({ type: 'job', jobId: job.jobId, sniffedFormat: job.sniffedFormat }, job.bytes),
        deadlineMs,
      );
    } catch (error) {
      return err(imageRefusal(error instanceof DeadlineError ? 'imageTimeout' : 'imageUnreadable'));
    }
    const h = reply.header;
    if (h.type !== 'result' || h.jobId !== job.jobId) return err(imageRefusal('imageUnreadable'));
    if (h.ok !== true) {
      const reason =
        typeof h.reason === 'string' && REASONS.has(h.reason) ? h.reason : 'imageUnreadable';
      return err(imageRefusal(reason as ImageRefusalReason));
    }
    try {
      const variants = splitVariants(
        reply.body,
        h.variants as Array<{ width: number; length: number }>,
      );
      return ok({ width: Number(h.width), height: Number(h.height), variants });
    } catch {
      return err(imageRefusal('imageUnreadable'));
    }
  }

  return { isReady, process };
}
