/*
 * A small, dependency-free PNG reader for the tests.
 *
 * The app hands the host a data URL, and the only honest way to say "that file
 * really is transparent" is to decode the bytes the host was given and look at
 * the alpha channel. Node has no PNG decoder, and the tests ship no
 * dependencies, so this reads the subset of the format a canvas encoder
 * produces: 8-bit, non-interlaced, colour type 0, 2, 4 or 6. Anything else
 * throws rather than guessing, so an unexpected encoder is visible instead of
 * silently passing.
 */
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(left, up, upLeft) {
    const estimate = left + up - upLeft;
    const toLeft = Math.abs(estimate - left);
    const toUp = Math.abs(estimate - up);
    const toUpLeft = Math.abs(estimate - upLeft);
    if (toLeft <= toUp && toLeft <= toUpLeft) return left;
    return toUp <= toUpLeft ? up : upLeft;
}

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Decodes a PNG buffer and returns its pixels plus `at(x, y)` -> [r, g, b, a]. */
export function decodePng(bytes) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
        throw new Error('not a PNG file: the signature is missing');
    }

    let header = null;
    const data = [];
    let offset = 8;

    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const body = buffer.subarray(offset + 8, offset + 8 + length);
        offset += 12 + length;

        if (type === 'IHDR') {
            header = {
                width: body.readUInt32BE(0),
                height: body.readUInt32BE(4),
                bitDepth: body[8],
                colourType: body[9],
                interlace: body[12]
            };
        } else if (type === 'IDAT') {
            data.push(body);
        } else if (type === 'IEND') {
            break;
        }
    }

    if (!header) throw new Error('PNG has no IHDR chunk');
    if (header.bitDepth !== 8) throw new Error('unsupported PNG bit depth ' + header.bitDepth);
    if (header.interlace !== 0) throw new Error('interlaced PNG is not supported by this reader');

    const channels = CHANNELS[header.colourType];
    if (!channels) throw new Error('unsupported PNG colour type ' + header.colourType);

    const raw = inflateSync(Buffer.concat(data));
    const stride = header.width * channels;
    const pixels = Buffer.alloc(stride * header.height);
    let position = 0;

    for (let y = 0; y < header.height; y++) {
        const filter = raw[position++];
        const row = y * stride;

        for (let x = 0; x < stride; x++) {
            const value = raw[position++];
            const left = x >= channels ? pixels[row + x - channels] : 0;
            const up = y > 0 ? pixels[row - stride + x] : 0;
            const upLeft = y > 0 && x >= channels ? pixels[row - stride + x - channels] : 0;

            let restored;
            if (filter === 0) restored = value;
            else if (filter === 1) restored = value + left;
            else if (filter === 2) restored = value + up;
            else if (filter === 3) restored = value + ((left + up) >> 1);
            else if (filter === 4) restored = value + paeth(left, up, upLeft);
            else throw new Error('unknown PNG filter ' + filter);

            pixels[row + x] = restored & 0xff;
        }
    }

    return {
        width: header.width,
        height: header.height,
        channels,
        pixels,
        at(x, y) {
            if (x < 0 || y < 0 || x >= header.width || y >= header.height) {
                throw new Error('pixel ' + x + ',' + y + ' is outside ' + header.width + 'x' + header.height);
            }
            const start = (y * header.width + x) * channels;
            const type = header.colourType;

            if (type === 6) {
                return [pixels[start], pixels[start + 1], pixels[start + 2], pixels[start + 3]];
            }
            if (type === 2) {
                return [pixels[start], pixels[start + 1], pixels[start + 2], 255];
            }
            if (type === 4) {
                return [pixels[start], pixels[start], pixels[start], pixels[start + 1]];
            }
            return [pixels[start], pixels[start], pixels[start], 255];
        }
    };
}
