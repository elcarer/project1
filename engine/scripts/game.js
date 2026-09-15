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
// По карте расселены ИИ-враги (деревни гоблинов/дворфов/орков с элитками,
// пауки и крысы в лесах, октопусы в воде) — modules/ai.js. Бой автоматический:
// герой и враги атакуют, когда противник в зоне достижимости оружия; попадания
// снарядов разрешает modules/combat.js (уклон/крит/блок, ХП, смерть, опыт,
// уровни, полоски ХП и всплывающие цифры урона через modules/fx.js).
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
    // Диагностика падений загрузки: страница классическая (без консоли по
    // двойному клику) — последняя ошибка доступна в window.__bootError
    window.addEventListener("unhandledrejection", (e) => {
        window.__bootError = String((e.reason && e.reason.stack) || e.reason);
    });
    window.addEventListener("error", (e) => {
        window.__bootError = `${e.message} @ ${e.filename}:${e.lineno}`;
    });
    const engine = await init();
    // Игровой шрифт всех надписей — загрузить ДО первых PIXI.Text (hud/fx/debug)
    await loadGameFont();
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

    // ===== HUD: подсказка (статус загрузки — на экране загрузки ниже) =========
    const hud = createHUD({ app, addSystem }); // addSystem — автообновление bar()-ов
    const hintLabel = hud.text("hint", "WASD/стрелки/джойстик — движение | атака автоматическая | колесо — зум | P — пауза", {
        x: 16, y: 12, size: 24, color: "#88ffcc",
    });
    hintLabel.visible = false; // в стартовом меню подсказка не нужна
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

    // ===== Экран загрузки + фабрика спрайт-полос (images/ui) ====================
    // Спрайты интерфейса (images/ui): по http живые файлы, на file:// вшитые
    // EMBED.ui. Прогресс загрузки мира тикает через setStage(метка, доля).
    const uiTex = {};
    for (const [key, base] of [
        ["bar", "bigBar"], ["line", "loadBarLine"],
        ["hpLine", "hpBarLine"], ["xpFrame", "smallBar"],
        ["startBg", "start"], ["btn", "button"],
    ]) {
        uiTex[key] = FILE_MODE
            ? await assets.textureFromDataURL(EMBED.ui[base])
            : await assets.loadTexture(`./images/ui/${base}.png`);
    }
    // Спрайт-полоска: рамка + линия-заливка, set(доля) зовёт сцена/загрузка.
    // Линия — NineSliceSprite: ширина = доля, середина растягивается, скруглённые
    // торцы не искажаются. (Маски и мутация frame UV-ов в v8 ненадёжны — проверено)
    const makeSpriteBar = (frameTex, lineTex, linePos, lineSize) => {
        const root = new PIXI.Container();
        const frame = new PIXI.Sprite(frameTex);
        const NS = PIXI.NineSliceSprite;
        const line = NS
            ? new NS({ texture: lineTex, left: 14, right: 14, top: 10, bottom: 10, height: lineTex.height })
            : new PIXI.Sprite(lineTex); // запасной путь: растяжение всей линии
        line.position.set(linePos[0], linePos[1]);
        line.scale.y = lineSize[1] / lineTex.height; // линия вписана в окно рамки
        root.addChild(frame, line);
        let ratio = 1;
        const draw = () => { line.width = Math.max(1, lineSize[0] * ratio); };
        draw();
        return { root, set(r) { ratio = Math.max(0, Math.min(1, r)); draw(); } };
    };
    // Экран загрузки: та же рамка bigBar + золотая линия по центру экрана
    const loader = makeSpriteBar(uiTex.bar, uiTex.line, [46, 20], [315, 24]);
    const barLabel = new PIXI.Text({
        text: "загрузка…",
        style: { fontFamily: GAME_FONT, fontSize: 24, fill: "#e8d5a0" },
    });
    barLabel.anchor.set(0.5, 0); // метка по центру под рамкой
    barLabel.position.set(407 / 2, 64 + 14);
    loader.root.addChild(barLabel);
    loader.root.position.set(
        Math.round((app.screen.width - 407) / 2),
        Math.round(app.screen.height / 2 - 32),
    );
    app.stage.addChild(loader.root);
    let loadRatio = 0;
    const setStage = (s, r) => {
        if (typeof r === "number") loadRatio = r;
        barLabel.text = s;
        loader.set(loadRatio);
    };

    // ===== Стартовое меню: фон start.png + кнопки button.png ====================
    // Показывается после загрузки мира (сцена "menu"); «Продолжить»/«Новая
    // игра» открывают мир, «Настройки» — панель с полноэкранным режимом,
    // «Выход» закрывает вкладку (иначе — экран завершения).
    app.stage.eventMode = "static"; // кнопкам меню нужны pointer-события
    const menuUi = new PIXI.Container();
    menuUi.visible = false; // откроется в сцене "menu" после загрузки мира
    app.stage.addChild(menuUi);
    const startBg = new PIXI.Sprite(uiTex.startBg);
    menuUi.addChild(startBg);
    const menuButtons = []; // контейнеры кнопок — для раскладки при resize
    const makeMenuButton = (label, onTap, width = 280, column = true) => {
        const btn = new PIXI.Container();
        const bg = new PIXI.NineSliceSprite({
            texture: uiTex.btn, left: 14, right: 14, top: 14, bottom: 14, width, height: 60,
        });
        const txt = new PIXI.Text({
            text: label,
            style: { fontFamily: GAME_FONT, fontSize: 26, fill: "#f0e6c8" },
        });
        txt.anchor.set(0.5);
        txt.position.set(width / 2, 30);
        bg.eventMode = "static";
        bg.cursor = "pointer";
        bg.on("pointerenter", () => { bg.tint = 0xffd98e; });
        bg.on("pointerleave", () => { bg.tint = 0xffffff; });
        bg.on("pointertap", onTap);
        btn.addChild(bg, txt);
        btn.labelText = txt;
        if (column) menuButtons.push(btn); // кнопки панели настроек не в раскладке
        return btn;
    };
    // Раскладка: фон «cover» на весь экран, колонка кнопок слева (там лес,
    // не заслоняя героев арта); вызывается при построении и при resize
    const placeMenu = () => {
        const s = Math.max(app.screen.width / startBg.texture.width,
            app.screen.height / startBg.texture.height);
        startBg.scale.set(s);
        startBg.position.set(
            (app.screen.width - startBg.texture.width * s) / 2,
            (app.screen.height - startBg.texture.height * s) / 2,
        );
        const bx = Math.max(24, Math.round(app.screen.width * 0.08));
        let by = Math.round(app.screen.height * 0.38);
        for (const btn of menuButtons) {
            btn.position.set(bx, by);
            by += 74;
        }
        if (menuUi.quitOverlay) {
            menuUi.quitOverlay.children[0].width = app.screen.width;
            menuUi.quitOverlay.children[0].height = app.screen.height;
            menuUi.quitOverlay.children[1].position.set(app.screen.width / 2, app.screen.height / 2);
        }
        if (menuUi.settings) {
            menuUi.settings.children[0].position.set(
                (app.screen.width - 400) / 2, (app.screen.height - 230) / 2);
        }
    };
    // Панель настроек: полноэкранный режим + назад
    let settingsOpen = false;
    const settingsPanel = new PIXI.Container();
    const settingsBg = new PIXI.Graphics()
        .roundRect(0, 0, 400, 230, 10).fill(0x140f08).stroke({ width: 3, color: 0x6b4a2f });
    settingsPanel.addChild(settingsBg);
    settingsPanel.visible = false;
    const toggleFullscreen = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
    };
    const menuOff = () => { menuUi.visible = false; settingsPanel.visible = false; settingsOpen = false; };
    const openSettings = () => { settingsOpen = true; settingsPanel.visible = true; };
    const closeSettings = () => { settingsOpen = false; settingsPanel.visible = false; };
    const newGame = () => {
        // новый мир: та же карта по размеру, случайный сид
        location.href = location.pathname + "?w=" + W + "&h=" + H +
            "&seed=" + Math.floor(Math.random() * 2147483647);
    };
    const quitGame = () => {
        window.close();
        // если вкладку закрыть не дали — экран завершения поверх всего
        if (!window.closed) {
            menuUi.visible = false;
            if (!menuUi.quitOverlay) {
                const q = new PIXI.Container();
                const bg = new PIXI.Graphics().rect(0, 0, app.screen.width, app.screen.height).fill(0x000000);
                const label = new PIXI.Text({
                    text: "Игра завершена.\nОбновите страницу, чтобы сыграть снова.",
                    style: { fontFamily: GAME_FONT, fontSize: 28, fill: "#cfc4a6", align: "center", lineHeight: 40 },
                });
                label.anchor.set(0.5);
                q.addChild(bg, label);
                menuUi.quitOverlay = q;
                menuUi.addChild(q);
                placeMenu();
            }
            menuUi.quitOverlay.visible = true;
        }
    };
    // Кнопки меню (в колонку слева) и панели настроек (внутри, не в раскладку)
    menuUi.addChild(
        makeMenuButton("Продолжить", () => { menuOff(); scenes.go("game"); }),
        makeMenuButton("Новая игра", newGame),
        makeMenuButton("Настройки", openSettings),
        makeMenuButton("Выход", quitGame),
    );
    const fsButton = makeMenuButton("Полный экран: вкл", () => { toggleFullscreen(); syncFsLabel(); }, 280, false);
    const syncFsLabel = () => { fsButton.labelText.text = document.fullscreenElement ? "Полный экран: выкл" : "Полный экран: вкл"; };
    document.addEventListener("fullscreenchange", syncFsLabel);
    fsButton.position.set(10, 35);
    const backButton = makeMenuButton("Назад", closeSettings, 280, false);
    backButton.position.set(10, 135);
    settingsPanel.addChild(fsButton, backButton);
    menuUi.addChild(settingsPanel);
    placeMenu();
    app.renderer.on("resize", placeMenu);

    // ===== Текстуры тайлсетов =====
    setStage("загрузка тайлсетов…", 0.02);
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
    setStage("загрузка реестра объектов…", 0.05);
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
        if (i % 64 === 0) { setStage(`реестр объектов… ${i}/${registry.length}`, 0.05 + (i / registry.length) * 0.08); await frame(); }
    }

    // ===== ГЕНЕРАЦИЯ МИРА (те же функции, что у кнопки «🌍 Сгенерировать мир») =====
    setStage(`генерация мира ${W}×${H}, сид ${SEED}…`, 0.15);
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
    setStage("запекание слоя пола…", 0.20);
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
        if (j % 64 === 0) { setStage(`запекание слоя пола… ${j}/${H + 1}`, 0.20 + (j / (H + 1)) * 0.38); await frame(); }
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
    setStage(`расстановка объектов (${gen.placements.length})…`, 0.60);
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
    setStage(`ECS-сущности объектов (0/${objSprites.length})…`, 0.62);
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
        if (n % 8192 === 0) { setStage(`ECS-сущности объектов (${n}/${objSprites.length})…`, 0.62 + (n / objSprites.length) * 0.10); await frame(); }
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
    setStage("спавн персонажа…", 0.74);
    await frame();
    const spawn = findSpawn();

    // ===== Оборотень: лист 5×11 кадров 64×64 + манифест строк =====
    setStage("загрузка персонажа…", 0.76);
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
    // Пловцы (ctrlSwim): вода проходима, суша/объекты — стены
    const blockedSwim = (px, py) => {
        const gx = Math.floor(px / TS), gy = Math.floor(py / TS);
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) return true;
        return waterMask[gy * W + gx] !== 1;
    };
    const characters = createCharacterSystem({ world, ECS, COMPONENTS, DATA, blocked, blockedAlt: blockedSwim, input: charInput });
    // Снаряды: типы из data/attacks.js (грузятся ниже, перед боевой сценой);
    // привязка персонажей к атакам — сразу после спавна каждого. При выпуске
    // снаряд получает снимок боевых данных владельца (фракция, бросок урона) —
    // combat создаётся ниже, поэтому колбэки ссылается на него через let.
    let combat = null;
    const projectiles = createProjectiles({
        world, ECS, COMPONENTS, DATA, addSystem, assets, rows, TS,
        getFaction: (id) => (combat ? combat.factionOf(id) : -1),
        getAttack: (id) => (combat ? combat.rollAttack(id) : null),
        getAim: (id) => characters.getAim(id), // прицел атаки (modules/character.js)
    });
    await projectiles.load(Object.keys(ATTACK_CONFIGS), {
        fileMode: FILE_MODE, embed: EMBED.proj,
    });
    // Эффекты (всплывающие цифры урона) — слой над объектами мира; боевая
    // система превращает попадания снарядов в урон, смерть, опыт и уровни
    const fxLayer = new PIXI.Container();
    worldContainer.addChild(fxLayer); // добавлен последним — рисуется поверх
    const fx = createFX({ app, layer: fxLayer, addSystem });
    combat = createCombat({
        world, ECS, COMPONENTS, DATA, addSystem, characters, projectiles, fx,
        onRemove(id) { // мёртвый враг уходит из рядов ног и хендлов сцены
            const k = creatureRowTrack.findIndex((e) => e.id === id);
            if (k !== -1) { creatureRowTrack.splice(k, 1); creatureRowCache.splice(k, 1); }
            const e = enemies.findIndex((en) => en.id === id);
            if (e !== -1) enemies.splice(e, 1);
        },
    });
    const wolfId = characters.spawn({
        x: spawn.x, y: spawn.y, sprite: wolfSprite, anims: wolf.animations,
        speed: 150, fps: wolf.fps,
        halfW: 3.5, halfH: 2.5, // «ноги» — вдвое уже тайла (спрайт 64px)
    });
    ECS.addComponent(world, wolfId, "cullPad", wolf.size); // герой выше «ног» на весь кадр (64px)
    projectiles.bind(wolfId, "wolf");
    // Ролевые статы героя (формулы — data/stats.js, образец countDopStats.js)
    combat.init(wolfId, {
        faction: 0, hero: true, size: wolf.size,
        lvl: HERO_BASE.lvl, prim: HERO_BASE.prim, growth: HERO_BASE.growth,
        weaponMin: HERO_BASE.weaponMin,
    });
    // HUD героя (правый верхний угол, поверх мира): спрайт-полосы ХП (bigBar +
    // красная hpBarLine) и опыта (smallBar + золотая loadBarLine). Привязка к
    // ПРАВОМУ КРАЮ: позиции пересчитываются при resize — на весь экран полоски
    // остаются в углу. Текст над полосками убран (данные — в оверлее отладки).
    let hudCenterX = app.screen.width - 126;
    // ХП: рамка 407×64 (линия 315×24 на 46,20), сжата до 220px ширины
    const heroHpBar = makeSpriteBar(uiTex.bar, uiTex.hpLine, [46, 20], [315, 24]);
    heroHpBar.root.scale.set(220 / 407);
    // Опыт: узкая рамка 220×14 → 176px (scale 0.8), центр = центр ХП-полосы
    const heroXpBar = makeSpriteBar(uiTex.xpFrame, uiTex.line, [5, 3], [210, 8]);
    heroXpBar.root.scale.set(0.8);
    const placeHeroHud = () => {
        hudCenterX = app.screen.width - 126;
        heroHpBar.root.position.set(hudCenterX - 110, 12);
        heroXpBar.root.position.set(hudCenterX - 88, 51);
    };
    placeHeroHud();
    app.renderer.on("resize", placeHeroHud);
    hud.container.addChild(heroHpBar.root, heroXpBar.root);
    hud.container.addChild(heroHpBar.root, heroXpBar.root);
    hud.container.addChild(heroHpBar.root, heroXpBar.root);
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

    // ===== Ряды ног живых существ: герой ходит между контейнерами рядов; =====
    // тот же механизм переиспользуют враги (переселение раз в кадр)
    const creatureRowTrack = []; // { sprite, id }
    const creatureRowCache = [];
    function creatureRowFollow() {
        creatureRowTrack.forEach(({ sprite, id }, k) => {
            const r = Math.max(0, Math.min(H, Math.floor(COMPONENTS.positionY[id] / TS)));
            if (r === creatureRowCache[k]) return;
            if (creatureRowCache[k] >= 0) sprite.removeFromParent();
            rows[r].addChild(sprite);
            creatureRowCache[k] = r;
        });
    }
    addSystem(creatureRowFollow);

    // ===== Враги: деревни и дикие (modules/ai.js) ==============================
    // Гоблины (элитка — шаман), дворфы, орки (элитка — огр) живут деревнями;
    // в лесах водятся пауки и крысы (под кронами группы "trees"), в глубокой
    // воде плавают октопусы (ctrlSwim: вода проходима, суша — стена).
    // Поведение — FSM патруль → погоня → возврат (aggro-радиус, поводок).
    setStage("расселение врагов…", 0.80);
    await frame();
    const KIND_STATS = {
        goba:    { speed: 120, detect: 130, leash: 280, patrol: 110 },
        shaman:  { speed: 110, detect: 175, leash: 330, patrol: 110, elite: true },
        dwarf:   { speed: 105, detect: 130, leash: 280, patrol: 100 },
        orc:     { speed: 125, detect: 140, leash: 300, patrol: 110 },
        ogr:     { speed: 95,  detect: 180, leash: 340, patrol: 100, elite: true },
        spider:  { speed: 135, detect: 120, leash: 240, patrol: 90 },
        rat:     { speed: 140, detect: 110, leash: 220, patrol: 80 },
        octopus: { speed: 100, detect: 110, leash: 200, patrol: 80, swim: true },
    };
    // «Зона достижимости оружия» (reach из ATTACK_CONFIGS) — дистанция атаки ИИ.
    // Ближний бой подходит БЛИЖЕ (0.6·reach): эффект оружия бьёт перед взглядом,
    // на диагональной дистанции reach он не достаёт до цели
    const weaponAttackR = (kind) => {
        const cfg = ATTACK_CONFIGS[CHARACTER_ATTACKS[kind].attack];
        return cfg.kind === "melee" ? cfg.reach * 0.6 : cfg.reach;
    };
    const ai = createEnemyAI({
        world, ECS, COMPONENTS, DATA, addSystem, characters,
        blocked,
        blockedAlt: blockedSwim, // пловец: вода проходима, всё остальное — нет
        getPlayerPos: () => ({ x: COMPONENTS.positionX[wolfId], y: COMPONENTS.positionY[wolfId] }),
    });
    const enemies = []; // { name, id, size } — хендл для __TEST
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
    function spawnEnemy(kind, x, y) {
        const ch = enemyKinds[kind], st = KIND_STATS[kind];
        const sprite = new PIXI.AnimatedSprite(ch.animations.wait, false);
        sprite.anchor.set(0.5, 1); // позиция сущности = точка ног
        const id = characters.spawn({
            x, y, sprite, anims: ch.animations, speed: st.speed, fps: ch.fps,
            halfW: ch.size / 64 * 3.5, halfH: ch.size / 64 * 2.5,
        });
        ECS.addComponent(world, id, "cullPad", ch.size);
        if (st.swim) ECS.addComponent(world, id, "ctrlSwim", 1);
        ai.register(id, { detectR: st.detect, leashR: st.leash, patrolR: st.patrol, attackR: weaponAttackR(kind) });
        creatureRowTrack.push({ sprite, id });
        creatureRowCache.push(-1);
        projectiles.bind(id, kind);
        // Ролевые статы вида (data/stats.js) с лёгкой индивидуальной разброской
        const es = ENEMY_STATS[kind];
        const v = (base) => base + ((Math.random() * 2) | 0);
        combat.init(id, {
            faction: 1, size: ch.size, lvl: es.lvl,
            prim: {
                str: v(es.prim.str), agi: v(es.prim.agi), vit: v(es.prim.vit),
                spd: v(es.prim.spd), wis: v(es.prim.wis),
            },
            weaponMin: es.weaponMin, xpReward: es.xp,
        });
        enemies.push({ name: kind, id, size: ch.size });
    }
    // Листы врагов — один вид грузится один раз (кэш менеджера ассетов)
    const enemyKinds = {};
    const ENEMY_SHEETS = ["goba", "shaman", "dwarf", "orc", "ogr", "spider", "rat", "octopus"];
    for (let i = 0; i < ENEMY_SHEETS.length; i++) {
        const kind = ENEMY_SHEETS[i];
        setStage(`расселение врагов… (${kind})`, 0.80 + (i / ENEMY_SHEETS.length) * 0.15);
        if (i % 4 === 0) await frame();
        enemyKinds[kind] = FILE_MODE
            ? await assets.loadCharacter(`${kind}_64`, EMBED.chars[`${kind}_64`])
            : await assets.loadCharacter(`${SPRITES_DIR}${kind}_64`);
    }
    // ── Маска леса: клетки footprint'ов деревьев + кромка под кронами
    const forest = new Uint8Array(W * H);
    for (const [t, x, y] of gen.placements) {
        if (!registry[t] || registry[t].group !== "trees") continue;
        for (let fy = y; fy < Math.min(H, y + registry[t].cellsY); fy++) {
            for (let fx = x; fx < Math.min(W, x + registry[t].cellsX); fx++) {
                forest[fy * W + fx] = 1;
            }
        }
    }
    // Пулы точек: лес (проходимая клетка под кроной) и глубокая вода (3×3 воды)
    const forestSpots = [], waterSpots = [];
    for (let gy = 1; gy < H - 1; gy++) {
        for (let gx = 1; gx < W - 1; gx++) {
            const k = gy * W + gx;
            const px = (gx + 0.5) * TS, py = (gy + 1) * TS;
            if (forest[k] && !blocked(px, py)) forestSpots.push([px, py]);
            let inner = waterMask[k] === 1 && solid.blocked[k] !== 1;
            for (let oy = -1; oy <= 1 && inner; oy++) {
                for (let ox = -1; ox <= 1 && inner; ox++) {
                    if (waterMask[(gy + oy) * W + (gx + ox)] !== 1) inner = false;
                }
            }
            if (inner) waterSpots.push([px, py]);
        }
    }
    const shuffle = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };
    shuffle(forestSpots);
    shuffle(waterSpots);
    // ── Деревни: сайты подальше от спавна героя и друг от друга
    const spawnTileX = Math.floor(spawn.x / TS), spawnTileY = Math.floor(spawn.y / TS);
    const VILLAGE_RACES = [
        { race: "goba", elite: "shaman" }, // элитка — гоблин-шаман
        { race: "dwarf", elite: null },
        { race: "orc", elite: "ogr" },     // элитка — огр
    ];
    const RING = [[-2, -1], [2, -1], [-2, 1], [2, 1], [0, -2], [0, 2], [-3, 0], [3, 0]];
    const villageSites = [];
    for (let guard = 0; guard < 6000 && villageSites.length < 12; guard++) {
        const gx = 8 + ((Math.random() * (W - 16)) | 0);
        const gy = 8 + ((Math.random() * (H - 16)) | 0);
        if (Math.max(Math.abs(gx - spawnTileX), Math.abs(gy - spawnTileY)) < 20) continue;
        if (!villageSites.every((s) => Math.max(Math.abs(s[0] - gx), Math.abs(s[1] - gy)) >= 45)) continue;
        if (blocked((gx + 0.5) * TS, (gy + 1) * TS)) continue;
        villageSites.push([gx, gy]);
    }
    villageSites.forEach(([gx, gy], i) => {
        const { race, elite } = VILLAGE_RACES[i % VILLAGE_RACES.length];
        const cx = (gx + 0.5) * TS, cy = (gy + 1) * TS;
        if (elite) {
            const spot = freeSpotNear(cx, cy);
            spawnEnemy(elite, spot.x, spot.y); // элитка в центре деревни
        }
        const members = 4 + ((Math.random() * 3) | 0);
        for (let m = 0; m < members; m++) {
            const [ox, oy] = RING[m % RING.length];
            const spot = freeSpotNear((gx + ox + 0.5) * TS, (gy + oy + 1) * TS);
            spawnEnemy(race, spot.x, spot.y);
        }
    });
    // ── Лесные и водные
    for (let i = 0; i < 40 && forestSpots.length; i++) {
        const [x, y] = forestSpots[i];
        spawnEnemy(i % 2 ? "spider" : "rat", x, y);
    }
    for (let i = 0; i < 14 && waterSpots.length; i++) {
        const [x, y] = waterSpots[i];
        spawnEnemy("octopus", x, y);
    }

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
        layer: worldContainer, overlayPos: { x: 16, y: 48 },
    });

    // ===== Сцены: game / pause =====
    const scenes = createScenes({ addSystem });
    // Автоатака героя: враг в «зоне достижимости оружия» (reach атаки героя)
    // бьётся сам, без клавиши; кулдаун между взмахами
    const heroReach = ATTACK_CONFIGS[CHARACTER_ATTACKS.wolf.attack].reach;
    let heroAtkCd = 0;
    scenes.add("game", {
        enter() {
            hud.removeText("pauseLabel");
            hintLabel.visible = true;
            debug.info["Сцена"] = "game";
        },
        update(ticker) {
            characters.update(ticker); // ввод → коллизии/скольжение → анимация (по компонентам)
            const dt = (ticker && ticker.deltaMS || 1000 / 60) / 1000;
            heroAtkCd -= dt;
            if (heroAtkCd <= 0 && !COMPONENTS.ctrlLock[wolfId]) {
                const px = COMPONENTS.positionX[wolfId], py = COMPONENTS.positionY[wolfId];
                const r2 = heroReach * heroReach;
                for (let i = 0; i < enemies.length; i++) {
                    const en = enemies[i];
                    if (COMPONENTS.hp[en.id] <= 0) continue; // при смерти не добиваем
                    const dx = COMPONENTS.positionX[en.id] - px;
                    const dy = COMPONENTS.positionY[en.id] - py;
                    if (dx * dx + dy * dy <= r2) {
                        // снаряд выпустит модуль projectiles; прицел — в цель,
                        // чтобы выстрел летел точно во врага с любой диагонали
                        characters.playAttack(wolfId, { x: COMPONENTS.positionX[en.id], y: COMPONENTS.positionY[en.id] });
                        // Рефлексы (Скорость/2) сокращают кулдаун основной атаки
                        heroAtkCd = 0.9 * (1 - combat.dopOf(wolfId).cdrAttack / 100);
                        break;
                    }
                }
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
            // Полоски героя + боевые статы в оверлее отладки
            const hs = combat.stat(wolfId);
            heroHpBar.set(combat.hpRatio(wolfId));
            heroXpBar.set(combat.xpRatio(wolfId));
            debug.info["ХП"] = `${Math.ceil(COMPONENTS.hp[wolfId])}/${COMPONENTS.maxHp[wolfId]} · опыт ${hs.xp}/${xpToNext(hs.lvl)}`;
            input.endFrame(); // сброс однокадровых флагов В КОНЦЕ кадра
        },
    });
    scenes.add("pause", {
        enter() {
            hud.text("pauseLabel", "ПАУЗА", {
                x: app.screen.width / 2 - 110, y: app.screen.height / 2 - 45,
                size: 64, color: "#ffee66",
            });
            debug.info["Сцена"] = "pause";
        },
        update() {
            if (input.wasPressed("KeyP")) scenes.go("game");
            input.endFrame();
        },
    });
    scenes.add("menu", {
        enter() {
            menuUi.visible = true;
            hintLabel.visible = false;
            debug.info["Сцена"] = "menu";
        },
        exit() {
            menuUi.visible = false;
            hintLabel.visible = true;
        },
        update() {
            if (settingsOpen && input.wasPressed("Escape")) closeSettings();
            input.endFrame();
        },
    });
    scenes.go("menu"); // мир загружен — ждём выбора игрока
    loader.root.destroy({ children: true }); // экран загрузки больше не нужен

    console.log(`[game] мир ${W}×${H} сид ${SEED}: объектов ${gen.placements.length}, POI ${gen.pois.length}; ` +
        `персонаж (сущность ${wolfId}) в (${spawn.x | 0}, ${spawn.y | 0}) + врагов ${enemies.length}; рендерер ${app.renderer.name}`);

    // ===== Хендл для автотестов из консоли браузера =====
    window.__TEST = {
        wolfId, characters, camera, input, scenes, blocked, tiles, tilesHolder, bake: cornerTex,
        components: COMPONENTS, data: DATA, enemies, ai, projectiles, combat,
        heroStat: () => combat.stat(wolfId),
        heroDop: () => combat.dopOf(wolfId),
        giveXp: (n) => combat.giveXp(wolfId, n),
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
