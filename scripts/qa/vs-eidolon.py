"""Side-by-side contact sheets: each Ofel screen next to the Eidolon screen it was forked from, at 1440 and 375.
Usage: python3 scripts/qa/vs-eidolon.py <ofel shots dir> <out dir>"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

EID = Path("/Volumes/Extreme SSD/Projects/grokbot/runs/total-recall/ui-v5/eidolon")
PAIRS = [
    ("desk", "trade-quoted"),
    ("desk-clears", "trade-rounds"),
    ("desk-balances", "trade-memories"),
    ("desk-signed-out", "trade-empty"),
    ("landing", "home"),
    ("batches", "leaderboard"),
    ("batch-detail", "round"),
    ("validators", "leaderboard"),
    ("portfolio", "trade-habits"),
    ("auditor", "trade-rounds"),
]


def load(p: Path, w: int, max_h: int):
    im = Image.open(p).convert("RGB")
    im = im.resize((w, round(im.height * w / im.width)))
    return im.crop((0, 0, w, min(im.height, max_h)))


def sheet(ofel: Path, eid: Path, out: Path, w: int, max_h: int, label: str):
    a, b = load(ofel, w, max_h), load(eid, w, max_h)
    pad, top = 24, 44
    W = Image.new("RGB", (w * 2 + pad * 3, max(a.height, b.height) + top + pad), "#e9e7e1")
    d = ImageDraw.Draw(W)
    d.text((pad, 14), f"Ofel · {label}", fill="#16131e")
    d.text((pad * 2 + w, 14), f"Eidolon (base) · {eid.stem}", fill="#16131e")
    W.paste(a, (pad, top))
    W.paste(b, (pad * 2 + w, top))
    W.save(out, quality=82)


def main():
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    for ours, theirs in PAIRS:
        for width, w, max_h in ((1440, 900, 1400), (375, 360, 2200)):
            a, b = src / f"{ours}-{width}.png", EID / f"{theirs}-{width}.png"
            if not (a.exists() and b.exists()):
                b = EID / f"{theirs}-1440.png" if not b.exists() else b
                if not (a.exists() and b.exists()):
                    continue
            sheet(a, b, dst / f"vs-{ours}-{width}.jpg", w, max_h, f"{ours} {width}")
            print("wrote", dst / f"vs-{ours}-{width}.jpg")


main()
