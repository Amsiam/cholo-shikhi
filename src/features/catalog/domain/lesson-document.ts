// The text-lesson document (rules.md BR3.4; NFR6.207; security-design SD-208). A body is a JSON
// document, never HTML, validated by this one allowlist schema, shared by the editor and the server.
// Every object is strict, so an unknown node, mark or attribute is refused, never silently dropped.
// Limits per language body: canonical UTF-8 size ≤ LESSON_BODY_MAX_BYTES, depth ≤ 8, ≤ 20 images,
// text runs ≤ 10,000 characters. Links are checked by the injected link validator (SD-210).
// Plain TypeScript: no framework, DB or env access.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';
import { fail, type LinkValidator, type Outcome, pass } from './link-validator.ts';

/**
 * SD-208: 101,376 bytes (99 KB) until the human approves the 104 KB request limit for
 * saveTextLessonBody; 102,400 bytes only after that approval. The schema, the editor's counter and
 * the tests all import this one constant.
 */
export const LESSON_BODY_MAX_BYTES = 101_376;
export const LESSON_MAX_DEPTH = 8;
export const LESSON_MAX_IMAGES = 20;
export const LESSON_MAX_TEXT_RUN = 10_000;
export const IMAGE_ALT_MAX = 300;
const HREF_MAX = 2048;

const BoldMark = z.strictObject({ type: z.literal('bold') });
const ItalicMark = z.strictObject({ type: z.literal('italic') });
const LinkMark = z.strictObject({
  type: z.literal('link'),
  attrs: z.strictObject({ href: z.string().min(1).max(HREF_MAX) }),
});
const Mark = z.discriminatedUnion('type', [BoldMark, ItalicMark, LinkMark]);

const TextNode = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(Mark).max(3).optional(),
});
const HardBreakNode = z.strictObject({ type: z.literal('hardBreak') });
const ImageNode = z.strictObject({
  type: z.literal('image'),
  attrs: z.strictObject({ imageId: Id, alt: z.string().min(1).max(IMAGE_ALT_MAX) }),
});
const Inline = z.discriminatedUnion('type', [TextNode, HardBreakNode, ImageNode]);

const ParagraphNode = z.strictObject({
  type: z.literal('paragraph'),
  content: z.array(Inline).optional(),
});
const HeadingNode = z.strictObject({
  type: z.literal('heading'),
  attrs: z.strictObject({ level: z.union([z.literal(2), z.literal(3), z.literal(4)]) }),
  content: z.array(Inline).optional(),
});

export type TextNode = z.infer<typeof TextNode>;
export type InlineNode = z.infer<typeof Inline>;
export type ParagraphNode = z.infer<typeof ParagraphNode>;
export type HeadingNode = z.infer<typeof HeadingNode>;
export type ListItemNode = { type: 'listItem'; content: BlockNode[] };
export type ListNode = { type: 'bulletList' | 'orderedList'; content: ListItemNode[] };
export type BlockNode = ParagraphNode | HeadingNode | ListNode;
export type LessonDocument = { type: 'doc'; content: BlockNode[] };

const ListItemNode: z.ZodType<ListItemNode> = z.lazy(() =>
  z.strictObject({ type: z.literal('listItem'), content: z.array(Block).min(1) }),
);
const ListNode: z.ZodType<ListNode> = z.lazy(() =>
  z.strictObject({
    type: z.enum(['bulletList', 'orderedList']),
    content: z.array(ListItemNode).min(1),
  }),
);
const Block: z.ZodType<BlockNode> = z.lazy(() => z.union([ParagraphNode, HeadingNode, ListNode]));

export const LessonDocumentSchema: z.ZodType<LessonDocument> = z.strictObject({
  type: z.literal('doc'),
  content: z.array(Block),
});

export type DocumentIssue = { path?: string; key: `errors.catalog.${string}` };
export type ValidatedDocument = {
  document: LessonDocument;
  /** Deduplicated SD-210 candidates of every link, written to link_domain_candidates (SD-211). */
  linkCandidates: string[];
  imageIds: string[];
};

const issue = (key: DocumentIssue['key']): Outcome<never, DocumentIssue[]> => fail([{ key }]);

type Shape = { depth: number; images: number; longestRun: number };

/**
 * Walks the raw value without recursion (a hostile body can nest far deeper than the stack), and
 * measures depth (every node counts, doc = 1), image nodes and the longest text run in code points.
 * Stops as soon as the depth limit is passed.
 */
function measure(raw: unknown): Shape {
  const shape: Shape = { depth: 0, images: 0, longestRun: 0 };
  const stack: Array<[unknown, number]> = [[raw, 1]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop() as [unknown, number];
    if (typeof node !== 'object' || node === null) continue;
    shape.depth = Math.max(shape.depth, depth);
    if (shape.depth > LESSON_MAX_DEPTH) return shape;
    const record = node as { type?: unknown; text?: unknown; content?: unknown };
    if (record.type === 'image') shape.images += 1;
    if (typeof record.text === 'string') {
      shape.longestRun = Math.max(shape.longestRun, [...record.text].length);
    }
    if (Array.isArray(record.content)) {
      for (const child of record.content) stack.push([child, depth + 1]);
    }
  }
  return shape;
}

const KEY_ORDER = ['type', 'attrs', 'content', 'text', 'marks'] as const;
const ATTR_ORDER = ['level', 'href', 'imageId', 'alt'] as const;

function canonicalValue(value: unknown, order: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => canonicalValue(v, KEY_ORDER));
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of order) {
    if (record[key] !== undefined) {
      out[key] = canonicalValue(record[key], key === 'attrs' ? ATTR_ORDER : KEY_ORDER);
    }
  }
  return out;
}

/** SD-208: keys in schema order, no whitespace. The size cap is measured on this string. */
export function canonicalJson(document: LessonDocument): string {
  return JSON.stringify(canonicalValue(document, KEY_ORDER));
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

function forEachText(nodes: readonly unknown[], visit: (node: TextNode) => void): void {
  for (const node of nodes) {
    const n = node as { type: string; content?: unknown[] };
    if (n.type === 'text') visit(n as TextNode);
    if (Array.isArray(n.content)) forEachText(n.content, visit);
  }
}

/** Every link href in document order (the index is the `links.<n>` field position). */
export function documentLinks(document: LessonDocument): string[] {
  const hrefs: string[] = [];
  forEachText(document.content, (t) => {
    for (const mark of t.marks ?? []) if (mark.type === 'link') hrefs.push(mark.attrs.href);
  });
  return hrefs;
}

function documentImageIds(nodes: readonly unknown[], into: string[] = []): string[] {
  for (const node of nodes) {
    const n = node as { type: string; attrs?: { imageId?: string }; content?: unknown[] };
    if (n.type === 'image' && n.attrs?.imageId) into.push(n.attrs.imageId);
    if (Array.isArray(n.content)) documentImageIds(n.content, into);
  }
  return into;
}

/** BR7.3: a body with no visible text and no image counts as empty. */
export function isDocumentEmpty(document: LessonDocument): boolean {
  if (documentImageIds(document.content).length > 0) return false;
  let hasText = false;
  forEachText(document.content, (t) => {
    if (t.text.trim().length > 0) hasText = true;
  });
  return !hasText;
}

/**
 * NFR6.207 + NFR6.209: refuses a body that breaks a limit, falls outside the allowlist, or holds an
 * invalid link. Link refusals carry their `links.<n>` position; all other refusals are body-wide.
 * The blocked-domain check (SD-211) needs the database, so the server runs it on `linkCandidates`.
 */
export function validateLessonDocument(
  raw: unknown,
  links: LinkValidator,
): Outcome<ValidatedDocument, DocumentIssue[]> {
  const shape = measure(raw);
  if (shape.depth > LESSON_MAX_DEPTH) return issue('errors.catalog.lessonBodyTooDeep');
  if (shape.longestRun > LESSON_MAX_TEXT_RUN) return issue('errors.catalog.lessonTextTooLong');
  if (shape.images > LESSON_MAX_IMAGES) return issue('errors.catalog.lessonBodyTooManyImages');
  const parsed = LessonDocumentSchema.safeParse(raw);
  if (!parsed.success) return issue('errors.catalog.lessonBodyInvalid');
  const document = parsed.data;
  if (byteLength(canonicalJson(document)) > LESSON_BODY_MAX_BYTES) {
    return issue('errors.catalog.lessonBodyTooLarge');
  }
  const issues: DocumentIssue[] = [];
  const candidates = new Set<string>();
  documentLinks(document).forEach((href, index) => {
    const checked = links.checkLink(href);
    if (!checked.ok) issues.push({ path: `links.${index}`, key: 'errors.catalog.linkInvalid' });
    else for (const candidate of checked.value.candidates) candidates.add(candidate);
  });
  if (issues.length > 0) return fail(issues);
  return pass({
    document,
    linkCandidates: [...candidates],
    imageIds: documentImageIds(document.content),
  });
}
