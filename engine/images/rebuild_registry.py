# -*- coding: utf-8 -*-
"""rebuild_registry.py — единый пересборщик ассетов, запечённых в код из images/.

Правишь PNG/JSON где-то в images/ — запусти этот скрипт: он проверит ВСЕ места,
куда файлы из images/ вшиты в код, и обновит только изменившиеся.

  1. images/objects/*.png
       → images/objects/objects_data.js — реестр объектов (данные читает
         редактор карт и движок; data-URL WebP lossless)
  2. images/tiles/*.png + images/sprites/wolf_64.png|.json
       → scripts/embedded_assets.js — ассеты игры для file://
         (генерирует scripts/make_embedded_assets.py)
  3. images/tiles/*.png
       → блок EMBEDDED_TILESETS в dualgrid_editor.html — тайлсеты по умолчанию
         в редакторе карт (PNG data-URL, байт-в-байт с файлами на диске)

Запуск:  python rebuild_registry.py [--check] [--noprune]
         --check — только показать, что изменилось, без записи файлов.
         --noprune — НЕ вычеркивать объекты, чей PNG удалён с диска
         (по умолчанию такие записи вычёркиваются из реестра).
"""
import base64
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "objects")
REG = os.path.join(OUT_DIR, "objects_data.js")
ENGINE = os.path.normpath(os.path.join(HERE, ".."))
EDITOR_HTML = os.path.join(ENGINE, "dualgrid_editor.html")
SCRIPTS = os.path.join(ENGINE, "scripts")


def data_url(path):
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    buf = io.BytesIO()
    im.save(buf, "WEBP", lossless=True)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode(), im.size


def load_registry(path):
    """Читает window.DUALGRID_OBJECTS: шапку — регэкспом, items — построчно."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    head = re.search(r"tileSize:\s*(\d+),\s*densityDefault:\s*(\d+)", text)
    tileSize = int(head.group(1)) if head else 32
    densityDefault = int(head.group(2)) if head else 12
    items = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith('{"name"'):
            items.append(json.loads(s.rstrip(",")))
    if not items:
        sys.exit(f"{path}: элементы реестра не найдены")
    return tileSize, densityDefault, items


def rebuild_registry(check_only, prune):
    """Шаг 1: objects_data.js из images/objects/*.png."""
    tileSize, densityDefault, items = load_registry(REG)
    changed, kept, missing, resized = [], [], [], []

    for it in items:
        png = os.path.join(OUT_DIR, it["file"])
        if not os.path.exists(png):
            missing.append(it["name"])
            continue
        url, (w, h) = data_url(png)
        if (w, h) != (it["w"], it["h"]):
            resized.append((it["name"], (it["w"], it["h"]), (w, h)))
        it["w"], it["h"] = w, h
        if url != it.get("png"):
            changed.append(it["name"])
            it["png"] = url
        else:
            kept.append(it["name"])

    if prune and missing:
        gone = set(missing)
        items = [it for it in items if it["name"] not in gone]

    print(f"реестр: {len(items)} объектов; совпадает: {len(kept)}, "
          f"обновлено из PNG: {len(changed)}, нет PNG: {len(missing)}")
    for n in changed:
        print("  обновлён:", n)
    for n in missing:
        if prune:
            print(("  будет вычеркнут (нет PNG): " if check_only
                   else "  вычеркнут (нет PNG): ") + n)
        else:
            print("  НЕТ PNG (оставлен старый data-URL):", n)
    for n, old, new in resized:
        print(f"  размер сменился у {n}: {old[0]}x{old[1]} -> {new[0]}x{new[1]} "
              f"— проверьте cellsX/cellsY и сетку проходимости!")
    if prune and missing:
        print("внимание: расстановки вычеркнутых имён в сохранённых картах "
              "станут ссылками на несуществующий объект")
    if not changed and not resized and not (prune and missing):
        print("изменений нет — objects_data.js уже соответствует PNG")
    if check_only or (not changed and not resized and not (prune and missing)):
        return

    lines = ["// Автосгенерировано скриптами вырезки (scripts/cut_sheet7.py, append-only),",
             "// пересборка из PNG — images/rebuild_registry.py.",
             "// Не править вручную: после правок PNG запускайте rebuild_registry.py.",
             "window.DUALGRID_OBJECTS = {",
             f"  tileSize: {tileSize}, densityDefault: {densityDefault},",
             "  items: ["]
    for it in items:
        lines.append("    " + json.dumps(it, ensure_ascii=False) + ",")
    lines.append("  ],\n};")
    with open(REG, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print(f"записан {REG} ({os.path.getsize(REG) // 1024} КБ, "
          f"объектов: {len(items)}); "
          f"перезагрузите редактор (Ctrl+F5, если браузер закэшировал)")


def sync_embedded_assets(check_only):
    """Шаг 2: scripts/embedded_assets.js из tiles/ + sprites/wolf_64 (игра на file://)."""
    sys.path.insert(0, SCRIPTS)
    import make_embedded_assets as mea
    fresh = mea.build_embedded_js()
    try:
        with open(mea.DST, encoding="utf-8") as fh:
            current = fh.read()
    except FileNotFoundError:
        current = None
    if current == fresh:
        print("embedded_assets.js: без изменений")
        return
    if check_only:
        print("embedded_assets.js: УСТАРЕЛ — запустите без --check для записи")
        return
    with io.open(mea.DST, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(fresh)
    print(f"embedded_assets.js: ОБНОВЛЁН ({os.path.getsize(mea.DST) // 1024} КБ) — "
          f"игра на file:// увидит новые ассеты после перезагрузки страницы")


def sync_editor_tilesets(check_only):
    """Шаг 3: EMBEDDED_TILESETS в dualgrid_editor.html из images/tiles/."""
    with open(EDITOR_HTML, encoding="utf-8") as fh:
        text = fh.read()
    block = re.search(r"const EMBEDDED_TILESETS = \{\n(.*?)\n\};", text, re.S)
    if not block:
        print("dualgrid_editor.html: блок EMBEDDED_TILESETS не найден — шаг пропущен")
        return
    names = re.findall(r'"([^"]+)":\s*"data:image/png;base64,', block.group(1))
    if not names:
        print("dualgrid_editor.html: в EMBEDDED_TILESETS нет тайлсетов — шаг пропущен")
        return
    sys.path.insert(0, SCRIPTS)
    from make_embedded_assets import png_data_url
    lines, changed = [], []
    for name in names:
        url = png_data_url(os.path.join(ENGINE, "images", "tiles", name))
        lines.append(f'    "{name}": "{url}",')
    fresh_block = "const EMBEDDED_TILESETS = {\n" + "\n".join(lines) + "\n};"
    if block.group(0) == fresh_block:
        print(f"dualgrid_editor.html: тайлсеты ({len(names)}) без изменений")
        return
    if check_only:
        print("dualgrid_editor.html: EMBEDDED_TILESETS УСТАРЕЛ — "
              "запустите без --check для записи")
        return
    with io.open(EDITOR_HTML, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text[:block.start()] + fresh_block + text[block.end():])
    print(f"dualgrid_editor.html: EMBEDDED_TILESETS ОБНОВЛЁН "
          f"({len(names)} тайлсетов) — перезагрузите редактор")


def main():
    check_only = "--check" in sys.argv
    prune = "--noprune" not in sys.argv
    rebuild_registry(check_only, prune)
    sync_embedded_assets(check_only)
    sync_editor_tilesets(check_only)


if __name__ == "__main__":
    main()
