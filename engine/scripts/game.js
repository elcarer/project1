// ИГРОВАЯ ЛОГИКА — открытый мир (dualgrid) + контроллер персонажа.
// При старте генерируется карта «открытого мира» теми же функциями, что и в
// редакторе (dual.generateWorld + dual.generateWorldObjects); четыре слоя пола
// запекаются в один при загрузке (перекрытые тайлы отбрасываются), и этот слой
// показывает только видимые тайлы потоковая ECS-система modules/tilemap.js.
// Все объекты мира и герой — сущности ECS (позиция/спрайт → culling ядра);
// спрайты объектов разложены по «рядам ног» для дешёвой y-сортировки.
// Оборотень (wolf_64, стандартный набор 11 анимаций) управляется
// modules/character.js: стрелки/WASD/джойстик, диагональ играет анимацию
// последнего нажатого направления, скольжение вдоль непроходимых клеток.
// Рядом строем стоят NPC — персонажи из forWork, склеенные в листы формата
// волка скриптом scripts/pack_characters.py; ввод у всех общий, пробел
// атакует всеми (тестовая витрина анимаций).
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

    // На file:// картинка с диска — чужой origin: WebGL не грузит её в GPU,
    // а fetch/XHR до файла запрещены. Вшитые копии — только для этого режима.
    const FILE_MODE = location.protocol === "file:";
    const EMBED = globalThis.EMBEDDED_GAME_ASSETS;
    if (FILE_MODE && !EMBED) throw new Error("file://: не подключён scripts/embedded_assets.js");

    // ===== Ассеты: менеджер с кэшем (модуль assets) =============================
    // Вся загрузка текстур и нарезка листов — через него; путь к листам
    // персонажей по http, вшитые копии EMBED — для file://
    const assets = createAssets();
    const SPRITES_DIR = "./images/sprites/";

    // ===== Текстуры тайлсетов =====
    setStage("загрузка тайлсетов…");
    await frame();
    const TILESETS = ["grass_dirt.png", "grass_water.png", "snow_dirt.png", "sand_dirt.png"];
    const tileTex = {};
    for (const name of TILESETS) {
        tileTex[name] = FILE_MODE
            ? await assets.textureFromDataURL(EMBED.tiles[name])
            : await assets.loadTexture(`./images/tiles/${name}`);
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
        const tex = await assets.textureFromDataURL(it.png); // data-URL WebP — при любом origin
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

    // ===== Оборотень: лист 5×11 кадров 64×64 + манифест строк =====
    setStage("загрузка персонажа…");
    await frame();
    const wolf = FILE_MODE
        ? await assets.loadCharacter("wolf_64", EMBED.wolf)
        : await assets.loadCharacter(`${SPRITES_DIR}wolf_64`);
    const wolfSprite = new PIXI.AnimatedSprite(wolf.animations.wait, false);
    wolfSprite.anchor.set(0.5, 1); // позиция сущности = точка ног

    // ===== Персонаж — ECS-сущность, контроллер — система (modules/character.js) ==
    // Спрайт ставит на место renderSystem ядра, кадры крутит animationSystem,
    // системе персонажей принадлежит только движение с коллизиями и выбор анимаций.
    const charInput = createCharacterInput(); // WASD/стрелки + джойстик
    const characters = createCharacterSystem({ world, ECS, COMPONENTS, DATA, blocked, input: charInput });
    const wolfId = characters.spawn({
        x: spawn.x, y: spawn.y, sprite: wolfSprite, anims: wolf.animations,
        speed: 150, fps: wolf.fps,
        halfW: 3.5, halfH: 2.5, // «ноги» — вдвое уже тайла (спрайт 64px)
    });
    ECS.addComponent(world, wolfId, "cullPad", wolf.size); // герой выше «ног» на весь кадр (64px)
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

    // ===== NPC тестовой карты: персонажи scripts/pack_characters.py ============
    // Сырые полосы forWork склеены в листы 5×11 формата волка (стандартный набор
    // 11 анимаций). Каждый NPC — полноценная сущность контроллера персонажей;
    // ввод общий, поэтому строй ходит и атакует вместе с героем — за один проход
    // видно все анимации всех персонажей.
    setStage("загрузка NPC…");
    await frame();
    const NPC_SHEETS = [
        "bat_64", "cyclop_128", "dark_64", "demon_128", "dwarf_64",
        "goba_64", "hound_64", "imp_64", "lider_64", "medusa_128",
        "mummy_64", "octopus_64", "ogr_64", "orc_64", "rat_64",
        "shaman_64", "spider_64", "spiderboss_64", "spiderman_64", "spiderRed_64",
        "spike_64", "succubus_64", "vampire_64",
        "knight_64", "rogue_64", "sorca_64", "valca_64",
    ];
    // Свободная точка ног возле (x, y): спот может попасть в воду/объект
    function freeSpotNear(x, y) {
        if (!blocked(x, y)) return { x, y };
        for (let r = 1; r <= 10; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    if (!blocked(x + dx * TS, y + dy * TS)) return { x: x + dx * TS, y: y + dy * TS };
                }
            }
        }
        return { x, y }; // всё вокруг занято — ставим как есть (утонет, но не сломает игру)
    }
    const npcs = []; // { name, id, size } — хендл для сцены и __TEST
    const npcRowTrack = []; // { sprite, id } — переселение между рядами ног
    for (let i = 0; i < NPC_SHEETS.length; i++) {
        const base = NPC_SHEETS[i];
        setStage(`загрузка NPC… ${i + 1}/${NPC_SHEETS.length}`);
        if (i % 8 === 0) await frame();
        const ch = FILE_MODE
            ? await assets.loadCharacter(base, EMBED.chars[base])
            : await assets.loadCharacter(`${SPRITES_DIR}${base}`);
        const npcSprite = new PIXI.AnimatedSprite(ch.animations.wait, false);
        npcSprite.anchor.set(0.5, 1); // позиция сущности = точка ног
        const COLS = 9, GAP = TS * 3; // строй: 9 в ряду, шаг 3 тайла
        const spot = freeSpotNear(
            spawn.x + ((i % COLS) - (COLS - 1) / 2) * GAP,
            spawn.y + TS * 5 + Math.floor(i / COLS) * GAP);
        const id = characters.spawn({
            x: spot.x, y: spot.y, sprite: npcSprite, anims: ch.animations,
            speed: 120, fps: ch.fps,
            halfW: ch.size / 64 * 3.5, halfH: ch.size / 64 * 2.5, // коробка «ног» волка, масштабированная кадром
        });
        ECS.addComponent(world, id, "cullPad", ch.size); // NPC выше «ног» на весь кадр
        npcRowTrack.push({ sprite: npcSprite, id });
        npcs.push({ name: base, id, size: ch.size });
    }
    // Ряды ног NPC — как у героя: контейнеры рядов держат порядок между рядами
    const npcRowCache = npcRowTrack.map(() => -1);
    function npcRowFollow() {
        npcRowTrack.forEach(({ sprite, id }, k) => {
            const r = Math.max(0, Math.min(H, Math.floor(COMPONENTS.positionY[id] / TS)));
            if (r === npcRowCache[k]) return;
            if (npcRowCache[k] >= 0) sprite.removeFromParent();
            rows[r].addChild(sprite);
            npcRowCache[k] = r;
        });
    }
    npcRowFollow(); // сразу в правильные ряды — к первому кадру
    addSystem(npcRowFollow);

    // ===== Модули: ввод, камера-слежение, отладка =====
    const input = createInput(); // endFrame зовёт сцена В КОНЦЕ кадра (см. ниже)
    const camera = createCamera({ app, container: worldContainer, addSystem });
    // Средняя кнопка мыши — вернуть изначальный зум (preventDefault гасит autoscroll)
    const INITIAL_ZOOM = 2.5;
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
            // Пробел — одиночная атака в сторону взгляда (демо play()/анимаций
            // атаки): герой и весь строй NPC
            if (input.wasPressed("Space")) {
                characters.playAttack(wolfId);
                for (const n of npcs) characters.playAttack(n.id);
            }
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
        `персонаж (сущность ${wolfId}) в (${spawn.x | 0}, ${spawn.y | 0}) + NPC ${npcs.length}; рендерер ${app.renderer.name}`);

    // ===== Хендл для автотестов из консоли браузера =====
    // Превью строки анимаций NPC: wait/walk_* крутятся в цикле, остальное
    // однократно; npcRelease возвращает персонажа под управление системы.
    function npcPreview(id, name) {
        const frames = DATA.ctrlAnims[id] && DATA.ctrlAnims[id][name];
        if (!frames) return false;
        const sprite = DATA.spriteMap[id];
        DATA.ctrlAnim[id] = name;
        COMPONENTS.ctrlLock[id] = 1; // авто-выбор анимации приостановлен
        sprite.textures = frames;
        sprite.loop = name === "wait" || name.startsWith("walk_");
        sprite.gotoAndPlay(0);
        return true;
    }
    function npcRelease(id) {
        COMPONENTS.ctrlLock[id] = 0;
        DATA.ctrlAnim[id] = ""; // система сама вернёт walk/wait
    }
    window.__TEST = {
        wolfId, characters, camera, input, scenes, blocked, tiles, tilesHolder, bake: cornerTex,
        components: COMPONENTS, data: DATA, npcs, npcPreview, npcRelease,
        world: () => ({ w: W, h: H, seed: SEED, objects: gen.placements.length, pois: gen.pois.length }),
        info: (id = wolfId) => ({
            x: COMPONENTS.positionX[id], y: COMPONENTS.positionY[id],
            anim: DATA.ctrlAnim[id], facing: characters.facingName(id),
            moving: !!COMPONENTS.ctrlMove[id],
        }),
        keyDown: (code) => window.dispatchEvent(new KeyboardEvent("keydown", { code })),
        keyUp: (code) => window.dispatchEvent(new KeyboardEvent("keyup", { code })),
        renderer: () => app.renderer.name,
    };
})();
