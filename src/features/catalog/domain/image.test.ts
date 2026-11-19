// [TF] Step 44 / 46: the image rules that need no decoder, written before the module. Type from
// content, never the name (NFR6.213, SD-215); the stored-output check (SD-216); random storage keys
// (NFR6.215, SD-217); and the level-triggered quarantine rules (NFR6.218, SD-220, RD-211).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  desiredImageState,
  IMAGE_SIGNATURE_BYTES,
  imageBusy,
  imageRefusal,
  imageStorageKey,
  isCleanWebp,
  isReconcileDue,
  planImageMove,
  sniffImageFormat,
  variantKey,
} from './image.ts';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];

/** A RIFF/WEBP container holding the given chunks (fourcc + payload), sizes little-endian. */
function webp(chunks: Array<[string, number[]]>): Uint8Array {
  const body: number[] = [...ascii('WEBP')];
  for (const [fourcc, payload] of chunks) {
    body.push(...ascii(fourcc), ...le32(payload.length), ...payload);
    if (payload.length % 2 === 1) body.push(0);
  }
  return new Uint8Array([...ascii('RIFF'), ...le32(body.length), ...body]);
}

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, ...ascii('IHDR'));
const WEBP = webp([['VP8 ', [1, 2, 3, 4]]]);

describe('sniffImageFormat (NFR6.213, SD-215)', () => {
  it('reads only the first 16 bytes', () => {
    expect(IMAGE_SIGNATURE_BYTES).toBe(16);
  });

  it('accepts the JPEG, PNG and WebP signatures', () => {
    expect(sniffImageFormat(JPEG)).toBe('jpeg');
    expect(sniffImageFormat(PNG)).toBe('png');
    expect(sniffImageFormat(WEBP)).toBe('webp');
  });

  it('refuses SVG, GIF, BMP, TIFF, ICO, HEIC/AVIF, PDF and HTML polyglots', () => {
    const refused = [
      ascii('<svg xmlns="http://www.w3.org/2000/svg">'),
      ascii('<?xml version="1.0"?><svg>'),
      ascii('GIF89a\x01\x00\x01\x00\x00\x00\x00\x00'),
      ascii('BM\x00\x00\x00\x00\x00\x00\x00\x00\x36\x00\x00\x00\x28\x00'),
      [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0x00, 0x00, 0x01, 0x00, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0],
      [0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0],
      [0, 0, 0, 0x1c, ...ascii('ftypavif'), 0, 0, 0, 0],
      ascii('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'),
      ascii('<html><script>alert(1)</script>'),
    ];
    for (const head of refused) expect(sniffImageFormat(new Uint8Array(head))).toBeNull();
  });

  it('refuses a RIFF container that is not WEBP (e.g. WAV, AVI)', () => {
    expect(sniffImageFormat(new Uint8Array([...ascii('RIFF'), 4, 0, 0, 0, ...ascii('WAVE')]))).toBe(
      null,
    );
    expect(sniffImageFormat(new Uint8Array([...ascii('RIFF'), 4, 0, 0, 0, ...ascii('AVI ')]))).toBe(
      null,
    );
  });

  it('refuses empty and truncated heads', () => {
    expect(sniffImageFormat(new Uint8Array())).toBeNull();
    expect(sniffImageFormat(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImageFormat(PNG.slice(0, 7))).toBeNull();
    expect(sniffImageFormat(WEBP.slice(0, 11))).toBeNull();
  });

  it('never accepts a head that differs from every signature in its signature bytes (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 32 }), (head) => {
        const format = sniffImageFormat(head);
        if (format === 'jpeg') expect([...head.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
        if (format === 'png') expect([...head.slice(0, 8)]).toEqual([...PNG.slice(0, 8)]);
        if (format === 'webp') {
          expect([...head.slice(0, 4)]).toEqual(ascii('RIFF'));
          expect([...head.slice(8, 12)]).toEqual(ascii('WEBP'));
        }
      }),
      { seed: 20261117, numRuns: 2000 },
    );
  });
});

describe('isCleanWebp: the stored-output check (SD-216)', () => {
  it('accepts a WebP with image chunks only', () => {
    expect(isCleanWebp(WEBP)).toBe(true);
    expect(
      isCleanWebp(
        webp([
          ['VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
          ['VP8L', [1, 2, 3]],
        ]),
      ),
    ).toBe(true);
  });

  it('refuses a WebP carrying an EXIF or XMP chunk (metadata must be gone)', () => {
    expect(
      isCleanWebp(
        webp([
          ['VP8 ', [1, 2]],
          ['EXIF', [9, 9, 9]],
        ]),
      ),
    ).toBe(false);
    expect(
      isCleanWebp(
        webp([
          ['VP8 ', [1, 2]],
          ['XMP ', [9]],
        ]),
      ),
    ).toBe(false);
  });

  it('refuses a non-WebP buffer, a chunk that overruns the buffer and a lying RIFF size', () => {
    expect(isCleanWebp(PNG)).toBe(false);
    const overrun = webp([['VP8 ', [1, 2, 3, 4]]]);
    overrun.set(le32(9999), 16);
    expect(isCleanWebp(overrun)).toBe(false);
    const lying = webp([['VP8 ', [1, 2]]]);
    lying.set(le32(4), 4);
    expect(isCleanWebp(lying)).toBe(false);
    expect(isCleanWebp(webp([]))).toBe(false);
    const truncatedHeader = new Uint8Array([...webp([['VP8 ', [1, 2]]]), ...ascii('EXI')]);
    truncatedHeader.set(le32(truncatedHeader.length - 8), 4);
    expect(isCleanWebp(truncatedHeader)).toBe(false);
  });
});

describe('storage keys (NFR6.215, SD-217)', () => {
  it('builds img/<base64url of 16 random bytes> and refuses any other length', () => {
    const key = imageStorageKey(new Uint8Array(16).fill(0xfb));
    expect(key).toMatch(/^img\/[A-Za-z0-9_-]{22}$/);
    expect(key).not.toContain('=');
    expect(() => imageStorageKey(new Uint8Array(15))).toThrow();
    expect(() => imageStorageKey(new Uint8Array(17))).toThrow();
  });

  it('maps distinct random bytes to distinct keys (property)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        (a, b) => {
          const isSame = a.every((v, i) => v === b[i]);
          expect(imageStorageKey(a) === imageStorageKey(b)).toBe(isSame);
        },
      ),
      { seed: 17112026, numRuns: 500 },
    );
  });

  it('names one object per variant width', () => {
    expect(variantKey('img/abc', 800)).toBe('img/abc/800.webp');
  });
});

describe('desiredImageState (NFR6.218, SD-220)', () => {
  it('quarantines a cover image exactly while its course is hidden', () => {
    expect(desiredImageState({ kind: 'cover', isCourseHidden: true, references: [] })).toBe(
      'quarantined',
    );
    expect(desiredImageState({ kind: 'cover', isCourseHidden: false, references: [] })).toBe(
      'active',
    );
  });

  it('quarantines an inline image only when every reference is under hidden content', () => {
    const hidden = { isHidden: true };
    const shown = { isHidden: false };
    expect(
      desiredImageState({ kind: 'inline', isCourseHidden: false, references: [hidden, hidden] }),
    ).toBe('quarantined');
    expect(
      desiredImageState({ kind: 'inline', isCourseHidden: false, references: [hidden, shown] }),
    ).toBe('active');
  });

  it('keeps an unreferenced inline image active, and a hidden course hides all its images', () => {
    expect(desiredImageState({ kind: 'inline', isCourseHidden: false, references: [] })).toBe(
      'active',
    );
    expect(
      desiredImageState({
        kind: 'inline',
        isCourseHidden: true,
        references: [{ isHidden: false }],
      }),
    ).toBe('quarantined');
  });
});

describe('planImageMove: level-triggered and convergent (RD-211)', () => {
  it('copies then deletes when the object is only in the source bucket', () => {
    expect(planImageMove({ inPublic: true, inQuarantine: false }, 'quarantined')).toEqual([
      'copyToQuarantine',
      'deleteFromPublic',
    ]);
    expect(planImageMove({ inPublic: false, inQuarantine: true }, 'active')).toEqual([
      'copyToPublic',
      'deleteFromQuarantine',
    ]);
  });

  it('finishes a half-done move (in both buckets) by deleting the source only', () => {
    expect(planImageMove({ inPublic: true, inQuarantine: true }, 'quarantined')).toEqual([
      'deleteFromPublic',
    ]);
    expect(planImageMove({ inPublic: true, inQuarantine: true }, 'active')).toEqual([
      'deleteFromQuarantine',
    ]);
  });

  it('does nothing when the object is already in place or missing everywhere', () => {
    expect(planImageMove({ inPublic: false, inQuarantine: true }, 'quarantined')).toEqual([]);
    expect(planImageMove({ inPublic: true, inQuarantine: false }, 'active')).toEqual([]);
    expect(planImageMove({ inPublic: false, inQuarantine: false }, 'active')).toEqual([]);
  });

  it('applying the plan twice from any location ends in the target bucket only (property)', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom('active' as const, 'quarantined' as const),
        (inPublic, inQuarantine, target) => {
          let place = { inPublic, inQuarantine };
          for (let round = 0; round < 2; round += 1) {
            for (const step of planImageMove(place, target)) {
              if (step === 'copyToQuarantine') place = { ...place, inQuarantine: true };
              if (step === 'copyToPublic') place = { ...place, inPublic: true };
              if (step === 'deleteFromPublic') place = { ...place, inPublic: false };
              if (step === 'deleteFromQuarantine') place = { ...place, inQuarantine: false };
            }
          }
          if (!inPublic && !inQuarantine) expect(place).toEqual({ inPublic, inQuarantine });
          else
            expect(place).toEqual(
              target === 'active'
                ? { inPublic: true, inQuarantine: false }
                : { inPublic: false, inQuarantine: true },
            );
        },
      ),
      { seed: 46, numRuns: 200 },
    );
  });
});

describe('isReconcileDue (RD-211: re-apply after 60 s apart)', () => {
  const since = new Date('2026-11-17T00:00:00Z');
  it('is due only when desired and actual differ for more than 60 s', () => {
    const at = (s: number) => new Date(since.getTime() + s * 1000);
    const row = {
      desiredState: 'quarantined',
      actualState: 'active',
      desiredSince: since,
    } as const;
    expect(isReconcileDue(row, at(60))).toBe(false);
    expect(isReconcileDue(row, at(61))).toBe(true);
    expect(isReconcileDue({ ...row, actualState: 'quarantined' }, at(600))).toBe(false);
  });
});

describe('image refusals (contract 1 unchanged)', () => {
  it('answers VALIDATION_FAILED with the reason key and RATE_LIMITED imageBusy with Retry-After', () => {
    expect(imageRefusal('imageType')).toEqual({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.catalog.imageType',
    });
    expect(imageBusy(5)).toEqual({
      code: 'RATE_LIMITED',
      i18nKey: 'errors.catalog.imageBusy',
      details: { retryAfterSeconds: 5 },
    });
  });
});
