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
//
// ГЕНЕРАЦИЯ И ФАЙЛЫ КАРТ (два сценария геймдизайнера, их можно сочетать):
//
//   1) Глобальную карту можно ГЕНЕРИРОВАТЬ по манифесту:
//   { format: "dualgrid-manifest", version: 2, width, height, seed,
//     layers: [{ texture, frequency, scatter, outside, hideBackground, layout? }],
//     objects: { density, avoidHideBg, items: [{ name, weight }] } }
//   frequency — процент ячеек «фичи» (0..100, выдерживается точно квантилем шума),
//   scatter — «разброс»: 0 — крупные материки, 100 — мелкие островки.
//   margin — зазор слоя (клеток, default 3) до «фич» НИЖНИХ слоёв с ДРУГИМ тайлсетом:
//   у разных тайлсетов нет общего перехода, и стык рисуется прямыми срезами спрайтов —
//   поэтому между землёй и водой при генерации всегда остаётся полоса травы ≥ margin.
//   makeManifest({...}) собирает объект с умолчаниями и проверкой,
//   mapFromManifest(манифест, textures) → Promise<{ root, layers, maps }> — стек слоёв.
//   Сид каждого слоя детерминирован: hashSeed(`${seed}:${индекс}:${texture}`) —
//   одна и та же генерация в движке и редакторе.
//
//   2) Локальную карту (данж) можно ОТРИСОВЫВАТЬ из готового файла карты:
//   { format: "dualgrid-map", version: 2, width, height,
//     layers: [{ texture, data: [0/1, ...], outside, hideBackground, layout? }],
//     objects: { items: [{ name, weight }], placements: [[t, x, y], ...] } }
//   mapFromJSON(карта, textures) → Promise<{ root, layers, maps, objects }> — без генерации.
//
//   В обоих форматах слой может нести png: "data:image/png;base64,…" — тогда текстура
//   берётся прямо из файла (файл самодостаточен). textures — необязательный справочник
//   { "имя.png": PIXI.Texture }; сначала ищется точное имя, затем по базовому имени.
//
//   generateMap({ w, h, seed, frequency, scatter }) — процедурная карта 0/1 (fBm-шум
//   value-noise, 3 октавы; порог берётся квантилем, поэтому частота соблюдается точно).
//
// СЛОЙ ОБЪЕКТОВ (version 2) — декор поверх пола: деревья, кусты, постройки, геммы.
//   Каждый объект — отдельная текстура с размером, кратным тайлу (32/64/96/128… px).
//   Якорь — «нижний центр»: объект «стоит» в ячейке (x, y) основанием по её нижней
//   грани; footprint занимает cellsX×cellsY ячеек и у генерации не пересекается
//   с другими. Рендер — спрайты с y-сортировкой (дальние рисуются раньше ближних).
//
//   В манифесте objects описывает ГЕНЕРАЦИЮ:
//   objects: { density: 12, avoidHideBg: true, items: [{ name, weight }] }
//   density — процент ячеек, получающих объект (0..100); weight — относительный вес
//   объекта при выборе (0 — не генерировать); avoidHideBg — не ставить объекты на
//   «фичи» слоёв с hideBackground (вода и т.п.). Сид потока: `${seed}:objects` —
//   раскладка стабильна при смене весов, меняется только выбор объектов.
//   API: buildObjects({items, ts, w, h}), syncObjects(container, placements),
//   placeObject / eraseObjectAt / objectAt, objectFootprint, generateObjects.
//
// ПРОХОДИМОСТЬ: каждый объект несёт сетку pass длиной cellsX*cellsY (построчно
//   сверху вниз; 1 — клетка НЕпроходима; по умолчанию непроходима нижняя строка —
//   корни/ствол/основание). Редактор даёт менять её кликами и хранит в файлах
//   (items[i].pass — строка "0101…"). Для движка: buildCollisionMap({w, h, items,
//   placements, ts}) → { w, h, blocked: Uint8Array, isBlocked(px, py) } — сборная
//   карта непроходимых клеток всех объектов; isBlocked принимает мировые пиксели.
//   mapFromManifest/mapFromJSON при наличии objects сами добавляют result.collision.

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

// Детерминированный PRNG (mulberry32) — одинаковые сиды дают одинаковые карты
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// FNV-1a: строка → uint32 (для строковых сидов вида "10:1:grass_water.png")
function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function clampPercent(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function clampMargin(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(0, Math.min(64, n)) : 3;
}

// Smoothstep — сглаживание интерполяции шума
function smooth(t) {
    return t * t * (3 - 2 * t);
}

// Сравнение таблиц углов по содержимому (чужой тайлсет может иметь свою раскладку)
function sameLayout(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] ||
            a[i][2] !== b[i][2] || a[i][3] !== b[i][3]) return false;
    }
    return true;
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
    function fill(container, textures, ts, map, layout, lookup, outside, hideBackground) {
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
        // Метаданные для update() и проверок (layout — для сравнения раскладок)
        container.dualMeta = { w: map.w, h: map.h, outside, lookup, layout, textures, sprites, ts,
                               hideBackground: !!hideBackground, bgTile };
        return container;
    }

    // Собрать слой пола. Опции: outside — значение карты за границами (0 = фон),
    // hideBackground — скрыть чисто-фоновые тайлы (для наслаиваемых слоёв),
    // layout — своя таблица углов (например, из detectLayout для чужого тайлсета).
    function build({ texture, map, outside = 0, layout = TILE_CORNERS, hideBackground = false }) {
        const { textures, ts } = makeTileTextures(texture);
        return fill(new PIXI.Container(), textures, ts, map, layout, buildLookup(layout), outside, hideBackground);
    }

    // Подменить карту у готового слоя. При совпадении размеров/outside/раскладки
    // переназначаем текстуры (спрайты переиспользуются), при несовпадении пересобираем
    // детей на месте — объект контейнера остаётся тем же, его не нужно пере-добавлять.
    // Опция hideBackground (если передана) переключает режим «прозрачного фона».
    function update(container, map, { outside, layout = TILE_CORNERS, hideBackground } = {}) {
        const meta = container.dualMeta;
        if (!meta) throw new Error("dualgrid.update: контейнер создан не через build()");
        const newOutside = outside ?? meta.outside;
        if (hideBackground !== undefined) meta.hideBackground = !!hideBackground;
        if (meta.w === map.w && meta.h === map.h && newOutside === meta.outside &&
            sameLayout(layout, meta.layout)) {
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
        return fill(container, meta.textures, meta.ts, map, layout, buildLookup(layout), newOutside,
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

    // ── ГЕНЕРАТОР КАРТ ────────────────────────────────────────────────────────
    // fBm value-noise (3 октавы, амплитуды 0.5/0.3/0.2). baseCells — размер ячейки
    // базовой октавы в клетках карты: 1.5 — крупные материки, min(w,h)/2.2 — островки.
    function fbmField(w, h, rng, baseCells) {
        const value = new Float32Array(w * h);
        let ampSum = 0;
        for (const [mult, amp] of [[1, 0.5], [2, 0.3], [4, 0.2]]) {
            ampSum += amp;
            const cells = Math.max(1, Math.round(baseCells * mult));
            const gw = cells + 1;
            const lattice = Array.from({ length: gw * gw }, () => rng());
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const fx = (x / w) * cells, fy = (y / h) * cells;
                    const x0 = Math.floor(fx), y0 = Math.floor(fy);
                    const tx = smooth(fx - x0), ty = smooth(fy - y0);
                    const v00 = lattice[y0 * gw + x0],       v10 = lattice[y0 * gw + x0 + 1];
                    const v01 = lattice[(y0 + 1) * gw + x0], v11 = lattice[(y0 + 1) * gw + x0 + 1];
                    value[y * w + x] += (v00 + (v10 - v00) * tx + (v01 - v00) * ty +
                                         (v00 - v10 - v01 + v11) * tx * ty) * amp;
                }
            }
        }
        for (let i = 0; i < value.length; i++) value[i] /= ampSum;
        return value;
    }

    // Ранговая нормализация: значение каждой ячейки → его доля среди всех значений
    // поля (0..1, распределение равномерное). Порог от поля вероятностей P даёт
    // локальную частоту «фичи» P(ячейка) точно, а не в среднем по карте.
    function rankNormalize(value) {
        const n = value.length;
        const sorted = Float32Array.from(value).sort();
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            let lo = 0, hi = n; // нижняя граница значения в отсортированном массиве
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (sorted[mid] < value[i]) lo = mid + 1; else hi = mid;
            }
            out[i] = lo / n;
        }
        return out;
    }

    // fBm value-noise (3 октавы) + порог-квантиль: частота «фичи» (в %) выдерживается
    // точно при любом сиде и разбросе. scatter: 0 — решётка 1.5 клетки (крупные
    // материки), 100 — до min(w,h)/2.2 клеток (мелкие островки).
    function generateMap({ w, h, seed = 1, frequency = 30, scatter = 50 }) {
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
            throw new Error("dualgrid.generateMap: размеры должны быть целыми ≥ 1");
        }
        const f = clampPercent(frequency) / 100;
        const s = clampPercent(scatter) / 100;
        const maxCells = Math.max(2, Math.min(w, h) / 2.2);
        const baseCells = 1.5 + s * (maxCells - 1.5);
        const rng = mulberry32(typeof seed === "number" ? seed >>> 0 : hashSeed(String(seed)));
        const value = fbmField(w, h, rng, baseCells);

        // Порог = квантиль распределения значений → частота соблюдается точно
        const sorted = Float32Array.from(value).sort();
        const n = sorted.length;
        const idx = Math.floor((1 - f) * n);
        const threshold = idx >= n ? sorted[n - 1] + 1e-6 : sorted[idx];
        const data = new Uint8Array(n);
        for (let i = 0; i < n; i++) data[i] = value[i] >= threshold ? 1 : 0;
        return { w, h, data };
    }

    // Расширить маску на times клеток (8 соседей → дистанция Чебышёва)
    function dilateMask(data, w, h, times) {
        let cur = Uint8Array.from(data);
        for (let t = 0; t < times; t++) {
            const next = Uint8Array.from(cur);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (cur[y * w + x]) continue;
                    let hit = false;
                    for (let dy = -1; dy <= 1 && !hit; dy++) {
                        for (let dx = -1; dx <= 1 && !hit; dx++) {
                            const nx = x + dx, ny = y + dy;
                            if (nx >= 0 && ny >= 0 && nx < w && ny < h && cur[ny * w + nx]) hit = true;
                        }
                    }
                    if (hit) next[y * w + x] = 1;
                }
            }
            cur = next;
        }
        return cur;
    }

    // Сжать маску на 1 клетку (Чебышёв): остаются клетки, все 8 соседей которых в
    // маске. За границей карты — 0, так что клетки у края всегда вымываются.
    function erodeMask(data, w, h) {
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!data[y * w + x]) continue;
                let ok = true;
                for (let dy = -1; dy <= 1 && ok; dy++) {
                    for (let dx = -1; dx <= 1 && ok; dx++) {
                        const nx = x + dx, ny = y + dy;
                        const v = (nx >= 0 && ny >= 0 && nx < w && ny < h) ? data[ny * w + nx] : 0;
                        if (!v) ok = false;
                    }
                }
                if (ok) out[y * w + x] = 1;
            }
        }
        return out;
    }

    // Раздвижка слоёв: стереть в data ячейки ближе margin клеток до «фич» блокеров.
    // У тайлсетов разных местностей нет общего перехода — стык рисуется прямым
    // срезом спрайтов, поэтому между ними остаётся полоса фона (травы) ≥ margin.
    function separateLayer(data, blockers, margin, w, h) {
        const out = Uint8Array.from(data);
        const m = Math.max(0, Math.round(Number(margin) || 0));
        const list = (blockers || []).filter(Boolean);
        if (!m || !list.length) return out;
        let blocked = null;
        for (const b of list) {
            const d = dilateMask(b, w, h, m);
            if (!blocked) blocked = d;
            else for (let i = 0; i < blocked.length; i++) blocked[i] = blocked[i] || d[i];
        }
        for (let i = 0; i < out.length; i++) if (blocked[i]) out[i] = 0;
        return out;
    }

    // ── СЛОЙ ОБЪЕКТОВ (декор поверх пола) ─────────────────────────────────────
    // Объект «стоит» в ячейке (x, y): точка привязки — нижний центр этой ячейки,
    // спрайт рисуется якорем (0.5, 1) в неё. Пиксельный прямоугольник и footprint:
    // cellsX=2 даёт клетки [x-1..x], cellsX=4 → [x-2..x+1] — центр низа всегда на
    // границе сетки, поэтому объекты «сажаются» на тайлы ровно.
    function objectRect(item, x, y, ts) {
        const w = item.w ?? (item.cellsX || 1) * ts;
        const h = item.h ?? (item.cellsY || 1) * ts;
        return { px: (x + 0.5) * ts - w / 2, py: (y + 1) * ts - h, w, h };
    }
    function objectFootprint(item, x, y, ts) {
        const cx = item.cellsX ?? Math.round((item.w ?? ts) / ts);
        const cy = item.cellsY ?? Math.round((item.h ?? ts) / ts);
        const x0 = x - Math.floor(cx / 2);
        return { x0, y0: y - cy + 1, x1: x0 + cx - 1, y1: y };
    }

    function clampWeight(v) {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 1;
    }

    // Процедурная раскладка объектов. items: [{ weight, cellsX, cellsY }] (индекс =
    // тип), density — % ячеек с объектом, avoid — маска ячеек, где объектов не быть
    // (например «фичи» воды). Два вызова rng() на ячейку независимо от параметров →
    // поток стабильный: смена весов меняет только выбор объекта, смена плотности —
    // только порог; раскладка ячеек не «прыгает».
    function generateObjects({ w, h, seed = 1, density = 12, items, avoid = null }) {
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
            throw new Error("dualgrid.generateObjects: размеры должны быть целыми ≥ 1");
        }
        const den = clampPercent(density) / 100;
        const rng = mulberry32(typeof seed === "number" ? seed >>> 0 : hashSeed(String(seed)));
        const weights = items.map((it) => clampWeight(it.weight));
        const total = weights.reduce((s, v) => s + v, 0);
        const occupied = new Uint8Array(w * h);
        const placements = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const roll = rng(), pick = rng();
                if (roll >= den || total <= 0) continue;
                if (avoid && avoid[y * w + x]) continue;
                // взвешенный выбор типа (порядок не важен — выбор по накопленному весу)
                let acc = 0, chosen = -1;
                const target = pick * total;
                for (let t = 0; t < weights.length; t++) {
                    acc += weights[t];
                    if (target < acc) { chosen = t; break; }
                }
                if (chosen < 0) continue;
                const fp = objectFootprint(items[chosen], x, y, 32);
                if (fp.x0 < 0 || fp.x1 >= w || fp.y0 < 0) continue; // не влезает в карту
                let free = true;
                for (let fy = fp.y0; fy <= fp.y1 && free; fy++) {
                    for (let fx = fp.x0; fx <= fp.x1 && free; fx++) {
                        if (occupied[fy * w + fx]) free = false;
                    }
                }
                if (!free) continue;
                for (let fy = fp.y0; fy <= fp.y1; fy++) {
                    for (let fx = fp.x0; fx <= fp.x1; fx++) occupied[fy * w + fx] = 1;
                }
                placements.push([chosen, x, y]);
            }
        }
        return placements; // отсортировано по (y, x) — порядок обхода ячеек
    }

    // Карта проходимости объекта: строка "0101…" длиной cellsX*cellsY
    // (построчно сверху вниз; 1 — клетка НЕпроходима) → Uint8Array.
    // По умолчанию непроходима только нижняя строка (корни/ствол/основание).
    function defaultPass(cellsX, cellsY) {
        const pass = new Uint8Array(cellsX * cellsY);
        for (let x = 0; x < cellsX; x++) pass[(cellsY - 1) * cellsX + x] = 1;
        return pass;
    }
    function normalizePass(it, cellsX, cellsY) {
        const n = cellsX * cellsY;
        let pass = null;
        if (typeof it.pass === "string" && /^[01]*$/.test(it.pass) && it.pass.length === n) {
            pass = Uint8Array.from(it.pass.split("").map((c) => (c === "1" ? 1 : 0)));
        } else if (it.pass instanceof Uint8Array || Array.isArray(it.pass)) {
            const arr = Uint8Array.from(it.pass);
            if (arr.length === n) pass = arr;
        }
        return pass || defaultPass(cellsX, cellsY);
    }

    // Контейнер объектов. items: [{ name, texture, pass?, w?, h? }] — размеры по
    // умолчанию берутся из текстуры и должны быть кратны ts. w/h карты — для
    // проверки границ при placeObject (генерация границы считает сама).
    function buildObjects({ items, ts = 32, w = Infinity, h = Infinity }) {
        const norm = items.map((it) => {
            it.texture.source.scaleMode = "nearest";
            const tw = it.w ?? it.texture.width, th = it.h ?? it.texture.height;
            if ((tw / ts) % 1 !== 0 || (th / ts) % 1 !== 0) {
                throw new Error(`dualgrid.buildObjects: «${it.name}» размер ${tw}×${th} не кратен ${ts}`);
            }
            const cellsX = tw / ts, cellsY = th / ts;
            return { name: it.name, texture: it.texture, w: tw, h: th, cellsX, cellsY,
                     pass: normalizePass(it, cellsX, cellsY) };
        });
        const container = new PIXI.Container();
        container.sortableChildren = true; // порядок отрисовки — по zIndex (ось Y)
        container.objectsMeta = { items: norm, placements: [], ts, w, h };
        return container;
    }

    function makeObjectSprite(meta, p) {
        const sp = new PIXI.Sprite(meta.items[p.t].texture);
        sp.anchor.set(0.5, 1);
        sp.position.set((p.x + 0.5) * meta.ts, (p.y + 1) * meta.ts);
        sp.zIndex = (p.y + 1) * meta.ts; // y-сортировка: нижние рисуются поверх верхних
        p.sprite = sp;
        return sp;
    }

    // Полная пересборка содержимого по списку [[t, x, y], …]. Битые записи
    // (тип вне диапазона, нецелые координаты) отбрасываются молча — файл карты
    // мог писаться под другой набор объектов.
    function syncObjects(container, placements) {
        const meta = container.objectsMeta;
        if (!meta) throw new Error("dualgrid.syncObjects: контейнер создан не через buildObjects()");
        meta.placements = (placements || []).map(([t, x, y]) => ({ t, x, y, sprite: null }))
            .filter((p) => Number.isInteger(p.t) && p.t >= 0 && p.t < meta.items.length &&
                            Number.isInteger(p.x) && Number.isInteger(p.y));
        container.removeChildren().forEach((s) => s.destroy());
        for (const p of meta.placements) container.addChild(makeObjectSprite(meta, p));
        return container;
    }

    // Поставить объект (якорь — ячейка x,y; footprint должен быть внутри карты),
    // вернуть true, если поставлен.
    function placeObject(container, t, x, y) {
        const meta = container.objectsMeta;
        if (!meta || t < 0 || t >= meta.items.length) return false;
        const fp = objectFootprint(meta.items[t], x, y, meta.ts);
        if (fp.x0 < 0 || fp.y0 < 0 || fp.x1 >= meta.w || fp.y1 >= meta.h) return false;
        const p = { t, x, y, sprite: null };
        meta.placements.push(p);
        container.addChild(makeObjectSprite(meta, p));
        return true;
    }

    // Верхний объект, чей footprint накрывает ячейку (для ластика), или null.
    function objectAt(container, cx, cy) {
        const meta = container.objectsMeta;
        if (!meta) return null;
        let best = null;
        for (const p of meta.placements) {
            const fp = objectFootprint(meta.items[p.t], p.x, p.y, meta.ts);
            if (cx >= fp.x0 && cx <= fp.x1 && cy >= fp.y0 && cy <= fp.y1) {
                if (!best || p.y > best.y || (p.y === best.y && p.x > best.x)) best = p;
            }
        }
        return best;
    }

    function eraseObjectAt(container, cx, cy) {
        const meta = container.objectsMeta;
        const p = objectAt(container, cx, cy);
        if (!p) return null;
        meta.placements.splice(meta.placements.indexOf(p), 1);
        container.removeChild(p.sprite);
        p.sprite.destroy();
        return [p.t, p.x, p.y];
    }

    // Карта коллизий по объектам: собирает непроходимые клетки всех placements
    // в Uint8Array размером карты (1 — клетка занята объектом). items —
    // meta.items контейнера объектов (там уже нормализована pass-сетка).
    // isBlocked(px, py) — проверка в мировых ПИКСЕЛЯХ, для персонажей.
    function buildCollisionMap({ w, h, items, placements, ts = 32 }) {
        const blocked = new Uint8Array(w * h);
        for (const [t, x, y] of placements || []) {
            const it = items[t];
            if (!it) continue;
            const fp = objectFootprint(it, x, y, ts);
            for (let cy = 0; cy < it.cellsY; cy++) {
                for (let cx = 0; cx < it.cellsX; cx++) {
                    if (!it.pass[cy * it.cellsX + cx]) continue;
                    const gx = fp.x0 + cx, gy = fp.y0 + cy;
                    if (gx >= 0 && gy >= 0 && gx < w && gy < h) blocked[gy * w + gx] = 1;
                }
            }
        }
        return {
            w, h, blocked,
            isBlocked(px, py) {
                const gx = Math.floor(px / ts), gy = Math.floor(py / ts);
                if (gx < 0 || gy < 0 || gx >= w || gy >= h) return false;
                return blocked[gy * w + gx] === 1;
            },
        };
    }

    // ── ГЕНЕРАТОР МИРА (карта «открытого мира» с биомными поясами) ────────────
    // Климат: широтный градиент температуры (север — холод, юг — жара) + fBm-шум,
    // который делает границы поясов волнистыми и оставляет карманы биомов в середине.
    // Вероятности местностей — поля Float32 (не глобальная частота!); в маски они
    // переводятся ранговой нормализацией шума. Дальше — обычный пайплайн стека:
    // привязка «on» (эрозия земляных пятен) и зазоры между разными тайлсетами.
    function generateWorld({ w, h, seed = 1 }) {
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
            throw new Error("dualgrid.generateWorld: размеры должны быть целыми ≥ 1");
        }
        const rng = mulberry32(typeof seed === "number" ? seed >>> 0 : hashSeed(String(seed)));
        const n = w * h;
        const small = Math.min(w, h);

        const temp = new Float32Array(n);
        const snowZone = new Float32Array(n);
        const sandZone = new Float32Array(n);
        const jitter = fbmField(w, h, rng, Math.max(3, Math.round(small / 60)));
        for (let y = 0; y < h; y++) {
            const u = y / Math.max(1, h - 1); // 0 — север (холод), 1 — юг (жара)
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const T = Math.min(1, Math.max(0, u + (jitter[i] - 0.5) * 0.36));
                temp[i] = T;
                snowZone[i] = Math.min(1, Math.max(0, (0.40 - T) / 0.26));
                sandZone[i] = Math.min(1, Math.max(0, (T - 0.66) / 0.26));
            }
        }
        const moisture = rankNormalize(fbmField(w, h, rng, Math.max(3, Math.round(small / 40))));

        // Поля вероятностей: земляные пятна — субстрат снега и песка (в поясах их
        // больше), снег/песок заполняют субстрат по своей зоне, вода живёт по
        // влажности и редеет в поясах (на юге редкие пруды = оазисы).
        const pDirt = new Float32Array(n);
        const pSnowZone = new Float32Array(n);
        const pSandZone = new Float32Array(n);
        const pSnowDust = new Float32Array(n);
        const pSandDust = new Float32Array(n);
        const pWater = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            pDirt[i] = Math.min(0.85, 0.14 + 0.62 * Math.max(snowZone[i], sandZone[i]));
            pSnowZone[i] = 0.88 * snowZone[i];
            pSandZone[i] = 0.88 * sandZone[i];
            // редкая россыпь одиночных пятен: снег тает к пустыне, песок — к снегам
            pSnowDust[i] = 0.05 * (1 - sandZone[i]);
            pSandDust[i] = 0.05 * (1 - snowZone[i]);
            pWater[i] = Math.max(0, Math.min(0.5, (0.10 + 0.18 * (moisture[i] * 2 - 1)) *
                (1 - 0.55 * snowZone[i]) * (1 - 0.45 * sandZone[i])));
        }
        // Зонные слои — грубый шум (крупные поля); россыпь — мелкий, иначе редкие
        // проценты на грубом шуме выпадают кластерами в случайных местах карты.
        const dirtRank = rankNormalize(fbmField(w, h, rng, Math.max(2, Math.round(small / 90))));
        const snowRank = rankNormalize(fbmField(w, h, rng, Math.max(2, Math.round(small / 100))));
        const sandRank = rankNormalize(fbmField(w, h, rng, Math.max(2, Math.round(small / 100))));
        const snowDustRank = rankNormalize(fbmField(w, h, rng, Math.max(6, Math.round(small / 8))));
        const sandDustRank = rankNormalize(fbmField(w, h, rng, Math.max(6, Math.round(small / 8))));
        const waterRank = rankNormalize(fbmField(w, h, rng, Math.max(2, Math.round(small / 70))));
        const cell = (rank, prob) => {
            const data = new Uint8Array(n);
            for (let i = 0; i < n; i++) data[i] = rank[i] >= 1 - prob[i] ? 1 : 0;
            return data;
        };
        const dirt = cell(dirtRank, pDirt);
        const dirtOpen = erodeMask(dirt, w, h); // переходные тайлы снега/песка лягут на его фон
        const snow = cell(snowRank, pSnowZone);
        const snowDust = cell(snowDustRank, pSnowDust);
        const sand = cell(sandRank, pSandZone);
        const sandDust = cell(sandDustRank, pSandDust);
        for (let i = 0; i < n; i++) {
            snow[i] = (snow[i] | snowDust[i]) & dirtOpen[i];
            sand[i] = (sand[i] | sandDust[i]) & dirtOpen[i];
        }
        const water = separateLayer(cell(waterRank, pWater), [dirt], 2, w, h);
        const snow2 = separateLayer(snow, [water], 2, w, h);
        const sand2 = separateLayer(sand, [water, snow2], 2, w, h);

        return {
            w, h,
            masks: {
                "grass_dirt.png": dirt,
                "grass_water.png": water,
                "snow_dirt.png": snow2,
                "sand_dirt.png": sand2,
            },
            climate: { temp, moisture, snowZone, sandZone },
        };
    }

    // Именованные палитры объектов мира (имена из реестра objects_data.js;
    // отсутствующие в реестре молча пропускаются).
    const WORLD_OBJ_NAMES = {
        bones: ["skeleton", "bones_pile", "bones_hand", "bones_stakes", "skull_cow", "ribcage",
                "skulls_two", "skulls_pile", "skulls_pile_m", "arch_bones"],
        desertTrees: ["tree_palm", "tree_dead_big", "tree_dead_small", "tree_dead_sparse"],
        desertTrash: ["amphora_broken", "amphora_cracked", "jug_shards"],
        forestFloor: ["log_hollow", "log_mushrooms", "log_long", "log_carved", "stump_wide",
                      "stump_open", "stump_hollow", "stump_lantern"],
        villageNorth: ["banner_boot_snow", "banner_axes_snow", "banner_anvil_snow", "banner_goose_snow",
                       "banner_beer_snow", "banner_ornate_snow", "sign_wood_snow", "sign_arrow_snow",
                       "sign_arrows_snow", "log_small_snow", "stump_snow", "mound_snow", "mounds_snow",
                       "barrel", "barrel_large", "crate_plants"],
        villageWarm: ["barrel", "barrel_large", "barrel_marked", "barrel_owl", "signpost",
                      "signpost_small", "signpost_big", "notice_board", "stall", "wood_arbor",
                      "arbor_wood", "fence", "fence_wattle", "fence_branch", "fence_lattice",
                      "fence_woven", "shield_wall", "tools_wall", "crate_plants", "log_carved"],
        villageCraft: ["anvil", "forge_big", "pottery_bench", "bench_pottery", "loom",
                       "spinning_wheel", "alchemy_table", "bench_potions"],
        wellsNorth: ["well_bucket_snow"],
        wellsWarm: ["well_roof", "well_stone", "well_gable", "well_old", "well_tub", "fountain_small"],
        ruinsCenter: ["ruin_gate", "stonecircle_rune", "rune_gate", "tower_tall", "tower_round",
                      "tower_fire", "root_plaza", "stump_plaza"],
        ruinsSupport: ["column_stump", "column_lie", "column_fallen", "column_broken_small",
                       "column_stub", "column_piece", "column_drum", "columns_lie_pair", "column_base",
                       "column_plinth", "column_knob", "column_mossy", "column_frag", "columns_pair",
                       "column_tall", "rubble_pile", "arch_ruin", "arch_moss", "wall_corner",
                       "wall_vine", "ruins_floor", "slab_rune", "menhir_round", "menhir_moss",
                       "obelisk_mossy", "chalice_stone", "stone_spiral", "amphora_broken"],
        bonesCenter: ["skull_cow", "bones_pile", "skeleton", "ribcage"],
        bonesSupport: ["skulls_two", "bones_hand", "bones_stakes", "skulls_pile", "skulls_pile_m",
                       "arch_bones", "pit_cracked", "pit_deep", "pit_square", "rocks_cairn",
                       "stones_drygrass", "amphora_broken", "jug_shards"],
    };

    // Растительные сообщества («лесные массивы»): в природе деревья одного вида
    // растут кластерами-патчами (ограничение разлёта семян), массив имеет доминанта
    // и спутников, внутри — градиент плотности (чаща/опушка) и поляны. Посадка
    // ДВУХПРОХОДНАЯ, как в реальном лесу: сначала полог из крупных деревьев стенда
    // (canopy), затем мелкие деревья и подлесок (trees/floor) — иначе гиганты
    // (дуб 8×8…10×11 клеток) проигрывают footprint-конкуренцию мелким берёзам.
    // Парковые/магические деревья (сакура, бонсай, топиар) в амбиент не входят.
    const WORLD_VEG = {
        // Умеренная зона (середина карты)
        temperate: [
            { canopy: ["tree_oak_big", "tree_oak_grove", "tree_oak_rock"],
              trees: ["tree_lush", "tree_round", "tree_small"],                      // дубрава
              comp: ["tree_birch_young"],
              floor: ["leaf_big", "leaves_pair", "mushrooms_red", "mushrooms_red_m",
                      "moss", "bush_berry", "bush_leafy"] },
            { canopy: ["tree_birch", "tree_white_tall", "tree_white_wide"],
              trees: ["tree_birch_young", "tree_birch_dark", "tree_small"],          // берёзовая роща
              comp: [],
              floor: ["flowers_white", "grass_tuft", "moss_patch", "bush_wild"] },
            { canopy: ["tree_lush", "tree_white_tall", "tree_tall_thicket", "tree_thicket"],
              trees: ["tree_round", "tree_small", "tree_bush_tall", "tree_mint"],    // смешанный лес
              comp: ["tree_birch"],
              floor: ["bush_round", "bush_leafy", "mushrooms_red", "moss_mounds",
                      "flowers_pink", "grass_wild"] },
            { canopy: ["tree_spruce_tall", "tree_spruce_fluffy", "tree_cone"],
              trees: ["tree_pine", "tree_birch_young"],                              // хвойный лес
              comp: [],
              floor: ["pinecones", "pinecones_pair", "pinecones_scatter",
                      "sprout_conifer", "bush_mossy_pair", "moss_bed"] },
        ],
        // Тайга (холодный пояс, на травяных клетках севера)
        taiga: [
            { canopy: ["tree_spruce_tall", "tree_spruce_fluffy"],
              trees: ["tree_pine", "tree_birch_young"],                              // ельники
              comp: [],
              floor: ["pinecones", "moss", "sprout_conifer", "bush_mossy_pair"] },
            { canopy: ["tree_birch", "tree_white_tall"],
              trees: ["tree_birch_young", "tree_birch_dark"],                        // берёзняки-пионеры
              comp: [],
              floor: ["grass_tuft", "moss_patch", "bush_wild"] },
            { canopy: ["tree_dead_big"],
              trees: ["tree_snag", "snag_branchy", "snag_bare"],                     // редкий сухостой
              comp: ["stump_mossy", "stump_hollow_moss"],
              floor: ["moss", "grass_tuft"] },
        ],
        // Сухой пояс (переход к пустыне)
        dry: [
            { canopy: ["tree_twisted"],
              trees: ["tree_dead_sparse", "snag_thin", "scrub_brown", "bush_mound"], // ксерофиты
              comp: [],
              floor: ["grass_dry", "brush_dry", "flowers_dry", "grass_silver"] },
            { canopy: ["tree_palm", "palm_tall"],
              trees: ["bush_round_dark", "grass_dry"],                               // пальмовая роща
              comp: [],
              floor: ["grass_dry", "brush_dry_small"] },
            { canopy: [],
              trees: ["scrub_brown", "scrub_low", "bush_mound"],                     // колючий скраб
              comp: ["grass_silver", "tree_dead_small"],
              floor: ["grass_dry", "reeds_dry"] },
        ],
    };

    // Логичная расстановка объектов мира: точки интереса (деревни, руины, костища)
    // сгущённым поиском с минимальной дистанцией (упрощённый blue-noise), кластерная
    // расстановка вокруг центра, затем амбиент по биомам ячеек (север — снежные
    // объекты, юг — камни и кости, середина — лес с полянами). items: [{ name,
    // group?, weight?, cellsX, cellsY, pass? }] в порядке индексов реестра.
    // tuning (необязательно, 0..1) — ручки густоты растительности редактора:
    // coreDen/edgeDen — плотность посадки в чаще/на опушке, edgeT/coreT — пороги
    // лесного шума «где начинается опушка/чаща». noManMade (по умолчанию true) —
    // дикий мир: без деревень и следов активной человеческой деятельности
    // (вывески, колодцы, бочки, мебель…); руины, кости и разбитые амфоры остаются.
    function generateWorldObjects({ w, h, seed = 1, masks, climate = null, items, ts = 32,
                                    tuning = {}, noManMade = true }) {
        const pick01 = (v, d) => (typeof v === "number" && Number.isFinite(v))
            ? Math.min(0.95, Math.max(0, v)) : d;
        const coreDen = pick01(tuning.coreDen, 0.30);
        const edgeDen = pick01(tuning.edgeDen, 0.07);
        const edgeT = pick01(tuning.edgeT, 0.42);
        const coreT = Math.max(edgeT + 0.05, pick01(tuning.coreT, 0.62));
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
            throw new Error("dualgrid.generateWorldObjects: размеры должны быть целыми ≥ 1");
        }
        const rng = mulberry32(hashSeed(`${typeof seed === "number" ? seed >>> 0 : String(seed)}:world-objects`));
        const n = w * h;
        const water = masks && masks["grass_water.png"];
        const snow = masks && masks["snow_dirt.png"];
        const sand = masks && masks["sand_dirt.png"];
        const snowZone = climate && climate.snowZone, sandZone = climate && climate.sandZone;
        // рукотворные предметы дикой природы (следы активной деятельности):
        // вывески, колодцы, бочки, мебель, топиары, горшки… Имена по префиксам.
        const MAN_MADE = /^(sign|banner|well|table_|easel|chalice|lamp_|pot_|topiary|birdhouse|barrel|crate|planter|fence|anvil|stall|notice|loom|spinning)/;
        const natural = (t) => !noManMade || !MAN_MADE.test(items[t].name);
        const byName = new Map(items.map((it, i) => [it.name, i]));
        const resolve = (names) => names.map((nm) => byName.get(nm)).filter((v) => v !== undefined);

        const occupied = new Uint8Array(n);
        const clearing = new Uint8Array(n); // вокруг POI амбиент не растёт
        const placements = [];
        const pois = [];

        // Опорные клетки типа (ствол/основание): клетки pass-сетки, а без неё —
        // нижняя строка footprint. МЯГКАЯ посадка (чаща) проверяет и метит только
        // их: кроны соседних деревьев свободно перекрываются (y-сортировка рисует
        // ствол переднего на фоне кроны заднего), а жёсткая — весь footprint
        // (постройки POI не должны врезаться друг в друга).
        const solids = items.map((it) => {
            const cx = it.cellsX, cy = it.cellsY, n2 = cx * cy;
            const pass = (typeof it.pass === "string" && /^[01]*$/.test(it.pass) &&
                          it.pass.length === n2) ? it.pass : null;
            const cells = [];
            for (let r = 0; r < cy; r++) {
                for (let c = 0; c < cx; c++) {
                    if (pass ? pass[r * cx + c] === "1" : r === cy - 1) cells.push([c, r]);
                }
            }
            return cells;
        });

        const isLand = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !(water && water[y * w + x]);
        const biomeAt = (x, y) => {
            const k = y * w + x;
            if (snow && snow[k]) return "snow";
            if (sand && sand[k]) return "desert";
            // холодные/жаркие бесснежные клетки — не «снежный/пустынный» биом:
            // снежные спрайты нарисованы под снежные тайлы и вне их не смотрятся
            if (sandZone && sandZone[k] > 0.5) return "desert";
            return "grass";
        };
        function canPlace(t, x, y) {
            const fp = objectFootprint(items[t], x, y, ts);
            if (fp.x0 < 0 || fp.y0 < 0 || fp.x1 >= w || fp.y1 >= h) return false;
            for (let fy = fp.y0; fy <= fp.y1; fy++) {
                for (let fx = fp.x0; fx <= fp.x1; fx++) {
                    const k = fy * w + fx;
                    if (occupied[k] || (water && water[k])) return false;
                }
            }
            return true;
        }
        function place(t, x, y, soft = false, onWater = false) {
            const fp = objectFootprint(items[t], x, y, ts);
            if (fp.x0 < 0 || fp.y0 < 0 || fp.x1 >= w || fp.y1 >= h) return false;
            if (soft) { // чаща: переплетение крон, заняты только опорные клетки
                for (const [c, r] of solids[t]) {
                    const k = (fp.y0 + r) * w + fp.x0 + c;
                    if (occupied[k] || (!onWater && water && water[k])) return false;
                }
                for (const [c, r] of solids[t]) occupied[(fp.y0 + r) * w + fp.x0 + c] = 1;
            } else {
                for (let fy = fp.y0; fy <= fp.y1; fy++) {
                    for (let fx = fp.x0; fx <= fp.x1; fx++) {
                        const k = fy * w + fx;
                        if (occupied[k] || (!onWater && water && water[k])) return false;
                    }
                }
                for (let fy = fp.y0; fy <= fp.y1; fy++) {
                    for (let fx = fp.x0; fx <= fp.x1; fx++) occupied[fy * w + fx] = 1;
                }
            }
            placements.push([t, x, y]);
            return true;
        }
        const weightOf = (t) => Math.max(0.1, items[t].weight || 1);
        function pickFrom(pool) { // pool: [[t, вес], …]
            let total = 0;
            for (const [, wv] of pool) total += wv;
            let r = rng() * total;
            for (const [t, wv] of pool) { r -= wv; if (r <= 0) return t; }
            return pool[pool.length - 1][0];
        }
        function placeCluster(centerNames, supportNames, cx, cy, { support = 6, radius = 8,
                                                                  craftNames = null, craftCount = 0 } = {}) {
            const cPool = resolve(centerNames).map((t) => [t, 1]);
            const sPool = resolve(supportNames).map((t) => [t, 1]);
            for (let t = 0; t < 12 && cPool.length; t++) { // центр с джиттером
                if (place(pickFrom(cPool), cx + Math.floor(rng() * 7) - 3, cy + Math.floor(rng() * 7) - 3)) break;
            }
            const count = support + Math.floor(rng() * 4);
            const ring = (pool, rMin, rMax) => {
                for (let t = 0; t < 14 && pool.length; t++) {
                    const ang = rng() * Math.PI * 2;
                    const dist = rMin + rng() * (rMax - rMin);
                    const x = Math.round(cx + Math.cos(ang) * dist);
                    const y = Math.round(cy + Math.sin(ang) * dist * 0.8);
                    if (isLand(x, y) && place(pickFrom(pool), x, y)) break;
                }
            };
            for (let k = 0; k < count; k++) ring(sPool, 2, radius);
            const crPool = resolve(craftNames || []).map((t) => [t, 1]);
            for (let k = 0; k < craftCount; k++) ring(crPool, 3, Math.max(4, radius - 2));
        }
        function markClearing(cx, cy, r) {
            for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
                for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
                    if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= r) clearing[y * w + x] = 1;
                }
            }
        }
        const sites = [];
        const minDist = (x, y) => {
            let m = Infinity;
            for (const s of sites) m = Math.min(m, Math.max(Math.abs(s.x - x), Math.abs(s.y - y)));
            return m;
        };
        function findSite({ tries = 64, gap = 30, edge = 14, biome = null, middleBias = 0 } = {}) {
            let best = null, bestScore = -Infinity;
            for (let t = 0; t < tries; t++) {
                const x = edge + Math.floor(rng() * Math.max(1, w - 2 * edge));
                const y = edge + Math.floor(rng() * Math.max(1, h - 2 * edge));
                if (!isLand(x, y)) continue;
                if (biome && biomeAt(x, y) !== biome) continue;
                const d = minDist(x, y);
                if (d < gap) continue;
                let score = d;
                if (middleBias) score += middleBias * (1 - Math.abs(y / Math.max(1, h - 1) - 0.5) * 2);
                if (score > bestScore) { bestScore = score; best = { x, y }; }
            }
            return best;
        }

        // 1) Точки интереса. Количество — от площади карты. Деревни — след
        // активной человеческой деятельности: в диком мире (noManMade) их нет.
        const area = w * h;
        const nVillages = noManMade ? 0 : Math.max(1, Math.round(area / 26000));
        const nRuins = Math.max(1, Math.round(area / 34000));
        const nBones = Math.max(1, Math.round(area / 52000));
        for (let k = 0; k < nVillages; k++) {
            const s = findSite({ gap: 34, edge: 16, biome: "grass", middleBias: 10 }) ||
                      findSite({ gap: 30, edge: 16, middleBias: 4 });
            if (!s) continue;
            sites.push(s); pois.push({ type: "village", x: s.x, y: s.y });
            const k = s.y * w + s.x;
            const north = snowZone ? snowZone[k] > 0.3 : biomeAt(s.x, s.y) === "snow";
            placeCluster(north ? WORLD_OBJ_NAMES.wellsNorth : WORLD_OBJ_NAMES.wellsWarm,
                         north ? WORLD_OBJ_NAMES.villageNorth : WORLD_OBJ_NAMES.villageWarm,
                         s.x, s.y, { support: 6, radius: 7,
                                     craftNames: WORLD_OBJ_NAMES.villageCraft,
                                     craftCount: 1 + Math.floor(rng() * 2) });
            markClearing(s.x, s.y, 10);
        }
        for (let k = 0; k < nRuins; k++) {
            const s = findSite({ gap: 30, edge: 14, middleBias: 6 });
            if (!s) continue;
            sites.push(s); pois.push({ type: "ruins", x: s.x, y: s.y });
            placeCluster(WORLD_OBJ_NAMES.ruinsCenter, WORLD_OBJ_NAMES.ruinsSupport,
                         s.x, s.y, { support: 7, radius: 8 });
            markClearing(s.x, s.y, 10);
        }
        for (let k = 0; k < nBones; k++) {
            const s = findSite({ gap: 26, edge: 12, biome: "desert" }) ||
                      findSite({ gap: 24, edge: 12 });
            if (!s) continue;
            sites.push(s); pois.push({ type: "bones", x: s.x, y: s.y });
            placeCluster(WORLD_OBJ_NAMES.bonesCenter, WORLD_OBJ_NAMES.bonesSupport,
                         s.x, s.y, { support: 5, radius: 6 });
            markClearing(s.x, s.y, 8);
        }

        // 3) Амбиент травяного биома — растительные сообщества. Поля:
        //    forest — где лес вообще растёт (чаща/опушка/луг), stand — какой стенд
        //    (вид-доминант) занимает место, glade — поляны внутри чащи,
        //    shore — береговая полоса (ивы и камыш у воды).
        const byGroup = (group) => items.map((it, i) => (it.group === group ? i : -1)).filter((i) => i >= 0);
        const weighted = (list, gw) => list.map((t) => [t, weightOf(t) * gw]);
        const poolSnow = weighted(byGroup("snow").filter(natural), 1);
        const poolDesert = [
            ...weighted(byGroup("stones"), 3),
            ...weighted(resolve(WORLD_OBJ_NAMES.bones), 2),
            ...weighted(resolve(WORLD_OBJ_NAMES.desertTrees), 1.2),
            ...weighted(resolve(WORLD_OBJ_NAMES.desertTrash), 0.8),
            ...weighted(resolve(["scrub_brown", "grass_dry", "flowers_dry"]), 0.7),
        ];
        // луг: дикие травы и цветы (мох/шишки/сухостой — подлесок леса, горшки и
        // клумбы — садовое, в дикой природе не растут)
        const isGarden = (nm) => /pot|planter|crate/.test(nm);
        const poolMeadow = weighted(byGroup("plants").filter((t) =>
            !/moss|pinecone|dry/.test(items[t].name) && !isGarden(items[t].name)), 2);
        const loneMeadow = resolve(["tree_oak_meadow", "tree_small", "tree_willow_small"])
            .map((t) => [t, 1]);
        const bushPool = resolve(["bush_round", "bush_round_dark", "bush_double", "bush_leafy",
                                  "bush_wild", "bush_round_big", "bush_green", "bush_berry"])
            .map((t) => [t, 1]);
        const willowPool = resolve(["tree_willow", "willow_white", "tree_willow_small"])
            .map((t) => [t, 3]);
        const reedPool = resolve(["grass_reeds", "reeds_big", "grass_sedge"]).map((t) => [t, 1]);
        const forest = rankNormalize(fbmField(w, h, rng, Math.max(3, Math.round(Math.min(w, h) / 26))));
        const standRank = rankNormalize(fbmField(w, h, rng, Math.max(4, Math.round(Math.min(w, h) / 12))));
        const gladeRank = rankNormalize(fbmField(w, h, rng, Math.max(6, Math.round(Math.min(w, h) / 16))));
        // Берега: трава в 2 клетках от воды (ивы, камыш), сама вода исключена
        const shore = water ? dilateMask(water, w, h, 2) : null;
        // Снежные спрайты нарисованы под снежные тайлы поверхности: ставить их
        // можно только вглубь снега — весь footprint в эрозированной на 1 клетку
        // маске снега (зазор ≥1 от кромки). Бесснежный холод подходит тайге.
        const snowDeep = snow ? erodeMask(snow, w, h) : null;
        const footIn = (t, x, y, mask) => {
            if (!mask) return false;
            const fp = objectFootprint(items[t], x, y, ts);
            if (fp.x0 < 0 || fp.y0 < 0 || fp.x1 >= w || fp.y1 >= h) return false;
            for (let fy = fp.y0; fy <= fp.y1; fy++) {
                for (let fx = fp.x0; fx <= fp.x1; fx++) {
                    if (!mask[fy * w + fx]) return false;
                }
            }
            return true;
        };
        // Стенд зоны: массив сообществ зависит от климатической фазы клетки
        const vegZoneStands = (k) => snowZone && snowZone[k] > 0.4 ? WORLD_VEG.taiga
            : sandZone && sandZone[k] > 0.45 ? WORLD_VEG.dry : WORLD_VEG.temperate;

        // Проход 1 — ПОЛОГ: крупные деревья стенда занимают место первыми
        // (в реальном лесу подрост развивается под пологом, а не наоборот).
        // Посадка мягкая: в чаще кроны смыкаются и переплетаются в сплошной свод.
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const k = y * w + x;
                if ((water && water[k]) || occupied[k] || clearing[k]) continue;
                if (biomeAt(x, y) !== "grass") continue;
                const F = forest[k];
                if (F <= edgeT) continue;                         // лес: чаща + опушка
                const den = F > coreT ? coreDen * 0.2 : edgeDen * 0.17; // полог пропорционален
                if (rng() >= den) continue;
                const stands = vegZoneStands(k);
                const stand = stands[Math.min(stands.length - 1, Math.floor(standRank[k] * stands.length))];
                const pool = weighted(resolve(stand.canopy), 1);
                if (pool.length) place(pickFrom(pool), x, y, true);
            }
        }

        // Проход 2 — подрост, подлесок, луга, берега. Луг сеется КОМКАМИ
        // (клумбоватый шум): между куртинами трав и цветов — голая земля.
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const k = y * w + x;
                if ((water && water[k]) || occupied[k] || clearing[k]) continue;
                const b = biomeAt(x, y);
                if (b === "snow") { // снежный биом: только вглубь снега, с зазором от кромки
                    if (rng() < 0.055) {
                        const t = pickFrom(poolSnow);
                        if (footIn(t, x, y, snowDeep)) place(t, x, y, true);
                    }
                    continue;
                }
                if (b === "desert") { // пустыня — камни/кости/сухие деревья
                    if (rng() < 0.045) place(pickFrom(poolDesert), x, y, true);
                    continue;
                }
                // Ивы и камыш у берега
                if (shore && shore[k] && rng() < 0.12) {
                    place(pickFrom(rng() < 0.6 ? willowPool : reedPool), x, y, true);
                    continue;
                }
                const F = forest[k];
                const core = F > coreT, edge = !core && F > edgeT;    // чаща / опушка
                const glade = core && gladeRank[k] > 0.9;             // поляна в чаще
                let den = core ? coreDen : edge ? edgeDen : 0;        // градиент плотности
                if (glade) den = 0.05;
                if (!core && !edge) { // луг: куртины трав/цветов, голые прогалины,
                    const clump = gladeRank[k] > 0.6;                 // редкое одиночное дерево
                    den = clump ? 0.10 : 0.008;
                    if (rng() >= den) continue;
                    if (clump && loneMeadow.length && rng() < 0.08) place(pickFrom(loneMeadow), x, y, true);
                    else if (poolMeadow.length) place(pickFrom(poolMeadow), x, y, true);
                    continue;
                }
                if (rng() >= den) continue;
                const stands = vegZoneStands(k);
                const stand = stands[Math.min(stands.length - 1, Math.floor(standRank[k] * stands.length))];
                const treePool = [...weighted(resolve(stand.trees), 3),
                                  ...weighted(resolve(stand.comp), 1)];
                const r = rng();
                if (r < (glade ? 0.15 : core ? 0.60 : 0.5)) {         // подрост стенда:
                    if (treePool.length) place(pickFrom(treePool), x, y, true); // доминанты тяжелее
                } else if (r < (core ? 0.92 : 0.78)) {                // подлесок сообщества
                    const floorPool = weighted(resolve(stand.floor), 1);
                    if (floorPool.length) place(pickFrom(floorPool), x, y, true);
                    else if (bushPool.length) place(pickFrom(bushPool), x, y, true);
                } else if (edge && bushPool.length) {                 // кусты — в основном на опушке
                    place(pickFrom(bushPool), x, y, true);
                }
            }
        }

        // Проход 3 — вода: понемногу водных объектов (кувшинки, ряска, затопленные
        // коряги, камыш на воде). Спрайт — декаль со своей водяной основой, весь
        // footprint обязан лежать на водных тайлах.
        const poolWater = weighted(items.map((it, i) =>
            (it.group === "water" && natural(i)) ? i : -1).filter((i) => i >= 0), 1);
        if (water && poolWater.length) {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (!water[y * w + x] || occupied[y * w + x] || rng() >= 0.02) continue;
                    const t = pickFrom(poolWater);
                    const fp = objectFootprint(items[t], x, y, ts);
                    if (fp.x0 < 0 || fp.y0 < 0 || fp.x1 >= w || fp.y1 >= h) continue;
                    let ok = true;
                    for (let fy = fp.y0; fy <= fp.y1 && ok; fy++) {
                        for (let fx = fp.x0; fx <= fp.x1 && ok; fx++) {
                            if (!water[fy * w + fx]) ok = false;
                        }
                    }
                    if (ok) place(t, x, y, true, true);
                }
            }
        }
        return { placements, pois };
    }

    // ── МАНИФЕСТ И ФАЙЛ КАРТЫ (JSON) ──────────────────────────────────────────
    function assertFormat(obj, expected, what) {
        if (!obj || obj.format !== expected) {
            throw new Error(`dualgrid: это не ${what} (format: ${obj && obj.format}, ожидался ${expected})`);
        }
    }

    // Манифест — описание ГЕНЕРАЦИИ: движок сам строит карту по параметрам.
    // objects (необязательно): { density, avoidHideBg, items: [{ name, weight }] }
    function makeManifest({ width, height, seed = 1, layers, objects = null }) {
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
            throw new Error("dualgrid.makeManifest: width/height должны быть целыми ≥ 1");
        }
        if (!Array.isArray(layers) || layers.length === 0) {
            throw new Error("dualgrid.makeManifest: нужен непустой массив layers");
        }
        const out = {
            format: "dualgrid-manifest",
            version: 2,
            width,
            height,
            seed: seed ?? 1,
            layers: layers.map((l) => {
                const o = {
                    texture: l.texture,
                    frequency: clampPercent(l.frequency ?? 30),
                    scatter: clampPercent(l.scatter ?? 50),
                    margin: clampMargin(l.margin ?? 3),
                    outside: (l.outside ?? 0) ? 1 : 0,
                    hideBackground: !!l.hideBackground,
                };
                if (l.layout) o.layout = l.layout;
                if (l.png) o.png = l.png;
                if (l.on) o.on = l.on;
                return o;
            }),
        };
        if (objects) {
            out.objects = {
                density: clampPercent(objects.density ?? 12),
                avoidHideBg: objects.avoidHideBg !== false,
                items: (objects.items || []).map((it) => {
                    const o = { name: it.name, weight: clampWeight(it.weight) };
                    if (typeof it.pass === "string" && /^[01]+$/.test(it.pass)) o.pass = it.pass;
                    return o;
                }),
            };
        }
        return out;
    }

    // Файл карты — ГОТОВАЯ карта: движок только загружает и отрисовывает.
    // objects (необязательно): { items: [{ name, weight }], placements: [[t, x, y], …] }
    function makeMap({ width, height, layers, objects = null, tileSize = null }) {
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
            throw new Error("dualgrid.makeMap: width/height должны быть целыми ≥ 1");
        }
        if (!Array.isArray(layers) || layers.length === 0) {
            throw new Error("dualgrid.makeMap: нужен непустой массив layers");
        }
        const out = {
            format: "dualgrid-map",
            version: 2,
            tileSize,
            width,
            height,
            layers: layers.map((l) => {
                if (!l.data || l.data.length !== width * height) {
                    throw new Error(`dualgrid.makeMap: data слоя «${l.texture}» должна быть длиной width*height`);
                }
                const o = {
                    texture: l.texture,
                    data: Array.from(l.data, (v) => (v ? 1 : 0)),
                    outside: (l.outside ?? 0) ? 1 : 0,
                    hideBackground: !!l.hideBackground,
                };
                if (l.layout) o.layout = l.layout;
                if (l.png) o.png = l.png;
                return o;
            }),
        };
        if (objects) {
            const placements = (objects.placements || []).map(([t, x, y]) => {
                if (![t, x, y].every(Number.isInteger)) {
                    throw new Error("dualgrid.makeMap: placements должны быть [[t, x, y], …] из целых чисел");
                }
                return [t, x, y];
            });
            out.objects = {
                items: (objects.items || []).map((it) => {
                    const o = { name: it.name, weight: clampWeight(it.weight) };
                    if (typeof it.pass === "string" && /^[01]+$/.test(it.pass)) o.pass = it.pass;
                    return o;
                }),
                placements,
            };
        }
        return out;
    }

    // Найти текстуру слоя: точное имя → базовое имя файла → встроенный png (data URL)
    function loadTexture(name, embeddedPng, textures) {
        if (textures) {
            if (textures[name]) return textures[name];
            const base = String(name).split(/[\\/]/).pop().toLowerCase();
            for (const key of Object.keys(textures)) {
                if (String(key).split(/[\\/]/).pop().toLowerCase() === base) return textures[key];
            }
        }
        if (embeddedPng) {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                    const tex = PIXI.Texture.from(image);
                    tex.source.scaleMode = "nearest";
                    resolve(tex);
                };
                image.onerror = () => reject(new Error(`dualgrid: не удалось загрузить встроенный png «${name}»`));
                image.src = embeddedPng;
            });
        }
        return Promise.reject(new Error(`dualgrid: текстура «${name}» не найдена — ` +
            `передайте справочник textures или вставьте png (base64) в файл`));
    }

    function normalizeMapData(data, w, h, name) {
        if (!data || data.length !== w * h) {
            throw new Error(`dualgrid: data слоя «${name}» должна быть длиной ${w * h}`);
        }
        return Uint8Array.from(data, (v) => (v ? 1 : 0));
    }

    // Построить стек слоёв по манифесту (генерация). textures — { "имя.png": Texture }.
    async function mapFromManifest(manifest, textures) {
        assertFormat(manifest, "dualgrid-manifest", "манифест dualgrid");
        const w = manifest.width, h = manifest.height;
        const root = new PIXI.Container();
        const result = { root, layers: [], maps: [], objects: null, w, h };
        const lowerMasks = []; // финальные маски нижних слоёв: [texture, data]
        let ts = 32;
        let i = 0;
        for (const l of manifest.layers) {
            const seedLayer = `${manifest.seed ?? 1}:${i}:${l.texture ?? i}`;
            const margin = clampMargin(l.margin ?? 3);
            // Привязка «on»: фичи слоя разрешены только внутри фич указанного нижнего
            // слоя (с отступом 1 клетку внутрь — чтобы переходные тайлы слоя лежали
            // на его собственном фоне, а не на чужом). К привязанному слою зазор не
            // применяется — переходы между ними рисует его собственный тайлсет.
            let confine = null, confineCells = 0;
            if (l.on) {
                const hit = lowerMasks.find(([tex]) => tex === l.on);
                if (hit) {
                    confine = erodeMask(hit[1], w, h);
                    for (let k = 0; k < confine.length; k++) confineCells += confine[k];
                }
            }
            // Зазор до нижних слоёв с ДРУГИМ тайлсетом: у них нет общего перехода,
            // стык «фича в фичу» рисуется прямыми срезами спрайтов. Привязанный слой
            // (l.on) из блокеров исключён — его фон общий со слоем по определению.
            const blockers = lowerMasks
                .filter(([tex]) => tex !== (l.texture ?? i) && tex !== l.on)
                .map(([, mask]) => mask);
            const target = clampPercent(l.frequency) / 100;

            // Частота выдерживается ПОСЛЕ раздвижки: если зазор съел часть слоя,
            // поднимаем входную частоту и перегенерируем (детерминированно, тот же сид).
            // got монотонно растёт с freq → сходимость; при 100% берём максимум возможного.
            // При привязке доля считается по клеткам разрешённой зоны, а не всей карты.
            let freq = clampPercent(l.frequency ?? 30);
            let map = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                const raw = generateMap({ w, h, seed: seedLayer, frequency: freq, scatter: l.scatter });
                let data = raw.data;
                if (confine) {
                    for (let k = 0; k < data.length; k++) data[k] &= confine[k];
                }
                map = { w, h, data: separateLayer(data, blockers, margin, w, h) };
                let got = 0;
                for (let k = 0; k < map.data.length; k++) got += map.data[k];
                got /= confine ? Math.max(confineCells, 1) : w * h;
                if ((!blockers.length && !confine) || got >= target * 0.92 || freq >= 100 || target === 0) break;
                freq = clampPercent(Math.min(100, Math.ceil(freq * Math.min(3, target / Math.max(got, 0.005)) + 2)));
            }

            const texture = await loadTexture(l.texture, l.png, textures);
            if (texture.width % 4 === 0) ts = texture.width / 4;
            const layer = build({
                texture,
                map,
                outside: l.outside,
                layout: l.layout || TILE_CORNERS,
                hideBackground: l.hideBackground,
            });
            root.addChild(layer);
            result.layers.push(layer);
            result.maps.push(map);
            lowerMasks.push([l.texture ?? i, map.data]);
            i++;
        }

        // Объекты поверх пола: генерация по objects-секции манифеста. avoidHideBg —
        // не ставить объекты на «фичи» наслаиваемых слоёв (вода и т.п.).
        const ospec = manifest.objects;
        if (ospec && Array.isArray(ospec.items) && ospec.items.length) {
            const items = [];
            for (const oi of ospec.items) {
                const tex = await loadTexture(oi.name, oi.png, textures);
                items.push({ name: oi.name, texture: tex, weight: oi.weight });
            }
            let avoid = null;
            if (ospec.avoidHideBg !== false) {
                for (let k = 0; k < manifest.layers.length; k++) {
                    if (!manifest.layers[k].hideBackground) continue;
                    const mask = result.maps[k].data;
                    if (!avoid) avoid = Uint8Array.from(mask);
                    else for (let q = 0; q < avoid.length; q++) avoid[q] = avoid[q] || mask[q];
                }
            }
            const genItems = items.map((it) => ({ weight: it.weight,
                cellsX: it.texture.width / ts, cellsY: it.texture.height / ts }));
            const placements = generateObjects({ w, h, seed: `${manifest.seed ?? 1}:objects`,
                density: ospec.density, items: genItems, avoid });
            const container = buildObjects({ items, ts, w, h });
            syncObjects(container, placements);
            root.addChild(container);
            result.objects = container;
            result.collision = buildCollisionMap({ w, h, items: container.objectsMeta.items,
                placements: container.objectsMeta.placements.map((p) => [p.t, p.x, p.y]), ts });
        }
        return result;
    }

    // Построить стек слоёв из готового файла карты (без генерации)
    async function mapFromJSON(mapJson, textures) {
        assertFormat(mapJson, "dualgrid-map", "файл карты dualgrid");
        const w = mapJson.width, h = mapJson.height;
        const root = new PIXI.Container();
        const result = { root, layers: [], maps: [], objects: null, w, h };
        let ts = 32;
        for (const l of mapJson.layers) {
            const map = { w, h, data: normalizeMapData(l.data, w, h, l.texture) };
            const texture = await loadTexture(l.texture, l.png, textures);
            if (texture.width % 4 === 0) ts = texture.width / 4;
            const layer = build({
                texture,
                map,
                outside: l.outside,
                layout: l.layout || TILE_CORNERS,
                hideBackground: l.hideBackground,
            });
            root.addChild(layer);
            result.layers.push(layer);
            result.maps.push(map);
        }
        // Готовые раскладки объектов — без генерации
        const ospec = mapJson.objects;
        if (ospec && Array.isArray(ospec.items) && ospec.items.length) {
            const items = [];
            for (const oi of ospec.items) {
                const tex = await loadTexture(oi.name, oi.png, textures);
                items.push({ name: oi.name, texture: tex, weight: oi.weight });
            }
            const container = buildObjects({ items, ts, w, h });
            syncObjects(container, ospec.placements || []);
            root.addChild(container);
            result.objects = container;
            result.collision = buildCollisionMap({ w, h, items: container.objectsMeta.items,
                placements: container.objectsMeta.placements.map((p) => [p.t, p.x, p.y]), ts });
        }
        return result;
    }

    return { build, update, tileIndex, sliceTileset: makeTileTextures, detectLayout, generateMap, separateLayer, dilateMask,
             fbmField, rankNormalize, generateWorld, generateWorldObjects,
             WORLD_OBJ_NAMES, WORLD_VEG,
             makeManifest, makeMap, mapFromManifest, mapFromJSON, TILE_CORNERS,
             objectRect, objectFootprint, generateObjects,
             buildObjects, syncObjects, placeObject, eraseObjectAt, objectAt,
             buildCollisionMap, defaultPass };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — создаётся глобальная createDualGrid (работает и на file://);
//   2) import "./dualgrid.js" внутри модуля — глобальная ставится как побочный эффект.
globalThis.createDualGrid = createDualGrid;
