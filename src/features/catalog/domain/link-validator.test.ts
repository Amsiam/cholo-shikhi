// [LT] Step 21 (written first): the link validator (NFR6.209, SD-210). Pure: the IDNA function is
// injected, and no network is touched (a spy on fetch proves it).
import { domainToASCII } from 'node:url';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCKED_DOMAINS, LINK_CORPUS } from '../test-fixtures/link-corpus.ts';
import {
  createLinkValidator,
  domainCandidates,
  isBlockedBy,
  LINK_MAX_LENGTH,
} from './link-validator.ts';

const links = createLinkValidator(domainToASCII);
const blocked = new Set(BLOCKED_DOMAINS);

function classify(href: string): 'ok' | 'invalid' | 'blocked' {
  const checked = links.checkLink(href);
  if (!checked.ok) return 'invalid';
  return isBlockedBy(checked.value.candidates, blocked) ? 'blocked' : 'ok';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkLink (SD-210)', () => {
  it.each(LINK_CORPUS)('$href is $expected ($why)', ({ href, expected }) => {
    expect(classify(href)).toBe(expected);
  });

  it('refuses with the linkInvalid key', () => {
    expect(links.checkLink('http://example.com/')).toEqual({ ok: false, error: 'linkInvalid' });
  });

  it('accepts exactly 2,048 characters and refuses 2,049', () => {
    const base = 'https://example.com/';
    const atLimit = base + 'a'.repeat(LINK_MAX_LENGTH - base.length);
    expect(atLimit).toHaveLength(2048);
    expect(links.checkLink(atLimit).ok).toBe(true);
    expect(links.checkLink(`${atLimit}a`).ok).toBe(false);
  });

  it('returns the normalised host and its candidates', () => {
    expect(links.checkLink('https://A.B.Example.COM./x')).toEqual({
      ok: true,
      value: {
        host: 'a.b.example.com',
        candidates: ['a.b.example.com', 'b.example.com', 'example.com'],
      },
    });
  });

  it('treats an IDNA function that rejects the host as invalid (empty result)', () => {
    const strict = createLinkValidator(() => '');
    expect(strict.checkLink('https://example.com/').ok).toBe(false);
  });

  it('never fetches anything (CT5)', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const { href } of LINK_CORPUS) links.checkLink(href);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('domainCandidates', () => {
  it('lists the host and every parent on a label boundary, without the bare TLD', () => {
    expect(domainCandidates('a.b.example.com')).toEqual([
      'a.b.example.com',
      'b.example.com',
      'example.com',
    ]);
    expect(domainCandidates('example.com')).toEqual(['example.com']);
  });
});

describe('normaliseDomain (Admin blocked-list entries)', () => {
  it('normalises case, trailing dot and IDN to the stored ASCII form', () => {
    expect(links.normaliseDomain(' Malware.Example. ')).toEqual({
      ok: true,
      value: 'malware.example',
    });
    expect(links.normaliseDomain('аpple.com')).toEqual({ ok: true, value: 'xn--pple-43d.com' });
  });

  it.each([
    '',
    'https://example.com',
    'example',
    '127.0.0.1',
    'localhost',
    'a b.com',
    'exa_mple.com/x',
    'x'.repeat(254),
  ])('refuses %j', (input) => {
    expect(links.normaliseDomain(input)).toEqual({ ok: false, error: 'domainInvalid' });
  });

  it('a link to a subdomain of an entry is blocked', () => {
    const entry = links.normaliseDomain('Phish.Test');
    const link = links.checkLink('https://login.phish.test/');
    expect(entry.ok && link.ok && isBlockedBy(link.value.candidates, new Set([entry.value]))).toBe(
      true,
    );
  });
});

describe('properties', () => {
  const label = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}[a-z0-9]$/);
  const host = fc.array(label, { minLength: 2, maxLength: 5 }).map((labels) => labels.join('.'));

  it('any https URL on a multi-label DNS host is accepted, and its candidates end at the registrable pair', () => {
    fc.assert(
      fc.property(host, fc.webPath(), (h, path) => {
        const checked = links.checkLink(`https://${h}${path}`);
        if (!checked.ok) return false;
        const last = checked.value.candidates.at(-1) as string;
        return checked.value.candidates[0] === h && last.split('.').length === 2;
      }),
      { seed: 2117, numRuns: 300 },
    );
  });

  it('any scheme other than https is refused', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('http', 'ftp', 'javascript', 'data', 'vbscript', 'file', 'ws', 'wss'),
        host,
        (scheme, h) => !links.checkLink(`${scheme}://${h}/`).ok,
      ),
      { seed: 2118, numRuns: 200 },
    );
  });

  it('blocking a domain blocks every subdomain of it, and only on label boundaries', () => {
    fc.assert(
      fc.property(host, label, (h, prefix) => {
        const set = new Set([h]);
        const sub = links.checkLink(`https://${prefix}.${h}/`);
        const glued = links.checkLink(`https://${prefix}${h}/`);
        return (
          sub.ok &&
          isBlockedBy(sub.value.candidates, set) &&
          glued.ok &&
          !isBlockedBy(glued.value.candidates, set)
        );
      }),
      { seed: 2119, numRuns: 300 },
    );
  });
});
