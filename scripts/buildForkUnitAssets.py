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
units = Image.new("RGBA", (182, 13))
units.paste(old_units.crop((0, 0, 156, 13)), (0, 0))
units.paste(sprite, (157, 1))
satellite = Image.new("RGBA", (11, 11))
sd = ImageDraw.Draw(satellite)
sd.rectangle((0, 3, 3, 7), fill=(70,70,70,255))
sd.rectangle((7, 3, 10, 7), fill=(70,70,70,255))
sd.line((1,5,9,5), fill=(180,180,180,255))
sd.rectangle((4, 2, 6, 8), fill=(180,180,180,255))
sd.line((5,0,5,10), fill=(130,130,130,255))
satellite.save(root / "resources/sprites/satellite.png")
units.paste(satellite, (170, 1))
units.save(units_path)
# Rasterize the same battery silhouette as CoastalBatteryIcon.svg at 4x resolution.
battery = Image.new("RGBA", (256, 256))
d = ImageDraw.Draw(battery)
for polygon in [[(27,23),(58,10),(62,19),(31,33)], [(15,28),(41,28),(49,43),(7,43)], [(6,46),(50,46),(50,53),(6,53)], [(18,22),(37,22),(37,38),(18,38)]]:
    d.polygon([(x*4,y*4) for x,y in polygon], fill="white")
d.line([(x*4, y*4) for x,y in [(3,59),(8,56),(14,62),(21,59),(26,56),(32,62),(39,59),(44,56),(50,62),(61,59)]], fill="white", width=16)
battery = battery.resize((56, 56), Image.Resampling.LANCZOS)
radar = Image.new("RGBA", (256, 256))
r = ImageDraw.Draw(radar)
r.arc((24, 0, 232, 208), 10, 170, fill="white", width=20)
r.line((128, 104, 200, 28), fill="white", width=16)
r.ellipse((116, 92, 140, 116), fill="white")
r.line((128, 128, 128, 212), fill="white", width=20)
r.polygon([(80, 228), (128, 176), (176, 228)], fill="white")
r.rectangle((40, 224, 216, 244), fill="white")
radar = radar.resize((56, 56), Image.Resampling.LANCZOS)
sat_icon = Image.new("RGBA", (224,224))
si = ImageDraw.Draw(sat_icon)
si.polygon([(80,60),(124,32),(158,88),(114,116)], fill="white")
si.polygon([(8,112),(60,80),(86,122),(34,154)], fill="white")
si.polygon([(150,24),(198,0),(222,42),(176,70)], fill="white")
si.line([(58,134),(108,104),(168,64)], fill="white", width=12)
si.arc((48,112,180,220), 15, 165, fill="white", width=10)
sat_icon = sat_icon.resize((56,56), Image.Resampling.LANCZOS)
icons = Image.new("RGBA", (576, 64))
icons.paste(old_icons.crop((0, 0, 384, 64)), (0, 0))
icons.paste(battery, (388, 4))
icons.paste(radar, (452, 4))
icons.paste(sat_icon, (516,4))
icons.save(icons_path)
