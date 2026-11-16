#!/usr/bin/env python3
"""Build MemeFryer.ico from assets/icon.svg, the one vector source of the mark.

    python make-icon.py                    # writes MemeFryer.ico and icon.lock beside this script
    python make-icon.py --check            # exit 1 when either file disagrees with a fresh build
    python make-icon.py --preview <dir>    # per-size PNG frames and the light/dark contact sheet

The art is `assets/icon.svg` in the repository root: the same file the README shows, so the icon
in the window, on the shortcut, in the installer and at the top of the README cannot drift apart.
It is hand-authored SVG - transparency is real alpha, there is no painted background to key out.

Every build also writes `icon.lock`, the sha256 of the vector and of the .ico it produced. That
record is what binds the pair on a machine with no Python: the test suite compares it with both
files directly, so editing the SVG, or replacing the .ico, without re-running this script turns the
icon checks red. `--check` is the same comparison plus a full re-render, and is what a person runs
after an intentional change.

Everything below is a small, strict SVG reader for the subset the art uses. It supports `<path>`
(M, L, H, V, C, S, Q, T, Z; absolute and relative), `<rect>` with square corners, `<circle>`,
`<ellipse>` and `<polygon>`, a solid `fill` or one `linearGradient`, `fill-opacity`, and the
`data-min-px` attribute that hides an element from frames below a pixel size. An element outside
that subset raises instead of being silently dropped: a wrong icon should fail loudly here, not
quietly ship. Fills are evaluated even-odd, so a painter must not overlap its own subpaths; the art
gives each painter one, which makes the two rules agree.

Rendering is vector, not photographic: each frame is rasterised at that size from the SVG with
supersampling, so a 16 px frame is drawn at 16 px rather than crushed down from 256, and every
size keeps its own crisp edge. Far more detail would only be a larger file; the shape is what
carries a small icon.

Requires Pillow and numpy (developed against Pillow 13.0.0, numpy 2.5.5). No other dependency:
there is no SVG library on the path, and adding one would make the build depend on it.
"""

from __future__ import annotations

import hashlib
import io
import math
import re
import struct
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
# desktop/MemeFryer.Desktop/Assets -> desktop/MemeFryer.Desktop -> desktop -> repository root
REPO_ROOT = HERE.parents[2]
SOURCE = REPO_ROOT / "assets" / "icon.svg"
TARGET = HERE / "MemeFryer.ico"

# The pair of digests the suite compares without Python. It is written by a build and verified by
# --check, so the .ico, the vector it came from and this record move only together.
LOCK = HERE / "icon.lock"

# Every size Windows asks an icon for, and the suite asserts: title bar, small and large list,
# taskbar and Alt-Tab at 100-200% scaling, the shell's jumbo view, and the 256 px installer badge.
SIZES = (16, 24, 32, 48, 64, 128, 256)

# Supersampling per frame. Small frames get more samples because a superpixel is a bigger share of
# them; every frame is drawn at its own size, so this is quality, never a downscale of a big master.
SUPERSAMPLE = {16: 12, 24: 10, 32: 8, 48: 6, 64: 6, 128: 4, 256: 4}


# --------------------------------------------------------------------------- SVG subset


TAG = lambda element: element.tag.rsplit("}", 1)[-1]  # noqa: E731 - short enough to read inline

PATH_TOKENS = re.compile(r"[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
RGB = re.compile(r"^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$")


def parse_colour(value: str) -> tuple[float, float, float]:
    match = HEX.match(value.strip())
    if match:
        digits = match.group(1)
        if len(digits) == 3:
            digits = "".join(character * 2 for character in digits)
        return tuple(float(int(digits[index:index + 2], 16)) for index in (0, 2, 4))
    match = RGB.match(value.strip())
    if match:
        return tuple(float(match.group(index)) for index in (1, 2, 3))
    raise SystemExit(f"unsupported colour {value!r}: the art uses hex or rgb() only")


def cubic(p0, p1, p2, p3, flatness: float = 1.0) -> list[tuple[float, float]]:
    """Points of a cubic after p0, dense enough that chords stay within ~flatness of the curve."""
    span = (math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3))
    steps = max(8, min(400, int(math.ceil(span / flatness))))
    points = []
    for step in range(1, steps + 1):
        t = step / steps
        u = 1.0 - t
        points.append((
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ))
    return points


def flatten_path(d: str) -> list[list[tuple[float, float]]]:
    """Subpaths of a `d` attribute, curves already flattened to chords."""
    tokens = PATH_TOKENS.findall(d)
    subpaths: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    x = y = start_x = start_y = 0.0
    control: tuple[float, float] | None = None
    command = ""
    cursor = 0

    def number() -> float:
        nonlocal cursor
        if cursor >= len(tokens):
            raise SystemExit(f"path ended early: {d!r}")
        value = float(tokens[cursor])
        cursor += 1
        return value

    while cursor < len(tokens):
        if tokens[cursor].isalpha():
            command = tokens[cursor]
            cursor += 1
        if not command:
            raise SystemExit(f"path starts without a command: {d!r}")

        relative = command.islower()
        kind = command.upper()

        if kind == "Z":
            if len(current) > 2:
                subpaths.append(current)
            current = []
            x, y = start_x, start_y
            control = None
            command = ""
            continue

        if kind == "M":
            next_x, next_y = number(), number()
            if relative:
                next_x, next_y = x + next_x, y + next_y
            if len(current) > 2:
                subpaths.append(current)
            current = [(next_x, next_y)]
            x, y = start_x, start_y = next_x, next_y
            control = None
            # A coordinate pair after a moveto is an implicit lineto, per the SVG grammar.
            command = "l" if relative else "L"
        elif kind == "L":
            next_x, next_y = number(), number()
            if relative:
                next_x, next_y = x + next_x, y + next_y
            current.append((next_x, next_y))
            x, y = next_x, next_y
            control = None
        elif kind == "H":
            next_x = number()
            x = x + next_x if relative else next_x
            current.append((x, y))
            control = None
        elif kind == "V":
            next_y = number()
            y = y + next_y if relative else next_y
            current.append((x, y))
            control = None
        elif kind in ("C", "S"):
            if kind == "C":
                x1, y1, x2, y2, next_x, next_y = (number() for _ in range(6))
                if relative:
                    x1, y1, x2, y2, next_x, next_y = (
                        x1 + x, y1 + y, x2 + x, y2 + y, next_x + x, next_y + y)
            else:
                x2, y2, next_x, next_y = (number() for _ in range(4))
                if relative:
                    x2, y2, next_x, next_y = x2 + x, y2 + y, next_x + x, next_y + y
                x1, y1 = (x, y) if control is None else (2 * x - control[0], 2 * y - control[1])
            current.extend(cubic((x, y), (x1, y1), (x2, y2), (next_x, next_y)))
            x, y, control = next_x, next_y, (x2, y2)
        elif kind in ("Q", "T"):
            if kind == "Q":
                qx, qy, next_x, next_y = (number() for _ in range(4))
                if relative:
                    qx, qy, next_x, next_y = qx + x, qy + y, next_x + x, next_y + y
            else:
                next_x, next_y = number(), number()
                if relative:
                    next_x, next_y = next_x + x, next_y + y
                qx, qy = (x, y) if control is None else (2 * x - control[0], 2 * y - control[1])
            # A quadratic is a cubic with its controls two thirds of the way to the single control.
            c1 = (x + 2.0 / 3.0 * (qx - x), y + 2.0 / 3.0 * (qy - y))
            c2 = (next_x + 2.0 / 3.0 * (qx - next_x), next_y + 2.0 / 3.0 * (qy - next_y))
            current.extend(cubic((x, y), c1, c2, (next_x, next_y)))
            x, y, control = next_x, next_y, (qx, qy)
        else:
            raise SystemExit(f"unsupported path command {command!r} in {d[:40]!r}")

    if len(current) > 2:
        subpaths.append(current)
    return subpaths


def shape_subpaths(element: ET.Element) -> list[list[tuple[float, float]]]:
    name = TAG(element)
    if name == "path":
        return flatten_path(element.get("d", ""))
    if name == "rect":
        if element.get("rx") or element.get("ry"):
            raise SystemExit("rect with rounded corners: the art is square-cornered by design")
        x, y = float(element.get("x", 0)), float(element.get("y", 0))
        width, height = float(element.get("width", 0)), float(element.get("height", 0))
        return [[(x, y), (x + width, y), (x + width, y + height), (x, y + height)]]
    if name in ("circle", "ellipse"):
        cx, cy = float(element.get("cx", 0)), float(element.get("cy", 0))
        if name == "circle":
            rx = ry = float(element.get("r", 0))
        else:
            rx, ry = float(element.get("rx", 0)), float(element.get("ry", 0))
        return [[(cx + rx * math.cos(2 * math.pi * index / 96),
                  cy + ry * math.sin(2 * math.pi * index / 96)) for index in range(96)]]
    if name == "polygon":
        numbers = [float(value) for value in re.findall(r"[-+]?(?:\d*\.\d+|\d+\.?)", element.get("points", ""))]
        if len(numbers) % 2 or len(numbers) < 6:
            raise SystemExit("polygon points are not coordinate pairs")
        return [[(numbers[index], numbers[index + 1]) for index in range(0, len(numbers), 2)]]
    raise SystemExit(f"unsupported shape <{name}>: use path, rect, circle, ellipse or polygon")


class Layer:
    """One painted element: its geometry, its paint and the smallest frame it belongs in."""

    def __init__(self, element: ET.Element, paint, opacity: float, min_px: int):
        self.subpaths = shape_subpaths(element)
        self.paint = paint
        self.opacity = opacity
        self.min_px = min_px
        if not any(len(subpath) > 2 for subpath in self.subpaths):
            raise SystemExit(f"<{TAG(element)}> has no drawable area")

    def bounds(self) -> tuple[float, float, float, float]:
        points = [point for subpath in self.subpaths for point in subpath]
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        return min(xs), min(ys), max(xs), max(ys)


class Gradient:
    def __init__(self, element: ET.Element):
        self.units = element.get("gradientUnits", "objectBoundingBox")
        self.start = (float(element.get("x1", 0)), float(element.get("y1", 0)))
        self.end = (float(element.get("x2", 1)), float(element.get("y2", 0)))
        self.stops: list[tuple[float, tuple[float, float, float], float]] = []
        for stop in element:
            if TAG(stop) != "stop":
                continue
            self.stops.append((
                float(stop.get("offset", 0)),
                parse_colour(stop.get("stop-color", "#000000")),
                float(stop.get("stop-opacity", 1)),
            ))
        if len(self.stops) < 2:
            raise SystemExit("a linearGradient needs at least two stops")
        self.stops.sort(key=lambda entry: entry[0])


class Art:
    def __init__(self, path: Path):
        root = ET.parse(path).getroot()
        if TAG(root) != "svg":
            raise SystemExit(f"{path} is not an svg document")
        view_box = [float(value) for value in re.split(r"[\s,]+", root.get("viewBox", "").strip()) if value]
        if len(view_box) != 4 or view_box[2] != view_box[3]:
            raise SystemExit(f"{path} needs a square viewBox, got {root.get('viewBox')!r}")
        self.extent = view_box[2]

        self.gradients: dict[str, Gradient] = {}
        for element in root.iter():
            if TAG(element) == "linearGradient":
                identifier = element.get("id")
                if not identifier:
                    raise SystemExit("a linearGradient without an id cannot be referenced")
                self.gradients[identifier] = Gradient(element)

        self.layers: list[Layer] = []
        self._walk(root, inherited_min=0)
        if not self.layers:
            raise SystemExit(f"{path} draws nothing")

    def _walk(self, element: ET.Element, inherited_min: int) -> None:
        name = TAG(element)
        if name in ("defs", "linearGradient", "title", "desc", "metadata", "style"):
            return

        min_px = int(element.get("data-min-px", inherited_min))
        inherited_min = max(inherited_min, min_px)

        if name in ("svg", "g"):
            for child in element:
                self._walk(child, inherited_min)
            return

        fill = element.get("fill", "#000000").strip()
        if fill == "none":
            return
        if fill.startswith("url("):
            identifier = fill[4:].rstrip(")").lstrip("#")
            if identifier not in self.gradients:
                raise SystemExit(f"fill references an unknown gradient: {fill}")
            paint = self.gradients[identifier]
        else:
            paint = parse_colour(fill)

        self.layers.append(Layer(
            element, paint, float(element.get("fill-opacity", 1)), inherited_min))


# --------------------------------------------------------------------------- raster


def fill_mask(subpaths, scale: float, width: int, height: int) -> np.ndarray:
    """Coverage of the element at supersampled resolution, even-odd across its subpaths."""
    coverage = np.zeros((height, width), dtype=bool)
    for subpath in subpaths:
        if len(subpath) < 3:
            continue
        canvas = Image.new("1", (width, height), 0)
        ImageDraw.Draw(canvas).polygon([(x * scale, y * scale) for x, y in subpath], fill=1)
        coverage ^= np.asarray(canvas, dtype=bool)
    return coverage


def paint_plane(paint, bounds, scale: float, width: int, height: int):
    """RGB and alpha planes for one element at supersampled resolution."""
    if not isinstance(paint, Gradient):
        plane = np.empty((height, width, 3), dtype=np.float32)
        plane[...] = np.asarray(paint, dtype=np.float32)
        return plane, None

    x0, y0, x1, y1 = bounds
    if paint.units == "objectBoundingBox":
        start = (x0 + paint.start[0] * (x1 - x0), y0 + paint.start[1] * (y1 - y0))
        end = (x0 + paint.end[0] * (x1 - x0), y0 + paint.end[1] * (y1 - y0))
    else:
        start, end = paint.start, paint.end

    grid_y, grid_x = np.mgrid[0:height, 0:width]
    px = (grid_x + 0.5) / scale
    py = (grid_y + 0.5) / scale

    run_x, run_y = end[0] - start[0], end[1] - start[1]
    length_squared = run_x * run_x + run_y * run_y
    if length_squared == 0:
        raise SystemExit("a linearGradient needs two different points")
    t = np.clip(((px - start[0]) * run_x + (py - start[1]) * run_y) / length_squared, 0.0, 1.0)

    offsets = np.array([entry[0] for entry in paint.stops], dtype=np.float32)
    plane = np.empty((height, width, 3), dtype=np.float32)
    for channel in range(3):
        values = np.array([entry[1][channel] for entry in paint.stops], dtype=np.float32)
        plane[..., channel] = np.interp(t, offsets, values)
    opacities = np.array([entry[2] for entry in paint.stops], dtype=np.float32)
    return plane, np.interp(t, offsets, opacities)


def downscale(image: Image.Image, size: int) -> Image.Image:
    """Area-average in premultiplied alpha, then un-premultiply: no dark halo on the edge."""
    array = np.asarray(image).astype(np.float32)
    alpha = array[..., 3:4] / 255.0
    premultiplied = Image.fromarray(
        np.dstack([array[..., :3] * alpha, array[..., 3:4]]).round().astype(np.uint8), "RGBA")
    reduced = premultiplied.resize((size, size), Image.BOX)
    scaled = np.asarray(reduced).astype(np.float32)
    weight = np.clip(scaled[..., 3:4] / 255.0, 1e-6, 1.0)
    straight = np.dstack([np.clip(scaled[..., :3] / weight, 0, 255), scaled[..., 3:4]])
    return Image.fromarray(straight.round().astype(np.uint8), "RGBA")


def render(art: Art, size: int) -> Image.Image:
    """One frame, drawn at `size` px from the vector source."""
    samples = SUPERSAMPLE[size]
    width = height = size * samples
    scale = width / art.extent

    colour = np.zeros((height, width, 3), dtype=np.float32)
    alpha = np.zeros((height, width, 1), dtype=np.float32)

    for layer in art.layers:
        if layer.min_px > size:
            continue
        mask = fill_mask(layer.subpaths, scale, width, height)
        if not mask.any():
            continue

        plane, plane_alpha = paint_plane(layer.paint, layer.bounds(), scale, width, height)
        source_alpha = mask.astype(np.float32)[..., None] * layer.opacity
        if plane_alpha is not None:
            source_alpha = source_alpha * plane_alpha[..., None]

        kept = alpha * (1.0 - source_alpha)
        total = source_alpha + kept
        safe = np.maximum(total, 1e-6)
        colour = (plane * source_alpha + colour * kept) / safe
        alpha = total

    rgba = np.dstack([np.clip(colour, 0, 255), alpha[..., 0] * 255.0])
    return downscale(Image.fromarray(rgba.round().astype(np.uint8), "RGBA"), size)


# --------------------------------------------------------------------------- Windows ICO


def dib(image: Image.Image) -> bytes:
    """BITMAPINFOHEADER + bottom-up BGRA pixels + the 1bpp AND mask (all zeros: alpha decides)."""
    width, height = image.size
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
    bgra = image.convert("RGBA").transpose(Image.FLIP_TOP_BOTTOM).tobytes("raw", "BGRA")
    mask_row = ((width + 31) // 32) * 4
    return header + bgra + b"\x00" * (mask_row * height)


def png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def assemble(frames: dict[int, Image.Image]) -> bytes:
    payloads = [(size, png(image) if size >= 256 else dib(image)) for size, image in sorted(frames.items())]

    directory = struct.pack("<HHH", 0, 1, len(payloads))
    offset = 6 + 16 * len(payloads)
    entries = []
    for size, data in payloads:
        dimension = 0 if size >= 256 else size  # 0 in a width/height byte means 256
        entries.append(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(data), offset))
        offset += len(data)

    return directory + b"".join(entries) + b"".join(data for _, data in payloads)


def build() -> dict[int, Image.Image]:
    if not SOURCE.exists():
        raise SystemExit(f"vector source missing: {SOURCE}")
    art = Art(SOURCE)
    return {size: render(art, size) for size in SIZES}


# --------------------------------------------------------------------------- digest record


LOCK_HEADER = (
    "# Generated by make-icon.py. Do not edit: the icon checks compare these digests with\n"
    "# assets/icon.svg and MemeFryer.ico, so neither file can move without the other.\n"
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def lock_text(svg: bytes, ico: bytes) -> str:
    return f"{LOCK_HEADER}svg {digest(svg)}\nico {digest(ico)}\n"


def read_lock(path: Path) -> dict[str, str]:
    """The recorded digests, or a reason the record cannot be trusted."""
    if not path.exists():
        raise SystemExit(f"the digest record is missing: {path.name}")
    recorded: dict[str, str] = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 2 or parts[0] not in ("svg", "ico") or len(parts[1]) != 64:
            raise SystemExit(f"{path.name}:{number} is not an '<svg|ico> <sha256>' line: {line!r}")
        recorded[parts[0]] = parts[1]
    if set(recorded) != {"svg", "ico"}:
        raise SystemExit(f"{path.name} does not record both digests")
    return recorded


# --------------------------------------------------------------------------- preview


GROUNDS = (
    ("light", (255, 255, 255)),
    ("light alt", (246, 248, 250)),
    ("dark", (13, 17, 23)),
    ("app bg", (8, 11, 15)),
)


def _font(size: int, bold: bool = False):
    for name in (("seguisb.ttf", "segoeuib.ttf") if bold else ("segoeui.ttf", "arial.ttf")):
        candidate = Path("C:/Windows/Fonts") / name
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def contact_sheet(frames: dict[int, Image.Image], destination: Path) -> None:
    """Every frame at 1:1 on the four grounds an icon meets, for a designer to judge."""
    column, gutter, label = 300, 20, 46
    heights = [max(size, 48) + 44 for size in sorted(frames)]
    sheet = Image.new("RGB", (label + gutter + len(GROUNDS) * (column + gutter),
                              gutter + sum(heights) + gutter), (120, 124, 130))
    draw = ImageDraw.Draw(sheet)

    for index, (name, ground) in enumerate(GROUNDS):
        left = label + gutter + index * (column + gutter)
        draw.rectangle([left, gutter, left + column, sheet.height - gutter], fill=ground)
        draw.text((left + 10, gutter - 16), name, fill=(240, 240, 240))

    top = gutter
    for size, height in zip(sorted(frames), heights):
        frame = frames[size]
        for index in range(len(GROUNDS)):
            left = label + gutter + index * (column + gutter)
            sheet.paste(frame, (left + (column - size) // 2, top + (height - size) // 2), frame)
        draw.text((10, top + (height - 16) // 2), f"{size}", fill=(245, 245, 245), font=_font(14))
        top += height

    sheet.save(destination)


def readme_header(frame: Image.Image, destination: Path) -> None:
    """The README's own top block, drawn on both GitHub themes at the size the page shows it."""
    width, height = 760, 300
    sheet = Image.new("RGB", (width * 2 + 24, height + 24), (120, 124, 130))
    draw = ImageDraw.Draw(sheet)
    ground = {"light": (255, 255, 255), "dark": (13, 17, 23)}

    for index, (name, colour) in enumerate(ground.items()):
        left = 8 + index * (width + 8)
        draw.rectangle([left, 8, left + width, 8 + height], fill=colour)
        icon = frame.resize((120, 120), Image.LANCZOS)
        sheet.paste(icon, (left + width // 2 - 60, 8 + 32), icon)
        ink = (31, 35, 40) if name == "light" else (230, 237, 243)
        title = "Bytefry"
        font = _font(44, bold=True)
        box = draw.textbbox((0, 0), title, font=font)
        draw.text((left + width // 2 - (box[2] - box[0]) / 2, 8 + 168), title, fill=ink, font=font)
        tagline = "Deep-fry an image in a Windows window"
        font = _font(19)
        box = draw.textbbox((0, 0), tagline, font=font)
        draw.text((left + width // 2 - (box[2] - box[0]) / 2, 8 + 236), tagline,
                  fill=(87, 96, 106) if name == "light" else (145, 152, 161), font=font)

    sheet.save(destination)


def main(argv: list[str]) -> int:
    frames = build()
    payload = assemble(frames)
    svg_bytes = SOURCE.read_bytes()

    if "--check" in argv:
        current = TARGET.read_bytes() if TARGET.exists() else b""
        stale = False
        if current != payload:
            print(f"{TARGET.name} is stale: {len(current)} bytes on disk, {len(payload)} built "
                  f"from {SOURCE.relative_to(REPO_ROOT).as_posix()}", file=sys.stderr)
            stale = True

        recorded = read_lock(LOCK)
        expected = {"svg": digest(svg_bytes), "ico": digest(payload)}
        for name, path in (("svg", SOURCE), ("ico", TARGET)):
            if recorded[name] != expected[name]:
                print(f"{path.name} does not match the digest recorded in {LOCK.name}: "
                      f"recorded {recorded[name][:12]}, actual {expected[name][:12]}", file=sys.stderr)
                stale = True

        if stale:
            print(f"run `python {Path(__file__).name}` to rebuild the pair", file=sys.stderr)
            return 1

        print(f"{TARGET.name} and {SOURCE.relative_to(REPO_ROOT).as_posix()} match the recorded pair "
              f"built from a fresh render")
        return 0

    TARGET.write_bytes(payload)
    LOCK.write_text(lock_text(svg_bytes, payload), encoding="utf-8", newline="\n")
    print(f"{TARGET.name}: {len(payload)} bytes, {len(frames)} frames "
          f"({', '.join(str(size) for size in sorted(frames))}) from "
          f"{SOURCE.relative_to(REPO_ROOT).as_posix()}")
    print(f"{LOCK.name}: svg {digest(svg_bytes)[:12]}, ico {digest(payload)[:12]}")

    if "--preview" in argv:
        directory = Path(argv[argv.index("--preview") + 1])
        directory.mkdir(parents=True, exist_ok=True)
        for size, image in frames.items():
            image.save(directory / f"frame-{size}.png")
        contact_sheet(frames, directory / "contact-sheet.png")
        readme_header(frames[256], directory / "readme-header.png")
        print(f"preview frames, contact-sheet.png and readme-header.png written to {directory}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
