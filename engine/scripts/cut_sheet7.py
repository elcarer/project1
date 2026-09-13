# -*- coding: utf-8 -*-
"""cut_sheet7.py — лист 7 «рытвины и скелеты», APPEND-ONLY.

Принцип пайплайна после отказа от cut_objects.py (удалён, см. git-историю):
существующие PNG и записи реестра НИКОГДА не пересоздаются — только
дополняются, чтобы не затирать ручные правки спрайтов. Этот скрипт:
  1) режет ТОЛЬКО новый лист (флуд-белый фон + компоненты + mask-cut, как
     у листов 5-6 вырезки; логика перенесена из удалённого cut_objects.py);
  2) сохраняет PNG только для новых имён (коллизия имени — ошибка);
  3) дописывает объекты в objects.json и objects_data.js (data-URL WebP).
Повторный запуск идемпотентен: уже добавленные имена пропускаются.
Запись с отсутствующим PNG потом уберёт rebuild_registry.py (prune по умолчанию).

Запуск:  python scripts/cut_sheet7.py
"""
import base64
import io
import json
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "images", "objects"))
SHEET = (r"E:/Program Files/VSCodeProjectLearn/elven_wood/art/окружение/"
         r"generate-a-new-grid-of-isometric-fantasy-game-envi.png")

DEDUPE_THRESHOLD = 9.0
GROUP_WEIGHT = {"pits": 1}

# k → (name, ru, group); отсутствующий k — мусор/обрывок/срезан краем листа
# (30 арка с камнем, 37 стопка щитов и 38 табурет срезаны нижней кромкой).
NAMES7 = {
    0: ("cave_rock", "Пещера каменная", "stones"),
    1: ("cave_earth", "Пещера земляная", "stones"),
    2: ("ruin_gate", "Вход в руины", "ruins"),
    3: ("cave_ice", "Пещера ледяная", "stones"),
    4: ("pit_cracked", "Рытвина потрескавшаяся", "pits"),
    5: ("pit_deep", "Яма глубокая", "pits"),
    6: ("pit_square", "Яма каменная", "pits"),
    7: ("pit_double", "Рытвина двойная", "pits"),
    8: ("skeleton", "Скелет в земле", "magic"),
    9: ("bones_hand", "Кости с кистью", "magic"),
    10: ("bones_pile", "Кости кучей", "magic"),
    11: ("skull_cow", "Череп быка", "magic"),
    12: ("bones_stakes", "Кости в земле", "magic"),
    13: ("ribcage", "Рёбра зверя", "magic"),
    15: ("rock_maw", "Скала-пасть", "stones"),
    16: ("skulls_two", "Черепа парой", "magic"),
    17: ("banner_pick", "Герб: кирка и молот", "deco"),
    18: ("banner_picks", "Герб: кирки накрест", "deco"),
    19: ("banner_dragon", "Герб: дракон", "deco"),
    20: ("banner_golem", "Герб: голем", "deco"),
    22: ("basket_branch", "Корзина на ветке", "deco"),
    23: ("signpost_lantern", "Указатель с фонариком", "deco"),
    24: ("banner_flask", "Герб: зелье", "deco"),
    25: ("stall_grapes", "Навес с виноградом", "buildings"),
    26: ("well_rooted", "Колодец в корнях", "buildings"),
    27: ("shield_lean", "Щит на валуне", "deco"),
    28: ("chalice_water", "Кубок с водой", "deco"),
    29: ("fox_sleep", "Лиса спящая", "deco"),
    31: ("pinecones_scatter", "Шишки россыпью", "plants"),
    32: ("trees_dead_twisted", "Мёртвые деревья витые", "trees"),
    33: ("crystals_cluster", "Кристаллы гроздью", "gems"),
    34: ("griffin", "Грифон", "magic"),
    35: ("totems_wood", "Тотемы парой", "deco"),
    36: ("fence_woven", "Ограда плетёная", "buildings"),
}

# Касаются края листа, но проверены визуально как целые (задевает тень/кромка)
EDGE_OK = {17, 23, 25, 32, 35}

# Колодец №26 слипся с аркой под ним (арка срезана краем листа) — резать по шву
SEAM_Y = {26: 894}

# Замкнутые белые карманы (просветы плетёнок/решёток, рёбер, корней) — фон
# внутри удаляется безусловно. Кости: порог строже (блики сливочно-белые).
INNER_WHITE = {
    "well_rooted": 243, "stall_grapes": 243, "fence_woven": 243,
    "basket_branch": 243, "signpost_lantern": 243, "totems_wood": 243,
    "trees_dead_twisted": 243,
    "banner_pick": 243, "banner_picks": 243, "banner_dragon": 243,
    "banner_golem": 243, "banner_flask": 243,
    "skeleton": 250, "bones_hand": 250, "bones_pile": 250, "skull_cow": 250,
    "bones_stakes": 250, "ribcage": 250, "skulls_two": 250,
}


def flood_bg(a, cand):
    lab, n = ndi.label(cand, structure=np.ones((3, 3), int))
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    return np.isin(lab, list(border))


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


def cut_object_mask(a, bgm, claim, allowed, box):
    """Вырезка по маске своего компонента; un-blend от белого + еда кромки."""
    x0, y0, x1, y1 = box
    sub = a[y0:y1, x0:x1].astype(np.float32)
    bgm_s = bgm[y0:y1, x0:x1]
    own = np.isin(claim[y0:y1, x0:x1], allowed)
    keep = (~bgm_s) & own
    ring = ndi.binary_dilation(~keep, structure=np.ones((3, 3), int), iterations=2) & keep
    t = sub.min(axis=2)
    alpha_f = np.where(bgm_s | ~keep, 0.0, np.where(ring, 1.0 - t / 255.0, 1.0))
    af3 = alpha_f[..., None]
    cc = np.where(af3 > 0, (sub - 255.0 * (1.0 - af3)) / np.maximum(af3, 1e-6), sub)
    rgba = np.dstack([np.clip(cc, 0, 255).astype(np.uint8), (alpha_f * 255).astype(np.uint8)])
    rgba = eat_white_edges(rgba)
    return drop_edge_fragments(rgba)


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


def main():
    a = np.array(Image.open(SHEET).convert("RGB"))
    bgm = flood_bg(a, a.min(axis=2) >= 248)
    objs, claim = segment_components(a, bgm)
    H, W = a.shape[:2]

    # существующие объекты: имена (коллизии) и сигнатуры (дедупликация)
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

    added, skipped = [], []
    for k, o in enumerate(objs):
        entry = NAMES7.get(k)
        if entry is None:
            continue
        name, ru, group = entry
        if name in known_names:
            print(f"  #{k} «{name}»: уже в реестре — пропущен")
            continue
        x0, y0, x1, y1 = o["x0"], o["y0"], o["x1"], o["y1"]
        if k in SEAM_Y:
            y1 = min(y1, SEAM_Y[k])  # шов: чужое ниже не попадает в кроп
        touches = x0 <= 1 or y0 <= 1 or x1 >= W - 1 or y1 >= H - 1
        if touches and k not in EDGE_OK:
            print(f"  #{k} «{name}»: задет край листа — пропущен")
            continue
        rgba = cut_object_mask(a, bgm, claim, [k + 1], (x0, y0, x1, y1))
        thr = INNER_WHITE.get(name)
        if thr:
            rgba[..., 3][rgba[..., :3].min(axis=2) >= thr] = 0
            rgba = eat_white_edges(rgba)
            rgba = drop_edge_fragments(rgba)
        trimmed = content_trim(rgba)
        if trimmed is None or trimmed[0].shape[0] < 6 or trimmed[0].shape[1] < 6:
            print(f"  #{k} «{name}»: пустой срез — проверь имя/сплит")
            continue
        rgba = trimmed[0]
        sig = signature(Image.fromarray(rgba, "RGBA"))
        if sig is not None and pool_sigs:
            dists = [np.abs(sig - s2).mean() for s2 in pool_sigs]
            if min(dists) < DEDUPE_THRESHOLD:
                print(f"  #{k}: повтор «{name}» (diff {min(dists):.1f}) — пропущен")
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
        # рытьё в земле непроходимо целиком; остальное — нижняя строка (основание)
        blocking = "1" * (cx * cy) if group == "pits" else "0" * (cx * (cy - 1)) + "1" * cx
        added.append({"name": name, "ru": ru, "group": group, "file": f"{name}.png",
                      "w": cw, "h": ch, "cellsX": cx, "cellsY": cy,
                      "weight": GROUP_WEIGHT.get(group, 1), "pass": blocking})
        known_names.add(name)

    if not added:
        print("новых объектов нет — всё уже добавлено")
        return

    # objects.json: дописать элементы
    meta_path = os.path.join(OUT, "objects.json")
    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)
    # ручные переопределения проходимости (pass_defaults.json) — поверх авторасчёта
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
    meta["source"] += " + лист 7 «рытвины и скелеты» (scripts/cut_sheet7.py, append-only)"
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)

    # objects_data.js: дописать строки перед "],"
    lines = reg_text.splitlines()
    ins = len(lines) - 1
    while ins >= 0 and not lines[ins].strip().startswith("],"):
        ins -= 1
    if ins < 0:
        raise SystemExit("objects_data.js: не найден закрывающий '],'")
    block = ["    " + json.dumps({**it, "png": data_url(os.path.join(OUT, it["file"]))},
                                  ensure_ascii=False) + "," for it in added]
    lines[ins:ins] = block  # срезом — иначе insert в одну точку переворачивает партию
    with open(reg_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"добавлено {len(added)} объектов: " + ", ".join(it["name"] for it in added))
    print(f"переопределений проходимости применено: {applied}")
    print(f"реестр: {meta['count']} объектов; перезагрузите редактор (Ctrl+F5)")


if __name__ == "__main__":
    main()
