// АССЕТЫ — единая загрузка ресурсов с прогрессом и кэшем поверх PIXI.Assets.
// Игре больше не нужно знать, как нарезать спрайтшиты и когда что загрузилось.
//
// Пример:
//   const assets = createAssets();
//   await assets.load(["images/bullets/all.png", "images/tiles/tile1.png"],
//                     (progress) => console.log(`Загружено ${progress * 100}%`));
//   const tex = assets.get("images/tiles/tile1.png");
//   const frames = await assets.loadSpritesheet("images/bullets/all.png", 32, 32);
//   const wolf = await assets.loadCharacter("images/sprites/wolf_64"); // <база>.png + .json
function createAssets() {
    const cache = new Map();

    // Рамка кадра подрезана на долю пикселя: UV ровно по границам кадров при
    // дробной фазе кромки спрайта на экране (нечётный канвас, нецелый зум)
    // захватывает крайнюю строку/столбец соседнего кадра — тёмная линия стоп
    // «протекает» на соседний кадр. 0.05px на зуме ×4 — 0.2 экранных пикселя.
    const FRAME_PAD = 0.05;

    // Texture из data-URL (file://-режим): <img> из data: — чистый origin,
    // тогда как картинка с диска на file://-странице чужая для GPU.
    function textureFromDataURL(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const tex = PIXI.Texture.from(img);
                tex.source.scaleMode = "nearest";
                resolve(tex);
            };
            img.onerror = () => reject(new Error("битый data-URL изображения"));
            img.src = src;
        });
    }

    // Загрузить список URL. onProgress(доля 0..1, url) вызывается после каждого файла.
    // Повторная загрузка уже кэшированного — мгновенна.
    async function load(urls, onProgress = null) {
        let done = 0;
        const results = {};
        await Promise.all(urls.map(async (url) => {
            results[url] = await loadTexture(url);
            done++;
            if (onProgress) onProgress(done / urls.length, url);
        }));
        return results;
    }

    // Загрузить одну текстуру (с кэшем); пиксельарт — без сглаживания
    async function loadTexture(url) {
        if (cache.has(url)) return cache.get(url);
        const texture = await PIXI.Assets.load(url);
        texture.source.scaleMode = "nearest";
        cache.set(url, texture);
        return texture;
    }

    // Получить из кэша без загрузки (undefined, если ещё не загружена)
    function get(url) {
        return cache.get(url);
    }

    // Нарезать текстуру на сетку кадров frameWidth × frameHeight с кэшем по ключу.
    // Возвращает массив текстур, делящих один источник.
    function sliceGrid(texture, frameWidth, frameHeight, key) {
        if (cache.has(key)) return cache.get(key);
        const p = FRAME_PAD;
        const totalFramesX = Math.floor(texture.width / frameWidth);
        const totalFramesY = Math.floor(texture.height / frameHeight);
        const textures = [];
        for (let row = 0; row < totalFramesY; row++) {
            for (let col = 0; col < totalFramesX; col++) {
                textures.push(new PIXI.Texture({
                    source: texture.source,
                    frame: new PIXI.Rectangle(
                        col * frameWidth + p, row * frameHeight + p,
                        frameWidth - 2 * p, frameHeight - 2 * p),
                }));
            }
        }
        cache.set(key, textures);
        return textures;
    }

    // Нарезать изображение на сетку кадров (frameWidth × frameHeight).
    async function loadSpritesheet(url, frameWidth, frameHeight) {
        return sliceGrid(await loadTexture(url), frameWidth, frameHeight,
            `${url}#${frameWidth}x${frameHeight}`);
    }

    // ПЕРСОНАЖ из формата пиксельного редактора: <base>.png — сетка
    // (строка = анимация, колонка = кадр) + <base>.json — манифест
    // {size, columns, fps, animations:[{name,row,frames}]}.
    // Возвращает { size, columns, fps, animationSpeed, animations: {...} } —
    // массивы готовы для AnimatedSprite (конфиг юнита: textures: anim.wait).
    // animationSpeed = fps/60 — готово для sprite.animationSpeed (у PixiJS
    // скорость 1 = 60 кадров/с).
    // Вшитый режим (file://): манифест передаётся готовым объектом, png —
    // data-URL: loadCharacter("wolf_64", EMBED.wolf) — мимо fetch и PIXI.Assets.
    async function loadCharacter(base, { manifest = null, png = null } = {}) {
        let mf = manifest ?? cache.get(`${base}#manifest`);
        if (!mf) {
            const response = await fetch(`${base}.json`);
            if (!response.ok) throw new Error(`Манифест не найден: ${base}.json`);
            mf = await response.json();
            cache.set(`${base}#manifest`, mf);
        }
        const texture = png
            ? textureFromDataURL(png) // data-URL не кэшируем: вшитые копии уникальны
            : await loadTexture(`${base}.png`);
        const all = sliceGrid(await texture, mf.size, mf.size, `${base}#${mf.size}`);
        const animations = {};
        for (const a of mf.animations) {
            animations[a.name] = all.slice(a.row * mf.columns, a.row * mf.columns + a.frames);
        }
        const fps = mf.fps ?? null;
        return {
            size: mf.size,
            columns: mf.columns,
            fps,
            animationSpeed: fps ? fps / 60 : null,
            animations,
        };
    }

    return {
        load,
        loadTexture,
        loadSpritesheet,
        loadCharacter,
        get,
        cache,
        textureFromDataURL,
        get progressInfo() { return { cached: cache.size }; },
    };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createAssets = createAssets;
