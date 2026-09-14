# -*- coding: utf-8 -*-
"""make_embedded_assets.py — вшитые ассеты игры для запуска с file://.

Картинка с диска на file://-странице — чужой origin: WebGL/WebGPU отказывается
грузить её в GPU (см. фикс редактора, коммит dac9e44), а fetch/XHR до файла
вообще запрещён. Поэтому для file://-режима ассеты вшиты data-URL в
scripts/embedded_assets.js (глобаль EMBEDDED_GAME_ASSETS). По http игра грузит
живые файлы — вшитая копия не используется.

ПЕРЕГЕНЕРАЦИЯ при изменении ассетов:  python scripts/make_embedded_assets.py
"""
import base64
import io
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.normpath(os.path.join(HERE, ".."))

TILES = ["grass_dirt.png", "grass_water.png", "snow_dirt.png", "sand_dirt.png"]


def png_data_url(path):
    with open(path, "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode()


def webp_data_url(path):
    im = Image.open(path).convert("RGBA")
    buf = io.BytesIO()
    im.save(buf, "WEBP", lossless=True)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


tiles = {name: png_data_url(os.path.join(ENGINE, "images", "tiles", name)) for name in TILES}
wolf_png = webp_data_url(os.path.join(ENGINE, "images", "sprites", "wolf_128.png"))
with open(os.path.join(ENGINE, "images", "sprites", "wolf_128.json"), encoding="utf-8") as fh:
    wolf_manifest = json.load(fh)

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
out.write("};\n")

dst = os.path.join(HERE, "embedded_assets.js")
with io.open(dst, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(out.getvalue())
print(f"written {dst} ({os.path.getsize(dst) // 1024} КБ)")
