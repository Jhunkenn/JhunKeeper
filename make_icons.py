from PIL import Image, ImageDraw
import math

SLATE = (27, 36, 48, 255)     # #1b2430
INDIGO = (61, 82, 213, 255)   # #3d52d5
WHITE = (255, 255, 255, 255)

def rounded_rect_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def draw_clock(img, cx, cy, R, ring_w):
    d = ImageDraw.Draw(img)
    # clock ring (white)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=WHITE, width=ring_w)
    # hands (indigo), rounded caps via line width
    def hand(angle_deg, length, w):
        a = math.radians(angle_deg - 90)  # 0deg = up
        x = cx + length * math.cos(a)
        y = cy + length * math.sin(a)
        d.line([cx, cy, x, y], fill=INDIGO, width=w)
        # rounded end cap
        r = w / 2
        d.ellipse([x - r, y - r, x + r, y + r], fill=INDIGO)
    hand(305, R * 0.50, max(2, int(R * 0.11)))  # hour hand
    hand(40, R * 0.72, max(2, int(R * 0.09)))   # minute hand
    # center pivot
    pr = int(R * 0.09)
    d.ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill=WHITE)

def make(size, *, maskable=False, apple=False, fname):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if maskable or apple:
        # full-bleed background (launcher / iOS applies its own mask)
        bg = Image.new("RGBA", (size, size), SLATE)
        img.paste(bg, (0, 0))
        R = int(size * (0.24 if maskable else 0.30))
    else:
        # app-tile look: rounded square
        bg = Image.new("RGBA", (size, size), SLATE)
        mask = rounded_rect_mask(size, int(size * 0.22))
        img.paste(bg, (0, 0), mask)
        R = int(size * 0.30)
    ring_w = max(2, int(size * 0.05))
    draw_clock(img, size // 2, size // 2, R, ring_w)
    img.save(f"public/{fname}")
    print("wrote", fname, size)

make(192, fname="pwa-192x192.png")
make(512, fname="pwa-512x512.png")
make(512, maskable=True, fname="maskable-512x512.png")
make(180, apple=True, fname="apple-touch-icon-180x180.png")
make(32, fname="favicon-32x32.png")
