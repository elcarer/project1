// DUALGRID — генерация пола по тайловым картам через Dual Grid System (Jess::Codes).
//
// Идея: тайл ложится не В ячейку карты, а НА её угол — точку, где сходятся 4 ячейки
// данных. Значение каждой ячейки (бит) подставляется в один из 4 углов тайла,
// поэтому любая форма границы описывается 2^4 = 16 тайлами (сетка 4×4) вместо
// классических 47 «blob»-вариантов. Сетка рендера смещена на полтайла относительно
// сетки данных — отсюда название «двойная сетка».
//
// Карта — плоский объект { w, h, data }: data[y * w + x] = 1 («фича»: земля, вода…)
// или 0 (фон: трава). Ячейка карты (x, y) занимает квадрат [x..x+1)×[y..y+1);
// тайл над ней выбирается по углам D(x-1,y-1) TL, D(x,y-1) TR, D(x-1,y) BL, D(x,y) BR.
// Значение за границами карты считается равным outside (по умолчанию 0 — фон).
//
// Тайлсет — картинка 4×4 тайла. Таблица TILE_CORNERS описывает углы каждого тайла;
// она попиксельно проверена для images/tiles/grass_dirt.png и grass_water.png
// (раскладка у обоих одинаковая). Для чужого тайлсета таблицу можно определить
// автоматически: detectLayout(изображение|текстура) читает пиксели и классифицирует
// углы по цвету (фон = самый частый цвет).
//
// Пример:
//   const dual = createDualGrid();
//   const layer = dual.build({
//       texture: assets.get("images/tiles/grass_dirt.png"),
//       map: { w: 24, h: 14, data },           // data: Uint8Array(w * h) из 0 и 1
//   });
//   stage.addChild(layer);                     // слой ровно w*ts × h*ts пикселей
//   dual.update(layer, newMap);                // подменить карту, переиспользуя тайлы
//
//   // Наслаивание (озеро поверх земли): у верхнего слоя скрываем чисто-фоновые
//   // тайлы, иначе его непрозрачная трава закрасит нижний слой
//   const water = dual.build({ texture: waterTex, map: waterMap, hideBackground: true });
//   stage.addChild(water);
//
//   const idx = dual.tileIndex(map, 3, 4);     // какой тайл (0..15) стоит в ячейке (3,4)

// Углы каждого тайла 4×4: [TL, TR, BL, BR]; 1 — угол «фичи», 0 — угол фона.
// Индекс тайла = строка * 4 + столбец (0 — левый верхний, 15 — правый нижний).
const TILE_CORNERS = [
    [0, 0, 1, 0], [0, 1, 0, 1], [1, 0, 1, 1], [0, 0, 1, 1],
    [1, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 0],
    [0, 1, 0, 0], [1, 1, 0, 0], [1, 1, 0, 1], [1, 0, 1, 0],
    [0, 0, 0, 0], [0, 0, 0, 1], [0, 1, 1, 0], [1, 0, 0, 0],
];

// Расстояние между цветами (евклидово по RGB)
function colorDist(a, b) {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

function createDualGrid() {

    // keyToTile: комбинация углов (TL*8 + TR*4 + BL*2 + BR) → индекс тайла
    function buildLookup(layout) {
        const keyToTile = new Array(16).fill(12);
        layout.forEach(([tl, tr, bl, br], tile) => {
            keyToTile[tl * 8 + tr * 4 + bl * 2 + br] = tile;
        });
        return keyToTile;
    }

    const DEFAULT_LOOKUP = buildLookup(TILE_CORNERS);

    // Нарезать тайлсет 4×4 на текстуры (делят один источник — как в assets.loadSpritesheet)
    function makeTileTextures(texture) {
        const ts = texture.width / 4;
        if (!Number.isInteger(ts) || ts < 1) {
            throw new Error(`dualgrid: ширина тайлсета (${texture.width}px) не делится на 4`);
        }
        texture.source.scaleMode = "nearest"; // пиксель-арт без размытия при зуме
        const textures = [];
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                textures.push(new PIXI.Texture({
                    source: texture.source,
                    frame: new PIXI.Rectangle(col * ts, row * ts, ts, ts),
                }));
            }
        }
        return { textures, ts };
    }

    // Значение карты в ячейке (за границами — outside)
    function cellAt(map, x, y, outside) {
        if (x < 0 || y < 0 || x >= map.w || y >= map.h) return outside;
        return map.data[y * map.w + x] ? 1 : 0;
    }

    // Индекс тайла для ячейки карты (i, j): 4 ячейки данных вокруг точки (i, j)
    function tileIndex(map, i, j, { outside = 0, layout = TILE_CORNERS } = {}) {
        const lookup = layout === TILE_CORNERS ? DEFAULT_LOOKUP : buildLookup(layout);
        const key = cellAt(map, i - 1, j - 1, outside) * 8 + cellAt(map, i, j - 1, outside) * 4 +
                    cellAt(map, i - 1, j, outside) * 2 + cellAt(map, i, j, outside);
        return lookup[key];
    }

    // Заполнить контейнер тайлами карты (общий путь для build и update).
    // hideBackground скрывает «полностью фоновые» тайлы — слой становится
    // прозрачным там, где нет «фичи» (нужно верхним слоям, чтобы не перекрывать
    // нижние: у воды травяные тайлы непрозрачны и закрасили бы землю под собой).
    function fill(container, textures, ts, map, lookup, outside, hideBackground) {
        const bgTile = lookup[0]; // тайл со всеми 4 углами фона
        const sprites = new Array(map.w * map.h);
        for (let j = 0; j < map.h; j++) {
            for (let i = 0; i < map.w; i++) {
                const key = cellAt(map, i - 1, j - 1, outside) * 8 + cellAt(map, i, j - 1, outside) * 4 +
                            cellAt(map, i - 1, j, outside) * 2 + cellAt(map, i, j, outside);
                const tile = lookup[key];
                const sprite = new PIXI.Sprite(textures[tile]);
                sprite.position.set(i * ts, j * ts);
                if (hideBackground && tile === bgTile) sprite.visible = false;
                container.addChild(sprite);
                sprites[j * map.w + i] = sprite;
            }
        }
        // Метаданные для update() и проверок
        container.dualMeta = { w: map.w, h: map.h, outside, lookup, textures, sprites, ts,
                               hideBackground: !!hideBackground, bgTile };
        return container;
    }

    // Собрать слой пола. Опции: outside — значение карты за границами (0 = фон),
    // hideBackground — скрыть чисто-фоновые тайлы (для наслаиваемых слоёв).
    function build({ texture, map, outside = 0, layout = TILE_CORNERS, hideBackground = false }) {
        const { textures, ts } = makeTileTextures(texture);
        return fill(new PIXI.Container(), textures, ts, map, buildLookup(layout), outside, hideBackground);
    }

    // Подменить карту у готового слоя. При совпадении размеров переназначаем текстуры
    // (спрайты переиспользуются), при несовпадении пересобираем детей на месте —
    // объект контейнера остаётся тем же, его не нужно пере-добавлять на сцену.
    function update(container, map, { outside, layout = TILE_CORNERS } = {}) {
        const meta = container.dualMeta;
        if (!meta) throw new Error("dualgrid.update: контейнер создан не через build()");
        const newOutside = outside ?? meta.outside;
        if (meta.w === map.w && meta.h === map.h && newOutside === meta.outside &&
            layout === TILE_CORNERS) {
            const lookup = meta.lookup;
            for (let j = 0; j < map.h; j++) {
                for (let i = 0; i < map.w; i++) {
                    const key = cellAt(map, i - 1, j - 1, newOutside) * 8 + cellAt(map, i, j - 1, newOutside) * 4 +
                                cellAt(map, i - 1, j, newOutside) * 2 + cellAt(map, i, j, newOutside);
                    const tile = lookup[key];
                    const sprite = meta.sprites[j * map.w + i];
                    sprite.texture = meta.textures[tile];
                    sprite.visible = !(meta.hideBackground && tile === meta.bgTile);
                }
            }
            return container;
        }
        container.removeChildren().forEach((s) => s.destroy());
        return fill(container, meta.textures, meta.ts, map, buildLookup(layout), newOutside,
                    meta.hideBackground);
    }

    // Автоопределение таблицы углов по пикселям (для чужих тайлсетов 4×4).
    // source: HTMLImageElement | Canvas | ImageBitmap | PIXI.Texture.
    // Фон — самый частый цвет; «фича» — самый частый из заметно отличающихся;
    // контурные и переходные пиксели в голосовании не участвуют.
    function detectLayout(source) {
        let img = source;
        if (typeof PIXI !== "undefined" && source instanceof PIXI.Texture) img = source.source.resource;
        const w = img.width, h = img.height, ts = w / 4;
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w, h).data;
        const at = (x, y) => { const k = (y * w + x) * 4; return [d[k], d[k + 1], d[k + 2]]; };

        // Два опорных цвета: фон = самый частый; «фича» = самый далёкий от фона
        // среди частых цветов. Пара с максимальным расстоянием не даёт контурным
        // оттенкам (тёмная кромка берега и т.п.) перехватить роль эталона.
        const freq = new Map();
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const c = at(x, y), key = c.join(",");
            freq.set(key, (freq.get(key) || 0) + 1);
        }
        const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.split(",").map(Number));
        const cand = sorted.slice(0, 6);
        const bg = cand[0];
        let fea = bg, bestDist = -1;
        for (const c of cand) {
            const d = colorDist(c, bg);
            if (d > bestDist) { bestDist = d; fea = c; }
        }

        // Голосование в окне у каждого угла тайла: пиксель голосует за ближайший
        // эталон (оттенки внутри семейства — тени, контур — считаются вместе с ним)
        const win = Math.max(4, ts >> 3);
        const inset = Math.max(1, ts >> 4);
        const layout = [];
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const corners = [];
                for (const [cx, cy] of [[inset, inset], [ts - inset - win, inset],
                                        [inset, ts - inset - win], [ts - inset - win, ts - inset - win]]) {
                    let votes = 0, total = 0;
                    for (let y = cy; y < cy + win; y++) for (let x = cx; x < cx + win; x++) {
                        const c = at(col * ts + x, row * ts + y);
                        const dB = colorDist(c, bg), dF = colorDist(c, fea);
                        if (Math.min(dB, dF) > 200) continue; // защитный порог от аномалий
                        total++;
                        if (dF < dB) votes++;
                    }
                    corners.push(votes * 2 > total ? 1 : 0);
                }
                layout.push(corners); // [TL, TR, BL, BR]
            }
        }
        return layout;
    }

    return { build, update, tileIndex, detectLayout, TILE_CORNERS };
}

export { createDualGrid };
