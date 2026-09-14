#!/usr/bin/env python3
# СБОРКА СПРАЙТШИТОВ ПЕРСОНАЖЕЙ из сырых заготовок forWork/.
# Вход:  forWork/<enemy|hero>/<имя>/{move,attack,others}/*.png — ПОЛОСЫ по 4 кадра
#        (одна полоса = одна анимация; кадры стоят на нижней кромке полосы).
# Выход: images/sprites/<имя>_<клетка>.png + .json — лист 5×11 клеток и манифест
#        формата wolf_64 (стандартный набор 11 анимаций, fps 8).
#
# Клетка: 64px по умолчанию (контент меньше — по центру X, низ в 2px от нижней
# кромки, как линия стоп волка), 128px для кадров 128×128 (копия как есть).
# У героя есть папка abil — НЕ стандартный набор, сюда не входит (другая задача).
# Недостающие анимации: wait синтезируется из кадра 0 move/front (спавн обязан
# иметь wait), damage просто отсутствует в манифесте (строка в листе пустует).
#
# Прогон создаёт контакт-листы (клетки, подписи строк, шахматный фон) в
# CHARACTER_PREVIEW_DIR — обязательная визуальная проверка каждого кадра.
import os
import sys
import json
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # engine/
SRC = os.path.join(os.path.dirname(ROOT), "forWork")                # forWork/
OUT = os.path.join(ROOT, "images", "sprites")
PREVIEW_DIR = os.path.join(os.path.dirname(ROOT), "tmp", "forwork_preview")

COLUMNS = 5
FPS = 8
ROWS = [  # (имя строки, папка/файл) — порядок строк листа, как у волка
    ("wait", "others/wait.png"),
    ("walk_front", "move/front.png"),
    ("walk_back", "move/back.png"),
    ("walk_left", "move/left.png"),
    ("walk_right", "move/right.png"),
    ("attack_front", "attack/front.png"),
    ("attack_back", "attack/back.png"),
    ("attack_right", "attack/right.png"),
    ("attack_left", "attack/left.png"),
    ("death", "others/death.png"),
    ("damage", "others/damage.png"),
]
FRAMES_PER_STRIP = 4
BOTTOM_MARGIN = 2  # зазор «ног» от нижней кромки клетки при подгонке


def cell_size(fw, fh):
    for c in (64, 128, 256):
        if fw <= c and fh <= c:
            return c
    raise ValueError(f"кадр {fw}×{fh} не влезает даже в 256")


def cut_strip(im, path):
    """Полоса → 4 кадра; проверка чистоты разрезов по границам клеток."""
    w, h = im.size
    if w % FRAMES_PER_STRIP:
        raise ValueError(f"{path}: ширина {w} не делится на {FRAMES_PER_STRIP}")
    fw = w // FRAMES_PER_STRIP
    im = im.convert("RGBA")
    px = im.load()
    for k in range(1, FRAMES_PER_STRIP):
        for x in (k * fw - 1, k * fw):
            dirty = sum(1 for y in range(h) if px[x, y][3] > 10)
            if dirty > h * 0.25:
                print(f"  ! {path}: граница x={x} замусорена ({dirty}/{h} px) — возможен разрез по спрайту")
    return [im.crop((k * fw, 0, (k + 1) * fw, h)) for k in range(FRAMES_PER_STRIP)]


def place(frame, cell):
    """Кадр в клетку: центр по X, низ с зазором (родной размер — как есть)."""
    fw, fh = frame.size
    if (fw, fh) == (cell, cell):
        return frame
    out = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    out.paste(frame, ((cell - fw) // 2, cell - BOTTOM_MARGIN - fh))
    return out


def contact_sheet(sheet, cell, rows_used, path):
    """Лист с сеткой и подписями строк на шахматном фоне, ×3 (128 → ×2)."""
    scale = 2 if cell >= 128 else 3
    cols, rows = COLUMNS, sheet.height // cell
    s = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)
    bg = Image.new("RGBA", s.size)
    check = 8 * scale
    for y in range(0, s.height, check):
        for x in range(0, s.width, check):
            c = 90 if ((x // check + y // check) % 2) else 60
            for yy in range(y, min(y + check, s.height)):
                bg.paste((c, c, c, 255), (x, yy, min(x + check, s.width), yy + 1))
    bg.alpha_composite(s)
    d = ImageDraw.Draw(bg)
    for c in range(cols + 1):
        d.line([(c * cell * scale, 0), (c * cell * scale, bg.height)], fill=(255, 0, 0, 255), width=1)
    for r in range(rows + 1):
        d.line([(0, r * cell * scale), (bg.width, r * cell * scale)], fill=(255, 0, 0, 255), width=1)
    for r, name in enumerate(rows_used):
        d.text((4, r * cell * scale + 3), name, fill=(255, 255, 0, 255))
    bg.save(path)


def pack_character(kind, name):
    cdir = os.path.join(SRC, kind, name)
    strips = {}
    for anim, rel in ROWS:
        p = os.path.join(cdir, rel)
        if os.path.isfile(p):
            strips[anim] = cut_strip(Image.open(p), rel)
    if "walk_front" not in strips:
        raise FileNotFoundError(f"{name}: нет move/front.png")
    if "wait" not in strips:  # спавн обязан иметь wait: стоячая поза = кадр 0 move/front
        strips["wait"] = [strips["walk_front"][0]]
        print(f"  ~ {name}: wait синтезирован из move/front[0]")

    fw, fh = strips["walk_front"][0].size
    cell = cell_size(fw, fh)
    sheet = Image.new("RGBA", (COLUMNS * cell, len(ROWS) * cell), (0, 0, 0, 0))
    manifest = {"size": cell, "columns": COLUMNS, "fps": FPS, "animations": []}
    for r, (anim, _) in enumerate(ROWS):
        if anim not in strips:
            continue
        frames = strips[anim]
        for c, fr in enumerate(frames):
            sheet.paste(place(fr, cell), (c * cell, r * cell))
        manifest["animations"].append({"name": anim, "row": r, "frames": len(frames)})

    base = f"{name}_{cell}"
    sheet.save(os.path.join(OUT, base + ".png"))
    with open(os.path.join(OUT, base + ".json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    contact_sheet(sheet, cell, [a for a, _ in ROWS if a in strips],
                  os.path.join(PREVIEW_DIR, base + ".png"))
    n = sum(a["frames"] for a in manifest["animations"])
    return base, len(manifest["animations"]), n


def main():
    if not os.path.isdir(SRC):
        sys.exit(f"нет папки {SRC}")
    packed = []
    for kind in ("enemy", "hero"):
        for name in sorted(os.listdir(os.path.join(SRC, kind))):
            if not os.path.isdir(os.path.join(SRC, kind, name)):
                continue
            base, anims, frames = pack_character(kind, name)
            print(f"  {base}: анимаций {anims}, кадров {frames}")
            packed.append(base)
    print(f"\nИтого {len(packed)} персонажей → {OUT}")
    print("Контакт-листы:", PREVIEW_DIR)


if __name__ == "__main__":
    main()
