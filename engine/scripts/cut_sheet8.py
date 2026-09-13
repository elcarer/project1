# -*- coding: utf-8 -*-
"""cut_sheet8.py — лист 8 «снежные объекты», APPEND-ONLY.

Принцип пайплайна (см. cut_sheet7.py): существующие PNG и записи реестра
НИКОГДА не пересоздаются — только дополняются. Отличия от листа 7:
  • фон листа кремовый (#ebe7dc), не белый — флуд по цветовой дистанции
    от медианы кромки, un-blend от цвета фона, кольцевая альфа по дистанции;
  • замкнутые кремовые карманы (прослветы заборов/вывесок) ключатся
    безусловно: замкнутая компонента фоново-подобных пикселей площадью ≥20;
  • #7 — четыре рисунка, слипшиеся тенями: режется сплитом (SPLITS) на 4
    объекта, тени разносятся по ближайшему тёмному контуру.
Все объекты — группа "snow" (категория «Снег»).

Запуск:  python scripts/cut_sheet8.py
"""
import base64
import io
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "images", "objects"))
SHEET = (r"E:/Program Files/VSCodeProjectLearn/elven_wood/art/окружение/"
         r"замени-спрайты-окружения-на-прикреплённом-изображе (2).png")

DEDUPE_THRESHOLD = 9.0
BG_THRESHOLD = 40          # sum|px-bg| ниже порога — фон
POCKET_AREA = 20           # минимальная площадь замкнутого кармана фона

# k → (name, ru); группа у всех "snow". Отсутствующий k — мусор/обрывок.
NAMES8 = {
    0: ("sign_wood_snow", "Указатель деревянный"),
    1: ("sign_boards_snow", "Указатель с дощечками"),
    2: ("sign_big_snow", "Большой указатель"),
    3: ("owl_snow", "Сова заснеженная"),
    4: ("rosette_frost", "Морозная розетка"),
    5: ("pot_tree_snow", "Деревце в горшке"),
    6: ("oak_snow_big", "Дуб заснеженный"),
    8: ("stones_small_snow", "Камни россыпью"),
    9: ("grass_icy", "Трава ледяная"),
    10: ("log_stump_hollow", "Дупло-пень заснеженное"),
    11: ("topiary_snow", "Топиар заснеженный"),
    12: ("pond_ice_ring", "Пруд в каменной оправе"),
    13: ("stones_cluster_snow", "Валуны гроздью"),
    14: ("log_big_hollow", "Бревно дуплистое большое"),
    15: ("pond_ice_small", "Лужица замёрзшая"),
    16: ("cypress_snow", "Кипарис заснеженный"),
    17: ("birch_snow", "Берёза заснеженная"),
    18: ("willow_snow_big", "Ива заснеженная большая"),
    19: ("mound_snow", "Сугроб"),
    20: ("saplings_snow", "Деревца заснеженные"),
    21: ("bush_pair_snow", "Кусты парой заснеженные"),
    22: ("stones_mushroom_snow", "Камни-грибы заснеженные"),
    23: ("tree_twisted_snow", "Дерево витое заснеженное"),
    24: ("bush_spiky_snow", "Куст колючий заснеженный"),
    25: ("cypress_dark_snow", "Кипарис тёмный заснеженный"),
    26: ("mounds_snow", "Сугробы парой"),
    27: ("topiary_big_snow", "Топиар большой заснеженный"),
    28: ("bush_ball_snow", "Куст шар заснеженный"),
    29: ("bush_wide_snow", "Куст широкий заснеженный"),
    30: ("tree_tiers_snow", "Дерево многоярусное заснеженное"),
    31: ("stone_dark_snow", "Камень тёмный заснеженный"),
    32: ("agave_snow", "Агава заснеженная"),
    33: ("log_flat_icy", "Бревно плоское ледяное"),
    34: ("spruce_snow_big", "Ель заснеженная большая"),
    35: ("dead_tree_snow", "Сухое дерево заснеженное"),
    36: ("runestone_snow", "Рунный камень заснеженный"),
    37: ("log_branch_big", "Бревно с суком"),
    38: ("roots_arch_snow", "Арка из корней заснеженная"),
    39: ("stone_blob_snow", "Валун заснеженный"),
    40: ("boulders_snow", "Валуны стопкой заснеженные"),
    41: ("stump_big_snow", "Пень большой заснеженный"),
    42: ("runestone_icy", "Рунный камень ледяной"),
    43: ("log_thin_snow", "Бревно тонкое заснеженное"),
    44: ("lantern_icicles", "Фонарь с сосульками"),
    45: ("well_wish_snow", "Колодец желаний"),
    46: ("bench_apothecary", "Столик с сосудами"),
    47: ("barrel_pedestal", "Бочка-тумба"),
    48: ("shield_hammer", "Щит с молотом"),
    49: ("easel_snow", "Мольберт заснеженный"),
    50: ("stall_frame_snow", "Навес с кристаллами"),
    52: ("crate_snow", "Ящик заснеженный"),
    53: ("table_alchemy", "Стол алхимика"),
    54: ("sign_board_snow", "Табличка заснеженная"),
    55: ("birdhouses_snow", "Скворечники тройные"),
    56: ("totem_deer_snow", "Тотем с черепом оленя"),
    57: ("owl_post_snow", "Сова на стойке"),
    58: ("barrel_snow", "Бочка заснеженная"),
    59: ("fence_snow", "Забор заснеженный"),
    60: ("planter_log_snow", "Клумба в бревне"),
    61: ("owl_perch_snow", "Сова на ветке"),
    62: ("fountain_small_snow", "Фонтанчик заснеженный"),
    63: ("totem_icy", "Тотем ледяной"),
    64: ("bench_plants_snow", "Скамья с растениями"),
    65: ("log_crystals_snow", "Лавка с кристаллами"),
    66: ("bench_fancy_snow", "Скамья резная заснеженная"),
    67: ("watering_can_snow", "Лейка"),
    68: ("bowl_snowballs", "Чаша со снежками"),
    69: ("pot_small_snow", "Горшочек заснеженный"),
    70: ("jars_pair_snow", "Кувшины парой"),
    71: ("leaf_big_snow", "Лист большой заснеженный"),
    72: ("forge_snow", "Горн заснеженный"),
    73: ("bench_leaf_snow", "Скамья-лист"),
    74: ("signpost_small_snow", "Указатель малый"),
    75: ("antlers_snow", "Рога оленьи"),
    76: ("barrel_upright_snow", "Бочка вертикальная"),
    77: ("stump_table_tall", "Пень-стол высокий"),
    78: ("snowman_hat", "Снеговик с шляпой"),
    79: ("stump_table_runes", "Пень-стол с рунами"),
    80: ("basket_apples_snow", "Корзина с яблоками"),
    81: ("shield_crest_dark", "Щит с гербом"),
    82: ("fountain_basin_snow", "Чаша фонтана"),
    83: ("well_bucket_snow", "Колодец с ведром"),
    84: ("banner_boot_snow", "Вывеска: сапог"),
    85: ("banner_axes_snow", "Вывеска: топоры"),
    86: ("banner_anvil_snow", "Вывеска: наковальня"),
    87: ("banner_goose_snow", "Вывеска: гусь"),
    88: ("banner_beer_snow", "Вывеска: кружка"),
    89: ("pinecones_snow", "Шишки заснеженные"),
    90: ("lantern_post_garland", "Фонарный столб с гирляндой"),
    91: ("horse_head_snow", "Конь-статуя"),
    92: ("chalice_pedestal_snow", "Чаша на подставке"),
    93: ("gate_arch_snow", "Врата арка заснеженные"),
    94: ("market_stall_snow", "Торговый шатёр заснеженный"),
    95: ("tower_hollow_snow", "Башня дуплистая заснеженная"),
    96: ("signpost_tall_snow", "Указатель высокий"),
    97: ("banner_beer_double", "Вывеска двойная: кружка"),
    98: ("palm_snow", "Пальма заснеженная"),
    99: ("fence_net_snow", "Забор с плетёнкой"),
    100: ("willow_icy", "Ива ледяная"),
    101: ("block_icy", "Блок ледяной"),
}

# #7 — четыре рисунка, слипшиеся тенями: имена в порядке чтения (слева направо,
# сверху вниз), вырезка по ближайшему тёмному контуру (тени не склеивают).
SPLITS = {
    7: ["plant_leaf_snow", "log_hollow_snow", "tree_small_snow", "pond_ice_stone"],
}
RU_SPLITS = {
    "plant_leaf_snow": "Растение листовое заснеженное",
    "log_hollow_snow": "Бревно дуплистое заснеженное",
    "tree_small_snow": "Деревце заснеженное",
    "pond_ice_stone": "Пруд замёрзший в камнях",
}

EDGE_OK = set()   # заполняется после первого прогона по отчёту о краях


def flood_bg(d, threshold):
    """Фон = замкнутые с кромкой листа компоненты фоново-подобных пикселей."""
    cand = d < threshold
    lab, n = ndi.label(cand, structure=np.ones((3, 3), int))
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    return np.isin(lab, list(border))


def key_enclosed_pockets(rgba, bg, threshold, min_area):
    """Замкнутые карманы фона (просветы заборов/вывесок) — в прозрачность."""
    d = np.abs(rgba[..., :3].astype(int) - bg.astype(int)).sum(axis=2)
    cand = (d < threshold) & (rgba[..., 3] > 0)
    lab, n = ndi.label(cand, structure=np.ones((3, 3), int))
    if not n:
        return rgba
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    sizes = ndi.sum(cand, lab, range(1, n + 1))
    for i in range(1, n + 1):
        if i in border or sizes[i - 1] < min_area:
            continue
        rgba[..., 3][lab == i] = 0
    return rgba


def eat_white_edges(rgba, thr=195, sat=30, max_iters=8):
    """Белёсые пиксели с внешнего края (остатки фона) снимаются волной снаружи."""
    alpha = rgba[..., 3].copy()
    rgb = rgba[..., :3].astype(int)
    mn = rgb.min(axis=2); mx = rgb.max(axis=2)
    whitish = (mn >= thr) & ((mx - mn) <= sat)
    st = np.ones((3, 3), bool)
    for _ in range(max_iters):
        opaque = alpha > 0
        if not opaque.any():
            break
        near = ndi.binary_dilation(~opaque, structure=st) & opaque
        near[0, :] |= opaque[0, :]; near[-1, :] |= opaque[-1, :]
        near[:, 0] |= opaque[:, 0]; near[:, -1] |= opaque[:, -1]
        eat = near & whitish
        if not eat.any():
            break
        alpha[eat] = 0
    rgba[..., 3] = alpha
    return rgba


def drop_edge_fragments(rgba, frac=0.06):
    """Обрывки чужих силуэтов: мелкий компонент у края кропа или вдали от
    главного — удаляется; крупная часть композиции остаётся."""
    alpha = rgba[..., 3]
    solid = alpha > 8
    lab, n = ndi.label(solid, structure=np.ones((3, 3), bool))
    if n <= 1:
        return rgba
    sizes = ndi.sum(solid, lab, range(1, n + 1))
    main = 1 + int(np.argmax(sizes))
    main_area = float(sizes[main - 1])
    h, w = solid.shape
    near_main = ndi.binary_dilation(lab == main, structure=np.ones((3, 3), bool))
    for i in range(1, n + 1):
        if i == main:
            continue
        comp = lab == i
        area = float(sizes[i - 1])
        if area >= main_area * 0.15:
            continue
        ys, xs = np.where(comp)
        touches = (ys.min() == 0 or xs.min() == 0 or ys.max() == h - 1 or xs.max() == w - 1)
        far = not (comp & near_main).any()
        if area < main_area * frac and (touches or far):
            alpha[comp] = 0
        elif touches:
            alpha[comp] = 0
    return rgba


def segment_components(a, bgm, pad=4, big_min=150, small_min=30):
    mask = ~bgm
    lab, n = ndi.label(mask, structure=np.ones((3, 3), int))
    comps = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        if sl is None:
            continue
        ys, xs = sl
        comps.append(dict(x0=int(xs.start), y0=int(ys.start), x1=int(xs.stop), y1=int(ys.stop),
                          area=int((lab[sl] == i + 1).sum()), members=[i + 1]))
    bigs = [c for c in comps if c["area"] >= big_min]
    smalls = [c for c in comps if small_min <= c["area"] < big_min]
    for s in smalls:
        best, bd = None, None
        for b in bigs:
            if (s["x0"] >= b["x0"] - pad and s["y0"] >= b["y0"] - pad and
                    s["x1"] <= b["x1"] + pad and s["y1"] <= b["y1"] + pad):
                bc = ((b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2)
                sc = ((s["x0"] + s["x1"]) / 2, (s["y0"] + s["y1"]) / 2)
                dist = (bc[0] - sc[0]) ** 2 + (bc[1] - sc[1]) ** 2
                if bd is None or dist < bd:
                    best, bd = b, dist
        if best is not None:
            best["members"].extend(s["members"])
            best["x0"] = min(best["x0"], s["x0"]); best["y0"] = min(best["y0"], s["y0"])
            best["x1"] = max(best["x1"], s["x1"]); best["y1"] = max(best["y1"], s["y1"])
            best["area"] += s["area"]
    objs = sorted(bigs, key=lambda o: (o["y0"] // 96, o["x0"]))
    claim = np.zeros(a.shape[:2], np.int32)
    for gi, o in enumerate(objs):
        claim[np.isin(lab, o["members"])] = gi + 1
    return objs, claim


def cut_object_mask(a, bgm, claim, allowed, box, bg):
    """Вырезка по маске своего компонента; un-blend от кремового фона."""
    x0, y0, x1, y1 = box
    sub = a[y0:y1, x0:x1].astype(np.float32)
    bgm_s = bgm[y0:y1, x0:x1]
    own = np.isin(claim[y0:y1, x0:x1], allowed)
    keep = (~bgm_s) & own
    dsum = np.abs(sub - bg.astype(np.float32)).sum(axis=2)
    ring = ndi.binary_dilation(~keep, structure=np.ones((3, 3), int), iterations=2) & keep
    alpha_f = np.where(bgm_s | ~keep, 0.0,
                       np.where(ring, np.clip(dsum / 70.0, 0.0, 1.0), 1.0))
    alpha_f[dsum < 12] = 0.0
    af3 = alpha_f[..., None]
    cc = np.where(af3 > 0, (sub - bg.astype(np.float32) * (1.0 - af3)) / np.maximum(af3, 1e-6), sub)
    rgba = np.dstack([np.clip(cc, 0, 255).astype(np.uint8), (alpha_f * 255).astype(np.uint8)])
    rgba = eat_white_edges(rgba)
    return drop_edge_fragments(rgba)


def split_by_outlines(a, bgm, box, bg):
    """Разрезка бокса на отдельные рисунки по тёмным контурам: тени и мягкие
    пикселы прилипают к ближайшему контуру (дистанционное преобразование),
    кремовый фон снимается, кромка полупрозрачная (un-blend от фона)."""
    x0, y0, x1, y1 = box
    sub = a[y0:y1, x0:x1].astype(np.float32)
    dsum = np.abs(sub - bg.astype(np.float32)).sum(axis=2)
    fg = (~bgm[y0:y1, x0:x1]) & (dsum >= BG_THRESHOLD)
    if not fg.any():
        return []
    strong = fg & (sub.min(axis=2) < 170)
    # эрозия рвёт тонкие мостики между соседними рисунками (1-2px),
    # оторвавшиеся мелочи вернутся к ближайшей части дистанционным полем
    strong = ndi.binary_erosion(strong, structure=np.ones((3, 3), bool), iterations=1)
    lab, n = ndi.label(strong, structure=np.ones((3, 3), int))
    if n == 0:
        return []
    sizes = ndi.sum(strong, lab, range(1, n + 1))
    keep = [i + 1 for i in range(n) if sizes[i] >= 120]
    if not keep:
        return []
    remap = {old: new for new, old in enumerate(keep, 1)}
    strong_l = np.zeros_like(lab)
    for old, new in remap.items():
        strong_l[lab == old] = new
    idx = ndi.distance_transform_edt(strong_l == 0, return_distances=False, return_indices=True)
    near = strong_l[tuple(idx)]
    parts = []
    for li in sorted(remap.values()):
        m = (near == li) & fg
        if m.sum() < 150:
            continue
        alpha = np.where(m, np.clip(dsum / 70.0, 0.0, 1.0) * 255.0, 0.0).astype(np.uint8)
        af3 = alpha[..., None].astype(np.float32) / 255.0
        cc = np.where(af3 > 0, (sub - bg.astype(np.float32) * (1.0 - af3)) /
                      np.maximum(af3, 1e-6), sub)
        rgba = np.dstack([np.clip(cc, 0, 255).astype(np.uint8), alpha])
        ys, xs = np.where(rgba[..., 3] > 8)
        if not len(xs):
            continue
        parts.append((int(xs.min()), int(ys.min()), rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]))
    parts.sort(key=lambda p: ((p[1] + 40) // 80, p[0]))
    return [p[2] for p in parts]



def content_trim(rgba, pad=1):
    ys, xs = np.where(rgba[..., 3] > 8)
    if not len(xs):
        return None
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    sx0 = max(0, x0 - pad); sy0 = max(0, y0 - pad)
    sx1 = min(rgba.shape[1], x1 + pad); sy1 = min(rgba.shape[0], y1 + pad)
    return rgba[sy0:sy1, sx0:sx1], sx0, sy0, sx1, sy1


def signature(im, size=48):
    arr = np.array(im)
    ys, xs = np.where(arr[..., 3] > 8)
    if not len(xs):
        return None
    crop = arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape[:2]
    side = max(h, w)
    sq = np.zeros((side, side, 4), np.uint8)
    px = (side - w) // 2; py = side - h
    sq[py:py + h, px:px + w] = crop
    q = np.array(Image.fromarray(sq).resize((size, size), Image.LANCZOS)).astype(np.float32)
    rgb = q[..., :3] * (q[..., 3:4] / 255.0) + 128 * (1 - q[..., 3:4] / 255.0)
    return np.concatenate([rgb[..., :3].ravel(), q[..., 3].ravel()])


def data_url(path):
    im = Image.open(path).convert("RGBA")
    buf = io.BytesIO()
    im.save(buf, "WEBP", lossless=True)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


PART_NAMES = json.load(open(os.path.join(HERE, "cut_sheet8_names.json"),
                                encoding="utf-8"))
PART_NAMES = {int(k): (v[0], v[1]) for k, v in PART_NAMES.items()}   # глобальный индекс части (из --dump-parts) → (name, ru)


def main():
    a = np.array(Image.open(SHEET).convert("RGB"))
    H, W = a.shape[:2]
    border = np.concatenate([a[0, :], a[-1, :], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    d = np.abs(a.astype(int) - bg.astype(int)).sum(axis=2)
    bgm = flood_bg(d, BG_THRESHOLD)
    objs, claim = segment_components(a, bgm)

    # каждая компонента (включая слипшиеся через тени) режется по контурам на части
    parts = []
    for k, o in enumerate(objs):
        for p in split_by_outlines(a, bgm, (o["x0"], o["y0"], o["x1"], o["y1"]), bg):
            parts.append(p)

    # --dump-parts: контактный лист частей с глобальными индексами для PART_NAMES
    if "--dump-parts" in sys.argv:
        from PIL import ImageDraw
        CELL, LBL, cols = 150, 24, 8
        rows = (len(parts) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * CELL, rows * (CELL + LBL)), (40, 40, 40))
        dr = ImageDraw.Draw(sheet)
        for i, rgba in enumerate(parts):
            c = Image.fromarray(rgba, "RGBA")
            sc = min((CELL - 8) / c.width, (CELL - 8) / c.height, 1.0)
            if sc < 1.0:
                c = c.resize((max(1, int(c.width * sc)), max(1, int(c.height * sc))), Image.LANCZOS)
            cx, cy = (i % cols) * CELL, (i // cols) * (CELL + LBL)
            bgc = Image.new("RGBA", c.size, (70, 70, 70, 255))
            bgc.alpha_composite(c)
            sheet.paste(bgc.convert("RGB"), (cx + (CELL - c.width) // 2, cy + LBL + (CELL - 8 - c.height) // 2))
            dr.text((cx + 4, cy + 4), str(i), fill=(255, 255, 100))
        sheet.save(os.path.join(HERE, "..", "..", "tmp_sheet8_parts.png"))
        print(f"частей: {len(parts)}; контактный лист сохранён")
        return

    reg_path = os.path.join(OUT, "objects_data.js")
    with open(reg_path, encoding="utf-8") as fh:
        reg_text = fh.read()
    known_names = {ln.split('"name": "')[1].split('"')[0]
                   for ln in reg_text.splitlines() if ln.strip().startswith('{"name"')}
    pool_sigs = []
    for f in sorted(os.listdir(OUT)):
        if f.endswith(".png"):
            sig = signature(Image.open(os.path.join(OUT, f)).convert("RGBA"))
            if sig is not None:
                pool_sigs.append(sig)

    added = []
    for gi, rgba in enumerate(parts):
        entry = PART_NAMES.get(gi)
        if entry is None:
            continue
        name, ru = entry
        if name in known_names:
            print(f"  «{name}»: уже в реестре — пропущен")
            continue
        rgba = key_enclosed_pockets(rgba, bg, BG_THRESHOLD, POCKET_AREA)
        rgba = eat_white_edges(rgba)
        rgba = drop_edge_fragments(rgba)
        trimmed = content_trim(rgba)
        if trimmed is None or trimmed[0].shape[0] < 6 or trimmed[0].shape[1] < 6:
            print(f"  «{name}»: пустой срез")
            continue
        rgba = trimmed[0]
        sig = signature(Image.fromarray(rgba, "RGBA"))
        if sig is not None and pool_sigs:
            dists = [np.abs(sig - s2).mean() for s2 in pool_sigs]
            if min(dists) < DEDUPE_THRESHOLD:
                print(f"  повтор «{name}» (diff {min(dists):.1f}) — пропущен")
                continue
        if sig is not None:
            pool_sigs.append(sig)
        h, w = rgba.shape[:2]
        cw = max(32, min(512, math.ceil(w / 32) * 32))
        ch = max(32, min(512, math.ceil(h / 32) * 32))
        canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        canvas.paste(Image.fromarray(rgba, "RGBA"), ((cw - w) // 2, ch - h))
        canvas.save(os.path.join(OUT, f"{name}.png"), optimize=True)
        cx, cy = cw // 32, ch // 32
        blocking = "0" * (cx * (cy - 1)) + "1" * cx
        added.append({"name": name, "ru": ru, "group": "snow", "file": f"{name}.png",
                      "w": cw, "h": ch, "cellsX": cx, "cellsY": cy,
                      "weight": 1, "pass": blocking})
        known_names.add(name)

    if not added:
        print("новых объектов нет — всё уже добавлено")
        return

    meta_path = os.path.join(OUT, "objects.json")
    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)
    pass_file = os.path.join(OUT, "pass_defaults.json")
    applied = 0
    if os.path.exists(pass_file):
        with open(pass_file, encoding="utf-8") as fh:
            overrides = {it["name"]: it["pass"] for it in json.load(fh).get("items", [])
                         if "name" in it and "pass" in it}
        for it in added:
            ps = overrides.get(it["name"])
            if ps and len(ps) == it["cellsX"] * it["cellsY"] and set(ps) <= {"0", "1"}:
                it["pass"] = ps
                applied += 1
    meta["items"].extend(added)
    meta["count"] = len(meta["items"])
    meta["source"] += " + лист 8 «снежные объекты» (scripts/cut_sheet8.py, append-only)"
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)

    lines = reg_text.splitlines()
    ins = len(lines) - 1
    while ins >= 0 and not lines[ins].strip().startswith("],"):
        ins -= 1
    if ins < 0:
        raise SystemExit("objects_data.js: не найден закрывающий '],'")
    block = ["    " + json.dumps({**it, "png": data_url(os.path.join(OUT, it["file"]))},
                                  ensure_ascii=False) + "," for it in added]
    lines[ins:ins] = block
    with open(reg_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"добавлено {len(added)} объектов: " + ", ".join(it["name"] for it in added))
    print(f"переопределений проходимости применено: {applied}")
    print(f"реестр: {meta['count']} объектов; перезагрузите редактор (Ctrl+F5)")


if __name__ == "__main__":
    main()
