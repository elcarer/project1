# Генератор тайлсета подземелья images/tiles/dungeon_dirt.png (двойная сетка
# dualgrid 4×4 тайла 32px, 128×128): фон — каменный пол, ФИЧА (1) — стена.
# Квадрант каждого тайла 16×16: стена = тёмный каменный блок с окантовкой
# к полу, пол = серо-синий камень с крапом и швами. Запуск:
#   python scripts/make_dungeon_tileset.py
import os
import random

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images", "tiles", "dungeon_dirt.png")
TILE = 32
QUAD = 16

# те же TILE_CORNERS, что в modules/dualgrid.js: [tl, tr, bl, br] (1 = стена)
TILE_CORNERS = [
    [0, 0, 1, 0], [0, 1, 0, 1], [1, 0, 1, 1], [0, 0, 1, 1],
    [1, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 0],
    [0, 1, 0, 0], [1, 1, 0, 0], [1, 1, 0, 1], [1, 0, 1, 0],
    [0, 0, 0, 0], [0, 0, 0, 1], [0, 1, 1, 0], [1, 0, 0, 0],
]

FLOOR = (44, 42, 56)        # базовый каменный пол
FLOOR_D = (36, 34, 48)      # крап пола темнее
FLOOR_L = (54, 52, 66)      # крап пола светлее
SEAM = (30, 28, 40)         # швы плит пола
WALL = (104, 100, 118)        # верх стены
WALL_D = (84, 80, 98)       # текстура блока
WALL_EDGE = (20, 18, 28)    # окантовка стены к полу
WALL_HI = (138, 134, 152)   # световая кромка блока


def rng_stream(seed):
    r = random.Random(seed)
    while True:
        yield r.random()


def draw_floor(px, ox, oy, rand):
    """Квадрант пола 16×16 (ox, oy — абсолютный пиксель): база + крап + швы."""
    for y in range(QUAD):
        for x in range(QUAD):
            r = next(rand)
            c = FLOOR
            if r < 0.14:
                c = FLOOR_D
            elif r > 0.90:
                c = FLOOR_L
            px[ox + x, oy + y] = c
    for i in range(QUAD):  # швы плит (по кромкам квадранта)
        px[ox + i, oy + QUAD - 1] = SEAM
        px[ox + QUAD - 1, oy + i] = SEAM


def draw_wall(px, ox, oy, open_sides):
    """Квадрант стены 16×16: блок с кирпичной текстурой; open_sides — стороны
    (t, r, b, l), где соседний квадрант — пол: там рисуется тёмная окантовка,
    сверху — световая кромка (свет сверху-слева)."""
    for y in range(QUAD):
        for x in range(QUAD):
            c = WALL
            # кирпичная кладка: горизонтальные швы каждые 5px, вертикальные вразбежку
            if y % 5 == 4:
                c = WALL_D
            elif (x + (0 if (y // 5) % 2 == 0 else 4)) % 8 == 7:
                c = WALL_D
            px[ox + x, oy + y] = c
    # световая кромка сверху (если сверху пол)
    if open_sides[0]:
        for x in range(QUAD):
            px[ox + x, oy + 0] = WALL_HI
            px[ox + x, oy + 1] = WALL_HI
    # тёмная окантовка на открытых сторонах
    for x in range(QUAD):
        if open_sides[0]:
            px[ox + x, oy + 0] = WALL_EDGE
        if open_sides[2]:
            px[ox + x, oy + QUAD - 1] = WALL_EDGE
    for y in range(QUAD):
        if open_sides[3]:
            px[ox + 0, oy + y] = WALL_EDGE
        if open_sides[1]:
            px[ox + QUAD - 1, oy + y] = WALL_EDGE
    # угловые точки окантовки плотнее
    if open_sides[0] and open_sides[3]:
        px[ox + 0, oy + 0] = WALL_EDGE
    if open_sides[0] and open_sides[1]:
        px[ox + QUAD - 1, oy + 0] = WALL_EDGE
    if open_sides[2] and open_sides[3]:
        px[ox + 0, oy + QUAD - 1] = WALL_EDGE
    if open_sides[2] and open_sides[1]:
        px[ox + QUAD - 1, oy + QUAD - 1] = WALL_EDGE


def main():
    img = Image.new("RGB", (TILE * 4, TILE * 4), FLOOR)
    px = img.load()
    for idx, (tl, tr, bl, br) in enumerate(TILE_CORNERS):
        tx, ty = idx % 4, idx // 4
        corners = [tl, tr, bl, br]               # 0=tl 1=tr 2=bl 3=br
        quads = [(0, 0), (1, 0), (0, 1), (1, 1)]  # (qx, qy) в паре с corners
        rand = rng_stream(1000 + idx)
        for qi, (qx, qy) in enumerate(quads):
            if corners[qi] == 1:
                # открытые стороны: соседний квадрант ВНУТРИ тайла — пол
                # (порядок сторон: t, r, b, l; вне тайла стена «замкнута»)
                nb = [None, None, None, None]
                if qi >= 2:
                    nb[0] = corners[qi - 2]  # сверху
                if qi < 2:
                    nb[2] = corners[qi + 2]  # снизу
                if qi % 2 == 1:
                    nb[3] = corners[qi - 1]  # слева
                if qi % 2 == 0:
                    nb[1] = corners[qi + 1]  # справа
                open_sides = [n == 0 for n in nb]
                draw_wall(px, tx * TILE + qx * QUAD, ty * TILE + qy * QUAD, open_sides)
            else:
                draw_floor(px, tx * TILE + qx * QUAD, ty * TILE + qy * QUAD, rand)
    img.save(OUT)
    print(f"OK {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
