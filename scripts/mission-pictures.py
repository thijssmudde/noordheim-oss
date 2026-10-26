"""Launcher mission-card pictures: the tactical renders widened onto blurred snow.

    python3 scripts/mission-pictures.py

Writes public/art/interface/mission-standard.webp (a harvester unloading at a
refinery) and mission-megawealth.webp (a derrick), 400x192 each.
"""
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "public/art/tactical"
OUT = ROOT / "public/art/interface"
FEATHER = 40


def widen(im, w=400, h=192):
    """Centre the render on a blurred, stretched copy of itself, edges feathered."""
    scaled = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    top = (scaled.height - h) // 2
    backdrop = scaled.crop((0, top, w, top + h)).filter(ImageFilter.GaussianBlur(18))
    mask = Image.new("L", im.size, 255)
    for x in range(FEATHER):
        level = round(255 * x / FEATHER)
        for col in (x, im.width - 1 - x):
            mask.paste(level, (col, 0, col + 1, im.height))
    backdrop.paste(im, ((w - im.width) // 2, 0), mask)
    return backdrop.convert("RGB")


refinery = Image.open(ART / "refinery.png").convert("RGBA")
harvester = Image.open(ART / "harvester.png").convert("RGBA").resize((128, 96), Image.LANCZOS)
refinery.alpha_composite(harvester, (2, 92))
widen(refinery).save(OUT / "mission-standard.webp", quality=90)

derrick = Image.open(ART / "sites/derrick.png").convert("RGBA")
widen(derrick).save(OUT / "mission-megawealth.webp", quality=90)
