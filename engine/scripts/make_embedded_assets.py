# -*- coding: utf-8 -*-
"""make_embedded_assets.py — вшитые ассеты игры для запуска с file://.

Картинка с диска на file://-странице — чужой origin: WebGL/WebGPU отказывается
грузить её в GPU (см. фикс редактора, коммит dac9e44), а fetch/XHR до файла
вообще запрещён. Поэтому для file://-режима ассеты вшиты data-URL в
scripts/embedded_assets.js (глобаль EMBEDDED_GAME_ASSETS). По http игра грузит
живые файлы — вшитая копия не используется.

Обычно запускается НЕ напрямую, а из images/rebuild_registry.py — единого
пересборщика всех запечённых ассетов. Прямой запуск тоже работает:
  python scripts/make_embedded_assets.py
"""
import base64
import io
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.normpath(os.path.join(HERE, ".."))
DST = os.path.join(HERE, "embedded_assets.js")

TILES = ["grass_dirt.png", "grass_water.png", "snow_dirt.png", "sand_dirt.png"]
WOLF_PNG = os.path.join(ENGINE, "images", "sprites", "wolf_64.png")
WOLF_JSON = os.path.join(ENGINE, "images", "sprites", "wolf_64.json")
SPRITES_DIR = os.path.join(ENGINE, "images", "sprites")


def collect_chars():
    """Все персонажи images/sprites (пары <база>.png + <база>.json), кроме волка —
    он живёт в отдельном поле wolf для обратной совместимости."""
    chars = {}
    for fn in sorted(os.listdir(SPRITES_DIR)):
        if not fn.endswith(".png"):
            continue
        base = fn[:-4]
        if base == "wolf_64":
            continue
        json_path = os.path.join(SPRITES_DIR, base + ".json")
        if not os.path.isfile(json_path):
            continue
        with open(json_path, encoding="utf-8") as fh:
            chars[base] = {
                "png": webp_data_url(os.path.join(SPRITES_DIR, fn)),
                "manifest": json.load(fh),
            }
    return chars


def png_data_url(path):
    with open(path, "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode()


def webp_data_url(path):
    im = Image.open(path).convert("RGBA")
    buf = io.BytesIO()
    im.save(buf, "WEBP", lossless=True)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def build_embedded_js():
    """Собирает текст embedded_assets.js из текущих файлов images/."""
    tiles = {name: png_data_url(os.path.join(ENGINE, "images", "tiles", name))
             for name in TILES}
    wolf_png = webp_data_url(WOLF_PNG)
    with open(WOLF_JSON, encoding="utf-8") as fh:
        wolf_manifest = json.load(fh)
    chars = collect_chars()

    out = io.StringIO()
    out.write("// СГЕНЕРИРОВАНО scripts/make_embedded_assets.py — вручную не править.\n")
    out.write("// Вшитые ассеты игры для запуска с file:// (по http не используются).\n")
    out.write("globalThis.EMBEDDED_GAME_ASSETS = {\n")
    out.write("    tiles: {\n")
    for name in TILES:
        out.write(f'        "{name}": "{tiles[name]}",\n')
    out.write("    },\n")
    out.write("    wolf: {\n")
    out.write(f'        png: "{wolf_png}",\n')
    out.write("        manifest: " + json.dumps(wolf_manifest, ensure_ascii=False) + ",\n")
    out.write("    },\n")
    out.write("    chars: {\n")
    for base, ch in chars.items():
        out.write(f'        "{base}": {{\n')
        out.write(f'            png: "{ch["png"]}",\n')
        out.write("            manifest: " + json.dumps(ch["manifest"], ensure_ascii=False) + ",\n")
        out.write("        },\n")
    out.write("    },\n")
    out.write("};\n")
    return out.getvalue()


def main():
    js = build_embedded_js()
    with io.open(DST, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(js)
    print(f"written {DST} ({os.path.getsize(DST) // 1024} КБ)")


if __name__ == "__main__":
    main()
