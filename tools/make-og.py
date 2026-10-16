"""Render the static share assets in the site's style (Departure Mono, amber on charcoal).

    uv run python tools/make-og.py

Writes web/public/og.png (1200x630), apple-touch-icon.png (180) and icon-512.png.
Departure Mono is drawn on an 11px grid, so font sizes are multiples of 11.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web" / "public"
FONT = str(Path(__file__).parent / "fonts" / "departure-mono.otf")  # SIL OFL, see fonts/
GROUND, INK, SUBTLE, MUTED = "#222222", "#ffa132", "#b0732c", "#594128"
# Per-window enjoyment of a real judged track, so the strip looks like a real result.
WINDOWS = [7.6, 7.8, 7.5, 7.4, 7.3, 7.2, 7.5, 7.5, 7.4, 7.0, 6.9, 7.2, 7.5, 7.6, 7.3, 7.5, 7.3, 7.3, 7.2, 7.2, 7.3, 6.6]


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size)


def bars(draw: ImageDraw.ImageDraw, x: int, y: int, width: int, height: int) -> None:
    low, high = min(WINDOWS), max(WINDOWS)
    gap = 4
    bar = (width - gap * (len(WINDOWS) - 1)) / len(WINDOWS)
    for i, score in enumerate(WINDOWS):
        h = (0.2 + 0.8 * (score - low) / (high - low)) * height
        left = x + i * (bar + gap)
        draw.rectangle([left, y + height - h, left + bar, y + height], fill=INK if score == high else MUTED)


og = Image.new("RGB", (1200, 630), GROUND)
d = ImageDraw.Draw(og)
d.text((90, 90), "music.micr.dev", font=font(22), fill=MUTED)
d.text((90, 150), "aesthetics judge", font=font(88), fill=INK)
d.text((90, 270), "Meta's Audiobox Aesthetics model listens", font=font(33), fill=SUBTLE)
d.text((90, 314), "to a whole song and scores it.", font=font(33), fill=SUBTLE)
bars(d, 90, 430, 1020, 110)
og.save(OUT / "og.png", optimize=True)

for size, name in [(180, "apple-touch-icon.png"), (512, "icon-512.png")]:
    icon = Image.new("RGB", (size, size), GROUND)
    di = ImageDraw.Draw(icon)
    # Three bars, the tallest in full amber: the timeline strip as a mark.
    unit = size / 9
    for i, (h, color) in enumerate([(0.45, MUTED), (0.75, INK), (0.55, MUTED)]):
        left = unit * (2 + i * 2)
        di.rectangle([left, size - unit * 2 - h * size * 0.6, left + unit * 1.4, size - unit * 2], fill=color)
    icon.save(OUT / name, optimize=True)
print("ok")
