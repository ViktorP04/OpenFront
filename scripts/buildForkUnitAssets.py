"""Append fork assets without shifting upstream atlas columns. Requires Pillow.
Run: python scripts/buildForkUnitAssets.py
"""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[1]
units_path = root / "resources/atlases/unit-atlas.png"
icons_path = root / "resources/atlases/icon-atlas.png"
old_units = Image.open(units_path).convert("RGBA")
old_icons = Image.open(icons_path).convert("RGBA")
assert old_units.height == 13 and old_units.width >= 156, "Review upstream unit columns"
assert old_icons.height == 64 and old_icons.width >= 384, "Review upstream icon columns"
sprite = Image.new("RGBA", (11, 11))
pixels = ImageDraw.Draw(sprite)
rows = ["...........", ".....x.....", ".....xxx...", "...xxxx....", ".xxxxxxxxx.", "xxxxxxxxxxx", ".xxxxxxxxx.", "..xxxxxxx..", "....xxx....", "...........", "..........."]
for y, row in enumerate(rows):
    gray = 70 if y < 4 else 180 if y < 6 else 130
    for x, value in enumerate(row):
        if value == "x": pixels.point((x, y), fill=(gray, gray, gray, 255))
sprite.save(root / "resources/sprites/submarine.png")
units = Image.new("RGBA", (169, 13))
units.paste(old_units.crop((0, 0, 156, 13)), (0, 0))
units.paste(sprite, (157, 1))
units.save(units_path)
# Rasterize the same battery silhouette as CoastalBatteryIcon.svg at 4x resolution.
battery = Image.new("RGBA", (256, 256))
d = ImageDraw.Draw(battery)
for polygon in [[(27,23),(58,10),(62,19),(31,33)], [(15,28),(41,28),(49,43),(7,43)], [(6,46),(50,46),(50,53),(6,53)], [(18,22),(37,22),(37,38),(18,38)]]:
    d.polygon([(x*4,y*4) for x,y in polygon], fill="white")
d.line([(x*4, y*4) for x,y in [(3,59),(8,56),(14,62),(21,59),(26,56),(32,62),(39,59),(44,56),(50,62),(61,59)]], fill="white", width=16)
battery = battery.resize((56, 56), Image.Resampling.LANCZOS)
icons = Image.new("RGBA", (448, 64))
icons.paste(old_icons.crop((0, 0, 384, 64)), (0, 0))
icons.paste(battery, (388, 4))
icons.save(icons_path)
