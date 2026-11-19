// [LT] Step 28: the editor markup parser emits only allowlisted nodes (NFR6.207), whatever is typed.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { XSS_CORPUS } from '../test-fixtures/xss-corpus.ts';
import { LessonDocumentSchema } from './lesson-document.ts';
import { lessonMarkupOf, parseInline, parseLessonMarkup } from './lesson-markup.ts';

describe('parseLessonMarkup', () => {
  it('parses headings, lists, paragraphs with line breaks and inline marks', () => {
    const doc = parseLessonMarkup(
      '## শিরোনাম\n\nপ্রথম **গাঢ়** ও *বাঁকা*\nদ্বিতীয় লাইন [সূত্র](https://example.com/a)\n\n- এক\n- দুই\n\n1. one\n2. two\n#### Small',
    );
    expect(doc.content.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'orderedList',
      'heading',
    ]);
    expect(doc.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'শিরোনাম' }],
    });
    const paragraph = doc.content[1] as { content: Array<{ type: string; marks?: unknown[] }> };
    expect(paragraph.content.map((n) => n.type)).toContain('hardBreak');
    expect(paragraph.content.find((n) => n.marks)?.marks).toEqual([{ type: 'bold' }]);
    expect(JSON.stringify(doc)).toContain('"href":"https://example.com/a"');
  });

  it('treats a single # as text (heading levels are 2–4 only)', () => {
    expect(parseLessonMarkup('# Big').content[0]?.type).toBe('paragraph');
    expect(parseLessonMarkup('##### Five').content[0]?.type).toBe('paragraph');
  });

  it('keeps HTML and script-looking input as literal text', () => {
    const doc = parseLessonMarkup('<script>alert(1)</script>\n<img src=x onerror=alert(1)>');
    expect(JSON.stringify(doc)).not.toMatch(/"type":"(script|img|html)"/);
    expect(parseInline('<b>x</b>')).toEqual([{ type: 'text', text: '<b>x</b>' }]);
  });

  it('round-trips through lessonMarkupOf', () => {
    const markup =
      '## Title\n\nText with **bold** and [a link](https://example.com/)\n\n- a\n- b\n\n1. x\n2. y';
    expect(lessonMarkupOf(parseLessonMarkup(markup))).toBe(markup);
    expect(lessonMarkupOf(null)).toBe('');
  });

  it('property: anything typed parses to an allowlisted document', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 400 }),
        (input) => LessonDocumentSchema.safeParse(parseLessonMarkup(input)).success,
      ),
      { seed: 2801, numRuns: 500 },
    );
    for (const payload of XSS_CORPUS) {
      expect(LessonDocumentSchema.safeParse(parseLessonMarkup(payload)).success).toBe(true);
    }
  });
});
