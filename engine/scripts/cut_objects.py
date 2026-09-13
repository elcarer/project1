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
    # листы 5-6 (руины / эльфийские руины): белая и ЖЕЛТОВАЯ В КРАПКУ заливки фона
    dict(path=ENV_DIR + "/замени-спрайты-окружения-на-прикреплённом-изображе (1).png", dense=False, bg="white"),
    dict(path=ENV_DIR + "/замени-спрайты-окружения-на-прикреплённом-изображе.png", dense=False, bg="beige"),
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
    # листы 5-6
    "pebbles_tiny": 32,
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
                "water": 1, "deco": 2, "ruins": 2}

# ── Лист 5 (белый фон, каменные руины): k → (name, ru, group) | None | [сплиты] ──
# Сплит: (x0, y0, x1, y1, name, ru, group) — прямоугольник в координатах листа.
NAMES5 = {
    0: ("sun_big", "Солнце большое", "magic"),
    1: ("signpost_trail", "Указатель «Тропа»", "deco"),
    2: ("tower_fire", "Башня с обгоревшим верхом", "ruins"),
    3: ("signpost_cross", "Указатель развилки", "deco"),
    4: ("owl_eared", "Сова ушастая", "deco"),
    5: ("stones_drift", "Камушки россыпью", "stones"),
    6: ("column_stump", "Культая колонна", "ruins"),
    7: ("tower_tall", "Башня высокая руинированная", "ruins"),
    8: ("amphora_broken", "Амфора разбитая", "ruins"),
    9: ("pond_puddle", "Лужа", "water"),
    10: ("jug_shards", "Кувшин с осколками", "ruins"),
    11: ("tree_dead_small", "Сухое деревце", "trees"),
    12: ("column_lie", "Барабан колонны лежит", "ruins"),
    13: ("crystal_roots", "Кристалл в корнях", "magic"),
    14: ("pebbles_mound", "Галька кучей", "stones"),
    15: ("rubble_pile", "Обломки кучей", "ruins"),
    16: ("dove_white", "Голубь белый", "deco"),
    17: ("stone_spiral", "Камень со спиралями", "ruins"),
    18: ("column_fallen", "Колонна упавшая", "ruins"),
    19: ("pebbles_small", "Галька мелкая", "stones"),
    20: ("column_tall", "Колонна целая", "ruins"),
    21: ("column_plinth", "Колонна с плинфусом", "ruins"),
    22: ("column_knob", "Колонна с капителью", "ruins"),
    23: ("arch_ruin", "Арка руинированная", "ruins"),
    24: ("stump_rooted", "Пень с корнями", "trees"),
    25: None,
    26: ("columns_lie_pair", "Барабаны парой", "ruins"),
    27: ("column_broken_small", "Колонна сломанная малая", "ruins"),
    28: ("column_drum", "Барабан колонны большой", "ruins"),
    29: ("column_base", "Колонна на базе", "ruins"),
    30: [(575, 260, 639, 322, "column_stub", "Колонна обломок", "ruins"),
         (575, 322, 639, 385, "stump_open", "Пень с дуплом", "trees")],
    31: ("column_piece", "Колонна фрагмент", "ruins"),
    32: ("pebbles_pile", "Камни горкой", "stones"),
    33: ("ruins_floor", "Мозаика руин", "ruins"),
    34: ("brush_dry", "Сухостой кустовой", "plants"),
    35: ("stones_drygrass", "Камни с сухостоем", "stones"),
    36: ("pebbles_rubble", "Галька с обломками", "stones"),
    37: ("wing_white", "Крыло каменное", "deco"),
    38: ("stump_boulder", "Пень с валунами", "trees"),
    39: ("tree_dead_branchy", "Сухостой ветвистый большой", "trees"),
    40: ("tower_round", "Башня круглая руина", "ruins"),
    41: [(404, 341, 558, 504, "root_tunnel", "Корневой тоннель", "trees"),
         (456, 500, 505, 578, "signpost_mini", "Указатель малый", "deco")],
    42: ("tree_dead_sparse", "Сухое дерево редкое", "trees"),
    43: ("log_massive", "Бревно огромное", "deco"),
    44: [(838, 358, 961, 573, "rocks_cairn", "Камни пирамидой", "stones"),
         (838, 573, 961, 637, "lantern_herbs", "Фонарь с травами", "deco")],
    45: ("runestone_blue", "Рунный камень синий", "magic"),
    46: [(0, 764, 64, 836, "sign_boot", "Вывеска с сапогом", "deco"),
         (64, 764, 128, 836, "sign_swords", "Вывеска с мечами", "deco"),
         (128, 764, 194, 836, "sign_anvil", "Вывеска с наковальней", "deco")],
    47: ("vine_pillar", "Столб из лиан", "deco"),
    48: ("bench_jugs", "Лавка с кувшинами", "craft"),
    49: ("board_stars", "Доска звёздная", "magic"),
    50: ("windchime_wall", "Вертушка настенная", "deco"),
    51: ("stump_low", "Пень-подставка", "deco"),
    52: [(582, 447, 634, 512, "well_old", "Колодец ветхий", "buildings"),
         (582, 512, 634, 577, "well_stone", "Колодец каменный", "buildings")],
    53: ("bowl_stone", "Ступа каменная", "deco"),
    54: ("mat_tools", "Ковёр с инструментами", "deco"),
    55: ("log_wide", "Бревно длинное", "deco"),
    56: [(771, 458, 829, 518, "wood_arbor", "Дровник", "buildings"),
         (771, 518, 829, 574, "basket_hanging", "Корзина подвесная", "deco")],
    57: ("menhir_round", "Менгир округлый", "ruins"),
    58: ("slab_rune", "Плита рунная", "ruins"),
    59: ("fence_wattle", "Забор плетёный", "buildings"),
    60: ("statue_idol", "Идол деревянный", "deco"),
    61: ("tree_snag", "Коряга", "trees"),
    62: [(639, 524, 694, 584, "barrel_large", "Бочка большая", "deco"),
         (639, 584, 694, 641, "owl_branch", "Сова на ветке", "deco")],
    63: ("birdhouse_post", "Скворечники на столбе", "deco"),
    64: ("lamppost_small", "Фонарик на ножке", "deco"),
    65: ("totem_winged", "Тотем крылатый", "deco"),
    66: [(320, 654, 390, 706, "leaf_big", "Лист дубовый", "plants"),
         (390, 654, 456, 706, "bench_garden", "Скамья садовая", "furniture"),
         (456, 654, 514, 706, "table_spill", "Стол-спил", "furniture")],
    67: ("stone_armchair", "Кресло каменное", "furniture"),
    68: ("bench_high", "Скамья со спинкой", "furniture"),
    69: ("tray_mushrooms", "Лоток с грибами", "deco"),
    70: [(511, 579, 577, 636, "sconce_stand", "Факел на стойке", "deco"),
         (511, 636, 577, 700, "tree_twist_mini", "Деревце витое", "trees"),
         (511, 700, 577, 769, "board_notice_small", "Доска сообщений", "deco")],
    71: ("watering_can_big", "Лейка большая", "deco"),
    72: ("bowl_wide", "Чаша широкая", "deco"),
    73: ("log_carved", "Бревно резное", "deco"),
    74: [(703, 650, 769, 716, "pots_triplet", "Горшки тройкой", "deco"),
         (703, 716, 769, 761, "skulls_pile", "Черепа кучей", "magic")],
    75: [(781, 576, 822, 646, "herbs_hang", "Травы подвешенные", "deco"),
         (781, 646, 822, 704, "lantern_iron", "Фонарь железный", "deco")],
    76: ("forge_big", "Кузница", "craft"),
    77: ("column_pedestal", "Пьедестал колонны", "ruins"),
    78: ("sign_bird", "Вывеска с птицей", "deco"),
    79: ("sign_mug", "Вывеска с кружкой", "deco"),
    80: ("stump_table", "Пень-стол", "furniture"),
    81: ("well_root", "Колодец корневой", "buildings"),
    82: ("basket_empty", "Корзина пустая", "deco"),
    83: ("signpost_arrows", "Указатель со стрелками", "deco"),
    84: [(589, 712, 629, 746, "birdbath_bowl", "Поилка птичья", "deco"),
         (589, 746, 629, 769, "planter_clay", "Кашпо глиняное", "deco")],
    85: [(639, 711, 690, 776, "statue_deer", "Статуя оленя", "deco"),
         (639, 776, 690, 826, "basket_rope", "Корзина на верёвке", "deco")],
    86: ("pot_small", "Горшочек", "deco"),
    87: ("barrel_marked", "Бочка с меткой", "deco"),
    88: None,
    89: ("pavilion_tattered", "Навес рваный", "buildings"),
    90: ("shield_rocks", "Щит на камнях", "deco"),
    91: ("chalice_stone", "Кубок каменный", "ruins"),
    92: ("mushrooms_red", "Грибы красные", "plants"),
    93: None,
    94: ("stonecircle_rune", "Кромлех рунный", "ruins"),
    95: ("pinecones_pair", "Шишки парой", "plants"),
    96: ("chain", "Цепь", "deco"),
    97: ("amphora_cracked", "Амфора треснутая", "ruins"),
    98: ("horse_wood", "Конь деревянный", "deco"),
    99: None,
    100: None,
    101: ("fence_branch", "Забор из жердей", "buildings"),
    102: None,
    103: None,
}

# ── Лист 6 (бежевый крапчатый фон, эльфийские руины) ──
NAMES6 = {
    0: ("sun_warm", "Солнце рыжее", "magic"),
    4: ("obelisk_mossy", "Обелиск с лианами", "ruins"),
    5: ("flowers_lilac", "Цветы сиреневые", "plants"),
    6: [(326, 9, 392, 262, "column_frag", "Колонна обломок с плитой", "ruins"),
        (392, 9, 641, 262, "stump_plaza", "Пень древний с площадкой", "ruins")],
    7: ("column_mossy", "Колонна мшистая", "ruins"),
    8: ("stump_split", "Пень расколотый", "deco"),
    9: ("pond_round", "Пруд круглый", "water"),
    10: [(703, 15, 770, 66, "leaves_pair", "Листья парой", "plants"),
         (770, 15, 832, 66, "log_mossy", "Бревно мшистое", "deco")],
    12: [(769, 68, 830, 128, "crystal_rooted", "Кристалл корневой", "magic"),
         (830, 68, 897, 128, "pebbles_heap", "Галька ворохом", "stones")],
    14: ("dove_brown", "Голубь бурый", "deco"),
    17: ("grass_dry", "Трава сухая", "plants"),
    18: ("tree_birch_dark", "Берёза тёмная", "trees"),
    19: ("stump_ancient", "Пень древний", "trees"),
    20: ("rocks_pile_small", "Камни кучкой", "stones"),
    21: ("arch_moss", "Арка мшистая", "ruins"),
    22: ("flowers_dry", "Сухоцветы", "plants"),
    23: ("stump_hollow_moss", "Пень дуплистый мшистый", "trees"),
    24: ("root_hook", "Корень дугой", "deco"),
    25: ("tree_twisted_vine", "Дерево витое с лианами", "trees"),
    26: ("brush_tangle", "Хворост переплетённый", "deco"),
    27: ("brush_wreath", "Хворост венком", "deco"),
    28: ("brush_dry_small", "Кустик сухой", "plants"),
    29: ("pebbles_tiny", "Камешки малые", "stones"),
    30: [(574, 259, 640, 312, "snag_branchy", "Сухостой ветвистый", "trees"),
         (574, 312, 640, 388, "stump_mossy", "Пень мшистый с дуплом", "trees")],
    31: ("snag_bare", "Сухостой голый", "trees"),
    32: [(703, 265, 762, 332, "bush_green", "Куст зелёный пышный", "bushes"),
         (703, 332, 820, 384, "log_moss_big", "Бревно с мхом", "deco")],
    33: ("brush_snarl", "Хворост сплетение", "deco"),
    34: ("reeds_dry", "Камыш сухой", "plants"),
    35: ("moss_bed", "Мох-подушка", "plants"),
    37: ("boulder_green", "Валун мшистый", "stones"),
    38: ("wall_corner", "Стена руин с обломками", "ruins"),
    39: ("wall_vine", "Стена с лианами", "ruins"),
    40: ("columns_pair", "Колонны парой", "ruins"),
    41: [(402, 337, 518, 490, "root_arch_dry", "Корневая арка", "trees"),
         (518, 337, 558, 440, "windchime_dry", "Подвеска сухая", "deco"),
         (455, 488, 506, 578, "signpost_way", "Указатель пути", "deco")],  # пусто: убрать?
    42: [(649, 355, 698, 440, "snag_thin", "Сухостой тонкий", "trees"),
         (649, 440, 698, 514, "birdbath_stone", "Поилка каменная", "deco")],
    43: [(836, 357, 960, 505, "cairn_moss", "Камни пирамидой мшистые", "stones"),
         (836, 573, 960, 637, "lantern_herbal", "Фонарь травник", "deco")],
    45: [(5, 459, 317, 784, "root_plaza", "Корневая площадка", "ruins"),
         (62, 786, 128, 834, "sign_swords_m", "Вывеска с мечами мшистая", "deco"),
         (126, 786, 192, 834, "sign_anvil_m", "Вывеска с наковальней мшистая", "deco"),
         (190, 786, 256, 834, "sign_bird_m", "Вывеска с птицей мшистая", "deco")],
    47: [(319, 448, 390, 514, "bench_pottery", "Лавка гончара", "craft"),
         (390, 448, 445, 514, "board_night", "Доска ночная", "magic")],
    48: [(508, 446, 578, 514, "chime_bronze", "Вертушка бронзовая", "deco"),
         (578, 446, 640, 547, "well_gable", "Колодец с фронтоном", "buildings"),
         (508, 514, 578, 591, "topiary_ball", "Топиарий шаровый", "bushes"),
         (508, 591, 578, 654, "totem_beast", "Тотем зверя", "deco"),
         (508, 654, 578, 719, "snag_pale", "Сухостой бледный", "trees"),
         (508, 719, 578, 770, "board_notice", "Доска объявлений старая", "deco")],
    50: [(706, 457, 768, 520, "tools_rug", "Ковёр инструментальный", "deco"),
         (768, 450, 831, 520, "arbor_wood", "Навес дровяной", "buildings"),
         (770, 515, 831, 585, "planter_hang", "Кашпо с растениями", "deco")],
    52: ("menhir_moss", "Менгир мшистый", "ruins"),
    54: [(318, 529, 384, 585, "fence_lattice", "Забор решётчатый", "buildings"),
         (318, 585, 384, 640, "armchair_moss", "Кресло мшистое", "furniture")],
    56: [(640, 523, 694, 585, "barrel_hoop", "Бочка обручная", "deco"),
         (640, 585, 694, 640, "owl_perch", "Сова на суке", "deco")],
    57: ("birdhouses_trio", "Скворечники тройкой", "deco"),
    58: [(780, 572, 825, 645, "chime_pine", "Подвеска шишкой", "deco"),
         (780, 645, 825, 706, "lantern_moss", "Фонарь с мхом", "deco")],
    61: ("bench_broken", "Скамья сломанная", "furniture"),
    62: ("tray_antlers", "Лоток с рогами", "deco"),
    63: [(698, 640, 772, 712, "pots_triplet_m", "Горшки тройкой мшистые", "deco"),
         (712, 698, 782, 775, "skulls_pile_m", "Черепа кучей мшистые", "magic"),
         (640, 703, 715, 777, "deer_topiary", "Топиарий олень", "bushes"),
         (608, 768, 680, 835, "mushrooms_red_m", "Грибы красные мшистые", "plants"),
         (652, 763, 722, 835, "basket_hang_m", "Корзина подвесная мшистая", "deco")],
    65: [(578, 649, 639, 712, "bowl_moss", "Чаша с мхом", "deco"),
         (578, 712, 639, 770, "birdbath_moss", "Поилка мшистая", "deco")],
    66: ("pot_bloom", "Горшок в цвету", "plants"),
    67: ("planter_log", "Корыто с растениями", "plants"),
    68: ("forge_root", "Кузница корневая", "craft"),
    69: ("column_leaf", "Столб с листьями", "ruins"),
    70: ("sign_mug_m2", "Вывеска с кружкой бурая", "deco"),
    71: ("stump_table_m", "Пень-стол мшистый", "furniture"),
    72: [(395, 717, 445, 772, "basket_apple_m", "Корзина яблок мшистая", "deco"),
         (333, 792, 500, 897, "well_root_m", "Колодец корневой мшистый", "buildings")],
    73: ("sign_boot_m", "Вывеска с сапогом мшистая", "deco"),
    74: ("lamppost_signs", "Фонарь с указателями", "deco"),
    75: ("pavilion_flowers", "Навес цветочный", "buildings"),
    78: ("pinecones_trio", "Шишки тройкой", "plants"),
    79: ("rune_gate", "Врата рунные", "ruins"),
    80: ("branches_hedge", "Заросли кустовые", "deco"),
    81: ("candles_white", "Канделябр восковой", "magic"),
    84: ("willow_white", "Ива белая", "trees"),
    86: [(961, 896, 1022, 962, "shield_ale", "Щит с элем", "deco"),
         (961, 962, 1022, 1023, "shield_snake", "Щит со змеёй", "deco")],
}

# Объекты, которые касаются края листа, но проверены визуально как целые
# (касается только тень/подошва/кончик): (src_idx, k)
KEEP_EDGE = {(4, 1), (4, 3), (4, 46), (4, 65), (4, 89), (5, 37), (5, 73),
             (5, 74), (5, 75), (5, 79), (5, 84), (5, 86)}

# Принудительно оставить, несмотря на похожесть сигнатуры на уже принятый
# объект (проверено глазами: другой предмет, а не повтор-генерация)
FORCE_KEEP = {(5, 74), (5, 18)}

BGC_BEIGE = np.array([229.0, 211.0, 173.0])

# Замкнутые карманы фона внутри силуэтов (дыры плетёнок/арок), проверенные
# визуально: фон внутри удаляется безусловно. Критерий — цвет фона листа.
KEY_INNER_HOLES = {
    "root_tunnel", "wood_arbor", "leaf_big", "fence_branch", "stonecircle_rune",
    "brush_tangle", "brush_wreath", "brush_snarl", "snag_bare", "snag_branchy",
    "stump_mossy", "root_arch_dry", "windchime_dry", "arbor_wood", "fence_lattice",
    "branches_hedge", "arch_moss", "lantern_herbal",
}


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


# ── Листы 5-6: флуд-ключинг фона, компонентная сегментация, mask-cut ─────────

def flood_bg(a, cand):
    """Флуд от краёв изображения по кандидатам на фон."""
    lab, n = ndi.label(cand, structure=np.ones((3, 3), int))
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    return np.isin(lab, list(border))


def bgmask_white_flood(a, thr=248):
    """Белый фон: флуд от краёв по почти-белому (внутренние блики голубя/
    пергамента, отрезанные от фона силуэтом, не затрагиваются)."""
    return flood_bg(a, a.min(axis=2) >= thr)


def bgmask_beige(a, T=40, speck=25):
    """Бежевый фон в крапинку: дистанция цвета до бежевого + флуд от краёв,
    затем мелкие острова-крапинки убираются в фон."""
    d = np.sqrt(((a.astype(np.float32) - BGC_BEIGE) ** 2).sum(axis=2))
    bgm = flood_bg(a, d < T)
    solid = ~bgm
    lab, n = ndi.label(solid, structure=np.ones((3, 3), int))
    sizes = ndi.sum(solid, lab, range(1, n + 1))
    bgm |= np.isin(lab, [i + 1 for i in range(n) if sizes[i] < speck])
    return bgm


def segment_components(a, bgm, pad=4, big_min=300, small_min=30):
    """Крупные компоненты (>=big_min px) = объекты; мелкие (small_min..big_min)
    прикрепляются к единственному крупному, в чей padded bbox они попадают;
    непривязанные мелкие — мусор (крапинки, обрывки). Возврат: (objs, claim),
    claim — карта меток групп (номер объекта + 1) для mask-cut."""
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
    used = set()
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
            used.add(id(s))
    objs = sorted(bigs, key=lambda o: (o["y0"] // 96, o["x0"]))
    claim = np.zeros(a.shape[:2], np.int32)
    for gi, o in enumerate(objs):
        claim[np.isin(lab, o["members"])] = gi + 1
    return objs, claim


def eat_bg_edges(rgba, bgc, thr=50, max_iters=8):
    """Аналог eat_white_edges для цветного фона: пиксели цвета фона
    (дистанция < thr) с внешнего края снимаются волной снаружи."""
    alpha = rgba[..., 3].copy()
    rgb = rgba[..., :3].astype(np.float32)
    bgish = np.sqrt(((rgb - bgc) ** 2).sum(axis=2)) < thr
    st = np.ones((3, 3), bool)
    for _ in range(max_iters):
        opaque = alpha > 0
        if not opaque.any():
            break
        near = ndi.binary_dilation(~opaque, structure=st) & opaque
        near[0, :] |= opaque[0, :]; near[-1, :] |= opaque[-1, :]
        near[:, 0] |= opaque[:, 0]; near[:, -1] |= opaque[:, -1]
        eat = near & bgish
        if not eat.any():
            break
        alpha[eat] = 0
    rgba[..., 3] = alpha
    return rgba


def cut_object_mask(a, bgm, claim, allowed, box, bgc=None):
    """Вырезка по маске СВОЕГО компонента (соседи в прямоугольнике не попадают).
    bgc None — белый фон (un-blend к белому), иначе массив цвета фона."""
    x0, y0, x1, y1 = box
    sub = a[y0:y1, x0:x1].astype(np.float32)
    bgm_s = bgm[y0:y1, x0:x1]
    own = np.isin(claim[y0:y1, x0:x1], allowed)
    keep = (~bgm_s) & own
    ring = ndi.binary_dilation(~keep, structure=np.ones((3, 3), int), iterations=2) & keep
    if bgc is None:
        t = sub.min(axis=2)
        alpha_f = np.where(bgm_s | ~keep, 0.0, np.where(ring, 1.0 - t / 255.0, 1.0))
        af3 = alpha_f[..., None]
        cc = np.where(af3 > 0, (sub - 255.0 * (1.0 - af3)) / np.maximum(af3, 1e-6), sub)
        rgba = np.dstack([np.clip(cc, 0, 255).astype(np.uint8), (alpha_f * 255).astype(np.uint8)])
        rgba = eat_white_edges(rgba)
    else:
        dist = np.sqrt(((sub - bgc) ** 2).sum(axis=2))
        alpha_f = np.where(bgm_s | ~keep, 0.0,
                           np.where(ring, np.clip(dist / 110.0, 0.0, 1.0) ** 1.5, 1.0))
        alpha_f[alpha_f < 0.12] = 0.0
        af3 = alpha_f[..., None]
        cc = np.where(af3 > 0, (sub - bgc * (1.0 - af3)) / np.maximum(af3, 1e-6), sub)
        rgba = np.dstack([np.clip(cc, 0, 255).astype(np.uint8), (alpha_f * 255).astype(np.uint8)])
        rgba = eat_bg_edges(rgba, bgc)
    return drop_edge_fragments(rgba)


def content_trim(rgba, pad=1):
    """Кроп контента вплотную (+pad). Возврат (массив, x0, y0, x1, y1 в листе)."""
    ys, xs = np.where(rgba[..., 3] > 8)
    if not len(xs):
        return None
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    sx0 = max(0, x0 - pad); sy0 = max(0, y0 - pad)
    sx1 = min(rgba.shape[1], x1 + pad); sy1 = min(rgba.shape[0], y1 + pad)
    return rgba[sy0:sy1, sx0:sx1], sx0, sy0, sx1, sy1


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

for src_idx, src in enumerate(SOURCES[:4]):
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

# ── 1б. Листы 5-6: руинные, флуд-фон, компоненты, mask-cut ───────────────────
for src_idx in (4, 5):
    src = SOURCES[src_idx]
    a = np.array(Image.open(src["path"]).convert("RGB"))
    beige = src["bg"] == "beige"
    bgm = bgmask_beige(a) if beige else bgmask_white_flood(a)
    objs, claim = segment_components(a, bgm)
    bgc = BGC_BEIGE if beige else None
    names_src = NAMES5 if src_idx == 4 else NAMES6
    H, W = a.shape[:2]
    for k, o in enumerate(objs):
        entry = names_src.get(k)
        if entry is None:
            continue
        parts = entry if isinstance(entry, list) else [(o["x0"], o["y0"], o["x1"], o["y1"]) + entry]
        for part in parts:
            bx0, by0, bx1, by1, name, ru, group = part
            rgba = cut_object_mask(a, bgm, claim, [k + 1], (bx0, by0, bx1, by1), bgc)
            if name in KEY_INNER_HOLES:
                if bgc is None:
                    rgba[..., 3][rgba[..., :3].min(axis=2) >= 243] = 0
                else:
                    dd = np.sqrt(((rgba[..., :3].astype(np.float32) - bgc) ** 2).sum(axis=2))
                    rgba[..., 3][dd < 42] = 0
                rgba = eat_white_edges(rgba) if bgc is None else eat_bg_edges(rgba, bgc)
            trimmed = content_trim(rgba)
            if trimmed is None or trimmed[0].shape[0] < 6 or trimmed[0].shape[1] < 6:
                print(f"  лист{src_idx+1} #{k} «{name}»: пустой срез — проверь сплит")
                continue
            rgba, tx0, ty0, tx1, ty1 = trimmed
            tx0 += bx0; tx1 += bx0; ty0 += by0; ty1 += by0
            touches = tx0 <= 1 or ty0 <= 1 or tx1 >= W - 1 or ty1 >= H - 1
            if touches and (src_idx, k) not in KEEP_EDGE:
                print(f"  лист{src_idx+1} #{k} «{name}»: задет край листа — пропущен")
                continue
            im = Image.fromarray(rgba, "RGBA")
            target = SHRINK.get(name)
            cw, ch = im.size
            if target and max(cw, ch) > target:
                s = target / max(cw, ch)
                im = im.resize((max(1, int(cw * s)), max(1, int(ch * s))), Image.LANCZOS)
            rgba = np.array(im)
            sig = signature(Image.fromarray(rgba, "RGBA"))
            if sig is not None and pool_sigs and (src_idx, k) not in FORCE_KEEP:
                dists = [np.abs(sig - s2).mean() for s2 in pool_sigs]
                if min(dists) < DEDUPE_THRESHOLD:
                    print(f"  лист{src_idx+1} #{k}: повтор «{name}» (diff {min(dists):.1f}) — пропущен")
                    continue
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

# Ручные переопределения проходимости: images/objects/pass_defaults.json
# (тот же формат, что выдаёт редактор кнопкой «💾 все сетки»; применяется
# поверх авторасчёта по имени объекта)
pass_file = os.path.join(OUT, "pass_defaults.json")
applied = 0
if os.path.exists(pass_file):
    with open(pass_file, encoding="utf-8") as fh:
        overrides = {it["name"]: it["pass"] for it in json.load(fh).get("items", [])
                     if "name" in it and "pass" in it}
    for it in items:
        ps = overrides.get(it["name"])
        if ps and len(ps) == it["cellsX"] * it["cellsY"] and set(ps) <= {"0", "1"}:
            it["pass"] = ps
            applied += 1

meta = dict(source="elven_wood, листы «замени-спрайты-окружения» 1–6", tileSize=32,
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
print(f"переопределений проходимости применено: {applied}")
print(f"готово: {len(items)} объектов ({total // 1024} КБ PNG), objects_data.js "
      f"{os.path.getsize(os.path.join(OUT, 'objects_data.js')) // 1024} КБ")
