// INF-202: the length-prefixed binary frames between a web process and its image helper, carried
// over a Unix socket with Node `net` (no new dependency). Plain TypeScript, no I/O.
//
// One frame: [u32 BE length of the rest][u32 BE header length][header: UTF-8 JSON][body bytes].
// A frame whose rest is longer than MAX_FRAME_BYTES (5 MB + 1 KB) is refused before it is buffered,
// so a peer cannot make the other side hold more than one maximal image in memory.
// The channel carries image bytes and results only, never credentials.
import { IMAGE_MAX_BYTES } from './limits.ts';

/** INF-202: frames over 5,243,904 bytes are refused (5 MB of image plus 1 KB of header). */
export const MAX_FRAME_BYTES = IMAGE_MAX_BYTES + 1024;
const PREFIX_BYTES = 4;

export type Frame = { header: Record<string, unknown>; body: Uint8Array };

export class FrameTooLargeError extends Error {
  readonly length: number;
  constructor(length: number) {
    super(`frame of ${length} bytes exceeds ${MAX_FRAME_BYTES}`);
    this.name = 'FrameTooLargeError';
    this.length = length;
  }
}

export class MalformedFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedFrameError';
  }
}

/** Encodes one frame; throws FrameTooLargeError rather than emit a frame the peer would refuse. */
export function encodeFrame(header: Record<string, unknown>, body: Uint8Array = new Uint8Array()) {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const rest = PREFIX_BYTES + headerBytes.byteLength + body.byteLength;
  if (rest > MAX_FRAME_BYTES) throw new FrameTooLargeError(rest);
  const frame = new Uint8Array(PREFIX_BYTES + rest);
  const view = new DataView(frame.buffer);
  view.setUint32(0, rest);
  view.setUint32(PREFIX_BYTES, headerBytes.byteLength);
  frame.set(headerBytes, PREFIX_BYTES * 2);
  frame.set(body, PREFIX_BYTES * 2 + headerBytes.byteLength);
  return frame;
}

function parseFrame(rest: Uint8Array): Frame {
  if (rest.byteLength < PREFIX_BYTES) throw new MalformedFrameError('frame has no header length');
  const headerLength = new DataView(rest.buffer, rest.byteOffset, rest.byteLength).getUint32(0);
  if (PREFIX_BYTES + headerLength > rest.byteLength) {
    throw new MalformedFrameError('header longer than the frame');
  }
  const headerText = new TextDecoder('utf-8', { fatal: true }).decode(
    rest.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength),
  );
  let header: unknown;
  try {
    header = JSON.parse(headerText);
  } catch {
    throw new MalformedFrameError('header is not JSON');
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    throw new MalformedFrameError('header is not an object');
  }
  return {
    header: header as Record<string, unknown>,
    body: rest.slice(PREFIX_BYTES + headerLength),
  };
}

/**
 * Incremental decoder for a byte stream. `push` returns every frame completed by the chunk and
 * throws FrameTooLargeError as soon as a length prefix announces an oversized frame.
 */
export function createFrameDecoder() {
  let pending = new Uint8Array();
  return {
    push(chunk: Uint8Array): Frame[] {
      const joined = new Uint8Array(pending.byteLength + chunk.byteLength);
      joined.set(pending, 0);
      joined.set(chunk, pending.byteLength);
      pending = joined;
      const frames: Frame[] = [];
      for (;;) {
        if (pending.byteLength < PREFIX_BYTES) break;
        const rest = new DataView(pending.buffer, pending.byteOffset).getUint32(0);
        if (rest > MAX_FRAME_BYTES) throw new FrameTooLargeError(rest);
        if (pending.byteLength < PREFIX_BYTES + rest) break;
        frames.push(parseFrame(pending.subarray(PREFIX_BYTES, PREFIX_BYTES + rest)));
        pending = pending.slice(PREFIX_BYTES + rest);
      }
      return frames;
    },
    /** Bytes received that do not yet form a whole frame. */
    get bufferedBytes(): number {
      return pending.byteLength;
    },
  };
}

/** Splits a result body into its variants, given each variant's declared length. */
export function splitVariants(
  body: Uint8Array,
  variants: ReadonlyArray<{ width: number; length: number }>,
): Array<{ width: number; bytes: Uint8Array }> {
  const total = variants.reduce((sum, v) => sum + v.length, 0);
  if (total !== body.byteLength) throw new MalformedFrameError('variant lengths do not match body');
  let offset = 0;
  return variants.map((v) => {
    const bytes = body.slice(offset, offset + v.length);
    offset += v.length;
    return { width: v.width, bytes };
  });
}

/** Joins variant buffers into one body, with the length list that `splitVariants` reverses. */
export function joinVariants(variants: ReadonlyArray<{ width: number; bytes: Uint8Array }>): {
  body: Uint8Array;
  layout: Array<{ width: number; length: number }>;
} {
  const total = variants.reduce((sum, v) => sum + v.bytes.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const v of variants) {
    body.set(v.bytes, offset);
    offset += v.bytes.byteLength;
  }
  return { body, layout: variants.map((v) => ({ width: v.width, length: v.bytes.byteLength })) };
}
