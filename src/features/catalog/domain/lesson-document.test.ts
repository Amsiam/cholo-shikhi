// [LT] Step 21 (written first): the allowlisted lesson document (NFR6.207, SD-208). Unknown nodes,
// marks and attributes are refused, never dropped; each limit refuses at limit + 1.
import { domainToASCII } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { XSS_CORPUS } from '../test-fixtures/xss-corpus.ts';
import {
  canonicalJson,
  documentLinks,
  isDocumentEmpty,
  LESSON_BODY_MAX_BYTES,
  LESSON_MAX_DEPTH,
  LESSON_MAX_IMAGES,
  LESSON_MAX_TEXT_RUN,
  type LessonDocument,
  validateLessonDocument,
} from './lesson-document.ts';
import { createLinkValidator } from './link-validator.ts';

const links = createLinkValidator(domainToASCII);
const validate = (raw: unknown) => validateLessonDocument(raw, links);

const text = (t: string, marks?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const link = (href: string) => ({ type: 'link', attrs: { href } });
const IMAGE_ID = '0b6f8c9e-3a8d-4f57-9b7e-0c1d2e3f4a5b';
const image = { type: 'image', attrs: { imageId: IMAGE_ID, alt: 'চিত্র' } };

function keysOf(result: ReturnType<typeof validate>): string[] {
  return result.ok ? [] : result.error.map((e) => e.key);
}

describe('allowlist (SD-208)', () => {
  it('accepts every allowed node and mark', () => {
    const full = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('শিরোনাম')] },
      { type: 'heading', attrs: { level: 4 }, content: [text('Sub')] },
      para(
        text('bold', [{ type: 'bold' }]),
        text('italic', [{ type: 'italic' }]),
        { type: 'hardBreak' },
        text('link', [link('https://example.com/')]),
        image,
      ),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('a'))] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('b'))] }] },
      para(),
    );
    const result = validate(full);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.imageIds).toEqual([IMAGE_ID]);
      expect(result.value.linkCandidates).toEqual(['example.com']);
    }
  });

  it.each([
    ['an unknown node', doc({ type: 'script', content: [text('x')] })],
    ['an unknown mark', doc(para(text('x', [{ type: 'underline' }])))],
    ['an unknown attribute on a node', doc({ ...para(text('x')), attrs: { style: 'x' } })],
    [
      'an unknown attribute on a mark',
      doc(para(text('x', [{ type: 'link', attrs: { href: 'https://e.com/', onclick: 'x' } }]))),
    ],
    ['an extra key on a text node', doc(para({ ...text('x'), html: '<b>x</b>' }))],
    ['heading level 1', doc({ type: 'heading', attrs: { level: 1 }, content: [text('x')] })],
    ['heading level 5', doc({ type: 'heading', attrs: { level: 5 }, content: [text('x')] })],
    ['an image without alt', doc(para({ type: 'image', attrs: { imageId: IMAGE_ID } }))],
    [
      'an image with a URL instead of an ID',
      doc(para({ type: 'image', attrs: { imageId: 'https://evil.example/x.png', alt: 'x' } })),
    ],
    ['an empty text node', doc(para(text('')))],
    ['a list without items', doc({ type: 'bulletList', content: [] })],
    ['a block inside a paragraph', doc(para(para(text('x'))))],
    ['a text node at the top level', doc(text('x'))],
    ['a root that is not doc', para(text('x'))],
    ['a string body', '<p>hello</p>'],
    ['null', null],
    ['an array', [doc()]],
  ])('refuses %s with lessonBodyInvalid', (_name, raw) => {
    expect(keysOf(validate(raw))).toEqual(['errors.catalog.lessonBodyInvalid']);
  });
});

describe('limits (refusal at limit + 1)', () => {
  it('byte cap: canonical JSON of exactly LESSON_BODY_MAX_BYTES passes; one byte more is refused', () => {
    const shell = canonicalJson(doc(para(text('x'))) as LessonDocument);
    const overhead = Buffer.byteLength(shell, 'utf8') - 1;
    // Several runs of ≤ 10,000 characters fill the document to the exact cap.
    const total = LESSON_BODY_MAX_BYTES - overhead;
    const build = (n: number) => {
      const runs: unknown[] = [];
      let left = n;
      const perRunOverhead = Buffer.byteLength(',{"type":"text","text":""}', 'utf8');
      while (left > LESSON_MAX_TEXT_RUN + perRunOverhead) {
        runs.push(text('a'.repeat(LESSON_MAX_TEXT_RUN)));
        left -= LESSON_MAX_TEXT_RUN + perRunOverhead;
      }
      runs.push(text('a'.repeat(left)));
      return doc(para(...runs));
    };
    const atCap = build(total);
    expect(Buffer.byteLength(canonicalJson(atCap as LessonDocument), 'utf8')).toBe(
      LESSON_BODY_MAX_BYTES,
    );
    expect(validate(atCap).ok).toBe(true);
    expect(keysOf(validate(build(total + 1)))).toEqual(['errors.catalog.lessonBodyTooLarge']);
  });

  it('counts UTF-8 bytes, not characters (Bangla is 3 bytes a character)', () => {
    const bangla = 'অ'.repeat(LESSON_MAX_TEXT_RUN);
    const runs = Array.from({ length: 4 }, () => text(bangla));
    expect(keysOf(validate(doc(para(...runs))))).toEqual(['errors.catalog.lessonBodyTooLarge']);
  });

  it('depth: 8 levels pass, 9 are refused (every node counts, doc = 1)', () => {
    const nest = (lists: number, leaf: unknown): unknown => {
      let inner = leaf;
      for (let i = 0; i < lists; i += 1) {
        inner = { type: 'bulletList', content: [{ type: 'listItem', content: [inner] }] };
      }
      return doc(inner);
    };
    expect(LESSON_MAX_DEPTH).toBe(8);
    // doc1 > (ul > li) x3 = 7 > paragraph8: exactly 8 levels.
    expect(validate(nest(3, para())).ok).toBe(true);
    // ... > paragraph8 > text9: 9 levels.
    expect(keysOf(validate(nest(3, para(text('x')))))).toEqual([
      'errors.catalog.lessonBodyTooDeep',
    ]);
    expect(validate(nest(2, para(text('x')))).ok).toBe(true);
  });

  it('refuses a pathological nesting without overflowing the stack', () => {
    let inner: unknown = para(text('x'));
    for (let i = 0; i < 50_000; i += 1) {
      inner = { type: 'bulletList', content: [{ type: 'listItem', content: [inner] }] };
    }
    expect(keysOf(validate(doc(inner)))).toEqual(['errors.catalog.lessonBodyTooDeep']);
  });

  it('images: 20 pass, 21 are refused', () => {
    const many = (n: number) => doc(para(...Array.from({ length: n }, () => image)));
    expect(validate(many(LESSON_MAX_IMAGES)).ok).toBe(true);
    expect(keysOf(validate(many(LESSON_MAX_IMAGES + 1)))).toEqual([
      'errors.catalog.lessonBodyTooManyImages',
    ]);
  });

  it('text runs: 10,000 characters pass, 10,001 are refused (counted as code points)', () => {
    expect(validate(doc(para(text('ক'.repeat(LESSON_MAX_TEXT_RUN))))).ok).toBe(true);
    expect(keysOf(validate(doc(para(text('a'.repeat(LESSON_MAX_TEXT_RUN + 1))))))).toEqual([
      'errors.catalog.lessonTextTooLong',
    ]);
    // Astral characters count once each.
    expect(validate(doc(para(text('😀'.repeat(LESSON_MAX_TEXT_RUN))))).ok).toBe(true);
  });
});

describe('links inside the document (NFR6.209)', () => {
  it('reports each bad link at its index in document order', () => {
    const body = doc(
      para(text('ok', [link('https://example.com/')])),
      para(text('bad', [link('http://example.com/')]), text('also', [link('javascript:alert(1)')])),
    );
    const result = validate(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual([
        { path: 'links.1', key: 'errors.catalog.linkInvalid' },
        { path: 'links.2', key: 'errors.catalog.linkInvalid' },
      ]);
    }
    expect(documentLinks(body as LessonDocument)).toEqual([
      'https://example.com/',
      'http://example.com/',
      'javascript:alert(1)',
    ]);
  });

  it('deduplicates the domain candidates of every link', () => {
    const result = validate(
      doc(
        para(text('a', [link('https://a.example.com/')])),
        para(text('b', [link('https://b.example.com/')])),
      ),
    );
    expect(result.ok && result.value.linkCandidates).toEqual([
      'a.example.com',
      'example.com',
      'b.example.com',
    ]);
  });
});

describe('emptiness (BR7.3)', () => {
  it('a document with only blank text is empty; any visible text or an image is content', () => {
    expect(isDocumentEmpty(doc() as LessonDocument)).toBe(true);
    expect(isDocumentEmpty(doc(para(), para(text('   '))) as LessonDocument)).toBe(true);
    expect(isDocumentEmpty(doc(para(text('x'))) as LessonDocument)).toBe(false);
    expect(isDocumentEmpty(doc(para(image)) as LessonDocument)).toBe(false);
    expect(
      isDocumentEmpty(
        doc({
          type: 'bulletList',
          content: [{ type: 'listItem', content: [para(text('y'))] }],
        }) as LessonDocument,
      ),
    ).toBe(false);
  });
});

describe('properties', () => {
  const inline = fc.oneof(
    fc.string({ minLength: 1, maxLength: 40 }).map((t) => text(t)),
    fc.constant({ type: 'hardBreak' }),
    fc.string({ minLength: 1, maxLength: 20 }).map((t) => text(t, [{ type: 'bold' }])),
  );
  const block = fc.oneof(
    fc.array(inline, { maxLength: 5 }).map((c) => para(...c)),
    fc
      .tuple(fc.constantFrom(2, 3, 4), fc.array(inline, { maxLength: 3 }))
      .map(([level, c]) => ({ type: 'heading', attrs: { level }, content: c })),
    fc.array(fc.array(inline, { maxLength: 3 }), { minLength: 1, maxLength: 3 }).map((items) => ({
      type: 'bulletList',
      content: items.map((c) => ({ type: 'listItem', content: [para(...c)] })),
    })),
  );
  const validDoc = fc.array(block, { maxLength: 8 }).map((b) => doc(...b));

  it('every generated allowlisted document is accepted and its canonical form round-trips', () => {
    fc.assert(
      fc.property(validDoc, (d) => {
        const result = validate(d);
        if (!result.ok) return false;
        return (
          canonicalJson(JSON.parse(canonicalJson(result.value.document))) ===
          canonicalJson(result.value.document)
        );
      }),
      { seed: 2121, numRuns: 300 },
    );
  });

  it('adding any unknown key anywhere is refused, never silently dropped', () => {
    const extraKey = fc
      .string({ minLength: 1, maxLength: 12 })
      .filter((k) => !['type', 'content', 'text', 'marks', 'attrs'].includes(k));
    fc.assert(
      fc.property(validDoc, extraKey, fc.nat(), (d, key, pick) => {
        const nodes: Record<string, unknown>[] = [];
        const walk = (n: Record<string, unknown>) => {
          nodes.push(n);
          for (const c of (n.content as Record<string, unknown>[] | undefined) ?? []) walk(c);
        };
        walk(d as Record<string, unknown>);
        const target = nodes[pick % nodes.length] as Record<string, unknown>;
        target[key] = 'x';
        return !validate(d).ok;
      }),
      { seed: 2122, numRuns: 300 },
    );
  });

  it('replacing any node type with an unknown one is refused', () => {
    const badType = fc.constantFrom('script', 'iframe', 'html', 'style', 'div', 'span', 'a', 'img');
    fc.assert(
      fc.property(validDoc, badType, fc.nat(), (d, type, pick) => {
        const nodes: Record<string, unknown>[] = [];
        const walk = (n: Record<string, unknown>) => {
          nodes.push(n);
          for (const c of (n.content as Record<string, unknown>[] | undefined) ?? []) walk(c);
        };
        walk(d as Record<string, unknown>);
        (nodes[pick % nodes.length] as Record<string, unknown>).type = type;
        return !validate(d).ok;
      }),
      { seed: 2123, numRuns: 300 },
    );
  });

  it('XSS corpus payloads are only ever text: as text they validate unchanged; as hrefs they are refused', () => {
    for (const payload of XSS_CORPUS) {
      const asText = validate(doc(para(text(payload))));
      expect(asText.ok).toBe(true);
      if (asText.ok) {
        expect(
          (asText.value.document.content[0] as { content: Array<{ text: string }> }).content[0]
            ?.text,
        ).toBe(payload);
      }
      if (!payload.trim().toLowerCase().startsWith('https:')) {
        expect(validate(doc(para(text('x', [link(payload)])))).ok).toBe(false);
      }
    }
    expect(XSS_CORPUS.length).toBeGreaterThanOrEqual(200);
  });
});
