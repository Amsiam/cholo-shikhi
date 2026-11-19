// SD-215 / SD-216 decode and re-encode with `sharp` (plan Step 44, approved by the human on
// 2026-11-17). This module runs ONLY inside a decode worker of the image-helper process, which has
// no network, no credentials and an env of exactly { UV_THREADPOOL_SIZE } (INF-201, INF-203). The
// web process never imports it.
// - Input limits: at most 50 Mpx, fail on any decoder warning, sequential read.
// - The format sharp reads must equal the format the route sniffed, with exactly one page
//   (animated WebP is refused); otherwise imageType.
// - Output: .rotate() applies EXIF orientation, .toColourspace('srgb'), then the 400/800/1600 px
//   WebP variants of `variantSlots`, never enlarged. withMetadata/keepMetadata are never called, so
//   EXIF (GPS, device), XMP, IPTC, thumbnails and the ICC profile are all dropped.
// - Any decoder error answers imageUnreadable; nothing here throws for bad input.
import sharp, { type Metadata } from 'sharp';
import type { ImageFormat, ImageRefusalReason } from '../domain/image.ts';
import { variantSlots } from '../domain/image.ts';

/** SD-216: the decoder refuses inputs above this many pixels. */
export const LIMIT_INPUT_PIXELS = 50_000_000;
const WEBP_QUALITY = 80;

export type DecodedImage = {
  width: number;
  height: number;
  variants: Array<{ width: number; bytes: Uint8Array }>;
};

export type DecodeResult =
  | { ok: true; value: DecodedImage; decodeMs: number }
  | { ok: false; reason: Extract<ImageRefusalReason, 'imageType' | 'imageUnreadable'> };

/** Called once per decode worker: no cache, one libvips thread per job (SD-216). */
export function configureSharpForWorker(): void {
  sharp.cache(false);
  sharp.concurrency(1);
}

const options = {
  limitInputPixels: LIMIT_INPUT_PIXELS,
  failOn: 'warning',
  sequentialRead: true,
} as const;

export async function decodeImage(
  bytes: Uint8Array,
  sniffedFormat: ImageFormat,
  now: () => number = () => performance.now(),
): Promise<DecodeResult> {
  const startedAt = now();
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, options).metadata();
  } catch {
    return { ok: false, reason: 'imageUnreadable' };
  }
  if (metadata.format !== sniffedFormat || (metadata.pages ?? 1) !== 1) {
    return { ok: false, reason: 'imageType' };
  }
  const sourceWidth = metadata.autoOrient?.width ?? metadata.width;
  if (!sourceWidth) return { ok: false, reason: 'imageUnreadable' };
  try {
    const variants: Array<{ width: number; bytes: Uint8Array; height: number; px: number }> = [];
    for (const slot of variantSlots(sourceWidth)) {
      const { data, info } = await sharp(bytes, options)
        .rotate()
        .toColourspace('srgb')
        .resize({ width: Math.min(slot, sourceWidth), withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      variants.push({
        width: slot,
        bytes: new Uint8Array(data),
        height: info.height,
        px: info.width,
      });
    }
    const largest = variants[variants.length - 1] as (typeof variants)[number];
    return {
      ok: true,
      value: {
        width: largest.px,
        height: largest.height,
        variants: variants.map((v) => ({ width: v.width, bytes: v.bytes })),
      },
      decodeMs: Math.round(now() - startedAt),
    };
  } catch {
    return { ok: false, reason: 'imageUnreadable' };
  }
}
