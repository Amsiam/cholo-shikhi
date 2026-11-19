// [LT] Step 44: the INF-202 frame protocol. Pure; a fast-check property proves that any split of
// any sequence of frames decodes to the same frames. Fixed seed.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createFrameDecoder,
  encodeFrame,
  FrameTooLargeError,
  joinVariants,
  MAX_FRAME_BYTES,
  MalformedFrameError,
  splitVariants,
} from './image-protocol.ts';

const SEED = 44202;

function rawFrame(rest: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + rest.byteLength);
  new DataView(out.buffer).setUint32(0, rest.byteLength);
  out.set(rest, 4);
  return out;
}

describe('encodeFrame and the decoder', () => {
  it('round-trips a header and a body', () => {
    const decoder = createFrameDecoder();
    const frames = decoder.push(
      encodeFrame({ type: 'job', jobId: 'j1' }, new Uint8Array([1, 2, 3])),
    );
    expect(frames).toEqual([
      { header: { type: 'job', jobId: 'j1' }, body: new Uint8Array([1, 2, 3]) },
    ]);
    expect(decoder.bufferedBytes).toBe(0);
  });

  it('waits for the rest of a frame split across chunks', () => {
    const frame = encodeFrame({ type: 'status' });
    const decoder = createFrameDecoder();
    expect(decoder.push(frame.slice(0, 3))).toEqual([]);
    expect(decoder.push(frame.slice(3, 9))).toEqual([]);
    expect(decoder.push(frame.slice(9))).toEqual([
      { header: { type: 'status' }, body: new Uint8Array() },
    ]);
  });

  it('refuses to encode a frame over 5,243,904 bytes', () => {
    expect(MAX_FRAME_BYTES).toBe(5_243_904);
    expect(() => encodeFrame({}, new Uint8Array(MAX_FRAME_BYTES))).toThrow(FrameTooLargeError);
  });

  it('refuses an oversized length prefix before buffering the frame', () => {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, MAX_FRAME_BYTES + 1);
    expect(() => createFrameDecoder().push(prefix)).toThrow(FrameTooLargeError);
  });

  it('refuses malformed frames: no header length, header past the end, bad JSON, non-object', () => {
    const header = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      const rest = new Uint8Array(4 + bytes.byteLength);
      new DataView(rest.buffer).setUint32(0, bytes.byteLength);
      rest.set(bytes, 4);
      return rawFrame(rest);
    };
    const tooLong = new Uint8Array(4);
    new DataView(tooLong.buffer).setUint32(0, 99);
    for (const frame of [
      rawFrame(new Uint8Array([1, 2])),
      rawFrame(tooLong),
      header('{oops'),
      header('[1,2]'),
      header('null'),
    ]) {
      expect(() => createFrameDecoder().push(frame)).toThrow(MalformedFrameError);
    }
  });

  it('property: any chunking of any frame sequence decodes to the same frames', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            jobId: fc.string({ maxLength: 12 }),
            body: fc.uint8Array({ maxLength: 64 }),
          }),
          { maxLength: 6 },
        ),
        fc.array(fc.integer({ min: 1, max: 17 }), { minLength: 1, maxLength: 8 }),
        (frames, sizes) => {
          const stream = frames.map((f) => encodeFrame({ jobId: f.jobId }, f.body));
          const all = new Uint8Array(stream.reduce((n, f) => n + f.byteLength, 0));
          let at = 0;
          for (const f of stream) {
            all.set(f, at);
            at += f.byteLength;
          }
          const decoder = createFrameDecoder();
          const out = [];
          let offset = 0;
          let i = 0;
          while (offset < all.byteLength) {
            const size = sizes[i % sizes.length] as number;
            out.push(...decoder.push(all.slice(offset, offset + size)));
            offset += size;
            i += 1;
          }
          expect(out.map((f) => f.header.jobId)).toEqual(frames.map((f) => f.jobId));
          expect(out.map((f) => [...f.body])).toEqual(frames.map((f) => [...f.body]));
        },
      ),
      { seed: SEED },
    );
  });
});

describe('joinVariants and splitVariants', () => {
  it('round-trips the variants of a result body', () => {
    const variants = [
      { width: 400, bytes: new Uint8Array([1, 2]) },
      { width: 800, bytes: new Uint8Array([3, 4, 5]) },
    ];
    const { body, layout } = joinVariants(variants);
    expect(layout).toEqual([
      { width: 400, length: 2 },
      { width: 800, length: 3 },
    ]);
    expect(splitVariants(body, layout)).toEqual(variants);
  });

  it('refuses a layout that does not match the body', () => {
    expect(() => splitVariants(new Uint8Array(3), [{ width: 400, length: 2 }])).toThrow(
      MalformedFrameError,
    );
  });
});
