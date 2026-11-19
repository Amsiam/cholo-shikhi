// The one reviewed lesson renderer (rules.md BR3.4; NFR6.208; security-design SD-209). It maps each
// node of a lesson document to a React element: text goes into React text nodes, so React escapes it;
// it never builds an HTML string, never uses dangerouslySetInnerHTML and never spreads stored
// attributes onto an element. Every href is re-checked as https at render, and image URLs come only
// from the caller's resolver, never from document text (defence in depth behind SD-208 and SD-210).
// GATE: any change to this file is listed in the Bolt's gate summary (NFR6.208).
import { Fragment, type ReactNode } from 'react';
import type { BlockNode, InlineNode, LessonDocument, TextNode } from '../domain/lesson-document.ts';
import { createLinkValidator } from '../domain/link-validator.ts';

export type RenderOptions = {
  /** Resolves an image ID to its static-origin URL; null or unsafe hides the image. */
  imageUrl?: (imageId: string) => string | null;
};

export const LINK_REL = 'noopener noreferrer nofollow ugc';

// The WHATWG URL parser already converts a host to ASCII, so the identity function is enough here.
const renderLinks = createLinkValidator((host) => host);

/** SD-209: only a link that passes the SD-210 checks again becomes a live link. */
function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  return renderLinks.checkLink(href).ok ? href : null;
}

/** An image URL is used only when it is same-origin (a single leading slash) or https. */
function safeImageUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return url;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    // Not a parseable URL: the image is not shown.
    return null;
  }
}

function renderText(node: TextNode, key: number): ReactNode {
  let out: ReactNode = node.text;
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') out = <strong>{out}</strong>;
    else if (mark.type === 'italic') out = <em>{out}</em>;
    else if (mark.type === 'link') {
      const href = safeHref(mark.attrs?.href);
      if (href) {
        out = (
          <a href={href} target="_blank" rel={LINK_REL}>
            {out}
          </a>
        );
      }
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

function renderInline(node: InlineNode, key: number, options: RenderOptions): ReactNode {
  switch (node.type) {
    case 'text':
      return typeof node.text === 'string' ? renderText(node, key) : null;
    case 'hardBreak':
      return <br key={key} />;
    case 'image': {
      const src = safeImageUrl(options.imageUrl?.(String(node.attrs?.imageId)));
      if (!src) return null;
      return <img key={key} src={src} alt={String(node.attrs?.alt ?? '')} loading="lazy" />;
    }
    default:
      return null;
  }
}

const inlines = (content: unknown, options: RenderOptions): ReactNode[] =>
  Array.isArray(content)
    ? (content as InlineNode[]).map((node, i) => renderInline(node, i, options))
    : [];

function renderBlock(node: BlockNode, key: number, options: RenderOptions): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{inlines(node.content, options)}</p>;
    case 'heading': {
      const level = node.attrs?.level;
      if (level === 2) return <h2 key={key}>{inlines(node.content, options)}</h2>;
      if (level === 3) return <h3 key={key}>{inlines(node.content, options)}</h3>;
      if (level === 4) return <h4 key={key}>{inlines(node.content, options)}</h4>;
      return null;
    }
    case 'bulletList':
    case 'orderedList': {
      const items = (Array.isArray(node.content) ? node.content : []).map((item, i) =>
        item?.type === 'listItem' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: document order is the identity of a node.
          <li key={i}>{blocks(item.content, options)}</li>
        ) : null,
      );
      return node.type === 'bulletList' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>;
    }
    default:
      return null;
  }
}

function blocks(content: unknown, options: RenderOptions): ReactNode[] {
  return Array.isArray(content)
    ? (content as BlockNode[]).map((node, i) => renderBlock(node, i, options))
    : [];
}

/** Renders a lesson document (normally already validated) as React elements. */
export function renderLessonDocument(
  document: LessonDocument,
  options: RenderOptions = {},
): ReactNode {
  return <>{blocks(document?.content, options)}</>;
}
