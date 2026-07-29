from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    ROOT / "tools" / "source-assets" / "emotion-pack-sheet-1-alpha.png",
    ROOT / "tools" / "source-assets" / "emotion-pack-sheet-2-alpha.png",
]
OUTPUT = ROOT / "src" / "assets" / "stickers" / "static"


def occupied_bands(alpha: Image.Image, axis: str) -> list[tuple[int, int]]:
    size = alpha.width if axis == "x" else alpha.height
    occupied = []
    for position in range(size):
        line = alpha.crop((position, 0, position + 1, alpha.height)) if axis == "x" else alpha.crop((0, position, alpha.width, position + 1))
        occupied.append(line.getbbox() is not None)
    bands = []
    start = None
    for position, present in enumerate(occupied + [False]):
        if present and start is None:
            start = position
        elif not present and start is not None:
            bands.append((start, position - 1))
            start = None
    merged = []
    for band in bands:
        if merged and band[0] - merged[-1][1] <= 3:
            merged[-1] = (merged[-1][0], band[1])
        else:
            merged.append(band)
    if len(merged) != 5:
        raise RuntimeError(f"Expected five {axis}-axis sticker bands, found {merged}")
    return merged


def band_boundaries(bands: list[tuple[int, int]], size: int) -> list[int]:
    return [0, *[(bands[index][1] + bands[index + 1][0]) // 2 for index in range(4)], size]


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for sheet_index, source in enumerate(SOURCES):
        sheet = Image.open(source).convert("RGBA")
        columns = [round(sheet.width * index / 5) for index in range(6)]
        rows = [round(sheet.height * index / 5) for index in range(6)]
        for local_index in range(25):
            column, row = local_index % 5, local_index // 5
            cell = sheet.crop((columns[column], rows[row], columns[column + 1], rows[row + 1]))
            alpha_box = cell.getchannel("A").getbbox()
            if not alpha_box:
                raise RuntimeError(f"Sticker cell {sheet_index}:{local_index} is empty")
            subject = cell.crop(alpha_box)
            subject.thumbnail((146, 146), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
            canvas.alpha_composite(subject, ((160 - subject.width) // 2, (160 - subject.height) // 2))
            index = sheet_index * 25 + local_index
            canvas.save(OUTPUT / f"mc-{index:02}.png", optimize=True)


if __name__ == "__main__":
    main()
