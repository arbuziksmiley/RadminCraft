"""Normalize visual scale of the bundled transparent avatar heads.

The source images contain differently sized transparent margins and, for a few
heads, a faint detached floor shadow. Using the full alpha box made those heads
look much smaller in the UI. This script measures the opaque subject, keeps a
small safety margin, then centres it on the original 256x256 canvas.
"""
from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
AVATARS = ROOT / "src" / "assets" / "avatars"
CANVAS = 256
SUBJECT = 218
OPAQUE_THRESHOLD = 96
MARGIN = 5


def normalize(path: Path) -> None:
    image = Image.open(path).convert("RGBA")
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value >= OPAQUE_THRESHOLD else 0)
    box = mask.getbbox()
    if not box:
        return

    left, top, right, bottom = box
    left = max(0, left - MARGIN)
    top = max(0, top - MARGIN)
    right = min(image.width, right + MARGIN)
    bottom = min(image.height, bottom + MARGIN)
    subject = image.crop((left, top, right, bottom))
    subject.thumbnail((SUBJECT, SUBJECT), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - subject.width) // 2
    y = (CANVAS - subject.height) // 2
    canvas.alpha_composite(subject, (x, y))
    canvas.save(path, optimize=True)


def main() -> None:
    paths = sorted(AVATARS.glob("head-*.png"))
    if len(paths) != 150:
        raise SystemExit(f"Expected 150 heads, found {len(paths)}")
    for path in paths:
        normalize(path)
    print(f"Normalized {len(paths)} avatar heads.")


if __name__ == "__main__":
    main()
