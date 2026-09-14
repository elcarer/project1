// ИГРОВАЯ ЛОГИКА — открытый мир (dualgrid) + контроллер персонажа.
// При старте генерируется карта «открытого мира» теми же функциями, что и в
// редакторе (dual.generateWorld + dual.generateWorldObjects); четыре слоя пола
// запекаются в один при загрузке (перекрытые тайлы отбрасываются), и этот слой
// показывает только видимые тайлы потоковая ECS-система modules/tilemap.js.
// Все объекты мира и герой — сущности ECS (позиция/спрайт → culling ядра);
// спрайты объектов разложены по «рядам ног» для дешёвой y-сортировки.
// Оборотень (wolf_128, стандартный набор 11 анимаций) управляется
// modules/character.js: стрелки/WASD/джойстик, диагональ играет анимацию
// последнего нажатого направления, скольжение вдоль непроходимых клеток.
//
// Параметры запуска: index.html?w=500&h=500&seed=7 (по умолчанию 500×500,
// случайный сид — он показывается в оверлее отладки, чтобы мир можно было
// воспроизвести). Классический <script> (движок в dual-mode глобалях, порядок
// подключения — в index.html): работает и с file://, и по http.
//
// Модули-глобали (см. index.html): PIXI, init/ECS/world/… (engine.js),
// createDualGrid, createInput, createCamera, createCharacterInput,
// createCharacterSystem, createTilemapSystem, createHUD, createScenes,
// createDebug, DUALGRID_OBJECTS (реестр), EMBEDDED_GAME_ASSETS (только file://).
(async () => {
    const engine = await init();
    const { app, worldContainer, world, ECS, COMPONENTS, DATA, SpatialHashGrid, addSystem } = engine;
    const dual = globalThis.createDualGrid();
    const TS = 32; // размер тайла dualgrid

    // ===== Параметры запуска: ?w=&h=&seed= =====
    const q = new URLSearchParams(location.search);
    const clampInt = (v, lo, hi, def) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
    };
    const W = clampInt(q.get("w"), 32, 2048, 500);
    const H = clampInt(q.get("h"), 32, 2048, 500);
    const SEED = q.has("seed")
        ? clampInt(q.get("seed"), 0, 2147483647, 1)
        : Math.floor(Math.random() * 2147483647);

    // ===== HUD: подсказка + статус загрузки =====
    const hud = createHUD({ app });
    hud.text("hint", "WASD/стрелки/джойстик — движение | пробел — атака | колесо — зум | P — пауза", {
        x: 16, y: 12, size: 12, color: "#88ffcc",
    });
    hud.text("status", "загрузка…", { x: 16, y: 32, size: 14, color: "#ffee66" });
    const setStage = (s) => hud.setText("status", s);
    const frame = () => new Promise((r) => requestAnimationFrame(r)); // дать статусу отрисоваться

    // Texture из data-URL (file://-режим): <img> из data: — чистый origin
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

    // На file:// картинка с диска — чужой origin: WebGL не грузит её в GPU,
    // а fetch/XHR до файла запрещены. Вшитые копии — только для этого режима.
    const FILE_MODE = location.protocol === "file:";
    const EMBED = globalThis.EMBEDDED_GAME_ASSETS;
    if (FILE_MODE && !EMBED) throw new Error("file://: не подключён scripts/embedded_assets.js");

    // ===== Текстуры тайлсетов =====
    setStage("загрузка тайлсетов…");
    await frame();
    const TILESETS = ["grass_dirt.png", "grass_water.png", "snow_dirt.png", "sand_dirt.png"];
    const tileTex = {};
    for (const name of TILESETS) {
        const tex = FILE_MODE
            ? await textureFromDataURL(EMBED.tiles[name])
            : await PIXI.Assets.load(`./images/tiles/${name}`);
        tex.source.scaleMode = "nearest"; // пиксельарт без сглаживания
        tileTex[name] = tex;
    }

    // ===== Реестр объектов (index.html подключает images/objects/objects_data.js) =====
    if (!window.DUALGRID_OBJECTS) throw new Error("objects_data.js не подключён в index.html");
    setStage("загрузка реестра объектов…");
    await frame();
    const registry = window.DUALGRID_OBJECTS.items;
    const baseName = (p) => String(p).split(/[\\/]/).pop();
    const objItems = []; // для buildObjects: { name, texture, pass }
    for (let i = 0; i < registry.length; i++) {
        const it = registry[i];
        const img = new Image();
        await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = () => rej(new Error(`битый png в реестре: ${it.name}`));
            img.src = it.png; // data-URL WebP — работает при любом origin
        });
        const tex = PIXI.Texture.from(img);
        tex.source.scaleMode = "nearest";
        objItems.push({
            name: baseName(it.name),
            texture: tex,
            pass: (typeof it.pass === "string" && it.pass.length === it.cellsX * it.cellsY) ? it.pass : null,
        });
        if (i % 64 === 0) { setStage(`реестр объектов… ${i}/${registry.length}`); await frame(); }
    }

    // ===== ГЕНЕРАЦИЯ МИРА (те же функции, что у кнопки «🌍 Сгенерировать мир») =====
    setStage(`генерация мира ${W}×${H}, сид ${SEED}…`);
    await frame();
    const worldData = dual.generateWorld({ w: W, h: H, seed: SEED });
    const gen = dual.generateWorldObjects({
        w: W, h: H, seed: SEED,
        masks: worldData.masks,
        climate: worldData.climate,
        noManMade: true, // дикая природа: без деревень и рукотворного амбиента
        items: registry.map((it, i) => ({
            name: objItems[i].name, group: it.group || "deco", weight: it.weight ?? 1,
            cellsX: it.cellsX, cellsY: it.cellsY, pass: objItems[i].pass || undefined,
        })),
    });

    // ===== Пол: запекание слоёв редактора в ОДИН слой ещё при загрузке =====
    // Четыре слоя нужны только редактору (для рисования). Тайлы dualgrid
    // непрозрачны (фон запечён в каждый тайл), поэтому для каждого угла двойной
    // сетки достаточно ВЕРХНЕГО непустого тайла (песок → снег → вода → база):
    // всё, что под ним, не видно никому и отбрасывается — остаётся одна текстура
    // на угол. В кадре её показывает modules/tilemap.js (только видимые углы).
    setStage("запекание слоя пола…");
    await frame();
    const LAYERS_FROM_TOP = [ // порядок отрисовки редактора, верхний первым
        ["sand_dirt.png", true], ["snow_dirt.png", true],
        ["grass_water.png", true], ["grass_dirt.png", false],
    ];
    const atlas = {};  // тайлсет → { textures: [16], ts }
    const maskMap = {}; // тайлсет → карта-маска для tileIndex
    for (const [name] of LAYERS_FROM_TOP) {
        atlas[name] = dual.sliceTileset(tileTex[name]);
        maskMap[name] = { w: W, h: H, data: worldData.masks[name] };
    }
    // «Чисто фоновый» тайл — тот, у которого все 4 угла ячеек = 0 (в базовой
    // раскладке это 12, не 0!). У наслагаемых слоёв он не рисуется, как и в редакторе.
    const BG_TILE = dual.TILE_CORNERS.findIndex(([tl, tr, bl, br]) => !tl && !tr && !bl && !br);
    const cornerTex = new Array((W + 1) * (H + 1)); // текстура угла (i, j)
    for (let j = 0; j <= H; j++) {
        if (j % 64 === 0) { setStage(`запекание слоя пола… ${j}/${H + 1}`); await frame(); }
        for (let i = 0; i <= W; i++) {
            let tex = null;
            for (const [name, hideBg] of LAYERS_FROM_TOP) {
                const t = dual.tileIndex(maskMap[name], i, j);
                if (!hideBg || t !== BG_TILE) { tex = atlas[name].textures[t]; break; }
            }
            cornerTex[j * (W + 1) + i] = tex;
        }
    }
    const tilesHolder = new PIXI.Container(); // тайлы — ниже объектов
    worldContainer.addChild(tilesHolder);

    // ===== Объекты: ECS-сущности; спрайты — по «рядам ног» для y-сортировки =====
    // Один sortableChildren-контейнер с 23 тысячами спрайтов пересортировывался
    // бы целиком каждый кадр (герой меняет zIndex). Ряды-полосы высотой TS:
    // между рядами порядок задают сами контейнеры, сортировка по Y — только
    // внутри ряда; ряд статичен и не тасуется, пока в него не войдёт герой.
    setStage(`расстановка объектов (${gen.placements.length})…`);
    await frame();
    const objHolder = dual.buildObjects({ items: objItems, ts: TS, w: W, h: H });
    dual.syncObjects(objHolder, gen.placements);
    worldContainer.addChild(objHolder);
    const objSprites = objHolder.removeChildren(); // уже с anchor/zIndex/позицией
    objHolder.sortableChildren = false; // порядок теперь держат ряды
    const rows = [];
    for (let r = 0; r <= H; r++) {
        const row = new PIXI.Container();
        row.sortableChildren = true;
        objHolder.addChild(row);
        rows.push(row);
    }
    setStage(`ECS-сущности объектов (0/${objSprites.length})…`);
    await frame();
    for (let n = 0; n < objSprites.length; n++) {
        const sp = objSprites[n];
        rows[Math.min(H, Math.round(sp.y / TS))].addChild(sp); // y спрайта = точка ног
        const id = ECS.addEntity(world);
        ECS.addComponent(world, id, "positionX", sp.x);
        ECS.addComponent(world, id, "positionY", sp.y);
        ECS.addComponent(world, id, "spriteMap", sp); // → renderable: позиция и culling ядра
        // Крона выше точки «ног»: ядро кульит по габариту — деревья выплывают
        // из-за края экрана постепенно, а не возникают целиком
        ECS.addComponent(world, id, "cullPad", Math.max(sp.texture.height, sp.texture.width / 2));
        if (n % 8192 === 0) { setStage(`ECS-сущности объектов (${n}/${objSprites.length})…`); await frame(); }
    }

    // ===== Коллизии: вода + непроходимые клетки объектов + границы карты =====
    const solid = dual.buildCollisionMap({
        w: W, h: H, items: objHolder.objectsMeta.items, placements: gen.placements, ts: TS,
    });
    const waterMask = worldData.masks["grass_water.png"];
    function blocked(px, py) {
        const gx = Math.floor(px / TS), gy = Math.floor(py / TS);
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) return true; // за краем карты — стены
        const k = gy * W + gx;
        return waterMask[k] === 1 || solid.blocked[k] === 1;
    }

    // Спавн: ближайшее к центру кольцо карт, где вся зона 3×3 клеток свободна
    function findSpawn() {
        const cx = W >> 1, cy = H >> 1;
        for (let r = 0; r < Math.max(W, H); r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // перебор кольцом
                    const x = cx + dx, y = cy + dy;
                    let ok = true;
                    for (let oy = -1; oy <= 1 && ok; oy++) {
                        for (let ox = -1; ox <= 1 && ok; ox++) {
                            if (blocked((x + ox) * TS + TS / 2, (y + oy) * TS + TS / 2)) ok = false;
                        }
                    }
                    if (ok) return { x: (x + 0.5) * TS, y: (y + 1) * TS };
                }
            }
        }
        return { x: (cx + 0.5) * TS, y: (cy + 0.5) * TS };
    }
    setStage("спавн персонажа…");
    await frame();
    const spawn = findSpawn();

    // ===== Оборотень: лист 5×11 кадров 128×128 + манифест строк =====
    setStage("загрузка персонажа…");
    await frame();
    const sheetTex = FILE_MODE
        ? await textureFromDataURL(EMBED.wolf.png)
        : await PIXI.Assets.load("./images/sprites/wolf_128.png");
    sheetTex.source.scaleMode = "nearest";
    const manifest = FILE_MODE
        ? EMBED.wolf.manifest
        : await (await fetch("./images/sprites/wolf_128.json")).json();
    const FR = manifest.size;
    const anims = {};
    for (const a of manifest.animations) {
        const frames = [];
        for (let c = 0; c < a.frames; c++) {
            frames.push(new PIXI.Texture({
                source: sheetTex.source,
                frame: new PIXI.Rectangle(c * FR, a.row * FR, FR, FR),
            }));
        }
        anims[a.name] = frames;
    }
    const wolfSprite = new PIXI.AnimatedSprite(anims.wait, false);
    wolfSprite.anchor.set(0.5, 1); // позиция сущности = точка ног

    // ===== Персонаж — ECS-сущность, контроллер — система (modules/character.js) ==
    // Спрайт ставит на место renderSystem ядра, кадры крутит animationSystem,
    // системе персонажей принадлежит только движение с коллизиями и выбор анимаций.
    const charInput = createCharacterInput(); // WASD/стрелки + джойстик
    const characters = createCharacterSystem({ world, ECS, COMPONENTS, DATA, blocked, input: charInput });
    const wolfId = characters.spawn({
        x: spawn.x, y: spawn.y, sprite: wolfSprite, anims,
        speed: 150, fps: manifest.fps, // коллизия «ног» — по умолчанию 14×10
    });
    ECS.addComponent(world, wolfId, "cullPad", FR); // герой выше «ног» на весь кадр (128px)
    // Герой ходит по «рядам ног» объектов: между рядами порядок задают
    // контейнеры, внутри ряда героя каждый кадр пересортировывает его zIndex
    // (ставит система персонажей). Ряды героя — единственное, что тасуется.
    let wolfRow = -1;
    function wolfRowFollow() {
        const r = Math.max(0, Math.min(H, Math.floor(COMPONENTS.positionY[wolfId] / TS)));
        if (r === wolfRow) return;
        if (wolfRow >= 0) wolfSprite.removeFromParent();
        rows[r].addChild(wolfSprite);
        wolfRow = r;
    }
    wolfRowFollow(); // сразу в правильный ряд — к первому кадру
    addSystem(wolfRowFollow);

    // ===== Модули: ввод, камера-слежение, отладка =====
    const input = createInput(); // endFrame зовёт сцена В КОНЦЕ кадра (см. ниже)
    const camera = createCamera({ app, container: worldContainer, addSystem });
    // Средняя кнопка мыши — вернуть изначальный зум (preventDefault гасит autoscroll)
    const INITIAL_ZOOM = 2;
    app.canvas.addEventListener("mousedown", (e) => {
        if (e.button === 1) { e.preventDefault(); camera.setZoom(INITIAL_ZOOM); }
    });
    // Камера следит за КОМПОНЕНТАМИ сущности (живой взгляд на positionX/Y)
    const wolfPos = {
        get x() { return COMPONENTS.positionX[wolfId]; },
        get y() { return COMPONENTS.positionY[wolfId]; },
    };
    camera.follow(wolfPos, 8);
    camera.setBounds({ x: 0, y: 0, width: W * TS, height: H * TS });
    camera.setZoom(INITIAL_ZOOM);
    camera.centerOn(spawn.x, spawn.y);
    // Пол — потоковая ECS-система тайлов: создаётся ПОСЛЕ камеры, чтобы её тик
    // шёл сразу за тиком камеры (окно по свежему виду, без лага в кадр)
    const tiles = createTilemapSystem({
        world, ECS, DATA, addSystem,
        container: tilesHolder, Sprite: PIXI.Sprite,
        getView() { // тот же вид, по которому ядро делает culling (renderSystem)
            const s = worldContainer.scale.x || 1;
            const halfW = app.screen.width / (2 * s), halfH = app.screen.height / (2 * s);
            return { left: worldContainer.pivot.x - halfW, top: worldContainer.pivot.y - halfH,
                     right: worldContainer.pivot.x + halfW, bottom: worldContainer.pivot.y + halfH };
        },
        mapW: W, mapH: H, ts: TS, margin: 2,
        tileAt: (i, j) => cornerTex[j * (W + 1) + i],
    });
    const debug = createDebug({
        app, addSystem, world, grid: SpatialHashGrid, components: COMPONENTS,
        layer: worldContainer, overlayPos: { x: 16, y: 32 },
    });

    // ===== Сцены: game / pause =====
    const scenes = createScenes({ addSystem });
    scenes.add("game", {
        enter() {
            hud.removeText("pauseLabel");
            debug.info["Сцена"] = "game";
        },
        update(ticker) {
            characters.update(ticker); // ввод → коллизии/скольжение → анимация (по компонентам)
            // Пробел — одиночная атака в сторону взгляда (демо play()/анимаций атаки)
            if (input.wasPressed("Space")) characters.playAttack(wolfId);
            // Колесо — зум (вверх — ближе); отдаление ограничено окном тайлов
            if (input.pointer.wheel !== 0) {
                camera.zoomBy(1 - input.pointer.wheel * 0.1);
                camera.setZoom(Math.min(4, Math.max(0.5, camera.cam.zoom)));
            }
            if (input.wasPressed("KeyP")) scenes.go("pause");
            // Оверлей отладки: параметры мира и живое состояние сущности из компонентов
            debug.info["Сид"] = SEED;
            debug.info["Карта"] = `${W}×${H}, объектов ${gen.placements.length}, POI ${gen.pois.length}`;
            debug.info["Позиция"] = `${COMPONENTS.positionX[wolfId] | 0}, ${COMPONENTS.positionY[wolfId] | 0}`;
            debug.info["Анимация"] = DATA.ctrlAnim[wolfId];
            debug.info["Взгляд"] = characters.facingName(wolfId);
            debug.info["Тайлов на экране"] = tiles.stats().tiles;
            debug.info["Сущностей ECS"] = world.entities.length;
            input.endFrame(); // сброс однокадровых флагов В КОНЦЕ кадра
        },
    });
    scenes.add("pause", {
        enter() {
            hud.text("pauseLabel", "ПАУЗА", {
                x: app.screen.width / 2 - 50, y: app.screen.height / 2 - 20,
                size: 32, color: "#ffee66",
            });
            debug.info["Сцена"] = "pause";
        },
        update() {
            if (input.wasPressed("KeyP")) scenes.go("game");
            input.endFrame();
        },
    });
    scenes.go("game");
    hud.removeText("status");

    console.log(`[game] мир ${W}×${H} сид ${SEED}: объектов ${gen.placements.length}, POI ${gen.pois.length}; ` +
        `персонаж (сущность ${wolfId}) в (${spawn.x | 0}, ${spawn.y | 0}); рендерер ${app.renderer.name}`);

    // ===== Хендл для автотестов из консоли браузера =====
    window.__TEST = {
        wolfId, characters, camera, input, scenes, blocked, tiles, tilesHolder, bake: cornerTex,
        components: COMPONENTS, data: DATA,
        world: () => ({ w: W, h: H, seed: SEED, objects: gen.placements.length, pois: gen.pois.length }),
        info: () => ({
            x: COMPONENTS.positionX[wolfId], y: COMPONENTS.positionY[wolfId],
            anim: DATA.ctrlAnim[wolfId], facing: characters.facingName(wolfId),
            moving: !!COMPONENTS.ctrlMove[wolfId],
        }),
        keyDown: (code) => window.dispatchEvent(new KeyboardEvent("keydown", { code })),
        keyUp: (code) => window.dispatchEvent(new KeyboardEvent("keyup", { code })),
        renderer: () => app.renderer.name,
    };
})();
