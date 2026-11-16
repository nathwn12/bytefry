#!/usr/bin/env python3
"""Rebuild MemeFryer.ico from icon-source.png.

    python make-icon.py                     # writes MemeFryer.ico beside this script
    python make-icon.py --preview <dir>     # also write per-size PNGs and a contact sheet

`icon-source.png` is the selected art as delivered — a 1254x1254 RGB painting composited on black
(no alpha; sha256 eb6571b87ffc769f80d22c801062c92b847d4f57e6bffadfca78b52606f884d7). This script
does the two things the art needs
before it can be an icon, then packs every size Windows asks for:

1. Transparent background. The black surround is keyed out by flooding the low-luminance region
   reachable from the border (a flood fill, never a brightness threshold on the whole image), so the
   monitor's dark body, its screen glass and its vents stay opaque. The glow outside the body keeps a
   luminance-proportional alpha, which makes the halo transparent on any background and keeps the
   composite identical to the delivered art on black.

2. Frames. 16, 24, 32, 48, 64, 128 and 256 px, downsampled in premultiplied alpha (a straight RGBA
   resize bleeds the transparent black into every edge), by repeated area halving to avoid ringing.
   Frames of 64 px and below are framed on the monitor itself rather than on the painting's canvas,
   because at that size the canvas margin is a wasted pixel row; 16-48 also get a mild contrast and
   saturation lift plus a light unsharp pass, since they are the sizes drawn on dark chrome.

Storage is what Windows expects: 32-bit BGRA DIB frames with an all-zero AND mask for 16-128 and a
PNG-compressed frame for 256.

Requires Pillow and numpy (developed against Pillow 13.0.0, numpy 2.5.5).
"""

from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "icon-source.png"
TARGET = HERE / "MemeFryer.ico"

# Everything at or below this maximum channel value counts as background paint over black. The
# delivered art's border ring measures 1-2, so 12 keeps the antialiased rim and the dimmest glow.
BACKGROUND_LUMINANCE = 12

# Frames at or below this size are framed on the monitor's own bounds instead of the full canvas.
TIGHT_FRAME_AT_OR_BELOW = 64
TIGHT_FRAME_PADDING = 0.06

# Sizes drawn on dark chrome: a light lift keeps the bezel, the screen and the flame distinguishable.
GRADE_AT_OR_BELOW = 48
CONTRAST = 1.12
SATURATION = 1.15
UNSHARP = 50
SHARPNESS_RADIUS = 0.7

# 16 and 24 px carry no room for a gentle lift: below this the flame and the bezel separate only with a
# harder contrast and a tighter unsharp radius (measured by eye at 10-12x against the lighter grade).
STRONG_GRADE_AT_OR_BELOW = 24
STRONG_CONTRAST = 1.20
STRONG_SATURATION = 1.25
STRONG_UNSHARP = 90
STRONG_RADIUS = 0.5

SIZES = (16, 24, 32, 48, 64, 128, 256)


def load_master() -> Image.Image:
    """The source painting with a real alpha channel: opaque object, luminance-ramped glow."""
    rgb = np.asarray(Image.open(SOURCE).convert("RGB")).astype(np.float32)
    luminance = rgb.max(axis=2)

    # Mark the background as the low-luminance region connected to the canvas border. Filling a
    # writable copy matters: PIL writes into the image's own buffer, and fromarray() is read-only.
    background_paint = Image.fromarray(
        np.where(luminance > BACKGROUND_LUMINANCE, 1, 0).astype(np.uint8) * 255, "L").copy()
    ImageDraw.floodfill(background_paint, (0, 0), 128, thresh=0)
    exterior = np.asarray(background_paint) == 128

    # On the object: full alpha, straight colour. Outside it: the art is glow composited on black, so
    # alpha is its luminance and the colour is un-premultiplied to keep the composite exact on black.
    alpha = np.where(exterior, luminance, 255.0)
    safe = np.maximum(alpha, 1.0)[..., None]
    colour = np.where(exterior[..., None], np.clip(rgb * 255.0 / safe, 0, 255), rgb)

    rgba = np.dstack([colour, alpha]).round().astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def object_bounds(master: Image.Image) -> tuple[int, int, int, int]:
    return master.getchannel("A").point(lambda value: 255 if value == 255 else 0).getbbox()


def tight(master: Image.Image) -> Image.Image:
    """Square crop on the opaque object with a small margin, never clipping it."""
    x0, y0, x1, y1 = object_bounds(master)
    centre_x, centre_y = (x0 + x1) / 2, (y0 + y1) / 2
    half = max(x1 - x0, y1 - y0) / 2 * (1 + TIGHT_FRAME_PADDING)
    box = (round(centre_x - half), round(centre_y - half), round(centre_x + half), round(centre_y + half))
    return master.crop(box)


def resize_premultiplied(img: Image.Image, size: int) -> Image.Image:
    """Area-halve in premultiplied alpha, then Lanczos the remainder, then un-premultiply."""
    arr = np.asarray(img).astype(np.float32)
    alpha = arr[..., 3:4] / 255.0
    premultiplied = np.dstack([arr[..., :3] * alpha, arr[..., 3:4]])

    current = Image.fromarray(premultiplied.round().astype(np.uint8), "RGBA")
    while current.width > size * 2:
        step = max(size, current.width // 2)
        current = current.resize((step, step), Image.BOX)
    current = current.resize((size, size), Image.LANCZOS)

    scaled = np.asarray(current).astype(np.float32)
    weight = np.clip(scaled[..., 3:4] / 255.0, 1e-6, 1.0)
    straight = np.dstack([np.clip(scaled[..., :3] / weight, 0, 255), scaled[..., 3:4]])
    return Image.fromarray(straight.round().astype(np.uint8), "RGBA")


def grade(img: Image.Image, contrast: float, saturation: float, unsharp: int, radius: float) -> Image.Image:
    """Contrast, saturation and an unsharp pass, alpha untouched."""
    rgb = ImageEnhance.Color(
        ImageEnhance.Contrast(img.convert("RGB")).enhance(contrast)).enhance(saturation)
    graded = rgb.convert("RGBA")
    graded.putalpha(img.getchannel("A"))
    return graded.filter(ImageFilter.UnsharpMask(radius=radius, percent=unsharp, threshold=0))


def frame(master: Image.Image, tight_master: Image.Image, size: int) -> Image.Image:
    source = tight_master if size <= TIGHT_FRAME_AT_OR_BELOW else master
    img = resize_premultiplied(source, size)

    if size <= STRONG_GRADE_AT_OR_BELOW:
        return grade(img, STRONG_CONTRAST, STRONG_SATURATION, STRONG_UNSHARP, STRONG_RADIUS)
    if size <= GRADE_AT_OR_BELOW:
        return grade(img, CONTRAST, SATURATION, UNSHARP, SHARPNESS_RADIUS)
    return img


def dib(img: Image.Image) -> bytes:
    """BITMAPINFOHEADER + bottom-up BGRA pixels + the 1bpp AND mask (all zeros: alpha decides)."""
    width, height = img.size
    header = struct.pack(
        "<IiiHHIIiiII",
        40,              # biSize
        width,           # biWidth
        height * 2,      # biHeight: XOR image then AND mask
        1,               # biPlanes
        32,              # biBitCount
        0,               # biCompression (BI_RGB)
        width * height * 4,  # biSizeImage
        0, 0,            # biXPelsPerMeter, biYPelsPerMeter
        0, 0,            # biClrUsed, biClrImportant
    )
    bgra = img.convert("RGBA").transpose(Image.FLIP_TOP_BOTTOM).tobytes("raw", "BGRA")
    mask_row = ((width + 31) // 32) * 4
    return header + bgra + b"\x00" * (mask_row * height)


def png(img: Image.Image) -> bytes:
    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def build() -> dict[int, Image.Image]:
    master = load_master()
    tight_master = tight(master)
    return {size: frame(master, tight_master, size) for size in SIZES}


def assemble(frames: dict[int, Image.Image]) -> bytes:
    payloads = [(size, png(img) if size >= 256 else dib(img)) for size, img in sorted(frames.items())]

    directory = struct.pack("<HHH", 0, 1, len(payloads))
    offset = 6 + 16 * len(payloads)
    entries = []
    for size, data in payloads:
        dimension = 0 if size >= 256 else size  # 0 in a width/height byte means 256
        entries.append(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(data), offset))
        offset += len(data)

    return directory + b"".join(entries) + b"".join(data for _, data in payloads)


def main(argv: list[str]) -> int:
    if not SOURCE.exists():
        raise SystemExit(f"source painting missing: {SOURCE}")

    frames = build()
    TARGET.write_bytes(assemble(frames))

    written = Image.open(TARGET)
    print(f"{TARGET.name}: {TARGET.stat().st_size} bytes, {len(written.info['sizes'])} frames "
          f"({', '.join(str(size[0]) for size in sorted(written.info['sizes']))})")

    if "--preview" in argv:
        directory = Path(argv[argv.index("--preview") + 1])
        directory.mkdir(parents=True, exist_ok=True)
        for size, img in frames.items():
            img.save(directory / f"frame-{size}.png")
        print(f"preview frames written to {directory}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
