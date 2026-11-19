// Image rules that need no decoder (Steps 44 and 46). Plain TypeScript, no framework:
// - the type comes from the leading bytes, never the file name or the declared type (NFR6.213, SD-215);
// - the stored-output check: every variant is WebP with no EXIF or XMP chunk (SD-216);
// - storage keys are 128 random bits, unrelated to course, user or file name (NFR6.215, SD-217);
// - the quarantine rules are level-triggered: the desired state is recomputed from the database and a
//   move converges from wherever the object is, so duplicate or out-of-order events are harmless
//   (NFR6.218, SD-220, RD-211).

import type { AppError } from '#src/lib/errors.ts';

export type ImageFormat = 'jpeg' | 'png' | 'webp';
export type ImageKind = 'cover' | 'inline';
export type ImageVisibility = 'active' | 'quarantined';

/** The route reads this many leading bytes to decide the type (SD-215). */
export const IMAGE_SIGNATURE_BYTES = 16;
/** The re-encoded WebP variants (SD-216). */
export const IMAGE_VARIANT_WIDTHS = [400, 800, 1600] as const;
/**
 * SD-216 variant plan, never enlarging: every slot below the source width, plus the first slot at or
 * above it (encoded at the source width). A 300 px image gives [400]; a 900 px one all three. The
 * slot names the stored object, so keys stay unique; the encoded width is min(slot, source).
 */
export function variantSlots(sourceWidth: number): number[] {
  if (!Number.isInteger(sourceWidth) || sourceWidth < 1) {
    throw new Error('a source width is a positive integer');
  }
  return IMAGE_VARIANT_WIDTHS.filter(
    (_, i) => i === 0 || (IMAGE_VARIANT_WIDTHS[i - 1] as number) < sourceWidth,
  );
}

/** RD-211: a desired/actual difference older than this is re-applied by the reconciler. */
export const RECONCILE_GRACE_MS = 60_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP"
/** RIFF chunks that carry metadata and must never be stored (SD-216). */
const METADATA_CHUNKS: ReadonlySet<string> = new Set(['EXIF', 'XMP ']);

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, i) => bytes[offset + i] === value);
}

/** JPEG, PNG or WebP from the signature bytes; anything else (SVG, GIF, HEIC, …) is null. */
export function sniffImageFormat(head: Uint8Array): ImageFormat | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, PNG_SIGNATURE)) return 'png';
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'webp';
  return null;
}

function readLe32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + 4));
}

/**
 * SD-216 output check: a RIFF/WEBP buffer whose declared size matches, whose chunks all fit, that
 * holds at least one chunk and no EXIF or XMP chunk. A decoder bug therefore cannot store metadata.
 */
export function isCleanWebp(buffer: Uint8Array): boolean {
  if (!startsWith(buffer, RIFF) || !startsWith(buffer, WEBP, 8)) return false;
  if (readLe32(buffer, 4) + 8 !== buffer.length) return false;
  let offset = 12;
  let chunks = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) return false;
    const name = fourcc(buffer, offset);
    const size = readLe32(buffer, offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > buffer.length) return false;
    if (METADATA_CHUNKS.has(name)) return false;
    chunks += 1;
    offset = end;
  }
  return chunks > 0;
}

/** `img/<base64url(16 random bytes)>`: exactly 128 bits, no padding (SD-217). */
export function imageStorageKey(random: Uint8Array): string {
  if (random.length !== 16) throw new Error('an image key needs exactly 16 random bytes');
  const base64 = btoa(String.fromCharCode(...random));
  return `img/${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** The object name of one variant. */
export function variantKey(storageKey: string, width: number): string {
  return `${storageKey}/${width}.webp`;
}

/**
 * SD-220: a cover image is quarantined while its course is hidden; an inline image is quarantined
 * when it has references and every one of them is under hidden content (a hidden course hides all).
 */
export function desiredImageState(input: {
  kind: ImageKind;
  isCourseHidden: boolean;
  references: ReadonlyArray<{ isHidden: boolean }>;
}): ImageVisibility {
  if (input.isCourseHidden) return 'quarantined';
  if (input.kind === 'cover') return 'active';
  const isEveryReferenceHidden =
    input.references.length > 0 && input.references.every((ref) => ref.isHidden);
  return isEveryReferenceHidden ? 'quarantined' : 'active';
}

export type MoveStep =
  | 'copyToQuarantine'
  | 'copyToPublic'
  | 'deleteFromPublic'
  | 'deleteFromQuarantine';

/**
 * RD-211 order of a move: copy to the target bucket, then delete from the source. Each step checks
 * the current location first, so a crash between steps converges on the next attempt. An object
 * found in neither bucket is left alone (the orphan sweep and retention own that case).
 */
export function planImageMove(
  location: { inPublic: boolean; inQuarantine: boolean },
  target: ImageVisibility,
): MoveStep[] {
  const isInTarget = target === 'active' ? location.inPublic : location.inQuarantine;
  const isInSource = target === 'active' ? location.inQuarantine : location.inPublic;
  if (!isInSource) return [];
  const deleteSource: MoveStep = target === 'active' ? 'deleteFromQuarantine' : 'deleteFromPublic';
  if (isInTarget) return [deleteSource];
  return [target === 'active' ? 'copyToPublic' : 'copyToQuarantine', deleteSource];
}

/** RD-211: the reconciler re-applies an image whose states have differed for more than 60 s. */
export function isReconcileDue(
  row: { desiredState: string; actualState: string; desiredSince: Date },
  now: Date,
  graceMs = RECONCILE_GRACE_MS,
): boolean {
  return (
    row.desiredState !== row.actualState && now.getTime() - row.desiredSince.getTime() > graceMs
  );
}

/** The refusal reasons of the upload route (SD-214 to SD-217; OD-204 `catalog.image.refused`). */
export type ImageRefusalReason =
  | 'imageType'
  | 'imageTooLarge'
  | 'imageLengthRequired'
  | 'imageUnreadable'
  | 'imageTimeout'
  | 'imageForeign';

/** VALIDATION_FAILED with the reason's own i18n key; contract 1 is unchanged (no new code). */
export function imageRefusal(reason: ImageRefusalReason): AppError<'VALIDATION_FAILED'> {
  return { code: 'VALIDATION_FAILED', i18nKey: `errors.catalog.${reason}` };
}

/** SD-214: no admission slot; the client waits `retryAfterSeconds` and may retry. */
export function imageBusy(retryAfterSeconds: number): AppError<'RATE_LIMITED'> {
  return {
    code: 'RATE_LIMITED',
    i18nKey: 'errors.catalog.imageBusy',
    details: { retryAfterSeconds },
  };
}
