from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "source-assets" / "app-icon-option-4.png"
PNG_OUTPUT = ROOT / "src" / "assets" / "app-icon.png"
ICO_OUTPUT = ROOT / "electron" / "app-icon.ico"


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    alpha_box = image.getchannel("A").getbbox()
    if not alpha_box:
        raise RuntimeError("Selected icon is empty")
    subject = image.crop(alpha_box)
    subject.thumbnail((940, 940), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    canvas.alpha_composite(subject, ((1024 - subject.width) // 2, (1024 - subject.height) // 2))
    canvas.save(PNG_OUTPUT, optimize=True)
    canvas.save(ICO_OUTPUT, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main()
