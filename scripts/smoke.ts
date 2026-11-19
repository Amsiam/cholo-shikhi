// `pnpm smoke`: boots the built server on a spare port, expects /api/health -> 200 and readiness, then
// stops it. Part of `pnpm verify` (after `pnpm build`).
import { spawn } from 'node:child_process';

const port = Number(process.env.SMOKE_PORT ?? 3100);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['scripts/serve.ts'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});

async function get(path: string): Promise<{ status: number; body: string }> {
  const response = await globalThis.fetch(`${base}${path}`);
  return { status: response.status, body: await response.text() };
}

let exitCode = 1;
try {
  let health: { status: number; body: string } | undefined;
  for (let i = 0; i < 60 && !health; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    health = await get('/api/health').catch(() => undefined);
  }
  if (health?.status !== 200)
    throw new Error(`/api/health did not answer 200 (got ${health?.status ?? 'no answer'})`);
  const ready = await get('/api/health/ready');
  const home = await get('/');
  console.log(`smoke: /api/health 200 ${health.body}`);
  console.log(`smoke: /api/health/ready ${ready.status} ${ready.body}`);
  console.log(`smoke: / ${home.status}`);
  if (ready.status !== 200 || home.status !== 200)
    throw new Error('readiness or the home page failed');
  exitCode = 0;
} catch (error) {
  console.error(
    `smoke failed: ${error instanceof Error ? error.message : String(error)}\n${output}`,
  );
} finally {
  child.kill('SIGTERM');
}
process.exit(exitCode);
