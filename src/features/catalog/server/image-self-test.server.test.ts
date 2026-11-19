// [LT] Step 44: the INF-203 helper-side checks, each driven both ways through injected probes, plus
// one run of the real probes on this (unhardened) machine, which must NOT pass.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluateIsolation } from '../domain/image-isolation.ts';
import {
  type ProbeTargets,
  realProbes,
  runHelperSelfTest,
  type SelfTestProbes,
} from './image-self-test.server.ts';

const targets: ProbeTargets = {
  privateHost: '10.0.0.5',
  publicHost: '1.1.1.1',
  webEnvFilePath: '/srv/app/.env',
};

/** Probes of a correctly hardened helper container (INF-201, INF-205). */
const hardened = (): SelfTestProbes => ({
  env: () => ({
    PATH: '/usr/bin',
    HOSTNAME: 'h1',
    PROCESS_ROLE: 'image-helper',
    UV_THREADPOOL_SIZE: '2',
  }),
  readText: async (path) =>
    ({
      '/proc/1/comm': 'docker-init\n',
      '/proc/self/status': 'Name:\tnode\nCapEff:\t0000000000000000\nNoNewPrivs:\t1\n',
      '/sys/fs/cgroup/memory.max': '536870912\n',
    })[path] ?? null,
  exists: async () => false,
  listPids: async () => ['1', '7', '8', '9'],
  connect: async () => 'ENETUNREACH',
  writeRoot: async () => 'EROFS',
  roundTrip: async () => true,
});
const workers = [['UV_THREADPOOL_SIZE'], ['UV_THREADPOOL_SIZE']];
const run = (probes: SelfTestProbes, workerEnvKeys = workers) =>
  runHelperSelfTest({ probes, workerEnvKeys, targets });

describe('runHelperSelfTest', () => {
  it('passes every check inside a hardened container and hashes env values', async () => {
    const report = await run(hardened());
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
    expect(report.envValueHashes).toContain(
      createHash('sha256').update('image-helper').digest('hex'),
    );
    expect(report.envValueHashes).not.toContain('image-helper');
  });

  const cases: Array<[string, Partial<SelfTestProbes>, string, string[][]?]> = [
    [
      'a DATABASE_URL in the helper env',
      { env: () => ({ PATH: '/x', DATABASE_URL: 'postgres://' }) },
      'envAllowlisted',
    ],
    ['a worker env with an extra key', {}, 'workerEnvExact', [['UV_THREADPOOL_SIZE', 'PATH']]],
    ['no worker at all', {}, 'workerEnvExact', []],
    [
      'the host init as PID 1',
      {
        readText: async (p) => (p === '/proc/1/comm' ? 'systemd\n' : await hardened().readText(p)),
      },
      'noForeignProcesses',
    ],
    [
      'more than 32 visible PIDs',
      { listPids: async () => Array.from({ length: 40 }, (_, i) => String(i + 1)) },
      'noForeignProcesses',
    ],
    ['a /run/secrets mount', { exists: async (p) => p === '/run/secrets' }, 'noSecretPaths'],
    ["web's env file", { exists: async (p) => p === targets.webEnvFilePath }, 'noSecretPaths'],
    [
      'a reachable database port',
      { connect: async (_h, port) => (port === 5432 ? 'connected' : 'ENETUNREACH') },
      'networkUnreachable',
    ],
    [
      'a refused (not unreachable) public port',
      { connect: async (_h, port) => (port === 443 ? 'ECONNREFUSED' : 'ENETUNREACH') },
      'networkUnreachable',
    ],
    ['a writable root', { writeRoot: async () => 'written' }, 'rootReadOnly'],
    ['an EACCES root (not read-only)', { writeRoot: async () => 'EACCES' }, 'rootReadOnly'],
    [
      'an effective capability',
      {
        readText: async (p) =>
          p === '/proc/self/status'
            ? 'CapEff:\t00000000a80425fb\nNoNewPrivs:\t1\n'
            : await hardened().readText(p),
      },
      'noCapabilities',
    ],
    [
      'NoNewPrivs off',
      {
        readText: async (p) =>
          p === '/proc/self/status'
            ? 'CapEff:\t0000000000000000\nNoNewPrivs:\t0\n'
            : await hardened().readText(p),
      },
      'noCapabilities',
    ],
    [
      'no status file',
      { readText: async (p) => (p === '/proc/self/status' ? null : await hardened().readText(p)) },
      'noCapabilities',
    ],
    [
      'no cgroup memory limit',
      {
        readText: async (p) =>
          p === '/sys/fs/cgroup/memory.max' ? 'max\n' : await hardened().readText(p),
      },
      'memoryLimit',
    ],
    ['a failed round trip', { roundTrip: async () => false }, 'roundTrip'],
    [
      'a throwing round trip',
      { roundTrip: async () => Promise.reject(new Error('decoder')) },
      'roundTrip',
    ],
  ];

  it.each(cases)('fails %s', async (_label, override, check, workerEnvKeys) => {
    const report = await run({ ...hardened(), ...override }, workerEnvKeys ?? workers);
    const failed = Object.entries(report.checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    expect(failed).toEqual([check]);
  });

  it('does not pass with the real probes on an unhardened machine (uploads stay closed)', async () => {
    const report = await runHelperSelfTest({
      probes: realProbes(async () => true),
      workerEnvKeys: workers,
      targets: {
        privateHost: '127.0.0.1',
        publicHost: '127.0.0.1',
        webEnvFilePath: '/nonexistent/.env',
      },
    });
    const verdict = evaluateIsolation({
      report,
      socketOwnerUid: 1,
      webUid: 0,
      webSecretValueHashes: [],
    });
    expect(verdict.isOk).toBe(false);
    expect(verdict.failed).toEqual(expect.arrayContaining(['networkUnreachable', 'memoryLimit']));
  });
});
