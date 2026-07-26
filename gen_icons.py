#!/usr/bin/env python3
"""Generate simple placeholder PNG icons for PromptVault without any
third-party image libraries (pure stdlib: zlib + struct).

Draws a rounded-square gradient background (indigo -> violet) with a
white "bookmark" glyph in the center, representing a saved snippet.
"""
import struct
import zlib
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(OUT_DIR, exist_ok=True)

def lerp(a, b, t):
    return a + (b - a) * t

def rounded_rect_mask(x, y, w, h, r):
    # returns True if point (x,y) is inside a rounded rect of size (w,h) radius r
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    dx = x - cx
    dy = y - cy
    return (dx * dx + dy * dy) <= r * r

def in_bookmark(x, y, size):
    # bookmark ribbon shape, coordinates normalized 0..1
    nx = x / size
    ny = y / size
    left, right = 0.32, 0.68
    top, bottom = 0.20, 0.82
    notch_y = 0.66
    if nx < left or nx > right or ny < top or ny > bottom:
        return False
    if ny <= notch_y:
        return True
    # below notch: triangular cut converging to a point at bottom center
    mid = (left + right) / 2
    # width shrinks linearly from notch_y to bottom
    t = (ny - notch_y) / (bottom - notch_y)
    half_width_at_notch = (right - left) / 2
    half_width = half_width_at_notch * (1 - t)
    return abs(nx - mid) <= half_width

def make_icon(size):
    pixels = bytearray()
    r = max(2, size // 5)
    c1 = (99, 102, 241)   # #6366F1 indigo
    c2 = (139, 92, 246)   # #8B5CF6 violet
    for y in range(size):
        row = bytearray()
        for x in range(size):
            if not rounded_rect_mask(x + 0.5, y + 0.5, size, size, r):
                row += bytes((0, 0, 0, 0))  # transparent outside rounded corners
                continue
            t = (x + y) / (2 * size)
            cr = int(lerp(c1[0], c2[0], t))
            cg = int(lerp(c1[1], c2[1], t))
            cb = int(lerp(c1[2], c2[2], t))
            if in_bookmark(x, y, size):
                # white glyph with subtle translucency near edges for AA-ish look
                cr, cg, cb = 255, 255, 255
            row += bytes((cr, cg, cb, 255))
        pixels += row
    return bytes(pixels)

def write_png(path, size, rgba_data):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0 (none)
        raw += rgba_data[y * stride:(y + 1) * stride]
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))

for size in (16, 48, 128):
    data = make_icon(size)
    write_png(os.path.join(OUT_DIR, f"icon{size}.png"), size, data)
    print(f"wrote icon{size}.png")
