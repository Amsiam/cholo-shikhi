// A minimal cookie-jar "browser" for driving the real Better Auth handler in integration tests.
export type Handler = (request: Request) => Promise<Response>;

export const TEST_ORIGIN = 'http://localhost:3000';

export type TestBrowser = {
  cookies: Map<string, string>;
  fetch(
    path: string,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<Response>;
  json<T = unknown>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<{ status: number; body: T; response: Response }>;
  cookieHeader(): string;
  request(path: string): Request;
};

function storeSetCookies(jar: Map<string, string>, response: Response): void {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = /max-age=0/i.test(raw) || value === '';
    if (expired) jar.delete(name);
    else jar.set(name, value);
  }
}

export function createBrowser(
  handler: Handler,
  options: { acceptLanguage?: string } = {},
): TestBrowser {
  const cookies = new Map<string, string>();
  // Each simulated device gets its own documentation-range IP (RFC 5737).
  const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const request = (
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = {
      origin: TEST_ORIGIN,
      'x-forwarded-for': ip,
      ...(options.acceptLanguage ? { 'accept-language': options.acceptLanguage } : {}),
      ...(init.headers ?? {}),
    };
    if (cookies.size > 0) headers.cookie = cookieHeader();
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    return new Request(`${TEST_ORIGIN}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      redirect: 'manual',
    });
  };
  const browser: TestBrowser = {
    cookies,
    cookieHeader,
    request: (path) => request(path),
    async fetch(path, init) {
      const response = await handler(request(path, init));
      storeSetCookies(cookies, response);
      return response;
    },
    async json(path, init) {
      const response = await browser.fetch(path, init);
      const text = await response.clone().text();
      return { status: response.status, body: (text ? JSON.parse(text) : null) as never, response };
    },
  };
  return browser;
}
