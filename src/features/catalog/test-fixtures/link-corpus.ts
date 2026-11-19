// Committed link corpus for the link validator (NFR6.209, SD-210): IDN, homograph, credential,
// IP-literal, single-label and blocked-subdomain cases. Test data only; no link is ever fetched.

export type LinkCase = {
  href: string;
  expected: 'ok' | 'invalid' | 'blocked';
  why: string;
};

/** Every case is checked against this blocked list (stored ASCII-normalised, as in SD-211). */
export const BLOCKED_DOMAINS: readonly string[] = [
  'malware.example',
  'xn--pple-43d.com', // "аpple.com" with a Cyrillic "а"
  'phish.test',
];

export const LINK_CORPUS: readonly LinkCase[] = [
  { href: 'https://example.com/', expected: 'ok', why: 'plain https' },
  { href: 'https://example.com/path?q=1#frag', expected: 'ok', why: 'path, query and fragment' },
  { href: 'https://sub.example.com/', expected: 'ok', why: 'subdomain' },
  { href: 'https://EXAMPLE.com/', expected: 'ok', why: 'upper-case host' },
  { href: 'https://example.com./', expected: 'ok', why: 'trailing dot' },
  { href: 'https://বাংলা.example/', expected: 'ok', why: 'IDN host' },
  { href: 'https://ｅｘａｍｐｌｅ.com/', expected: 'ok', why: 'full-width host normalises' },
  { href: 'http://example.com/', expected: 'invalid', why: 'not https' },
  { href: 'ftp://example.com/', expected: 'invalid', why: 'not https' },
  { href: 'javascript:alert(1)', expected: 'invalid', why: 'script scheme' },
  { href: 'data:text/html,x', expected: 'invalid', why: 'data scheme' },
  { href: '//example.com/', expected: 'invalid', why: 'relative, no scheme' },
  { href: 'example.com', expected: 'invalid', why: 'no scheme' },
  { href: 'https://', expected: 'invalid', why: 'no host' },
  { href: 'https://user@example.com/', expected: 'invalid', why: 'user name' },
  { href: 'https://user:pw@example.com/', expected: 'invalid', why: 'credentials' },
  { href: 'https://127.0.0.1/', expected: 'invalid', why: 'IPv4 literal' },
  { href: 'https://0x7f.1/', expected: 'invalid', why: 'IPv4 in hex, normalised by the parser' },
  { href: 'https://2130706433/', expected: 'invalid', why: 'IPv4 as one integer' },
  { href: 'https://[::1]/', expected: 'invalid', why: 'IPv6 literal' },
  { href: 'https://localhost/', expected: 'invalid', why: 'localhost' },
  { href: 'https://api.localhost/', expected: 'invalid', why: 'a .localhost name' },
  { href: 'https://intranet/', expected: 'invalid', why: 'single-label host' },
  { href: `https://example.com/${'a'.repeat(2030)}`, expected: 'invalid', why: 'over 2,048' },
  { href: 'https://xn--/', expected: 'invalid', why: 'invalid IDN' },
  { href: 'https://malware.example/', expected: 'blocked', why: 'blocked domain' },
  { href: 'https://cdn.malware.example/x', expected: 'blocked', why: 'blocked parent domain' },
  { href: 'https://a.b.malware.example/', expected: 'blocked', why: 'deep subdomain' },
  { href: 'https://MALWARE.example./', expected: 'blocked', why: 'case and trailing dot' },
  { href: 'https://аpple.com/', expected: 'blocked', why: 'homograph matches its ASCII form' },
  { href: 'https://apple.com/', expected: 'ok', why: 'the real Latin domain is not blocked' },
  { href: 'https://notmalware.example/', expected: 'ok', why: 'suffix only, not a label boundary' },
  { href: 'https://phish.test.example.com/', expected: 'ok', why: 'blocked name as a prefix only' },
];
