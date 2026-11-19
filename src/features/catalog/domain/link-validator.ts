// Link validation for lesson documents (rules.md BR3.4; NFR6.209; security-design SD-210). Pure: the
// IDNA-to-ASCII function is injected (the server passes node:url domainToASCII), so this module needs
// no framework or Node import. It parses with the WHATWG URL parser, a web-standard global, and it
// never fetches anything: no preview and no reachability check (CT5).

/**
 * A pure check's outcome. Contract 1's Result carries an AppError; these checks return a bare key
 * (or a list of positioned keys) that the service turns into VALIDATION_FAILED field errors.
 */
export type Outcome<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
export const pass = <T>(value: T) => ({ ok: true, value }) as const;
export const fail = <E>(error: E) => ({ ok: false, error }) as const;

export const LINK_MAX_LENGTH = 2048;
/** RFC 1035: a host name is at most 253 characters. */
export const DOMAIN_MAX_LENGTH = 253;

export type ToAscii = (domain: string) => string;
export type CheckedLink = { host: string; candidates: string[] };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * SD-210 step 4: the host and every parent on a label boundary, without the bare top-level label
 * (`a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`).
 */
export function domainCandidates(host: string): string[] {
  const labels = host.split('.');
  const candidates: string[] = [];
  for (let i = 0; i < labels.length - 1; i += 1) candidates.push(labels.slice(i).join('.'));
  return candidates;
}

/** SD-211: a link is blocked when any of its candidates is on the list. */
export function isBlockedBy(candidates: readonly string[], blocked: ReadonlySet<string>): boolean {
  return candidates.some((candidate) => blocked.has(candidate));
}

export function createLinkValidator(toAscii: ToAscii) {
  /** SD-210 step 3: ASCII, lower case, no trailing dot; '' when the host is not a usable DNS name. */
  function normaliseHost(raw: string): string {
    const ascii = toAscii(raw.toLowerCase()).toLowerCase().replace(/\.$/, '');
    if (ascii.length === 0 || ascii.length > DOMAIN_MAX_LENGTH) return '';
    if (IPV4.test(ascii) || ascii.startsWith('[')) return '';
    if (ascii === 'localhost' || ascii.endsWith('.localhost')) return '';
    const labels = ascii.split('.');
    if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return '';
    return ascii;
  }

  /** SD-210 steps 1–4 for one link mark's href. */
  function checkLink(href: string): Outcome<CheckedLink, 'linkInvalid'> {
    if (href.length > LINK_MAX_LENGTH) return fail('linkInvalid' as const);
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      // An unparseable link is an expected refusal, reported to the author as linkInvalid.
      return fail('linkInvalid' as const);
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      return fail('linkInvalid' as const);
    }
    const host = normaliseHost(url.hostname);
    if (host === '') return fail('linkInvalid' as const);
    return pass({ host, candidates: domainCandidates(host) });
  }

  /** An Admin's blocked-list entry: a bare domain (no scheme, path or port), stored ASCII. */
  function normaliseDomain(input: string): Outcome<string, 'domainInvalid'> {
    const trimmed = input.trim();
    if (trimmed.length === 0 || trimmed.length > DOMAIN_MAX_LENGTH + 1)
      return fail('domainInvalid' as const);
    if (/[\s/:?#@[\]\\]/.test(trimmed)) return fail('domainInvalid' as const);
    const host = normaliseHost(trimmed);
    return host === '' ? fail('domainInvalid' as const) : pass(host);
  }

  return { checkLink, normaliseDomain };
}

export type LinkValidator = ReturnType<typeof createLinkValidator>;
