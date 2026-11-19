// [LT] Step 21 (written first): the one reviewed lesson renderer (NFR6.208, SD-209). It maps nodes to
// React elements, never builds an HTML string, and re-checks every href and image URL at render.
// The XSS corpus (≥ 200 payloads) is rendered as text, as link targets and as image alt text.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LessonDocument } from '../domain/lesson-document.ts';
import { HOSTILE_HREFS, XSS_CORPUS } from '../test-fixtures/xss-corpus.ts';
import { renderLessonDocument } from './render-lesson-document.tsx';

afterEach(cleanup);

const IMAGE_ID = '0b6f8c9e-3a8d-4f57-9b7e-0c1d2e3f4a5b';
const text = (t: string, marks?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as unknown as LessonDocument;

const DANGEROUS_URL = /^(javascript|data|vbscript):/;

/** Every attribute in the tree: no on* handler and no script-capable URL may appear. */
function assertInert(container: HTMLElement) {
  for (const element of container.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      expect(attribute.name.toLowerCase().startsWith('on')).toBe(false);
      if (['href', 'src', 'xlink:href', 'action', 'formaction'].includes(attribute.name)) {
        // Browsers strip control characters and spaces before reading a scheme.
        const normalised = [...attribute.value]
          .filter((c) => (c.codePointAt(0) ?? 0) > 0x20)
          .join('')
          .toLowerCase();
        expect(DANGEROUS_URL.test(normalised)).toBe(false);
      }
    }
    expect([
      'SCRIPT',
      'IFRAME',
      'OBJECT',
      'EMBED',
      'STYLE',
      'BASE',
      'META',
      'LINK',
      'FORM',
    ]).not.toContain(element.tagName);
  }
}

describe('renderLessonDocument', () => {
  it('maps every node and mark to its element', () => {
    const { container } = render(
      <div>
        {renderLessonDocument(
          doc(
            { type: 'heading', attrs: { level: 3 }, content: [text('শিরোনাম')] },
            para(
              text('b', [{ type: 'bold' }]),
              text('i', [{ type: 'italic' }]),
              { type: 'hardBreak' },
              text('both', [{ type: 'bold' }, { type: 'italic' }]),
            ),
            { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('u'))] }] },
            { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('o'))] }] },
          ),
        )}
      </div>,
    );
    expect(container.querySelector('h3')?.textContent).toBe('শিরোনাম');
    expect(container.querySelector('strong')?.textContent).toBe('b');
    expect(container.querySelector('em')?.textContent).toBe('i');
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.querySelector('strong em, em strong')?.textContent).toBe('both');
    expect(container.querySelector('ul > li > p')?.textContent).toBe('u');
    expect(container.querySelector('ol > li > p')?.textContent).toBe('o');
  });

  it('renders an https link in a new tab with the exact rel', () => {
    const { container } = render(
      <div>
        {renderLessonDocument(
          doc(para(text('go', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]))),
        )}
      </div>,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://example.com/a');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
  });

  it.each(HOSTILE_HREFS)('never renders %j as a live link (defence in depth)', (href) => {
    const { container } = render(
      <div>{renderLessonDocument(doc(para(text('x', [{ type: 'link', attrs: { href } }]))))}</div>,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('x');
  });

  it('renders an image only through the resolver and only with a safe URL', () => {
    const image = { type: 'image', attrs: { imageId: IMAGE_ID, alt: 'চিত্র' } };
    const resolved = render(
      <div>
        {renderLessonDocument(doc(para(image)), { imageUrl: (id) => `/images/${id}.webp` })}
      </div>,
    );
    expect(resolved.container.querySelector('img')?.getAttribute('src')).toBe(
      `/images/${IMAGE_ID}.webp`,
    );
    expect(resolved.container.querySelector('img')?.getAttribute('alt')).toBe('চিত্র');
    cleanup();
    const unresolved = render(<div>{renderLessonDocument(doc(para(image)))}</div>);
    expect(unresolved.container.querySelector('img')).toBeNull();
    cleanup();
    const hostile = render(
      <div>
        {renderLessonDocument(doc(para(image)), { imageUrl: () => 'javascript:alert(1)' })}
      </div>,
    );
    expect(hostile.container.querySelector('img')).toBeNull();
    cleanup();
    const protocolRelative = render(
      <div>
        {renderLessonDocument(doc(para(image)), { imageUrl: () => '//evil.example/x.png' })}
      </div>,
    );
    expect(protocolRelative.container.querySelector('img')).toBeNull();
  });

  it('renders nothing for a node it does not know (stored data that bypassed validation)', () => {
    const { container } = render(
      <div>
        {renderLessonDocument(
          doc(
            { type: 'script', content: [text('alert(1)')] },
            para({ type: 'iframe' }, text('kept')),
          ),
        )}
      </div>,
    );
    expect(container.textContent).toBe('kept');
    assertInert(container);
  });

  it('ignores an unknown mark and keeps the text', () => {
    const { container } = render(
      <div>{renderLessonDocument(doc(para(text('t', [{ type: 'onclick' }]))))}</div>,
    );
    expect(container.innerHTML).toBe('<div><p>t</p></div>');
  });

  it(`keeps all ${XSS_CORPUS.length} corpus payloads inert as text, link targets and alt text`, () => {
    expect(XSS_CORPUS.length).toBeGreaterThanOrEqual(200);
    const content = XSS_CORPUS.flatMap((payload) => [
      para(text(payload), text('l', [{ type: 'link', attrs: { href: payload } }]), {
        type: 'image',
        attrs: { imageId: IMAGE_ID, alt: payload },
      }),
      { type: 'heading', attrs: { level: 2 }, content: [text(payload, [{ type: 'bold' }])] },
    ]);
    const { container } = render(
      <div>{renderLessonDocument(doc(...content), { imageUrl: () => '/images/x.webp' })}</div>,
    );
    assertInert(container);
    // The payload text reaches the DOM verbatim as text, never as markup.
    expect(container.querySelectorAll('p').length).toBe(XSS_CORPUS.length);
    expect(container.textContent).toContain(XSS_CORPUS[0]);
  });

  it('tolerates malformed stored data without rendering anything unsafe', () => {
    const malformed = doc(
      { type: 'heading', attrs: { level: 4 }, content: [text('four')] },
      { type: 'heading', attrs: { level: 9 }, content: [text('nine')] },
      { type: 'paragraph', content: 'not-a-list' },
      para({ type: 'text', text: 42 }, text('n', [{ type: 'link', attrs: { href: 7 } }]), {
        type: 'image',
        attrs: { imageId: IMAGE_ID },
      }),
      { type: 'bulletList', content: 'x' },
      { type: 'orderedList', content: [{ type: 'paragraph' }, { type: 'listItem', content: 'y' }] },
    );
    const { container } = render(
      <div>
        {renderLessonDocument(malformed, { imageUrl: () => 'http://plain.example/x.png' })}
      </div>,
    );
    expect(container.querySelector('h4')?.textContent).toBe('four');
    expect(container.textContent).not.toContain('nine');
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    assertInert(container);
    cleanup();
    const noAlt = render(
      <div>
        {renderLessonDocument(malformed, { imageUrl: () => 'https://static.example/x.png' })}
      </div>,
    );
    expect(noAlt.container.querySelector('img')?.getAttribute('alt')).toBe('');
    cleanup();
    const broken = render(
      <div>
        {renderLessonDocument({ type: 'doc', content: 'z' } as unknown as LessonDocument)}
        {renderLessonDocument(
          doc(para({ type: 'image', attrs: { imageId: IMAGE_ID, alt: 'a' } })),
          {
            imageUrl: () => 'https://[bad',
          },
        )}
      </div>,
    );
    expect(broken.container.innerHTML).toBe('<div><p></p></div>');
  });

  it('renders an empty document as nothing', () => {
    const { container } = render(<div>{renderLessonDocument(doc())}</div>);
    expect(container.innerHTML).toBe('<div></div>');
  });
});
