# -*- coding: utf-8 -*-
"""cut_sheet9.py — лист 9 «водная поверхность», APPEND-ONLY.

Из листа берутся ТОЛЬКО объекты, стоящие на воде (затопленные коряги и брёвна,
ряска, кувшинки, водные камни, кораллы, камыш на воде) — они уже нарисованы со
своей водяной основой-декалями и ставятся поверх водных тайлов. Остальное на
листе — повторки, которые уже есть в реестре, — не режется вовсе (нет имени в
NAMES9). Механика — из cut_sheet7.py (флуд-белый фон + компоненты + mask-cut).

Запуск:  python scripts/cut_sheet9.py [--dump]
  --dump — контактный лист частей с индексами + список bbox (для NAMES9),
          без вырезки и записи реестра.
"""
import base64
import io
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "images", "objects"))
SHEET = (r"E:/Program Files/VSCodeProjectLearn/elven_wood/art/окружение/"
         r"generate-a-completely-new-grid-of-isometric-fantas.png")

DEDUPE_THRESHOLD = 9.0

# k → (name, ru); отсутствующий k — повторка (в реестре) или мусор.
# По контактке --dump: водные объекты листа (стоят на своей водяной основе).
NAMES9 = {
    0: ("log_flooded_big", "Бревно затопленное большое"),
    1: ("stump_flooded", "Пень затопленный"),
    2: ("snag_flooded", "Коряга затопленная"),
    3: ("duckweed_big", "Ряска большая"),
    4: ("duckweed_bit", "Ряска малая"),
    8: ("duckweed_mid", "Ряска средняя"),
    9: ("duckweed_bit_b", "Ряска малая (вариант)"),
    11: ("lily_white_pond", "Пруд с белой кувшинкой"),
    12: ("lily_yellow_pond", "Пруд с жёлтой кувшинкой"),
    13: ("log_flooded_moss", "Бревно мшистое затопленное"),
    14: ("log_flooded", "Бревно затопленное"),
    15: ("snag_flooded_b", "Коряга затопленная (вариант)"),
    16: ("duckweed_round", "Ряска круглая"),
    17: ("duckweed_bit_c", "Ряска малая (вариант 2)"),
    19: ("duckweed_weed", "Ряска с водорослями"),
    20: ("lily_yellow_pond_b", "Пруд с жёлтой кувшинкой (вариант)"),
    21: ("lily_blue_pond", "Пруд с синей кувшинкой"),
    22: ("snag_flooded_c", "Коряга витая затопленная"),
    26: ("lily_pad", "Лист кувшинки"),
    27: ("lily_pads", "Листья кувшинки парой"),
    29: ("lily_pad_white", "Лист с белой кувшинкой"),
    31: ("lily_pad_b", "Лист кувшинки (вариант)"),
    32: ("log_flooded_b", "Бревно затопленное (вариант)"),
    33: ("log_flooded_small", "Бревно затопленное малое"),
    34: ("snag_flooded_d", "Коряга на воде (вариант)"),
    35: ("lily_white_pond_big", "Пруд с белой кувшинкой большой"),
    36: ("lily_yellow", "Кувшинка жёлтая"),
    37: ("lily_blue_pond_big", "Пруд с синей кувшинкой большой"),
    38: ("stones_water", "Камни в воде"),
    39: ("stones_water_small", "Камни в воде малые"),
    43: ("lily_blue", "Кувшинка синяя"),
    48: ("coral_reef", "Коралловый риф"),
    49: ("coral_small", "Кораллы малые"),
    50: ("coral_small_b", "Кораллы малые (вариант)"),
    51: ("pond_logs", "Пруд с брёвнами"),
    69: ("coral_reef_big", "Коралловый риф большой"),
    83: ("reeds_water", "Камыш на воде"),
    91: ("reeds_water_b", "Камыш на воде (вариант)"),
    93: ("reeds_water_c", "Камыш на воде (вариант 2)"),
    94: ("pond_reeds", "Пруд с камышом"),
}

# Касаются края листа, но визуально целые (кораллы у правой кромки,
# камыш у нижней)
EDGE_OK = {49, 50, 91}


def flood_bg(a, cand):
    lab, n = ndi.label(cand, structure=np.ones((3, 3), int))
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    return np.isin(lab, list(border))


def eat_white_edges(rgba, thr=195, sat=30, max_iters=8):
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


def segment_components(a, bgm, pad=6, big_min=150, small_min=30):
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
    dump = "--dump" in __import__("sys").argv
    a = np.array(Image.open(SHEET).convert("RGB"))
    bgm = flood_bg(a, a.min(axis=2) >= 248)
    objs, claim = segment_components(a, bgm)
    H, W = a.shape[:2]
    print(f"частей (крупных): {len(objs)}")

    if dump:
        tiles = []
        for k, o in enumerate(objs):
            x0, y0, x1, y1 = o["x0"], o["y0"], o["x1"], o["y1"]
            rgba = cut_object_mask(a, bgm, claim, [k + 1], (x0, y0, x1, y1))
            trimmed = content_trim(rgba)
            if trimmed is None:
                continue
            tiles.append((k, trimmed[0], (x0, y0, x1, y1)))
            print(f"  #{k}: bbox=({x0},{y0},{x1},{y1}) area={o['area']}")
        cols = 8
        cw, ch = 132, 140
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cw, rows * ch), (200, 205, 215, 255))
        dr = ImageDraw.Draw(sheet)
        for i, (k, im, bbox) in enumerate(tiles):
            tx, ty = (i % cols) * cw, (i // cols) * ch
            if im.shape[0] > ch - 20 or im.shape[1] > cw - 4:
                s = min((cw - 4) / im.shape[1], (ch - 20) / im.shape[0])
                im = np.array(Image.fromarray(im, "RGBA").resize(
                    (max(1, int(im.shape[1] * s)), max(1, int(im.shape[0] * s))), Image.NEAREST))
            sheet.paste(Image.fromarray(im, "RGBA"), (tx + 2, ty + 18), Image.fromarray(im, "RGBA"))
            dr.text((tx + 4, ty + 2), f"#{k} {bbox[0]},{bbox[1]}", fill=(120, 0, 0, 255))
        sheet.convert("RGB").save(os.path.join(HERE, "sheet9_dump.png"))
        print("контактка: scripts/sheet9_dump.png")
        return

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
        entry = NAMES9.get(k)
        if entry is None:
            continue
        name, ru = entry
        if name in known_names:
            print(f"  #{k} «{name}»: уже в реестре — пропущен")
            continue
        x0, y0, x1, y1 = o["x0"], o["y0"], o["x1"], o["y1"]
        touches = x0 <= 1 or y0 <= 1 or x1 >= W - 1 or y1 >= H - 1
        if touches and k not in EDGE_OK:
            print(f"  #{k} «{name}»: задет край листа — пропущен")
            continue
        rgba = cut_object_mask(a, bgm, claim, [k + 1], (x0, y0, x1, y1))
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
        # водные декали: вся площадь непроходима (стоят на воде — она и так вода)
        blocking = "1" * (cx * cy)
        added.append({"name": name, "ru": ru, "group": "water", "file": f"{name}.png",
                      "w": cw, "h": ch, "cellsX": cx, "cellsY": cy,
                      "weight": 1, "pass": blocking})
        known_names.add(name)

    if not added:
        print("новых объектов нет — всё уже добавлено")
        return

    meta_path = os.path.join(OUT, "objects.json")
    with open(meta_path, encoding="utf-8") as fh:
        meta = json.load(fh)
    meta["items"].extend(added)
    meta["count"] = len(meta["items"])
    meta["source"] += " + лист 9 «водная поверхность» (scripts/cut_sheet9.py, append-only)"
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
    print(f"реестр: {meta['count']} объектов; перезагрузите редактор (Ctrl+F5)")


if __name__ == "__main__":
    main()
