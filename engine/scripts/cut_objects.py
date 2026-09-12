# Вырезка объектов окружения из артов elven_wood «замени-спрайты-окружения» (2 листа).
# Генерирует: images/objects/<имя>.png (холст кратен 32, якорь — низ-центр),
#             images/objects/objects.json (справочник для движка),
#             images/objects/objects_data.js (data-URL для редактора, работает на file://).
#
# Запуск:  python scripts/cut_objects.py
# Исходники берутся из пакета elven_wood (см. SOURCES). Повторный запуск полностью
# пересоздаёт файлы (идемпотентно).
#
# Конвейер:
#   1. Маска «не белый фон» → связные компоненты (8-связность).
#   2. Фрагменты, чей bbox вложен в расширенный bbox группы (лепестки вокруг кроны),
#      присоединяются к ней; итерации до стабилизации. Мусор (<30px) отбрасывается.
#   3. Прозрачность: ключится ВСЁ чисто-белое (min-канал ≥240) без требования
#      связности — замкнутые просветы между ветвями тоже белые. Светлые детали
#      внутри силуэтов (пергамент, яйца, ствол берёзы) темнее и остаются.
#   4. Еда белой кромки: непрозрачные «белёсые» пиксели (min ≥195, ненасыщенные),
#      соседние с прозрачностью или краем холста, — остатки фона; снимаются волной
#      снаружи внутрь до стабилизации (тёмный контур останавливает волну).
#   5. SHRINK: «мелкие по смыслу» объекты уменьшаются до реальных размеров
#      (связка ключей — 32×32, а не 64×64 как бочка).
#   6. Холст — размер кратно 32 (32…320), контент низ-центр: якорь (0.5, 1).
#   7. Лист 2: кандидаты сравниваются с пулом по сигнатуре (контент 48×48, L1);
#      diff < 9 — повтор уже существующего объекта, не добавляется. Часть слепков
#      «джанк-мержей» и повторов отброшена именами (None в NAMES2).
#   8. PNG — как есть (RGBA); в objects_data.js — WebP-lossless data-URL
#      (P-квантизация PIL портит полупрозрачность tRNS, WebP сохраняет).

import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ART_DIR = r"E:/Program Files/VSCodeProjectLearn/elven_wood/art"
ENV_DIR = ART_DIR + "/окружение"
SOURCES = [
    dict(path=ART_DIR + "/замени-спрайты-окружения-на-прикреплённом-изображе.png", dense=False),
    dict(path=ART_DIR + "/замени-спрайты-окружения-на-прикреплённом-изображе (1).png", dense=False),
    dict(path=ENV_DIR + "/a-tidy-grid-of-isometric-fantasy-game-environment- (1).png", dense=True),
    dict(path=ENV_DIR + "/a-tidy-grid-of-isometric-fantasy-game-environment-.png", dense=True),
]
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "images", "objects"))

# «Реальные размеры»: имя → максимальный размер контента в px (холст остаётся кратен 32)
SHRINK = {
    "keys": 32, "scroll": 32, "book": 32, "leaf_gold": 32, "rune_plate": 32,
    "fairy": 64, "telescope": 64, "jug": 64, "well_tub": 64, "signpost_small": 64,
    # лист 2
    "sun": 32, "leaf_lush": 32, "bird": 32, "grass": 32,
    "sign_park": 64, "signpost_two": 64,
    # листы 3-4 (трава/ростки — мелкая живность на 32)
    "grass_spiky": 32, "grass_dark": 32, "grass_wild": 32, "grass_sprig": 32,
    "scrub_low": 32, "sprout_small": 32,
}

DEDUPE_THRESHOLD = 9.0

# Лист 2: кандидат 8 (обелиск) слился с прудом/деревом/листами — ручной кроп.
# Лист 1: у gem_ice/gem_amber авторасширение bbox захватило кончики соседних
# самоцветов — точные рамки (raw bbox этих камней с полупиксельным запасом).
MANUAL_CROP = {
    (1, 8): (434, 6, 615, 257),
    (0, 21): (963, 67, 992, 110),    # gem_ice — ледяная капля без золотого клина
    (0, 26): (769, 98, 804, 127),    # gem_amber — янтарь без зелёного осколка
    (0, 30): (974, 100, 1018, 132),  # leaf_gold — лист без клина ледяной капли
    (0, 108): (960, 894, 1018, 1018),  # щиты: пиво и рога — без забора и камня
    (2, 4): (466, 25, 622, 258),     # круглое дерево — камыш и камни за границей кропа
    (2, 11): (482, 258, 792, 528),   # белое голое дерево — куст справа не входит
}

# ── Имена листа 1 (индекс = позиция на листе; менять нельзя — в сохранённых картах!) ──
NAMES1 = [
    (0, "crystal_blue", "Хрусталь синий", "magic"),
    (1, "telescope", "Телескоп", "deco"),
    (2, "tree_sakura", "Сакура", "trees"),
    (3, "scroll", "Свиток", "deco"),
    (4, "book", "Книга", "deco"),
    (5, "tree_birch", "Берёза", "trees"),
    (6, "keys", "Ключи", "deco"),
    (7, "fairy", "Фея", "magic"),
    (8, "tree_oak_big", "Дуб старый", "trees"),
    (9, "pond", "Пруд", "water"),
    (10, "jug", "Кувшин", "deco"),
    (11, "vase_orange", "Ваза узорная", "deco"),
    (12, "pot_dark", "Горшок тёмный", "deco"),
    (13, "gem_green", "Самоцвет зелёный", "gems"),
    (14, "gems_blue", "Самоцветы синие", "gems"),
    (15, "gem_teal", "Самоцвет бирюзовый", "gems"),
    (16, "vase_set", "Вазы, набор", "deco"),
    (17, "gem_blue", "Самоцвет синий", "gems"),
    (18, "gem_red", "Самоцвет красный", "gems"),
    (19, "stones", "Камни", "stones"),
    (20, "gems_navy", "Самоцветы: синие", "gems"),
    (21, "gem_ice", "Самоцвет ледяной", "gems"),
    (22, "moss", "Мох", "plants"),
    (23, "tree_topiary", "Топиарий", "trees"),
    (24, "tree_willow", "Ива", "trees"),
    (25, "flowers_lupine", "Люпины", "plants"),
    (26, "gem_amber", "Янтарь", "gems"),
    (27, "sundial_fern", "Солнечные часы", "deco"),
    (28, "gem_purple", "Самоцвет лиловый", "gems"),
    (29, "butterfly_frame", "Бабочки в рамке", "deco"),
    (30, "leaf_gold", "Золотой лист", "deco"),
    (31, "tree_blue_big", "Древо синее", "trees"),
    (32, "tree_lush", "Дерево пышное", "trees"),
    (33, "flowers_pink", "Цветы розовые", "plants"),
    (34, "bush_round_dark", "Куст тёмный", "bushes"),
    (35, "bush_double", "Кусты парой", "bushes"),
    (36, "bush_cypress", "Туя", "bushes"),
    (37, "bush_berry", "Куст с ягодами", "bushes"),
    (38, "bush_round", "Куст круглый", "bushes"),
    (39, "bush_leafy", "Куст лиственный", "bushes"),
    (40, "bush_hedge", "Живая изгородь", "bushes"),
    (41, "moss_patch", "Мох-полянка", "plants"),
    (42, "rock_moss", "Камень со мхом", "stones"),
    (43, "alchemy_table", "Стол алхимика", "craft"),
    (44, "anvil", "Наковальня", "craft"),
    (45, "loom", "Ткацкий станок", "craft"),
    (46, "spinning_wheel", "Прялка", "craft"),
    (47, "runestone", "Рунный камень", "magic"),
    (48, "post_vine", "Столб с хмелем", "deco"),
    (49, "well", "Колодец большой", "buildings"),
    (50, "pottery_bench", "Гончарная лавка", "craft"),
    (51, "easel", "Мольберт", "deco"),
    (52, "shield_wall", "Щит настенный", "deco"),
    (53, "topiary_chime", "Топиарий с подвеской", "deco"),
    (54, "well_tub", "Колодец-корыто", "buildings"),
    (55, "pottery_wheel", "Гончарный круг", "craft"),
    (56, "tools_wall", "Инструменты", "deco"),
    (57, "flower_stand", "Стойка с цветами", "deco"),
    (58, "rock_amphora", "Скала с амфорой", "stones"),
    (59, "rune_plate", "Рунная табличка", "magic"),
    (60, "runestone_moss", "Надгробие", "stones"),
    (61, "fence", "Забор", "buildings"),
    (62, "totem_small", "Тотем малый", "deco"),
    (63, "signpost", "Указатель", "deco"),
    (64, "well_roof", "Колодец с крышей", "buildings"),
    (65, "barrel_owl", "Бочка с совой", "deco"),
    (66, "birdhouses", "Скворечники", "deco"),
    (67, "windchime_lantern", "Фонарь-подвеска", "deco"),
    (68, "totem_deer", "Тотем оленя", "deco"),
    (69, "leaf_deco", "Лист на подставке", "deco"),
    (70, "fountain_small", "Фонтан малый", "buildings"),
    (71, "bench_simple", "Скамья простая", "furniture"),
    (72, "bench_carved", "Скамья резная", "furniture"),
    (73, "table_round", "Стол круглый", "furniture"),
    (74, "planter_flowers", "Клумба", "plants"),
    (75, "torch_deadtree", "Факел на сухом древе", "deco"),
    (76, "watering_can", "Лейка", "deco"),
    (77, "bowl_herbs", "Чаша с травами", "deco"),
    (78, "pot_flowers", "Горшок с цветами", "plants"),
    (79, "crate_plants", "Ящик с растениями", "plants"),
    (80, "pots_clay", "Горшки глиняные", "deco"),
    (81, "loom_workshop", "Ткацкая мастерская", "craft"),
    (82, "log_small", "Пенёк", "stones"),
    (83, "shields_wall", "Щиты на стойках", "deco"),
    (84, "sign_flask_green", "Вывеска зелья", "deco"),
    (85, "sign_flask_purple", "Вывеска зелья лиловая", "deco"),
    (86, "bread_basket", "Корзина хлеба", "deco"),
    (87, "egg_basket", "Корзина яиц", "deco"),
    (88, "signpost_small", "Столбик-указатель", "deco"),
    (89, "notice_board", "Доска объявлений", "deco"),
    (90, "birdbath", "Поилка для птиц", "deco"),
    (91, "hanging_basket", "Подвеска с улиткой", "deco"),
    (92, "antlers", "Рога оленьи", "deco"),
    (93, "barrel", "Бочка", "deco"),
    (94, "signpost_big", "Указатель большой", "deco"),
    (95, "stall", "Торговый навес", "buildings"),
    (96, "chair", "Кресло", "furniture"),
    (97, "table", "Стол", "furniture"),
    (98, "shield_stones", "Щит с камнями", "deco"),
    (99, "pedestal", "Пьедестал", "deco"),
    (100, "statue_face", "Статуя лика", "magic"),
    (101, "pinecones", "Шишки", "plants"),
    (102, "arch_bones", "Арка из костей", "magic"),
    (103, "flowers_blue", "Цветы синие", "plants"),
    (104, "candles", "Канделябр", "magic"),
    (105, "horse_head", "Голова коня", "deco"),
    (106, "tree_palm", "Пальма", "trees"),
    (107, "tree_willow_small", "Ива малая", "trees"),
    (108, "shields_beerhorn", "Щиты: пиво и рога", "deco"),
]

# ── Имена листа 2: k → (name, ru, group); None — повтор или мусорный слепок ──
NAMES2 = {
    0: ("sun", "Солнце", "magic"),
    1: ("tree_white_tall", "Дерево белое высокое", "trees"),
    2: ("sign_park", "Щит «Парк»", "deco"),
    3: ("signpost_two", "Указатель маршрутный", "deco"),
    4: ("owl", "Сова", "deco"),
    5: ("flowers_violet", "Цветы фиолетовые", "plants"),
    6: ("tree_cypress_dark", "Кипарис тёмный", "trees"),
    8: ("obelisk", "Обелиск", "magic"),
    9: ("leaf_lush", "Лист сочный", "plants"),
    12: ("bird", "Птица", "deco"),
    13: ("log_hollow", "Дуплистое бревно", "deco"),
    14: ("grass", "Трава", "plants"),
    15: ("tree_birch_young", "Берёза молодая", "trees"),
    16: ("moss_mounds", "Моховые кочки", "plants"),
    17: ("bush_mound", "Куст-кочка", "bushes"),
    18: ("flowers_white", "Цветы белые", "plants"),
    19: ("stump_lantern", "Пень с фонарём", "deco"),
    20: ("tree_twisted", "Дерево витое", "trees"),
    26: ("bush_wild", "Куст дикий", "bushes"),
    29: ("tree_dead_big", "Мёртвое древо", "trees"),
    30: ("tree_pine", "Ель", "trees"),
    31: ("root_arch", "Корневой тоннель", "trees"),
    32: ("stump_hollow", "Дуплистый пень", "deco"),
    33: ("tree_small", "Дерево малое", "trees"),
    34: ("log_mushrooms", "Бревно с грибами", "deco"),
    39: ("bench_potions", "Лавка со зельями", "craft"),
    43: ("stump_wide", "Пень широкий", "deco"),
    45: ("fountain_pillar", "Фонтан-столб", "buildings"),
    47: ("log_long", "Бревно мшистое", "deco"),
    61: ("bench_ornate", "Скамья узорная", "furniture"),
    66: ("root_workshop", "Корневая мастерская", "buildings"),
    68: ("shields_skull", "Щиты: дракон и череп", "deco"),
    69: ("stump_books", "Пень с книгами", "deco"),
    70: ("root_cauldron", "Корневой котёл", "buildings"),
    71: ("basket_apples", "Корзина яблок", "deco"),
    37: ("fountain_dragon", "Фонтан драконий", "buildings"),
    81: ("fox", "Лиса", "deco"),
    82: ("tree_white_wide", "Дерево белое широкое", "trees"),
    84: ("tree_redroots", "Древо краснокорневое", "trees"),
    86: ("candelabrum", "Канделябр золочёный", "magic"),
    87: ("pegasus", "Пегас", "magic"),
    89: ("totems_tiki", "Тотемы тики", "deco"),
    91: ("shields_mug", "Щиты: пиво и змея", "deco"),
    92: ("stone_bench", "Каменная скамья", "furniture"),
}
# ── Лист 3 (плотный): k → (name, ru, group); отсутствующий k — брак/мусор ──
NAMES3 = {
    3: ("rocks_mound", "Каменная насыпь", "stones"),
    4: ("tree_round", "Дерево круглое", "trees"),
    7: ("palm_tall", "Пальма высокая", "trees"),
    8: ("rock_big", "Валун большой", "stones"),
    11: ("tree_white_bare", "Дерево белое голое", "trees"),
    13: ("tree_bonsai_oak", "Дуб-бонсай", "trees"),
    14: ("grass_tuft", "Кочка травы", "plants"),
    15: ("rock_small", "Камешек малый", "stones"),
    17: ("rock_flat", "Камень плоский", "stones"),
    18: ("grass_spiky", "Трава колючая", "plants"),
    21: ("tree_bonsai_pine", "Сосна-бонсай", "trees"),
    24: ("rocks_wide", "Камни широкие", "stones"),
    26: ("tree_cone", "Дерево конус", "trees"),
    28: ("tree_oak_meadow", "Дуб на поляне", "trees"),
    29: ("rocks_pair", "Камни парой", "stones"),
    31: ("rock_boulder", "Валун", "stones"),
    32: ("tree_bush_tall", "Дерево кустовое", "trees"),
    33: ("tree_mint", "Дерево мятное", "trees"),
    34: ("tree_white_crown", "Дерево с белой кроной", "trees"),
    40: ("grass_big", "Трава большая", "plants"),
    41: ("rock_pebble", "Камень-галка", "stones"),
    42: ("rock_tiny", "Камешек крохотный", "stones"),
    45: ("rocks_two", "Камни двое", "stones"),
    50: ("rocks_pile", "Камни кучей", "stones"),
}

# ── Лист 4 (плотный) ──
NAMES4 = {
    0: ("tree_oak_grove", "Дуб с подлеском", "trees"),
    1: ("tree_spruce_tall", "Ель высокая", "trees"),
    2: ("tree_spruce_fluffy", "Ель пушистая", "trees"),
    3: ("tree_bare_tall", "Дерево голое высокое", "trees"),
    4: ("tree_oak_rock", "Дуб с камнем", "trees"),
    5: ("rock_gray", "Камень серый", "stones"),
    7: ("bush_round_big", "Куст круглый большой", "bushes"),
    8: ("grass_silver", "Трава серебристая", "plants"),
    9: ("tree_tall_thicket", "Дерево с зарослями", "trees"),
    10: ("rocks_small", "Камешки", "stones"),
    11: ("tree_thicket", "Древо-заросли", "trees"),
    13: ("grass_dark", "Трава тёмная", "plants"),
    14: ("tree_bonsai_big", "Бонсай большой", "trees"),
    15: ("grass_small", "Трава малая", "plants"),
    16: ("grass_wild", "Трава дикая", "plants"),
    17: ("tree_bare_bush", "Дерево голое с кустом", "trees"),
    19: ("branch_dry", "Сухая ветка", "deco"),
    21: ("scrub_low", "Кустарник низкий", "bushes"),
    23: ("sprout_conifer", "Хвойный росток", "plants"),
    24: ("grass_bits", "Травинки", "plants"),
    25: ("grass_tall", "Трава высокая", "plants"),
    28: ("sprout_tall", "Росток высокий", "plants"),
    30: ("rock_gray_big", "Камень серый большой", "stones"),
    31: ("bush_big_round", "Куст большой круглый", "bushes"),
    32: ("rock_mossy", "Камень мшистый", "stones"),
    33: ("plant_spiky", "Растение колючее", "plants"),
    35: ("grass_reeds", "Камыш", "plants"),
    36: ("bush_huge", "Куст огромный", "bushes"),
    37: ("scrub_brown", "Кустарник бурый", "bushes"),
    39: ("grass_sprig", "Проросль травы", "plants"),
    40: ("reeds_big", "Камыш большой", "plants"),
    41: ("bush_mossy_pair", "Кусты мшистые парой", "bushes"),
    42: ("sprout_small", "Росток малый", "plants"),
    43: ("rocks_gray_big", "Валуны серые", "stones"),
    44: ("rocks_gray_wide", "Валуны серые широкие", "stones"),
    46: ("grass_sedge", "Осока", "plants"),
}

GROUP_WEIGHT = {"trees": 1, "bushes": 3, "plants": 3, "stones": 2, "gems": 1,
                "magic": 1, "buildings": 1, "craft": 1, "furniture": 1,
                "water": 1, "deco": 2}


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
    """Полуобрезанные чужие изображения: любой компонент альфы, кроме главного,
    который (а) касается края кропа — продолжается за его пределами, или (б) мал и
    лежит вдали от главного силуэта — обрывок соседнего объекта. Удаляется.
    Крупные (>15% главного) обрывки и мелочь рядом с силуэтом (лепестки) остаются."""
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
            continue  # крупная часть самой композиции (фонарь у пня и т.п.)
        ys, xs = np.where(comp)
        touches = (ys.min() == 0 or xs.min() == 0 or ys.max() == h - 1 or xs.max() == w - 1)
        far = not (comp & near_main).any()
        if area < main_area * frac and (touches or far):
            alpha[comp] = 0
        elif touches:
            alpha[comp] = 0
    return rgba


def cut_object(a, global_bg, box):
    """Альфа-ключинг + еда белой кромки + отсечение обрезанных чужих фрагментов."""
    x0, y0, x1, y1 = box
    sub = a[y0:y1, x0:x1]
    bgm = global_bg[y0:y1, x0:x1]
    ring = ndi.binary_dilation(bgm, structure=np.ones((3, 3), int), iterations=2) & ~bgm
    t = sub.min(axis=2).astype(np.float32)
    alpha_f = np.where(bgm, 0.0, np.where(ring, 1.0 - t / 255.0, 1.0))
    af3 = alpha_f[..., None]
    srcf = sub.astype(np.float32)
    cc = np.where(af3 > 0, (srcf - 255.0 * (1.0 - af3)) / np.maximum(af3, 1e-6), srcf)
    rgba = np.dstack([np.clip(cc, 0, 255).astype(np.uint8), (alpha_f * 255).astype(np.uint8)])
    rgba = eat_white_edges(rgba)
    return drop_edge_fragments(rgba)


def segment_dense(a, thr=245, erode=1, attach=6):
    """Для ПЛОТНЫХ листов: bbox-слияние схлопывает сетку в один group. Здесь:
    эрозия рвёт AA-мосты, метки восстанавливаются в полосу кромки, мелкие
    фрагменты (мусор/листва) прикрепляются к ближайшему крупному объекту (≤6px)."""
    mask = ~((a[..., 0] >= thr) & (a[..., 1] >= thr) & (a[..., 2] >= thr))
    st = np.ones((3, 3), bool)
    er = ndi.binary_erosion(mask, structure=st, iterations=erode)
    lab_e, n = ndi.label(er, structure=st)
    lab_full = lab_e.copy()
    for _ in range(erode):
        grow = ndi.grey_dilation(lab_full, size=(3, 3))
        band = mask & (lab_full == 0)
        lab_full[band] = grow[band]
    sizes = ndi.sum(mask, lab_full, range(1, n + 1))
    big_ids = [i for i in range(1, n + 1) if sizes[i - 1] >= 400]
    small_ids = [i for i in range(1, n + 1) if 30 <= sizes[i - 1] < 400]
    big_mask = np.isin(lab_full, big_ids)
    dist, (iy, ix) = ndi.distance_transform_edt(~big_mask, return_indices=True)
    big_label_at = np.zeros_like(lab_full)
    big_label_at[big_mask] = lab_full[big_mask]
    groups = {i: [i] for i in big_ids}
    for si in small_ids:
        ys, xs = np.where(lab_full == si)
        if len(ys) == 0:
            continue
        d = dist[ys, xs]
        if d.min() <= attach:
            py, px = ys[int(np.argmin(d))], xs[int(np.argmin(d))]
            tgt = int(big_label_at[iy[py, px], ix[py, px]])
            groups.setdefault(tgt, []).append(si)
        elif len(ys) >= 60:
            groups[si] = [si]
    objs = []
    for members in groups.values():
        pts = np.isin(lab_full, members)
        ys, xs = np.where(pts)
        o = dict(x0=int(xs.min()), y0=int(ys.min()), x1=int(xs.max()) + 1, y1=int(ys.max()) + 1,
                 area=int(sum(sizes[m - 1] for m in members)))
        if o["area"] >= 30 and max(o["x1"] - o["x0"], o["y1"] - o["y0"]) >= 8:
            objs.append(o)
    objs.sort(key=lambda o: (o["y0"] // 96, o["x0"]))
    return objs


def segment(a):
    """Связные компоненты + слияние вложенных фрагментов → [bbox], сортировка как на листе."""
    mask = ~((a[..., 0] >= 245) & (a[..., 1] >= 245) & (a[..., 2] >= 245))
    lab, n = ndi.label(mask, structure=np.ones((3, 3), int))
    comps = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        if sl is None:
            continue
        ys, xs = sl
        comps.append(dict(x0=xs.start, y0=ys.start, x1=xs.stop, y1=ys.stop,
                          area=int((lab[sl] == i + 1).sum())))
    assign = list(range(len(comps)))

    def group_of(i):
        while assign[i] != i:
            i = assign[i]
        return i

    def group_bbox(g):
        members = [i for i in range(len(comps)) if group_of(i) == g]
        return (min(comps[i]["x0"] for i in members), min(comps[i]["y0"] for i in members),
                max(comps[i]["x1"] for i in members), max(comps[i]["y1"] for i in members))

    changed = True
    while changed:
        changed = False
        for ci in range(len(comps)):
            c = comps[ci]
            for d in range(len(comps)):
                gd = group_of(d)
                if gd == group_of(ci):
                    continue
                db = group_bbox(gd)
                pad = 4
                if (c["x0"] >= db[0] - pad and c["y0"] >= db[1] - pad and
                        c["x1"] <= db[2] + pad and c["y1"] <= db[3] + pad):
                    assign[max(group_of(ci), gd)] = min(group_of(ci), gd)
                    changed = True

    groups = {}
    for i in range(len(comps)):
        groups.setdefault(group_of(i), []).append(i)
    objs = []
    for members in groups.values():
        o = dict(x0=min(comps[i]["x0"] for i in members),
                 y0=min(comps[i]["y0"] for i in members),
                 x1=max(comps[i]["x1"] for i in members),
                 y1=max(comps[i]["y1"] for i in members),
                 area=sum(comps[i]["area"] for i in members))
        if o["area"] >= 30 and max(o["x1"] - o["x0"], o["y1"] - o["y0"]) >= 8:
            objs.append(o)
    objs.sort(key=lambda o: (o["y0"] // 96, o["x0"]))
    return objs


def refine_bbox(a, o):
    """Блок уточняется по ослабленному порогу белого (238) — белые лепестки не срезаются."""
    x0, y0, x1, y1 = o["x0"], o["y0"], o["x1"], o["y1"]
    wx0, wy0 = max(0, x0 - 8), max(0, y0 - 8)
    wx1, wy1 = min(a.shape[1], x1 + 8), min(a.shape[0], y1 + 8)
    sub = a[wy0:wy1, wx0:wx1]
    loose = ~((sub[..., 0] >= 238) & (sub[..., 1] >= 238) & (sub[..., 2] >= 238))
    llab, ln = ndi.label(loose, structure=np.ones((3, 3), int))
    keep = np.zeros_like(loose)
    for i in range(1, ln + 1):
        ys, xs = np.where(llab == i)
        gx0, gx1 = xs.min() + wx0, xs.max() + wx0
        gy0, gy1 = ys.min() + wy0, ys.max() + wy0
        if gx1 >= x0 and gx0 <= x1 - 1 and gy1 >= y0 and gy0 <= y1 - 1:
            keep |= llab == i
    ys, xs = np.where(keep)
    if len(xs):
        x0 = min(x0, int(xs.min()) + wx0); y0 = min(y0, int(ys.min()) + wy0)
        x1 = max(x1, int(xs.max()) + wx0 + 1); y1 = max(y1, int(ys.max()) + wy0 + 1)
    return x0, y0, x1, y1


def signature(im, size=48):
    """Контент, вписанный в квадрат (низ-центр): RGB поверх серого + альфа."""
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


# ── 1. Разбор источников ─────────────────────────────────────────────────────
accepted = []   # [{name, ru, group, rgba(массив холста), w, h, ...}]
pool_sigs = []  # сигнатуры уже принятых (для дедупликации листа 2)

for src_idx, src in enumerate(SOURCES):
    a = np.array(Image.open(src["path"]).convert("RGB"))
    mn_all = a.min(axis=2)
    global_bg = mn_all >= 240
    objs = segment_dense(a) if src["dense"] else segment(a)
    H, W = a.shape[:2]
    names_src = {0: None, 1: NAMES2, 2: NAMES3, 3: NAMES4}[src_idx]

    if src_idx == 0:
        assert len(objs) == len(NAMES1), f"лист 1: объектов {len(objs)}, имён {len(NAMES1)}"
        tables = [(k, o, NAMES1[k]) for k, o in enumerate(objs)]
    elif src_idx == 1:
        tables = [(k, o, NAMES2[k]) for k, o in enumerate(objs) if k in NAMES2]
    else:
        # плотные листы: unlisted k — мусор/повтор; объект, задевающий край
        # изображения, обрезан — не используем (правило пользователя)
        tables = [(k, o, names_src[k]) for k, o in enumerate(objs)
                  if k in names_src and not (o["x0"] <= 1 or o["y0"] <= 1 or
                                             o["x1"] >= W - 1 or o["y1"] >= H - 1)]

    for k, o, table in tables:
        if (src_idx, k) in MANUAL_CROP:
            box = MANUAL_CROP[(src_idx, k)]
        else:
            box = refine_bbox(a, o)
        rgba = cut_object(a, global_bg, box)
        _, name, ru, group = table if len(table) == 4 else (None,) + table

        # «реальные размеры»: контент кропается вплотную, мелкие по смыслу
        # объекты уменьшаются до целевого размера (холст остаётся кратен 32)
        im = Image.fromarray(rgba, "RGBA")
        arr = np.array(im)
        ys, xs = np.where(arr[..., 3] > 8)
        if len(xs):
            im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
        target = SHRINK.get(name)
        cw, ch = im.size
        if os.environ.get("OBJDEBUG"):
            print(f"[dbg] {name}: content={cw}x{ch} target={target}")
        if target and max(cw, ch) > target:
            s = target / max(cw, ch)
            im = im.resize((max(1, int(cw * s)), max(1, int(ch * s))), Image.LANCZOS)
            if os.environ.get("OBJDEBUG"):
                print(f"[dbg] {name}: после shrink {im.size}")
        rgba = np.array(im)

        if src_idx > 0:
            # дедупликация: diff < порога → повтор уже принятого объекта
            sig = signature(Image.fromarray(rgba, "RGBA"))
            if sig is not None and pool_sigs:
                dists = [np.abs(sig - s2).mean() for s2 in pool_sigs]
                if min(dists) < DEDUPE_THRESHOLD:
                    print(f"  лист2 #{k}: повтор «{name}» (diff {min(dists):.1f}) — пропущен")
                    continue
        sig = signature(Image.fromarray(rgba, "RGBA"))
        if sig is not None:
            pool_sigs.append(sig)

        accepted.append(dict(name=name, ru=ru, group=group, rgba=rgba))

# ── 2. Холсты (кратны 32, низ-центр) и сохранение ────────────────────────────
os.makedirs(OUT, exist_ok=True)
items = []
for it in accepted:
    rgba = it["rgba"]
    h, w = rgba.shape[:2]
    cw = max(32, min(512, math.ceil(w / 32) * 32))
    ch = max(32, min(512, math.ceil(h / 32) * 32))
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    canvas.paste(Image.fromarray(rgba, "RGBA"), ((cw - w) // 2, ch - h))
    canvas.save(os.path.join(OUT, f"{it['name']}.png"), optimize=True)
    cx, cy = cw // 32, ch // 32
    # проходимость по умолчанию: непроходима нижняя строка (корни/ствол/основание),
    # для объектов в 1 клетку — сама клетка
    items.append({"name": it["name"], "ru": it["ru"], "group": it["group"],
                  "file": f"{it['name']}.png",
                  "w": cw, "h": ch, "cellsX": cx, "cellsY": cy,
                  "weight": GROUP_WEIGHT[it["group"]],
                  "pass": "0" * (cx * (cy - 1)) + "1" * cx})

meta = dict(source="elven_wood, листы «замени-спрайты-окружения» 1–2", tileSize=32,
            anchor="bottom-center", density=12, count=len(items), items=items)
with open(os.path.join(OUT, "objects.json"), "w", encoding="utf-8") as fh:
    json.dump(meta, fh, ensure_ascii=False, indent=1)

# ── 3. objects_data.js — data-URL (WebP lossless: полная альфа) ──────────────
import base64
import io

def data_url(path):
    im = Image.open(path).convert("RGBA")
    buf = io.BytesIO()
    im.save(buf, "WEBP", lossless=True)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()

lines = ["// Автосгенерировано scripts/cut_objects.py (objects.json + PNG рядом).",
         "// Не править вручную — перезапустите скрипт.",
         "window.DUALGRID_OBJECTS = {",
         "  tileSize: 32, densityDefault: 12,",
         "  items: ["]
for it in items:
    lines.append("    " + json.dumps({**it, "png": data_url(os.path.join(OUT, it["file"]))},
                                     ensure_ascii=False) + ",")
lines.append("  ],\n};")
with open(os.path.join(OUT, "objects_data.js"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))

# осиротевшие png прежних имён больше не нужны
known = {i["file"] for i in items}
for f in os.listdir(OUT):
    if f.endswith(".png") and f not in known:
        os.remove(os.path.join(OUT, f))
        print("удалён осиротевший", f)

total = sum(os.path.getsize(os.path.join(OUT, i["file"])) for i in items)
print(f"готово: {len(items)} объектов ({total // 1024} КБ PNG), objects_data.js "
      f"{os.path.getsize(os.path.join(OUT, 'objects_data.js')) // 1024} КБ")
