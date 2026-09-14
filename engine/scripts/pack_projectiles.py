#!/usr/bin/env python3
# СБОРКА СНАРЯДОВ из сырых полос forWork/attacks/.
# Вход:  forWork/attacks/<атака>/<направление>.png — горизонтальная полоса
#        кадров; all.png = универсальная анимация для всех направлений,
#        front/back/left/right (+ у knife диагонали topleft/topright/downleft/
#        downright) — анимация конкретного направления. icon.png пропускается
#        (UI-иконка, не снаряд).
# Выход: images/projectiles/<атака>.png + .json — ОДИН лист на атаку, строка
#        листа = направление (формат манифеста как у персонажей: size, columns,
#        fps, animations[{name,row,frames}]) — грузится тем же assets.loadCharacter.
#
# Кадры сегментируются по прозрачным колонкам-разделителям (ширина кадра в
# полосах не постоянна даже внутри одной атаки: alebard 64x64 и 64x96).
# Клетка листа = max(ширина, высота) сегмента по ВСЕМ направлениям атаки,
# сегмент ставится по центру клетки (снаряд летит «ядром», а не ногами).
# Прогон пишет контакт-листы в tmp/forwork_preview/projectiles/.
import os
import sys
import json
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # engine/
SRC = os.path.join(os.path.dirname(ROOT), "forWork", "attacks")
OUT = os.path.join(ROOT, "images", "projectiles")
PREVIEW_DIR = os.path.join(os.path.dirname(ROOT), "tmp", "forwork_preview", "projectiles")
FPS = 8
# Порядок строк листа (у knife есть диагонали — добавляются в конец)
ROW_ORDER = ["all", "front", "back", "left", "right", "topleft", "topright", "downleft", "downright"]
# Ручные переопределения: "<атака>/<направление>": N — разделить полосу на N
# РАВНЫХ кадров, минуя сегментацию (кадры в полосе слиплись без прозрачных
# разделителей или сегментация нарезала осколки)
FRAME_COUNT_OVERRIDES = {
    "fireball/all": 4,
    "void/all": 4,
    "alebard/left": 4,
    "poison/left": 4,
    "sword/left": 4,
    "swordHound/left": 4,
    "spear/front": 3,
    "spear/back": 3,
    "dagger/right": 4,
    "dagger/left": 4,
}


def segment(strip):
    """Полоса → список кадров по прозрачным вертикальным разделителям (зазор ≥2px)."""
    w, h = strip.size
    px = strip.load()
    content = []
    for x in range(w):
        content.append(any(px[x, y][3] > 10 for y in range(h)))
    segs = []
    x = 0
    while x < w:
        if not content[x]:
            x += 1
            continue
        start = x
        gap = 0
        end = x
        while x < w:
            if content[x]:
                end = x
                gap = 0
            else:
                gap += 1
                if gap >= 2 and end >= start:
                    break
            x += 1
        segs.append((start, end + 1))
        x = end + gap if gap >= 2 else x + 1
    return [strip.crop((s, 0, e, h)) for s, e in segs]


def contact_sheet(sheet, cell, rows_used, cols, path):
    scale = max(1, 192 // cell) if cell < 192 else 1
    s = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)
    bg = Image.new("RGBA", s.size)
    check = max(8, 8 * scale)
    for y in range(0, s.height, check):
        for x in range(0, s.width, check):
            c = 90 if ((x // check + y // check) % 2) else 60
            for yy in range(y, min(y + check, s.height)):
                bg.paste((c, c, c, 255), (x, yy, min(x + check, s.width), yy + 1))
    bg.alpha_composite(s)
    d = ImageDraw.Draw(bg)
    for c in range(cols + 1):
        d.line([(c * cell * scale, 0), (c * cell * scale, bg.height)], fill=(255, 0, 0, 255), width=1)
    for r in range(len(rows_used) + 1):
        d.line([(0, r * cell * scale), (bg.width, r * cell * scale)], fill=(255, 0, 0, 255), width=1)
    for r, name in enumerate(rows_used):
        d.text((4, r * cell * scale + 3), name, fill=(255, 255, 0, 255))
    bg.save(path)


def equal_frames(strip, n):
    """Полоса → n равных кадров (когда кадры слиплись без разделителей)."""
    w, h = strip.size
    fw = w // n
    return [strip.crop((k * fw, 0, (k + 1) * fw, h)) for k in range(n)]


def pack_attack(attack):
    adir = os.path.join(SRC, attack)
    dirs = [d for d in ROW_ORDER if os.path.isfile(os.path.join(adir, d + ".png"))]
    if not dirs:
        return None
    strips = {}
    for d in dirs:
        strip = Image.open(os.path.join(adir, d + ".png")).convert("RGBA")
        want = FRAME_COUNT_OVERRIDES.get(f"{attack}/{d}")
        strips[d] = equal_frames(strip, want) if want else segment(strip)
    cell = max(max(s.width, s.height) for segs in strips.values() for s in segs)
    cols = max(len(strips[d]) for d in dirs)
    sheet = Image.new("RGBA", (cols * cell, len(dirs) * cell), (0, 0, 0, 0))
    manifest = {"size": cell, "columns": cols, "fps": FPS, "animations": []}
    for r, d in enumerate(dirs):
        for c, seg in enumerate(strips[d]):
            sx = c * cell + (cell - seg.width) // 2
            sy = r * cell + (cell - seg.height) // 2
            sheet.paste(seg, (sx, sy))
        manifest["animations"].append({"name": d, "row": r, "frames": len(strips[d])})
    sheet.save(os.path.join(OUT, attack + ".png"))
    with open(os.path.join(OUT, attack + ".json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    contact_sheet(sheet, cell, dirs, cols, os.path.join(PREVIEW_DIR, attack + ".png"))
    return len(dirs), sum(len(strips[d]) for d in dirs), cell


def main():
    if not os.path.isdir(SRC):
        sys.exit(f"нет папки {SRC}")
    os.makedirs(OUT, exist_ok=True)
    packed = []
    for attack in sorted(os.listdir(SRC)):
        adir = os.path.join(SRC, attack)
        if not os.path.isdir(adir):
            continue
        r = pack_attack(attack)
        if r:
            dirs, frames, cell = r
            print(f"  {attack}: направлений {dirs}, кадров {frames}, клетка {cell}")
            packed.append(attack)
    print(f"\nИтого {len(packed)} снарядов → {OUT}")
    print("Контакт-листы:", PREVIEW_DIR)


if __name__ == "__main__":
    main()
