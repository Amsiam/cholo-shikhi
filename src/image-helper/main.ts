// The image-helper process (`PROCESS_ROLE=image-helper`; `pnpm dev:image-helper`): catalog plan
// Step 44, approved by the human on 2026-11-17 (SD-216, INF-201 to INF-203). In production it runs
// from the same image digest as web, in a hardened sidecar with no network, no secrets and a
// read-only root (the Compose fragment is Step 47, deferred). It reads no .env file and no app
// settings: its only inputs are PROCESS_ROLE and IMAGE_HELPER_SOCKET_PATH.
// It forks 2 decode workers, runs the INF-203 self-test on web's first status request, and serves
// the Unix socket. It emits no telemetry (OD-205); only a fatal start-up error is written to stderr.
import { readFile } from 'node:fs/promises';
import { isCleanWebp } from '#src/features/catalog/domain/image.ts';
import { createDecodePool } from '#src/features/catalog/server/image-decode-pool.server.ts';
import { createHelperServer } from '#src/features/catalog/server/image-helper.server.ts';
import {
  realProbes,
  runHelperSelfTest,
} from '#src/features/catalog/server/image-self-test.server.ts';

if (process.env.PROCESS_ROLE !== 'image-helper') {
  process.stderr.write('image-helper: PROCESS_ROLE must be image-helper\n');
  process.exit(1);
}
const socketPath = process.env.IMAGE_HELPER_SOCKET_PATH ?? '/run/helper/helper.sock';
const workerPath = new URL(
  '../features/catalog/server/image-decode-worker.server.ts',
  import.meta.url,
);
const selfTestJpeg = new Uint8Array(await readFile(new URL('./selftest.jpg', import.meta.url)));

const pool = createDecodePool({ workerPath });
await pool.start();

/** INF-203 check 8: the committed ~1 KB JPEG becomes three clean WebP variants. */
async function roundTrip(): Promise<boolean> {
  const outcome = await pool.run({ jobId: 'selftest', bytes: selfTestJpeg, sniffedFormat: 'jpeg' });
  return (
    outcome.ok &&
    outcome.value.variants.length === 3 &&
    outcome.value.variants.every((v) => isCleanWebp(v.bytes))
  );
}

const server = createHelperServer({
  pool,
  selfTest: (targets) =>
    runHelperSelfTest({
      probes: realProbes(roundTrip),
      workerEnvKeys: pool.workerEnvKeys(),
      targets,
    }),
});
await server.listen(socketPath);

async function shutdown(): Promise<void> {
  await server.close();
  await pool.stop();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
