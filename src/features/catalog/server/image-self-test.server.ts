// INF-203 checks 2 to 8, run by a freshly started image helper before any upload reaches it (plan
// Step 44). Every probe is injectable so tests can drive each check both ways; the real probes read
// the helper's own process and container. Check 1 (the socket owner) is done by the web process,
// which does not trust this report (domain/image-isolation.ts).
//
// Outside the hardened sidecar (Step 47 is deferred) checks 3, 4, 5, 6 and 7 fail on a developer
// machine, so the web process keeps uploads failing closed. That is the designed behaviour.
import { createHash } from 'node:crypto';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import {
  type HelperSelfReport,
  isEnvAllowlisted,
  isWorkerEnvExact,
} from '../domain/image-isolation.ts';

/** INF-205 cgroup memory.max of a helper container: 512 MB. */
export const HELPER_MEMORY_MAX = '536870912';
/** PID 1 inside a hardened helper container (`init: true`) is Docker's init. */
const CONTAINER_INITS: ReadonlySet<string> = new Set(['docker-init', 'tini', 'catatonit']);
const CONNECT_TIMEOUT_MS = 1_000;

/** What the web process sends with its status request: addresses to probe, never a credential. */
export type ProbeTargets = {
  /** The VM's private address of the database (ports 5432 and 6432). */
  privateHost: string;
  /** One public address (port 443). */
  publicHost: string;
  /** The path of web's env file, which must not exist inside the helper. */
  webEnvFilePath: string;
};

export type SelfTestProbes = {
  env(): Record<string, string | undefined>;
  readText(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  listPids(): Promise<string[]>;
  /** The error code of a TCP connect, or 'connected'. */
  connect(host: string, port: number): Promise<string>;
  /** The error code of a write to the root directory, or 'written'. */
  writeRoot(): Promise<string>;
  /** Check 8: the committed synthetic JPEG round-trips into clean WebP variants. */
  roundTrip(): Promise<boolean>;
};

export const realProbes = (roundTrip: () => Promise<boolean>): SelfTestProbes => ({
  env: () => process.env,
  readText: (path) => readFile(path, 'utf8').catch(() => null),
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  listPids: async () => (await readdir('/proc')).filter((name) => /^\d+$/.test(name)),
  connect: (host, port) =>
    new Promise((resolve) => {
      const socket = new Socket();
      const done = (outcome: string) => {
        socket.destroy();
        resolve(outcome);
      };
      socket.setTimeout(CONNECT_TIMEOUT_MS, () => done('ETIMEDOUT'));
      socket.once('connect', () => done('connected'));
      socket.once('error', (error: NodeJS.ErrnoException) => done(error.code ?? 'error'));
      socket.connect(port, host);
    }),
  writeRoot: () =>
    writeFile('/.image-helper-probe', 'x').then(
      () => 'written',
      (error: NodeJS.ErrnoException) => error.code ?? 'error',
    ),
  roundTrip,
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function statusField(status: string | null, name: string): string | null {
  const line = status?.split('\n').find((l) => l.startsWith(`${name}:`));
  return line ? line.slice(name.length + 1).trim() : null;
}

export async function runHelperSelfTest(input: {
  probes: SelfTestProbes;
  workerEnvKeys: string[][];
  targets: ProbeTargets;
}): Promise<HelperSelfReport> {
  const { probes, targets } = input;
  const env = probes.env();
  const values = Object.values(env).filter((v): v is string => typeof v === 'string');

  const pid1 = (await probes.readText('/proc/1/comm'))?.trim() ?? '';
  const pids = await probes.listPids();
  const noForeignProcesses = CONTAINER_INITS.has(pid1) && pids.length <= 32;

  const noSecretPaths =
    !(await probes.exists('/run/secrets')) && !(await probes.exists(targets.webEnvFilePath));

  const attempts = await Promise.all([
    probes.connect(targets.privateHost, 6432),
    probes.connect(targets.privateHost, 5432),
    probes.connect(targets.publicHost, 443),
  ]);
  const networkUnreachable = attempts.every((code) => code === 'ENETUNREACH');

  const status = await probes.readText('/proc/self/status');
  const capEff = statusField(status, 'CapEff');
  const noCapabilities =
    capEff !== null && /^0+$/.test(capEff) && statusField(status, 'NoNewPrivs') === '1';

  const memoryMax = (await probes.readText('/sys/fs/cgroup/memory.max'))?.trim();

  return {
    checks: {
      envAllowlisted: isEnvAllowlisted(Object.keys(env)),
      workerEnvExact:
        input.workerEnvKeys.length > 0 &&
        input.workerEnvKeys.every((keys) => isWorkerEnvExact(keys)),
      noForeignProcesses,
      noSecretPaths,
      networkUnreachable,
      rootReadOnly: (await probes.writeRoot()) === 'EROFS',
      noCapabilities,
      memoryLimit: memoryMax === HELPER_MEMORY_MAX,
      roundTrip: await probes.roundTrip().catch(() => false),
    },
    envValueHashes: values.map(sha256),
  };
}
