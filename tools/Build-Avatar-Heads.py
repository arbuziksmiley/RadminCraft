from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "assets" / "avatars"


def cell_bounds(size: int, index: int) -> tuple[int, int]:
    return round(size * index / 5), round(size * (index + 1) / 5)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    sheets = [
        Image.open(ROOT / "tools" / "source-assets" / "avatar-sheet-1.png").convert("RGBA"),
        Image.open(ROOT / "tools" / "source-assets" / "avatar-sheet-2.png").convert("RGBA"),
    ]
    for index in range(50):
        sheet = sheets[index // 25]
        cell_index = index % 25
        column, row = cell_index % 5, cell_index // 5
        left, right = cell_bounds(sheet.width, column)
        top, bottom = cell_bounds(sheet.height, row)
        cell = sheet.crop((left, top, right, bottom))
        alpha_box = cell.getchannel("A").getbbox()
        if not alpha_box:
            raise RuntimeError(f"Avatar cell {index} is empty")
        subject = cell.crop(alpha_box)
        subject.thumbnail((236, 236), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        canvas.alpha_composite(subject, ((256 - subject.width) // 2, (256 - subject.height) // 2))
        canvas.save(OUTPUT / f"head-{index:03}.png", optimize=True)


if __name__ == "__main__":
    main()
