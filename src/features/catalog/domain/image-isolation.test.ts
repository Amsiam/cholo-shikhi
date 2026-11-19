// [TF] Step 44 (approved 2026-11-17): the INF-203 isolation verdict and the SD-216 variant plan.
// Security logic, written test-first. Plain inputs, no I/O.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { variantSlots } from './image.ts';
import {
  evaluateIsolation,
  HELPER_ENV_ALLOWLIST,
  type HelperSelfReport,
  isEnvAllowlisted,
  isWorkerEnvExact,
} from './image-isolation.ts';

const SEED = 44203;

const passing: HelperSelfReport = {
  checks: {
    envAllowlisted: true,
    workerEnvExact: true,
    noForeignProcesses: true,
    noSecretPaths: true,
    networkUnreachable: true,
    rootReadOnly: true,
    noCapabilities: true,
    memoryLimit: true,
    roundTrip: true,
  },
  envValueHashes: ['aa', 'bb'],
};
const web = { socketOwnerUid: 10002, webUid: 10001, webSecretValueHashes: ['cc', 'dd'] };

describe('evaluateIsolation (INF-203)', () => {
  it('passes only when the socket owner differs, every helper check passed and no secret hash matches', () => {
    expect(evaluateIsolation({ report: passing, ...web })).toEqual({ isOk: true, failed: [] });
  });

  it('fails closed without a report or a socket owner', () => {
    expect(evaluateIsolation({ report: null, ...web })).toEqual({
      isOk: false,
      failed: ['noReport'],
    });
    expect(evaluateIsolation({ report: passing, ...web, socketOwnerUid: null })).toEqual({
      isOk: false,
      failed: ['socketOwner'],
    });
  });

  it('fails when the helper socket belongs to the web UID (check 1, not trusting the helper)', () => {
    expect(evaluateIsolation({ report: passing, ...web, socketOwnerUid: 10001 }).failed).toEqual([
      'socketOwner',
    ]);
  });

  it('names every failed helper-reported check', () => {
    const report = {
      ...passing,
      checks: { ...passing.checks, networkUnreachable: false, memoryLimit: false },
    };
    expect(evaluateIsolation({ report, ...web })).toEqual({
      isOk: false,
      failed: ['networkUnreachable', 'memoryLimit'],
    });
  });

  it('fails when a helper env value hash equals one of the web secret hashes (check 2)', () => {
    expect(
      evaluateIsolation({ report: passing, ...web, webSecretValueHashes: ['zz', 'bb'] }).failed,
    ).toEqual(['secretValueShared']);
  });

  it('property: one false check is always enough to fail', () => {
    const keys = Object.keys(passing.checks) as Array<keyof HelperSelfReport['checks']>;
    fc.assert(
      fc.property(fc.constantFrom(...keys), (key) => {
        const report = { ...passing, checks: { ...passing.checks, [key]: false } };
        const verdict = evaluateIsolation({ report, ...web });
        return !verdict.isOk && verdict.failed.includes(key);
      }),
      { seed: SEED },
    );
  });
});

describe('the env allow-lists (INF-203 check 2, SD-216)', () => {
  it('accepts a helper environment inside the allow-list, refuses any other key', () => {
    expect(isEnvAllowlisted(['PATH', 'HOSTNAME', 'PROCESS_ROLE', 'UV_THREADPOOL_SIZE'])).toBe(true);
    expect(isEnvAllowlisted([...HELPER_ENV_ALLOWLIST])).toBe(true);
    expect(isEnvAllowlisted(['PATH', 'DATABASE_URL'])).toBe(false);
    expect(isEnvAllowlisted(['PATH', 'BETTER_AUTH_SECRET'])).toBe(false);
  });

  it('requires each decode worker env to be exactly { UV_THREADPOOL_SIZE }', () => {
    expect(isWorkerEnvExact(['UV_THREADPOOL_SIZE'])).toBe(true);
    expect(isWorkerEnvExact([])).toBe(false);
    expect(isWorkerEnvExact(['UV_THREADPOOL_SIZE', 'PATH'])).toBe(false);
    expect(isWorkerEnvExact(['PATH'])).toBe(false);
  });
});

describe('variantSlots (SD-216: 400, 800 and 1600 px, never enlarged)', () => {
  it('keeps every slot below the source width plus the first slot at or above it', () => {
    expect(variantSlots(300)).toEqual([400]);
    expect(variantSlots(400)).toEqual([400]);
    expect(variantSlots(401)).toEqual([400, 800]);
    expect(variantSlots(800)).toEqual([400, 800]);
    expect(variantSlots(900)).toEqual([400, 800, 1600]);
    expect(variantSlots(5000)).toEqual([400, 800, 1600]);
  });

  it('refuses a non-positive or non-integer width', () => {
    expect(() => variantSlots(0)).toThrow();
    expect(() => variantSlots(1.5)).toThrow();
  });

  it('property: 1 to 3 distinct ascending slots, the smallest always 400', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (width) => {
        const slots = variantSlots(width);
        return (
          slots.length >= 1 &&
          slots.length <= 3 &&
          slots[0] === 400 &&
          slots.every((w, i) => i === 0 || w > (slots[i - 1] as number))
        );
      }),
      { seed: SEED },
    );
  });
});
