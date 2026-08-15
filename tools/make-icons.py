#!/usr/bin/env python3
"""
Génère les icônes PWA et les écrans de lancement iOS de WindStats.

Aucune dépendance externe : le PNG est encodé à la main (zlib + struct) et les
formes sont rasterisées via des fonctions de distance signée (anti-aliasing
analytique).

    python3 tools/make-icons.py

Sorties : icons/*.png, icons/favicon.svg, icons/splash/*.png
"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")
SPLASH = os.path.join(ICONS, "splash")

# ── Palette (alignée sur les variables CSS du dashboard) ──────────────
ACCENT = (56, 189, 248)    # --accent  #38bdf8
ORANGE = (251, 146, 60)    # rentrée   #fb923c
BG_TOP = (22, 29, 46)      # dégradé haut
BG_BOT = (9, 12, 18)       # --bg      #090c12


# ── Géométrie du logo (repère unitaire, y vers le bas) ────────────────

def _arc_segments(cx, cy, radius, a0, a1, r, steps=14):
    """Approxime un arc par une chaîne de capsules."""
    caps = []
    prev = None
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        p = (cx + radius * math.cos(a), cy + radius * math.sin(a))
        if prev is not None:
            caps.append((prev[0], prev[1], p[0], p[1], r))
        prev = p
    return caps


R = 0.042  # demi-épaisseur des traits

# Trois rafales : la première et la dernière se terminent par une volute.
GROUPS = [
    (ACCENT, 0.85, [(0.22, 0.32, 0.63, 0.32, R)]
                   + _arc_segments(0.63, 0.21, 0.11, 90, -160, R)),
    (ACCENT, 1.00, [(0.19, 0.50, 0.81, 0.50, R)]),
    (ORANGE, 0.95, [(0.26, 0.68, 0.62, 0.68, R)]
                   + _arc_segments(0.62, 0.79, 0.11, -90, 160, R)),
]


def _sd_capsule(px, py, ax, ay, bx, by, r):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    ll = vx * vx + vy * vy
    t = (wx * vx + wy * vy) / ll if ll else 0.0
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    dx, dy = wx - t * vx, wy - t * vy
    return math.sqrt(dx * dx + dy * dy) - r


def _mark_pixel(u, v, ppu, base):
    """Compose les traits du logo au point unitaire (u, v) sur `base`."""
    out = base
    for color, alpha, caps in GROUPS:
        d = min(_sd_capsule(u, v, *c) for c in caps)
        cov = 0.5 - d * ppu
        if cov <= 0.0:
            continue
        a = alpha * (1.0 if cov >= 1.0 else cov)
        out = (
            int(out[0] + (color[0] - out[0]) * a),
            int(out[1] + (color[1] - out[1]) * a),
            int(out[2] + (color[2] - out[2]) * a),
        )
    return out


# ── Encodage PNG ──────────────────────────────────────────────────────

def _write_png(path, width, height, rows):
    raw = bytearray()
    for row in rows:
        raw.append(0)          # filtre "None"
        raw += row

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


# ── Rendus ────────────────────────────────────────────────────────────

def render_icon(path, size, content=0.82, glow=True):
    """Icône carrée pleine page : dégradé + volutes centrées."""
    ppu = size * content
    rows = []
    for y in range(size):
        ty = y / (size - 1)
        # dégradé vertical
        bg = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * ty) for i in range(3))
        row = bytearray()
        for x in range(size):
            tx = x / (size - 1)
            base = bg
            if glow:
                # halo accent en haut à gauche
                g = max(0.0, 1.0 - math.hypot(tx - 0.30, ty - 0.18) * 1.7) ** 2 * 0.22
                base = tuple(int(base[i] + (ACCENT[i] - base[i]) * g) for i in range(3))
            u = (tx - 0.5) / content + 0.5
            v = (ty - 0.5) / content + 0.5
            row += bytes(_mark_pixel(u, v, ppu, base))
        rows.append(row)
    return _write_png(path, size, size, rows)


def render_splash(path, width, height):
    """Écran de lancement iOS : fond plat + logo centré."""
    bg = bytes(BG_BOT)
    flat = bg * width

    side = int(min(width, height) * 0.34)
    side -= side % 2
    x0 = (width - side) // 2
    y0 = (height - side) // 2
    ppu = side

    rows = []
    for y in range(height):
        if y < y0 or y >= y0 + side:
            rows.append(flat)
            continue
        v = (y - y0) / (side - 1)
        mid = bytearray()
        for x in range(side):
            u = x / (side - 1)
            mid += bytes(_mark_pixel(u, v, ppu, BG_BOT))
        rows.append(bg * x0 + bytes(mid) + bg * (width - x0 - side))
    return _write_png(path, width, height, rows)


FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#0f1420"/>
  <g fill="none" stroke-linecap="round" stroke-width="10.4">
    <path d="M17 35.5H63" stroke="#38bdf8" opacity=".85"/>
    <path d="M14 52h64a8.5 8.5 0 1 0-8.5-8.5" stroke="#38bdf8"/>
    <path d="M22 68.5H55" stroke="#fb923c" opacity=".95"/>
  </g>
</svg>
"""

# Écrans de lancement iOS (largeur x hauteur en pixels physiques).
SPLASHES = [
    (1488, 2266), (2266, 1488),   # iPad mini 8.3"
    (1620, 2160), (2160, 1620),   # iPad 10.2"
    (1640, 2360), (2360, 1640),   # iPad Air / Pro 11"
    (2048, 2732), (2732, 2048),   # iPad Pro 12.9"
]


def main():
    os.makedirs(ICONS, exist_ok=True)
    total = 0
    for name, size, content in [
        ("icon-192.png", 192, 0.82),
        ("icon-512.png", 512, 0.82),
        ("icon-maskable-512.png", 512, 0.58),
        ("apple-touch-icon.png", 180, 0.82),
    ]:
        n = render_icon(os.path.join(ICONS, name), size, content)
        total += n
        print(f"  icons/{name:<24} {size}x{size:<5} {n/1024:6.1f} KB")

    with open(os.path.join(ICONS, "favicon.svg"), "w") as f:
        f.write(FAVICON_SVG)
    print(f"  icons/favicon.svg")

    for w, h in SPLASHES:
        name = f"splash-{w}x{h}.png"
        n = render_splash(os.path.join(SPLASH, name), w, h)
        total += n
        print(f"  icons/splash/{name:<21} {n/1024:6.1f} KB")

    print(f"\n  total {total/1024:.1f} KB")


if __name__ == "__main__":
    main()
