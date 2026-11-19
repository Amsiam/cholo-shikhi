// Regenerates the committed image corpus of the catalog image helper (plan Step 44, NFR6.213,
// NFR6.214, NFR11.204, CI-204): synthetic files only, made with sharp and fixed bytes, plus a
// manifest of the outcome each file must have. Run: `node scripts/generate-image-corpus.ts`.
// The files are committed; this script exists so the corpus can be reviewed and rebuilt.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = fileURLToPath(
  new URL('../src/features/catalog/test-fixtures/images/', import.meta.url),
);
mkdirSync(OUT, { recursive: true });

type Expect = 'stored' | 'imageType' | 'imageUnreadable';
const manifest: Array<{ file: string; expect: Expect; note: string }> = [];

function save(file: string, bytes: Uint8Array, expect: Expect, note: string) {
  writeFileSync(join(OUT, file), bytes);
  manifest.push({ file, expect, note });
}

const solid = (width: number, height: number, alpha = false) =>
  sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 30, g: 120, b: 200, alpha: 0.5 } : { r: 30, g: 120, b: 200 },
    },
  });

/** A small two-colour pattern, so encoders have real edges to keep. */
async function pattern(width: number, height: number) {
  const overlay = await solid(Math.max(1, Math.floor(width / 2)), height)
    .png()
    .toBuffer();
  return sharp(await solid(width, height).png().toBuffer()).composite([
    { input: overlay, left: 0, top: 0, blend: 'difference' },
  ]);
}

const GPS_EXIF = {
  IFD0: { Make: 'SyntheticCam', Model: 'Corpus-1', Copyright: 'synthetic' },
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '23/1 48/1 0/1',
    GPSLongitudeRef: 'E',
    GPSLongitude: '90/1 24/1 0/1',
  },
};
const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>synthetic</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>';

// ---- accepted: re-encoded into clean WebP variants
const jpegSmall = await (await pattern(64, 48)).jpeg({ quality: 70 }).toBuffer();
save('jpeg-small.jpg', jpegSmall, 'stored', '64x48 baseline JPEG');
save(
  'jpeg-large.jpg',
  await (await pattern(2000, 1500)).jpeg({ quality: 40 }).toBuffer(),
  'stored',
  '2000x1500, all three variants',
);
save(
  'jpeg-exif-gps-orient6.jpg',
  await (await pattern(64, 32))
    .withMetadata({ orientation: 6 })
    .withExif(GPS_EXIF)
    .jpeg()
    .toBuffer(),
  'stored',
  'EXIF with GPS and orientation 6: rotated, metadata dropped',
);
save(
  'jpeg-cmyk.jpg',
  await (await pattern(120, 80)).toColourspace('cmyk').jpeg().toBuffer(),
  'stored',
  'CMYK JPEG converted to sRGB',
);
save(
  'jpeg-gray.jpg',
  await (await pattern(90, 60)).toColourspace('b-w').jpeg().toBuffer(),
  'stored',
  'greyscale JPEG',
);
save(
  'jpeg-progressive.jpg',
  await (await pattern(500, 300)).jpeg({ progressive: true }).toBuffer(),
  'stored',
  'progressive JPEG',
);
save(
  'jpeg-icc-p3.jpg',
  await (await pattern(100, 100)).withIccProfile('p3').jpeg().toBuffer(),
  'stored',
  'Display P3 ICC profile, converted and dropped',
);
save(
  'jpeg-xmp.jpg',
  await (await pattern(80, 60)).withXmp(XMP).jpeg().toBuffer(),
  'stored',
  'XMP packet dropped',
);
save('png-rgb.png', await (await pattern(300, 200)).png().toBuffer(), 'stored', 'RGB PNG');
save('png-rgba.png', await solid(200, 120, true).png().toBuffer(), 'stored', 'PNG with alpha');
save(
  'png-16bit.png',
  await (await pattern(64, 64)).toColourspace('rgb16').png().toBuffer(),
  'stored',
  '16-bit PNG',
);
save(
  'png-gray.png',
  await (await pattern(64, 64)).toColourspace('b-w').png().toBuffer(),
  'stored',
  'greyscale PNG',
);
save(
  'png-palette.png',
  await (await pattern(128, 64)).png({ palette: true }).toBuffer(),
  'stored',
  'palette PNG',
);
save(
  'png-interlaced.png',
  await (await pattern(256, 128)).png({ progressive: true }).toBuffer(),
  'stored',
  'Adam7 interlaced PNG',
);
save('png-1x1.png', await solid(1, 1).png().toBuffer(), 'stored', 'one pixel');
save('png-wide.png', await solid(3000, 10).png().toBuffer(), 'stored', '3000x10 strip');
save(
  'webp-lossy.webp',
  await (await pattern(640, 360)).webp({ quality: 60 }).toBuffer(),
  'stored',
  'lossy WebP',
);
save(
  'webp-lossless.webp',
  await (await pattern(64, 64)).webp({ lossless: true }).toBuffer(),
  'stored',
  'lossless WebP',
);
save('webp-alpha.webp', await solid(100, 50, true).webp().toBuffer(), 'stored', 'WebP with alpha');
save(
  'webp-exif-xmp.webp',
  await (await pattern(120, 90)).withExif(GPS_EXIF).withXmp(XMP).webp().toBuffer(),
  'stored',
  'WebP with EXIF (GPS) and XMP chunks, dropped',
);
save(
  'selftest.jpg',
  await solid(1700, 8).jpeg({ quality: 30 }).toBuffer(),
  'stored',
  'INF-203 check 8: about 1 KB, three variants',
);

// ---- refused by the route's signature sniff (SD-215): imageType
save('gif.gif', await solid(20, 20).gif().toBuffer(), 'imageType', 'GIF');
save(
  'svg-script.bin',
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  ),
  'imageType',
  'SVG with script',
);
save('tiff.tif', await solid(20, 20).tiff().toBuffer(), 'imageType', 'TIFF');
save(
  'bmp.bmp',
  new Uint8Array([0x42, 0x4d, 0x3e, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0, 0x28, 0]),
  'imageType',
  'BMP header',
);
save(
  'heic-header.heic',
  new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]),
  'imageType',
  'HEIC ftyp box',
);
save(
  'pdf.pdf',
  new TextEncoder().encode('%PDF-1.4\n%âã\n1 0 obj\n<<>>\nendobj\n'),
  'imageType',
  'PDF',
);
save('empty.bin', new Uint8Array(), 'imageType', 'zero bytes');
save(
  'html-script.bin',
  new TextEncoder().encode('<!doctype html><img src=x onerror=alert(1)>'),
  'imageType',
  'HTML',
);
let seed = 4404;
const random = new Uint8Array(512).map(() => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed & 0xff;
});
random[0] = 0x00;
save('random.bin', random, 'imageType', 'fixed pseudo-random bytes');

// ---- sniffed as an image but refused by the helper
const frames = [
  await solid(40, 40).png().toBuffer(),
  await (await pattern(40, 40)).png().toBuffer(),
];
save(
  'webp-animated.webp',
  await sharp(frames, { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer(),
  'imageType',
  'animated WebP (2 pages): exactly one page is accepted',
);
save(
  'jpeg-truncated.jpg',
  (await (await pattern(400, 300)).jpeg().toBuffer()).subarray(0, 600),
  'imageUnreadable',
  'JPEG cut off',
);
save(
  'png-truncated.png',
  (await (await pattern(400, 300)).png().toBuffer()).subarray(0, 200),
  'imageUnreadable',
  'PNG cut off',
);
save(
  'png-bomb.png',
  await solid(7200, 7200).png({ compressionLevel: 9 }).toBuffer(),
  'imageUnreadable',
  '51.8 Mpx, over limitInputPixels (memory-spike case, CI-204)',
);
const garbage = new Uint8Array(256);
garbage.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
garbage.set(new TextEncoder().encode('<html><script>alert(1)</script></html>'), 8);
save('png-polyglot.png', garbage, 'imageUnreadable', 'PNG signature followed by HTML');
save(
  'jpeg-header-only.jpg',
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  'imageUnreadable',
  'JPEG signature only',
);

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${manifest.length} corpus files to ${OUT}`);
