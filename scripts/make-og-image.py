"""Generate the default Open Graph / social card (1200x630) for the SEO pages.

Pure PIL plus fonts that are already in the repo, so it runs anywhere:
    python scripts/make-og-image.py
Writes public/images/og-default.png (referenced by seo/site.config.json - path unchanged).

The card mirrors the site header: the brand mark (public/favicon-512.png, rasterised from
public/images/favicon.svg by `node scripts/make-favicons.mjs`) next to the `MusePDF` wordmark, on the
site's own palette (white -> #E7F1FF band, ink #272E62, primary #006DFF). The tool count is read from
seo/pages.manifest.json so the card cannot go stale the way a hard-coded number would.
"""
import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "images" / "og-default.png"
MARK = ROOT / "public" / "favicon-512.png"
W, H = 1200, 630

INK = (39, 46, 98)          # --hp-ink-strong
PRIMARY = (0, 109, 255)     # --hp-primary
MUTED = (74, 85, 120)
BAND = (231, 241, 255)      # --hp-band
RULE = (196, 216, 255)

NOTO = ROOT / "public" / "fonts" / "NotoSans-Regular.ttf"
FALLBACKS = [pathlib.Path("C:/Windows/Fonts/segoeui.ttf"),
             pathlib.Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")]


def font(size: int):
    """Noto Sans (shipped in the repo) - the same family the site falls back to for Latin."""
    for path in [NOTO, *FALLBACKS]:
        try:
            return ImageFont.truetype(str(path), size)
        except OSError:
            continue
    return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def bold(draw, xy, text, size, fill, anchor="la", weight=0.035):
    """Noto Sans ships regular-only here, so weight is synthesised with a same-colour stroke."""
    draw.text(xy, text, font=font(size), fill=fill, anchor=anchor,
              stroke_width=max(1, round(size * weight)), stroke_fill=fill)


def tool_count() -> int:
    data = json.loads((ROOT / "seo" / "pages.manifest.json").read_text(encoding="utf-8"))
    return len([k for k in data["inputs"] if k not in ("main", "app")])


def main() -> None:
    if not MARK.exists():
        sys.exit(f"missing {MARK} - run `node scripts/make-favicons.mjs` first")

    n = tool_count()
    img = Image.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    top, bottom = (255, 255, 255), BAND
    for y in range(H):
        draw.line([(0, y), (W, y)], fill=lerp(top, bottom, y / H))

    # soft primary glow in the top-left, behind the lockup
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-200, -260, 640, 380], fill=(150, 196, 255))
    img = Image.blend(img, Image.blend(img, glow, 0.5), 0.35)
    draw = ImageDraw.Draw(img)

    # brand lockup: the mark next to the wordmark, exactly as the header draws it
    mark = Image.open(MARK).convert("RGBA").resize((132, 132), Image.LANCZOS)
    img.paste(mark, (84, 82), mark)
    bold(draw, (236, 150), "MusePDF", 58, INK, anchor="lm", weight=0.03)

    bold(draw, (84, 258), f"{n} free PDF tools", 76, INK, weight=0.03)
    draw.text((84, 356), "that run in your browser", font=font(52), fill=PRIMARY)
    draw.text((84, 442), "Merge / Split / Compress / Sign / Convert / Edit / Protect",
              font=font(30), fill=MUTED)
    bold(draw, (84, 498), "No upload. No signup. No watermark.", 30, PRIMARY, weight=0.03)

    draw.line([(84, 566), (1116, 566)], fill=RULE, width=2)
    bold(draw, (84, 580), "MusePDF", 26, INK, anchor="la", weight=0.03)
    draw.text((1116, 580), "100% client-side", font=font(26), fill=MUTED, anchor="ra")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, format="PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {W}x{H}, {n} tools)")


if __name__ == "__main__":
    main()
