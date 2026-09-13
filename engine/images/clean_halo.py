# -*- coding: utf-8 -*-
"""clean_halo.py — чистка остатков фона вокруг спрайтов objects/.

Кеинг в scripts/cut_objects.py оставляет по контуру мат: полупрозрачную
светло-серую каёмку (смесь чёрной обводки с белым/кремовым фоном листа) и
кремовые карманы фона в промежутках между частями объекта (между корнями,
в проёмах арок, между ручкой и телом корзины). В редакторе это выглядит как
пятна фона вокруг чёрной обводки.

Правила (пороги выверены на статистике всех 405 спрайтов):
  1) полупрозрачный пиксел (16<alpha<250), соседний с прозрачным, удаляется,
     если он нейтрально-светлый (sat<=0.38, lum>=100) — это всегда мат.
     Цветное полупрозрачное свечение (солнце, фея, кристаллы) насыщеннее
     и остаётся; тёмная полупрозрачность (статичная тень под объектом,
     lum<100) тоже не трогается;
  2) непрозрачный пиксел, соседний с прозрачным, удаляется, только если он
     почти цвета фона листа: кремовый (lum>=185, sat<=0.22, r-b>=18).
     Дизайн холоднее (серо-белые камни, r-b~0) или темнее (крона белой
     ивы, пергамент свитка) — остаётся.
  Удаление идёт волной от прозрачного края и упирается в тёмную обводку,
  поэтому внутренний дизайн недостижим и не страдает. Заодно вся
  альфа<=16 гасится в 0 (остатки недочищенного кеинга).

После чистки реестр objects_data.js пересобирается вызовом
rebuild_registry.py (редактор читает только data-URL).

Запуск:  python images/clean_halo.py           # только отчёт
         python images/clean_halo.py --apply   # почистить и пересобрать
"""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "objects")
T_LO = 16  # альфа <= T_LO считается прозрачной (и гасится в 0)

def clean_image(im):
    """Чистит копию изображения; возвращает (им, удалено_пикселов)."""
    im = im.copy()
    w, h = im.size
    P = im.load()
    for y in range(h):
        for x in range(w):
            if P[x, y][3] <= T_LO:
                P[x, y] = (0, 0, 0, 0)
    removed = 0
    for _ in range(10):  # волна от края; обычно хватает 3-4 проходов
        tr = [[P[x, y][3] == 0 for x in range(w)] for y in range(h)]
        kill = []
        for y in range(h):
            row = tr[y]
            up = tr[y - 1] if y else None
            dn = tr[y + 1] if y < h - 1 else None
            for x in range(w):
                if P[x, y][3] == 0:
                    continue
                if not ((x > 0 and row[x - 1]) or (x < w - 1 and row[x + 1])
                        or (up and up[x]) or (dn and dn[x])):
                    continue
                r, g, b, a = P[x, y]
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                mx = max(r, g, b)
                sat = (mx - min(r, g, b)) / mx if mx else 0.0
                if a < 250:
                    if lum >= 100 and sat <= 0.38:
                        kill.append((x, y))
                elif lum >= 185 and sat <= 0.22 and r - b >= 18:
                    kill.append((x, y))
        if not kill:
            break
        for x, y in kill:
            P[x, y] = (0, 0, 0, 0)
        removed += len(kill)
    return im, removed

def rebuild_registry():
    sys.path.insert(0, HERE)
    import rebuild_registry
    sys.argv = [sys.argv[0]]
    rebuild_registry.main()

def main():
    apply = "--apply" in sys.argv
    from PIL import Image
    files = sorted(f for f in os.listdir(OUT) if f.endswith(".png"))
    bak = os.path.join(tempfile.gettempdir(), "clean_halo_backup")
    touched, total = [], 0
    for f in files:
        src = os.path.join(OUT, f)
        im2, n = clean_image(Image.open(src).convert("RGBA"))
        if not n:
            continue
        touched.append((f, n))
        total += n
        if apply:
            os.makedirs(bak, exist_ok=True)
            shutil.copy2(src, os.path.join(bak, f))
            im2.save(src)
    print(f"объектов: {len(files)}; с остатками фона: {len(touched)}; "
          f"пикселов к чистке: {total}")
    for f, n in sorted(touched, key=lambda t: -t[1])[:25]:
        print(f"  {n:5d}  {f}")
    if len(touched) > 25:
        print(f"  … и ещё {len(touched) - 25} файлов")
    if not apply:
        print("\nэто отчёт; чистка: python images/clean_halo.py --apply")
        return
    if not touched:
        print("чистить нечего")
        return
    print(f"\nкопии до чистки: {bak}")
    print("пересборка реестра…")
    rebuild_registry()

if __name__ == "__main__":
    main()
