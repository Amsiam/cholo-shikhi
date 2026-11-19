// INF-203 isolation self-test verdict (Step 44, approved by the human on 2026-11-17). Plain
// TypeScript, no I/O: the helper process reports its own checks (it is fresh from the attested image
// and has seen no upload yet), and the web process decides with one check that does not trust the
// helper (the socket's owner UID) and with a comparison of env value hashes. Any failure keeps that
// instance's upload route failing closed (imageUnreadable without reading the body).

/**
 * INF-203 check 2: the keys a helper process may have. The image's own ENV keys of the Node base
 * image, plus the four the design names and the socket path. Step 47 (deferred) moves this list to
 * `ops/compose/helper-env-allowlist.json`; until then this constant is the single source.
 */
export const HELPER_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOSTNAME',
  'HOME',
  'NODE_VERSION',
  'YARN_VERSION',
  'PROCESS_ROLE',
  'UV_THREADPOOL_SIZE',
  'IMAGE_HELPER_SOCKET_PATH',
];

/** SD-216: each decode worker receives exactly this one variable. */
export const DECODE_WORKER_ENV_KEYS: readonly string[] = ['UV_THREADPOOL_SIZE'];

export type HelperSelfReport = {
  checks: {
    /** 2: the helper's env keys are all allow-listed. */
    envAllowlisted: boolean;
    /** 2: each decode worker's env is exactly { UV_THREADPOOL_SIZE }. */
    workerEnvExact: boolean;
    /** 3: no process outside its own container is visible in /proc. */
    noForeignProcesses: boolean;
    /** 3: /run/secrets and web's env-file path do not exist. */
    noSecretPaths: boolean;
    /** 4: TCP to the database ports and a public address fails at once with ENETUNREACH. */
    networkUnreachable: boolean;
    /** 5: a write to / fails with EROFS. */
    rootReadOnly: boolean;
    /** 6: CapEff is 0 and NoNewPrivs is 1. */
    noCapabilities: boolean;
    /** 7: the cgroup memory.max is 536870912. */
    memoryLimit: boolean;
    /** 8: the committed synthetic JPEG round-trips into clean WebP variants. */
    roundTrip: boolean;
  };
  /** SHA-256 (hex) of each of the helper's env values; never the values themselves. */
  envValueHashes: string[];
};

export type IsolationVerdict = { isOk: boolean; failed: string[] };

export function isEnvAllowlisted(keys: readonly string[]): boolean {
  return keys.every((key) => HELPER_ENV_ALLOWLIST.includes(key));
}

export function isWorkerEnvExact(keys: readonly string[]): boolean {
  return (
    keys.length === DECODE_WORKER_ENV_KEYS.length &&
    DECODE_WORKER_ENV_KEYS.every((key) => keys.includes(key))
  );
}

/**
 * The web-side decision. `socketOwnerUid` is read by web itself (check 1) and must differ from its
 * own UID; `webSecretValueHashes` are hashes of web's values for keys outside the helper allow-list,
 * none of which may appear among the helper's hashes.
 */
export function evaluateIsolation(input: {
  report: HelperSelfReport | null;
  socketOwnerUid: number | null;
  webUid: number;
  webSecretValueHashes: readonly string[];
}): IsolationVerdict {
  if (input.report === null) return { isOk: false, failed: ['noReport'] };
  const failed: string[] = [];
  if (input.socketOwnerUid === null || input.socketOwnerUid === input.webUid) {
    failed.push('socketOwner');
  }
  for (const [name, passed] of Object.entries(input.report.checks)) {
    if (!passed) failed.push(name);
  }
  const helperHashes = new Set(input.report.envValueHashes);
  if (input.webSecretValueHashes.some((hash) => helperHashes.has(hash))) {
    failed.push('secretValueShared');
  }
  return { isOk: failed.length === 0, failed };
}
