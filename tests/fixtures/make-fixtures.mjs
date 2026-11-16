/*
 * Deterministic image fixtures for the web-layer tests.
 *
 * No dependency and no browser: a tiny 8-bit RGB PNG writer plus an integer
 * LCG, so the same bytes come out on every machine and every run. The app
 * accepts anything `image/*`, and PNG is the one format that can be written
 * correctly in a few dozen lines.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
}

/** An 8-bit, non-interlaced PNG of a deterministic pattern. */
function encodePngChannels(width, height, channels, pixel) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;                              // bit depth
    ihdr[9] = channels === 4 ? 6 : 2;         // colour type: truecolour, with or without alpha
    ihdr[10] = 0;                             // deflate
    ihdr[11] = 0;                             // adaptive filtering
    ihdr[12] = 0;                             // no interlace

    const raw = Buffer.alloc((width * channels + 1) * height);
    let offset = 0;
    for (let y = 0; y < height; y++) {
        raw[offset++] = 0; // filter: none
        for (let x = 0; x < width; x++) {
            const values = pixel(x, y);
            for (let c = 0; c < channels; c++) raw[offset++] = values[c];
        }
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 6 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

/** An opaque 8-bit truecolour PNG. */
export function encodePng(width, height, pixel) {
    return encodePngChannels(width, height, 3, pixel);
}

/** The same writer with an alpha channel: pixel returns [r, g, b, a]. */
export function encodePngRgba(width, height, pixel) {
    return encodePngChannels(width, height, 4, pixel);
}

/** Same picture at any size: a diagonal gradient with seeded discs over it. */
export function patternPixel(width, height) {
    let seed = 0x5eed;
    const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };

    const discs = [];
    const count = 220;
    for (let i = 0; i < count; i++) {
        discs.push({
            x: rnd() * width,
            y: rnd() * height,
            r: 4 + rnd() * (Math.min(width, height) * 0.09),
            colour: [Math.floor(rnd() * 255), Math.floor(rnd() * 255), Math.floor(rnd() * 255)]
        });
    }

    const stops = [
        { at: 0, c: [0x2b, 0x5c, 0x8a] },
        { at: 0.5, c: [0xd8, 0xc4, 0x6a] },
        { at: 1, c: [0x8a, 0x2b, 0x3c] }
    ];

    return (x, y) => {
        const t = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2;
        const [a, b] = t < 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]];
        const f = (t - a.at) / (b.at - a.at);
        let out = [
            Math.round(a.c[0] + (b.c[0] - a.c[0]) * f),
            Math.round(a.c[1] + (b.c[1] - a.c[1]) * f),
            Math.round(a.c[2] + (b.c[2] - a.c[2]) * f)
        ];

        for (const d of discs) {
            const dx = x - d.x;
            const dy = y - d.y;
            if (dx * dx + dy * dy <= d.r * d.r) {
                out = [
                    Math.round(out[0] * 0.45 + d.colour[0] * 0.55),
                    Math.round(out[1] * 0.45 + d.colour[1] * 0.55),
                    Math.round(out[2] * 0.45 + d.colour[2] * 0.55)
                ];
            }
        }
        return out;
    };
}

export const SIZES = [
    { name: 'small-800x600.png', width: 800, height: 600 },
    { name: 'photo-4032x3024.png', width: 4032, height: 3024 }
];

/** Writes every fixture into `dir` and returns their absolute paths. */
export function makeFixtures(dir) {
    mkdirSync(dir, { recursive: true });
    return SIZES.map(size => {
        const path = join(dir, size.name);
        writeFileSync(path, encodePng(size.width, size.height, patternPixel(size.width, size.height)));
        return { ...size, path };
    });
}

/**
 * A large JPEG of the kind a phone actually drops, encoded by the browser
 * itself: 12 megapixels of seeded noise, so it does not compress to nothing and
 * the file lands in the megabytes rather than the hundreds of kilobytes. Written
 * once per run and used for both variants.
 */
export async function makePhotoJpeg(page, dir, { width = 4032, height = 3024, quality = 0.85 } = {}) {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `photo-${width}x${height}.jpg`);
    const base64 = await page.evaluate(`(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = ${width};
        canvas.height = ${height};
        const context = canvas.getContext('2d');
        const image = context.createImageData(${width}, ${height});
        let state = 0x9e3779b9;
        const next = () => {
            state ^= state << 13; state >>>= 0;
            state ^= state >>> 17;
            state ^= state << 5; state >>>= 0;
            return state;
        };
        for (let i = 0; i < image.data.length; i += 4) {
            const value = next();
            image.data[i] = value & 0xff;
            image.data[i + 1] = (value >>> 8) & 0xff;
            image.data[i + 2] = (value >>> 16) & 0xff;
            image.data[i + 3] = 255;
        }
        context.putImageData(image, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', ${quality}));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        const step = 0x8000;
        for (let i = 0; i < bytes.length; i += step) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
        }
        return btoa(binary);
    })()`);
    const bytes = Buffer.from(base64, 'base64');
    writeFileSync(path, bytes);
    return { name: `photo-${width}x${height}.jpg`, width, height, path, size: bytes.length };
}

if (import.meta.main) {
    const dir = process.argv[2] || join(import.meta.dir, 'generated');
    const made = makeFixtures(dir);
    for (const item of made) console.log(`${item.path}  ${item.width}x${item.height}`);
}
