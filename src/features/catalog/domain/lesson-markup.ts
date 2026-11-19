// The I1 text-lesson editor's input format (BR3.4; NFR6.207). Authors type a small line-based markup
// and this parser turns it into a lesson document that holds only allowlisted nodes and marks; it
// never produces HTML. The server validates the result again with the one allowlist schema, so this
// parser is a convenience, not the safety boundary. Plain TypeScript, shared by the editor and tests.
//
//   ## / ### / ####  heading (levels 2–4)     - item     bulleted list
//   1. item          numbered list            blank line ends a block
//   **bold**  *italic*  [text](https://link)  a single line break inside a paragraph is kept
import type {
  BlockNode,
  InlineNode,
  LessonDocument,
  ListItemNode,
  TextNode,
} from './lesson-document.ts';

type Mark = NonNullable<TextNode['marks']>[number];

const INLINE = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;

function text(value: string, marks: Mark[] = []): TextNode {
  return marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

/** Inline marks of one line: links, bold and italic; everything else stays literal text. */
export function parseInline(line: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text(line.slice(last, index)));
    const [, linkText, href, bold, italic] = match;
    if (linkText !== undefined && href !== undefined) {
      nodes.push(text(linkText, [{ type: 'link', attrs: { href } }]));
    } else if (bold !== undefined) {
      nodes.push(text(bold, [{ type: 'bold' }]));
    } else if (italic !== undefined) {
      nodes.push(text(italic, [{ type: 'italic' }]));
    }
    last = index + match[0].length;
  }
  if (last < line.length) nodes.push(text(line.slice(last)));
  return nodes;
}

const HEADING = /^(#{2,4})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;

const item = (line: string): ListItemNode => ({
  type: 'listItem',
  content: [{ type: 'paragraph', content: parseInline(line) }],
});

/** Parses the editor markup into an allowlisted lesson document. */
export function parseLessonMarkup(markup: string): LessonDocument {
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];
  let list: { type: 'bulletList' | 'orderedList'; items: ListItemNode[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const content: InlineNode[] = [];
    paragraph.forEach((line, i) => {
      if (i > 0) content.push({ type: 'hardBreak' });
      content.push(...parseInline(line));
    });
    blocks.push({ type: 'paragraph', content });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: list.type, content: list.items });
    list = null;
  };

  for (const raw of markup.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (line.length === 0) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = (heading[1] as string).length as 2 | 3 | 4;
      blocks.push({
        type: 'heading',
        attrs: { level },
        content: parseInline(heading[2] as string),
      });
    } else if (bullet || ordered) {
      flushParagraph();
      const type = bullet ? 'bulletList' : 'orderedList';
      const current = list as { type: 'bulletList' | 'orderedList'; items: ListItemNode[] } | null;
      if (current?.type !== type) flushList();
      list ??= { type, items: [] };
      list.items.push(item(((bullet ?? ordered) as RegExpExecArray)[1] as string));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return { type: 'doc', content: blocks };
}

function inlineMarkup(nodes: readonly InlineNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === 'hardBreak') return '\n';
      if (node.type !== 'text') return '';
      let out = node.text;
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold') out = `**${out}**`;
        else if (mark.type === 'italic') out = `*${out}*`;
        else out = `[${out}](${mark.attrs.href})`;
      }
      return out;
    })
    .join('');
}

const firstParagraph = (item: ListItemNode) => {
  const first = item.content[0];
  return first && (first.type === 'paragraph' || first.type === 'heading')
    ? inlineMarkup(first.content)
    : '';
};

/** Turns a stored document back into editor markup (the inverse of parseLessonMarkup). */
export function lessonMarkupOf(document: LessonDocument | null): string {
  if (!document) return '';
  return document.content
    .map((block) => {
      if (block.type === 'heading') {
        return `${'#'.repeat(block.attrs.level)} ${inlineMarkup(block.content)}`;
      }
      if (block.type === 'paragraph') return inlineMarkup(block.content);
      return block.content
        .map((li, i) => `${block.type === 'bulletList' ? '-' : `${i + 1}.`} ${firstParagraph(li)}`)
        .join('\n');
    })
    .join('\n\n');
}
