// АССЕТЫ — единая загрузка ресурсов с прогрессом и кэшем поверх PIXI.Assets.
// Игре больше не нужно знать, как нарезать спрайтшиты и когда что загрузилось.
//
// Пример:
//   const assets = createAssets();
//   await assets.load(["images/bullets/all.png", "images/tiles/tile1.png"],
//                     (progress) => console.log(`Загружено ${progress * 100}%`));
//   const tex = assets.get("images/tiles/tile1.png");
//   const frames = await assets.loadSpritesheet("images/bullets/all.png", 32, 32);
function createAssets() {
    const cache = new Map();

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

    // Загрузить одну текстуру (с кэшем)
    async function loadTexture(url) {
        if (cache.has(url)) return cache.get(url);
        const texture = await PIXI.Assets.load(url);
        cache.set(url, texture);
        return texture;
    }

    // Получить из кэша без загрузки (undefined, если ещё не загружена)
    function get(url) {
        return cache.get(url);
    }

    // Нарезать изображение на сетку кадров (frameWidth × frameHeight).
    // Возвращает массив текстур, делящих один источник — как loadSpritesheetFromImage
    // в ядре, но с кэшем нарезки по ключу "url#fwxFH".
    async function loadSpritesheet(url, frameWidth, frameHeight) {
        const key = `${url}#${frameWidth}x${frameHeight}`;
        if (cache.has(key)) return cache.get(key);
        const texture = await loadTexture(url);
        const totalFramesX = Math.floor(texture.width / frameWidth);
        const totalFramesY = Math.floor(texture.height / frameHeight);
        const textures = [];
        for (let row = 0; row < totalFramesY; row++) {
            for (let col = 0; col < totalFramesX; col++) {
                textures.push(new PIXI.Texture({
                    source: texture.source,
                    frame: new PIXI.Rectangle(col * frameWidth, row * frameHeight, frameWidth, frameHeight),
                }));
            }
        }
        cache.set(key, textures);
        return textures;
    }

    // ПЕРСОНАЖ из формата пиксельного редактора: <base>.png — сетка
    // (строка = анимация, колонка = кадр) + <base>.json — манифест
    // {size, columns, fps, animations:[{name,row,frames}]}.
    // Возвращает { size, columns, fps, animationSpeed, animations: {...} } —
    // массивы готовы для AnimatedSprite (конфиг юнита: textures: anim.wait).
    // animationSpeed = fps/60 — готово для sprite.animationSpeed (у PixiJS
    // скорость 1 = 60 кадров/с).
    async function loadCharacter(pngUrl) {
        const base = pngUrl.replace(/\.png$/, "");
        let manifest = cache.get(`${base}#manifest`);
        if (!manifest) {
            const response = await fetch(`${base}.json`);
            if (!response.ok) throw new Error(`Манифест не найден: ${base}.json`);
            manifest = await response.json();
            cache.set(`${base}#manifest`, manifest);
        }
        const all = await loadSpritesheet(pngUrl, manifest.size, manifest.size);
        const animations = {};
        for (const a of manifest.animations) {
            animations[a.name] = all.slice(a.row * manifest.columns, a.row * manifest.columns + a.frames);
        }
        const fps = manifest.fps ?? null;
        return {
            size: manifest.size,
            columns: manifest.columns,
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
        get progressInfo() { return { cached: cache.size }; },
    };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createAssets = createAssets;
