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
//   { format: "dualgrid-manifest", version: 1, width, height, seed,
//     layers: [{ texture, frequency, scatter, outside, hideBackground, layout? }] }
//   frequency — процент ячеек «фичи» (0..100, выдерживается точно квантилем шума),
//   scatter — «разброс»: 0 — крупные материки, 100 — мелкие островки.
//   makeManifest({...}) собирает объект с умолчаниями и проверкой,
//   mapFromManifest(манифест, textures) → Promise<{ root, layers, maps }> — стек слоёв.
//   Сид каждого слоя детерминирован: hashSeed(`${seed}:${индекс}:${texture}`) —
//   одна и та же генерация в движке и редакторе.
//
//   2) Локальную карту (данж) можно ОТРИСОВЫВАТЬ из готового файла карты:
//   { format: "dualgrid-map", version: 1, width, height,
//     layers: [{ texture, data: [0/1, ...], outside, hideBackground, layout? }] }
//   mapFromJSON(карта, textures) → Promise<{ root, layers, maps }> — без генерации.
//
//   В обоих форматах слой может нести png: "data:image/png;base64,…" — тогда текстура
//   берётся прямо из файла (файл самодостаточен). textures — необязательный справочник
//   { "имя.png": PIXI.Texture }; сначала ищется точное имя, затем по базовому имени.
//
//   generateMap({ w, h, seed, frequency, scatter }) — процедурная карта 0/1 (fBm-шум
//   value-noise, 3 октавы; порог берётся квантилем, поэтому частота соблюдается точно).

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

        // Порог = квантиль распределения значений → частота соблюдается точно
        const sorted = Float32Array.from(value).sort();
        const n = sorted.length;
        const idx = Math.floor((1 - f) * n);
        const threshold = idx >= n ? sorted[n - 1] + 1e-6 : sorted[idx];
        const data = new Uint8Array(n);
        for (let i = 0; i < n; i++) data[i] = value[i] >= threshold ? 1 : 0;
        return { w, h, data };
    }

    // ── МАНИФЕСТ И ФАЙЛ КАРТЫ (JSON) ──────────────────────────────────────────
    function assertFormat(obj, expected, what) {
        if (!obj || obj.format !== expected) {
            throw new Error(`dualgrid: это не ${what} (format: ${obj && obj.format}, ожидался ${expected})`);
        }
    }

    // Манифест — описание ГЕНЕРАЦИИ: движок сам строит карту по параметрам
    function makeManifest({ width, height, seed = 1, layers }) {
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
            throw new Error("dualgrid.makeManifest: width/height должны быть целыми ≥ 1");
        }
        if (!Array.isArray(layers) || layers.length === 0) {
            throw new Error("dualgrid.makeManifest: нужен непустой массив layers");
        }
        return {
            format: "dualgrid-manifest",
            version: 1,
            width,
            height,
            seed: seed ?? 1,
            layers: layers.map((l) => {
                const out = {
                    texture: l.texture,
                    frequency: clampPercent(l.frequency ?? 30),
                    scatter: clampPercent(l.scatter ?? 50),
                    outside: (l.outside ?? 0) ? 1 : 0,
                    hideBackground: !!l.hideBackground,
                };
                if (l.layout) out.layout = l.layout;
                if (l.png) out.png = l.png;
                return out;
            }),
        };
    }

    // Файл карты — ГОТОВАЯ карта: движок только загружает и отрисовывает
    function makeMap({ width, height, layers, tileSize = null }) {
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
            throw new Error("dualgrid.makeMap: width/height должны быть целыми ≥ 1");
        }
        if (!Array.isArray(layers) || layers.length === 0) {
            throw new Error("dualgrid.makeMap: нужен непустой массив layers");
        }
        return {
            format: "dualgrid-map",
            version: 1,
            tileSize,
            width,
            height,
            layers: layers.map((l) => {
                if (!l.data || l.data.length !== width * height) {
                    throw new Error(`dualgrid.makeMap: data слоя «${l.texture}» должна быть длиной width*height`);
                }
                const out = {
                    texture: l.texture,
                    data: Array.from(l.data, (v) => (v ? 1 : 0)),
                    outside: (l.outside ?? 0) ? 1 : 0,
                    hideBackground: !!l.hideBackground,
                };
                if (l.layout) out.layout = l.layout;
                if (l.png) out.png = l.png;
                return out;
            }),
        };
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
        const result = { root, layers: [], maps: [], w, h };
        let i = 0;
        for (const l of manifest.layers) {
            // Сид слоя детерминирован (совпадает с редактором и между запусками)
            const map = generateMap({
                w, h,
                seed: `${manifest.seed ?? 1}:${i}:${l.texture ?? i}`,
                frequency: l.frequency,
                scatter: l.scatter,
            });
            const texture = await loadTexture(l.texture, l.png, textures);
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
            i++;
        }
        return result;
    }

    // Построить стек слоёв из готового файла карты (без генерации)
    async function mapFromJSON(mapJson, textures) {
        assertFormat(mapJson, "dualgrid-map", "файл карты dualgrid");
        const w = mapJson.width, h = mapJson.height;
        const root = new PIXI.Container();
        const result = { root, layers: [], maps: [], w, h };
        for (const l of mapJson.layers) {
            const map = { w, h, data: normalizeMapData(l.data, w, h, l.texture) };
            const texture = await loadTexture(l.texture, l.png, textures);
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
        return result;
    }

    return { build, update, tileIndex, detectLayout, generateMap, makeManifest, makeMap,
             mapFromManifest, mapFromJSON, TILE_CORNERS };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — создаётся глобальная createDualGrid (работает и на file://);
//   2) import "./dualgrid.js" внутри модуля — глобальная ставится как побочный эффект.
globalThis.createDualGrid = createDualGrid;
