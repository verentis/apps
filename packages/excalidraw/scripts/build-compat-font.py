"""Convert the official OFL 2.1.5 TTF, retaining glyphs/metrics and renaming reserved names."""
import sys
from fontTools.ttLib import TTFont

font = TTFont(sys.argv[1])
names = {
    1: "Verentis Sans",
    2: "Regular",
    3: "Verentis Sans 2.1.5",
    4: "Verentis Sans Regular",
    6: "VerentisSans-Regular",
    16: "Verentis Sans",
    17: "Regular",
}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.flavor = "woff2"
font.save("vendor/fonts/VerentisSans-Regular.woff2")
