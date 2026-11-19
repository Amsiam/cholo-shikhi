// `pnpm start`: serves the production build (dist/) with Node's http server. TanStack Start's build
// emits a fetch handler (dist/server/server.js); static files come from dist/client.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { getServeConfig } from '../src/lib/env.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const clientDir = join(root, 'dist', 'client');
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Local runs read .env; in a deployment the environment is provided by the host (never committed).
const dotenv = join(root, '.env');
if (existsSync(dotenv)) process.loadEnvFile(dotenv);

const serverEntry = join(root, 'dist', 'server', 'server.js');
if (!existsSync(serverEntry)) {
  console.error('dist/server/server.js is missing: run `pnpm build` first.');
  process.exit(1);
}
const app = (await import(serverEntry)).default as {
  fetch: (request: Request) => Promise<Response>;
};

function toRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url ?? '/', origin), {
    method: req.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: 'half' } : {}),
  } as RequestInit);
}

function staticPath(pathname: string): string | null {
  const candidate = normalize(join(clientDir, decodeURIComponent(pathname)));
  if (!candidate.startsWith(clientDir)) return null;
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null;
}

const { port, host } = getServeConfig();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    const file = req.method === 'GET' ? staticPath(url.pathname) : null;
    if (file) {
      const isHashed = url.pathname.startsWith('/assets/');
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      createReadStream(file).pipe(res);
      return;
    }
    const response = await app.fetch(
      toRequest(req, `http://${req.headers.host ?? `${host}:${port}`}`),
    );
    const headers: Record<string, string | string[]> = {};
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') headers[key] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    if (response.body) Readable.fromWeb(response.body as never).pipe(res);
    else res.end();
  } catch (error) {
    console.error('request failed', error instanceof Error ? error.name : 'unknown');
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(port, host, () => console.log(`serving dist/ on http://${host}:${port}`));
const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
