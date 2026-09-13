# -*- coding: utf-8 -*-
"""rebuild_registry.py — пересборка objects/objects_data.js из PNG на диске.

Редактор берёт текстуры объектов из data-URL внутри objects_data.js, поэтому
правки PNG-файлов вручную (Photoshop/Aseprite/…) до пересборки в редакторе не
видны. Скрипт перечитывает каждый PNG из images/objects/, кодирует его заново
(WebP lossless — как в scripts/cut_objects.py) и переписывает реестр, сохраняя
метаданные (ru/group/cells/weight/pass) из старого файла. Ничего на диске,
кроме objects_data.js, не меняет.

Запуск:  python rebuild_registry.py [--check] [--prune]
         --check — только показать, что изменилось, без записи файла.
         --prune — вычеркнуть из реестра объекты, чей PNG удалён с диска
         (без флага такие записи сохраняются со старым data-URL).
"""
import base64
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "objects")
REG = os.path.join(OUT, "objects_data.js")


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


def main():
    check_only = "--check" in sys.argv
    prune = "--prune" in sys.argv
    tileSize, densityDefault, items = load_registry(REG)
    changed, kept, missing, resized = [], [], [], []

    for it in items:
        png = os.path.join(OUT, it["file"])
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

    lines = ["// Автосгенерировано: scripts/cut_objects.py, пересборка из PNG — images/rebuild_registry.py.",
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


if __name__ == "__main__":
    main()
