#!/usr/bin/env python3
"""Generate build/icon.png — the app icon: Array's gunmetal plate, a heavy ring with
one open slot, and the withdrawn segment pulled out of that slot like a book
from a shelf (variant P3: slot at the four-o'clock position).

Drawn on Apple's icon grid: the squircle sits inset on the 1024 canvas
(the Big Sur+ template, ~10% margin) — a full-bleed rounded rect is what
reads as a grey border against the Dock. Supersampled 4x and Lanczos-
downscaled for clean edges. Run: npm run icon

Geometry lives in mockup units (a 200x200 viewBox, plate 18..182) and is
scaled onto the Apple grid, so this file stays in lockstep with the HTML
mockups (/tmp/index-logo-mockups*.html).
"""

from PIL import Image, ImageDraw
import math

S = 1024  # macOS wants 1024x1024
SS = 4    # supersample factor
# Apple grid: squircle ~82.4% of the canvas, centered.
PLATE = int(824 * SS)
MARGIN = (S * SS - PLATE) // 2

GREY = (58, 65, 72, 255)     # the plate — Array's gunmetal squircle, #3a4148
RING = (191, 233, 245, 255)  # Array's ice ring, #bfe9f5

# --- mockup geometry (200-unit viewBox; plate spans 18..182) -------------
R = 44.0        # ring centreline radius
HALF = 8.0      # band half-thickness at the top
RING_TAPER = 1.0  # extra half-thickness swelling toward the base
SLOT = 28.0     # half-angle of the open slot, deg
PIECE_HALF = 21.0  # half-angle of the withdrawn segment, deg
LIFT = 18.0     # radial withdrawal, mockup px
SPINE = 4.0     # free-end swell of the segment
TILT = 120.0    # whole composition, deg clockwise from 12 o'clock

SCALE = PLATE / 164.0  # mockup plate (164) → Apple plate (824·SS)

img = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

d.rounded_rectangle(
    [MARGIN, MARGIN, MARGIN + PLATE, MARGIN + PLATE],
    radius=int(PLATE * 0.225), fill=GREY,
)

C = S * SS / 2  # center


def band_w(a_deg):
    """Band half-thickness at angle a (deg from 12 o'clock): swells toward
    the base (180°)."""
    return HALF + RING_TAPER * (0.5 - 0.5 * math.cos(math.radians(a)))


def mock_pt(a_deg, r):
    """Polar (deg from 12 o'clock, mockup radius) → mockup viewBox xy."""
    a = math.radians(a_deg - 90)
    return (100 + math.cos(a) * r, 100 + math.sin(a) * r)


def polygon(mockup_pts, color):
    """Rotate mockup points by TILT, then scale onto the canvas."""
    t = math.radians(TILT)
    pts = []
    for x, y in mockup_pts:
        x, y = x - 100, y - 100
        rx = x * math.cos(t) - y * math.sin(t)
        ry = x * math.sin(t) + y * math.cos(t)
        pts.append((C + rx * SCALE, C + ry * SCALE))
    d.polygon(pts, fill=color)


# The band: one arc with the slot left open at 12 o'clock, drawn as a filled
# polygon so its width can taper. Runs clockwise from the slot's right edge
# to its left edge.
steps = 64
out_pts, inn_pts = [], []
for i in range(steps + 1):
    a = SLOT + (360 - 2 * SLOT) * i / steps
    w = band_w(a)
    out_pts.append(mock_pt(a, R + w))
    inn_pts.append(mock_pt(a, R - w))
polygon(out_pts + inn_pts[::-1], RING)

# The withdrawn segment: an arc piece of the band's own thickness, lifted
# radially out of the slot, its outer edge swelling at the free end.
out_pts, inn_pts = [], []
for i in range(steps + 1):
    t = i / steps
    a = -PIECE_HALF + 2 * PIECE_HALF * t
    co = (math.cos((a / PIECE_HALF) * math.pi / 2) + 1) / 2
    w_out = band_w(a) + SPINE * co * co
    w_in = band_w(a)
    out_pts.append(mock_pt(a, R + w_out + LIFT))
    inn_pts.append(mock_pt(a, R - w_in + LIFT))
polygon(out_pts + inn_pts[::-1], RING)

img = img.resize((S, S), Image.LANCZOS)
img.save("build/icon.png")
print("wrote build/icon.png")