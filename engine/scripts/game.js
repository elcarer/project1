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
    const hintLabel = hud.text("hint", "WASD — движение | бой авто | колесо — зум | P — пауза | L — задания | 1–3 — умения", {
        x: 16, y: 12, size: 24, color: "#88ffcc",
    });
    hintLabel.visible = false; // в стартовом меню подсказка не нужна
    const placeHint = () => hintLabel.position.set(16, app.screen.width < 720 ? 88 : 48);
    placeHint(); // под полосой кнопок меню (добавится позже)
    app.renderer.on("resize", placeHint);
    const frame = () => new Promise((r) => requestAnimationFrame(r)); // дать статусу отрисоваться

    // ── ПАУЗА МИРА: панели меню и пауза останавливают системы модулей (ИИ,
    // снаряды, бой, тайлы), ядро (рендер/анимации) продолжает работать.
    // СЦЕНЫ мороз не затрагивает (панель сама должна ловить Escape).
    let worldPaused = false;
    const setWorldPaused = (v) => { worldPaused = v; };
    const gatedAddSystem = (fn) => addSystem((t) => { if (!worldPaused) fn(t); });

    // ── ЖУРНАЛ СОБЫТИЙ (вкладка «Журнал») и БИБЛИОТЕКА (открытие видов) ────
    const gameLog = [];
    const logEvent = (text, color = "#cfc4a6") => {
        gameLog.push({ text, color });
        if (gameLog.length > 100) gameLog.shift();
    };
    // зачёт библиотеки живёт между сессиями (как в образце)
    const libraryUnlocked = new Set(JSON.parse(localStorage.getItem("libraryKinds") || "[]"));
    const unlockKind = (kind) => {
        if (libraryUnlocked.has(kind)) return false;
        libraryUnlocked.add(kind);
        localStorage.setItem("libraryKinds", JSON.stringify([...libraryUnlocked]));
        return true;
    };

    // На file:// картинка с диска — чужой origin: WebGL не грузит её в GPU,
    // а fetch/XHR до файла запрещены. Вшитые копии — только для этого режима.
    // ?filemode=1 — прогон file://-веток по http (тесты вшитых ассетов)
    const FILE_MODE = location.protocol === "file:" || q.has("filemode");
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
        // ЛОВУШКА v8: NineSliceSprite в минифицированном билде НЕ хит-тестится
        // (containsPoint всегда false — проверено hitTest'ом). Интерактивность
        // вешаем на КОНТЕЙНЕР кнопки с явным hitArea, фон остаётся картинкой.
        btn.eventMode = "static";
        btn.cursor = "pointer";
        btn.hitArea = new PIXI.Rectangle(0, 0, width, 60);
        btn.on("pointerenter", () => { bg.tint = 0xffd98e; });
        btn.on("pointerleave", () => { bg.tint = 0xffffff; });
        btn.on("pointertap", onTap);
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
        // новый мир: та же карта по размеру, случайный сид; после загрузки —
        // ЛОББИ выбора героя (флаг читается при буте). ОТНОСИТЕЛЬНЫЙ адрес:
        // на file:// location.pathname ("/D:/...") даёт «Unsafe attempt to
        // load URL» — навигация разрешена только в пределах папки
        sessionStorage.setItem("pickHero", "1");
        location.href = "index.html?w=" + W + "&h=" + H +
            "&seed=" + Math.floor(Math.random() * 2147483647);
    };
    // «Продолжить»: герой уже с выбранном классом? нет — пробуем сохранённый
    // выбор (localStorage); и его нет — открываем лобби
    const continueGame = async () => {
        if (heroId !== null) return true;
        const saved = localStorage.getItem("heroKey");
        if (saved && HERO_CLASSES.some((c) => c.key === saved)) {
            await spawnHero(saved);
            return true;
        }
        scenes.go("lobby");
        return false;
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
        makeMenuButton("Продолжить", async () => {
            menuOff();
            if (await continueGame()) scenes.go("game");
        }),
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

    // ===== Лобби выбора героя (сцена "lobby") ==================================
    // Четыре карточки (HERO_CLASSES): портрет-кукла из образца, имя, статы,
    // описание и иконки боевых умений. Клик — спавн героя и вход в игру;
    // выбор запоминается (localStorage "heroKey"), «Продолжить» его подхватывает.
    const lobbyUi = new PIXI.Container();
    lobbyUi.visible = false;
    app.stage.addChild(lobbyUi);
    if (FILE_MODE && !globalThis.EMBED_LOBBY) {
        throw new Error("file://: не подключён scripts/embedded_lobby.js");
    }
    const lobbyBg = new PIXI.Graphics();
    lobbyUi.addChild(lobbyBg); // затемнение поверх мира, рисуется в placeLobby
    const lobbyTitle = new PIXI.Text({
        text: "ВЫБЕРИТЕ ГЕРОЯ",
        style: { fontFamily: GAME_FONT, fontSize: 44, fill: "#ffd98e", fontWeight: "bold" },
    });
    lobbyTitle.anchor.set(0.5);
    lobbyUi.addChild(lobbyTitle);
    const abilityIconTex = {}; // кэш иконок карточек (те же файлы, что у панели)
    const heroDolls = {};      // портреты-куклы (общие с меню «Экипировка»)
    const abilityIcon = async (icon) => {
        if (!abilityIconTex[icon]) {
            abilityIconTex[icon] = FILE_MODE
                ? assets.textureFromDataURL(globalThis.EMBED_ABILITIES[icon])
                : await assets.loadTexture(`./images/abilities/${icon}.png`);
        }
        return abilityIconTex[icon];
    };
    const CARD_W = 216, CARD_H = 444, CARD_GAP = 18;
    const lobbyCards = [];
    let heroLoading = false;
    for (const cls of HERO_CLASSES) {
        const card = new PIXI.Container();
        const bg = new PIXI.Graphics();
        const drawCardBg = (hot) => {
            bg.clear()
                .roundRect(0, 0, CARD_W, CARD_H, 12).fill({ color: 0x140f08, alpha: 0.94 })
                .roundRect(0, 0, CARD_W, CARD_H, 12).stroke({ width: 3, color: hot ? 0xffd98e : 0x6b4a2f });
        };
        drawCardBg(false);
        // текстура ДО создания Sprite (на file:// textureFromDataURL — промис:
        // Sprite(промис) ломает рендер и размеры)
        heroDolls[cls.key] = FILE_MODE
            ? await assets.textureFromDataURL(EMBED_LOBBY.dolls[cls.doll])
            : await assets.loadTexture(`./images/heroes/doll/${cls.doll}.png`);
        const doll = new PIXI.Sprite(heroDolls[cls.key]);
        doll.scale.set(0.56); // 192×288 → ~107×161
        doll.position.set((CARD_W - doll.width) / 2, 10);
        const name = new PIXI.Text({
            text: cls.name,
            style: { fontFamily: GAME_FONT, fontSize: 26, fill: "#f0e6c8", fontWeight: "bold" },
        });
        name.anchor.set(0.5, 0);
        name.position.set(CARD_W / 2, 178);
        // 5 основных статов (класс — ровно 20 очков, разброс из образца)
        const stats = new PIXI.Text({
            text: STAT_LABELS.map((lab, i) => `${lab.name}: ${Object.values(cls.prim)[i]}`).join("\n"),
            style: { fontFamily: GAME_FONT, fontSize: 16, fill: "#cfc4a6", lineHeight: 21 },
        });
        stats.position.set(16, 212);
        const desc = new PIXI.Text({
            text: cls.desc,
            style: {
                fontFamily: GAME_FONT, fontSize: 14, fill: "#9aa4ad",
                wordWrap: true, wordWrapWidth: CARD_W - 30, breakWords: true, lineHeight: 18,
            },
        });
        desc.position.set(15, 324);
        card.addChild(bg, doll, name, stats, desc);
        // иконки боевых умений класса (изучаются из дерева в меню «Умения»)
        const poolDefs = HERO_ABILITIES[cls.key];
        for (let i = 0; i < poolDefs.length; i++) {
            const icon = new PIXI.Sprite(await abilityIcon(poolDefs[i].icon));
            icon.width = icon.height = 34;
            icon.position.set(CARD_W / 2 - (poolDefs.length * 42 - 8) / 2 + i * 42, CARD_H - 46);
            card.addChild(icon);
        }
        bg.eventMode = "static";
        bg.cursor = "pointer";
        bg.on("pointerenter", () => drawCardBg(true));
        bg.on("pointerleave", () => drawCardBg(false));
        bg.on("pointertap", async () => {
            if (heroLoading) return;
            heroLoading = true;
            lobbyHint.text = `Загрузка героя: ${cls.name}…`;
            try {
                await spawnHero(cls.key);
                localStorage.setItem("heroKey", cls.key);
                lobbyUi.visible = false;
                scenes.go("game");
            } catch (err) {
                console.error(err);
                lobbyHint.text = `Ошибка загрузки героя: ${err.message}`;
                lobbyHint.style.fill = "#ff7d6e";
            }
            heroLoading = false;
        });
        lobbyUi.addChild(card);
        lobbyCards.push(card);
    }
    const lobbyHint = new PIXI.Text({
        text: "Кого позовёшь в этот мир?",
        style: { fontFamily: GAME_FONT, fontSize: 22, fill: "#cfc4a6" },
    });
    lobbyHint.anchor.set(0.5);
    lobbyUi.addChild(lobbyHint);
    const placeLobby = () => {
        const w = app.screen.width, h = app.screen.height;
        lobbyBg.clear().rect(0, 0, w, h).fill({ color: 0x0a0805, alpha: 0.9 });
        lobbyTitle.position.set(w / 2, 26);
        lobbyHint.position.set(w / 2, 92);
        // колонки: широкому экрану — ряд из 4, узкому — сетка 2×2; масштаб
        // подгоняем так, чтобы блок целиком влезал по ширине и высоте
        const cols = w >= (4 * CARD_W + 3 * CARD_GAP + 40) ? 4 : 2;
        const rowsN = Math.ceil(lobbyCards.length / cols);
        const gridW = cols * CARD_W + (cols - 1) * CARD_GAP;
        const gridH = rowsN * CARD_H + (rowsN - 1) * CARD_GAP;
        const scale = Math.min(1, (w - 24) / gridW, (h - 150) / gridH);
        lobbyCards.forEach((card, i) => {
            const cx = i % cols, cy = (i / cols) | 0;
            card.scale.set(scale);
            card.position.set(
                (w - gridW * scale) / 2 + cx * (CARD_W + CARD_GAP) * scale,
                (h - gridH * scale) / 2 + 22 + cy * (CARD_H + CARD_GAP) * scale,
            );
        });
    };
    placeLobby();
    app.renderer.on("resize", placeLobby);

    // ===== Текстуры тайлсетов =====
    setStage("загрузка тайлсетов…", 0.02);
    await frame();
    const TILESETS = ["grass_dirt.png", "grass_water.png", "snow_dirt.png", "sand_dirt.png", "dungeon_dirt.png"];
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

    // ===== Подземелье: генерируемый регион в дальнем углу карты ================
    // Комнаты+коридоры (generateDungeonLayout) запекаются ПОВЕРХ природного
    // пола тайлсетом dungeon_dirt (двойная сетка «пол ↔ стена»), стены —
    // коллизии; внутри живёт гарнизон подземельных врагов, у входа — портал
    // (cave_rock) в мир, в данже — выход и портал на следующий этаж (rune_gate).
    const DUN = {
        w: 46, h: 34,
        x0: W - 46 - 8, y0: H - 34 - 8, // правый нижний угол карты
        depth: 1, maxDepth: 3,
        layout: null, garrison: [], portalCd: 0,
    };
    const dungeonWall = new Uint8Array(W * H);
    let mapTex = null; // мини-карта (сбрасывается при смене планировки данжа)
    const inDun = (gx, gy) => gx >= DUN.x0 - 1 && gx < DUN.x0 + DUN.w + 1 &&
                             gy >= DUN.y0 - 1 && gy < DUN.y0 + DUN.h + 1;
    // объекты мира не растут в регионе данжа
    gen.placements = gen.placements.filter(([, x, y]) => !inDun(x, y));
    function carveDungeon(depth) {
        DUN.depth = depth;
        DUN.layout = generateDungeonLayout(DUN.w, DUN.h, (SEED * 7919 + depth * 1013) >>> 0);
        dungeonWall.fill(0);
        for (let gy = 0; gy < DUN.h; gy++) {
            for (let gx = 0; gx < DUN.w; gx++) {
                if (DUN.layout.walls[gy * DUN.w + gx]) dungeonWall[(DUN.y0 + gy) * W + (DUN.x0 + gx)] = 1;
            }
        }
        // тайлы: перезапись углов региона (outside=1 — внешний периметр замкнут)
        const regionMask = { w: DUN.w, h: DUN.h, data: DUN.layout.walls };
        const dt = atlas["dungeon_dirt.png"].textures;
        for (let j = 0; j <= DUN.h; j++) {
            for (let i = 0; i <= DUN.w; i++) {
                cornerTex[(DUN.y0 + j) * (W + 1) + (DUN.x0 + i)] =
                    dt[dual.tileIndex(regionMask, i, j, { outside: 1 })];
            }
        }
        mapTex = null; // мини-карта перерисуется с планировкой
    }

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
    // Тайлсет подземелья: нарезка + запекание региона поверх природного пола
    atlas["dungeon_dirt.png"] = dual.sliceTileset(tileTex["dungeon_dirt.png"]);
    carveDungeon(1);
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
    const treeObjects = []; // кроны: { id, x0, y0, x1, y1 } — для прозрачности над героем
    for (let n = 0; n < objSprites.length; n++) {
        const sp = objSprites[n];
        rows[Math.min(H, Math.round(sp.y / TS))].addChild(sp); // y спрайта = точка ног
        const id = ECS.addEntity(world);
        const placement = gen.placements[n];
        if (placement && registry[placement[0]] && registry[placement[0]].group === "trees") {
            const reg = registry[placement[0]];
            treeObjects.push({ id, x0: placement[1] - 1.2, y0: placement[2] - 1.2,
                               x1: placement[1] + reg.cellsX + 1.2, y1: placement[2] + reg.cellsY + 1.2 });
        }
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
        return waterMask[k] === 1 || solid.blocked[k] === 1 || dungeonWall[k] === 1;
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
    setStage("точка спавна героя…", 0.74);
    await frame();
    const spawn = findSpawn(); // герой появится здесь после выбора класса

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
    const characters = createCharacterSystem({ world, ECS, COMPONENTS, DATA, blocked, blockedAlt: blockedSwim, input: charInput,
    addSystem: gatedAddSystem });
    // Снаряды: типы из data/attacks.js (грузятся ниже, перед боевой сценой);
    // привязка персонажей к атакам — сразу после спавна каждого. При выпуске
    // снаряд получает снимок боевых данных владельца (фракция, бросок урона) —
    // combat создаётся ниже, поэтому колбэки ссылается на него через let.
    let combat = null;
    let quests = null; // квесты создаются при спавне героя (колбэк onKill ниже)
    // Герой появляется только после выбора класса (лобби/«Продолжить»):
    // до этого сцены меню/лобби работают без сущности героя
    let heroId = null;
    let heroCls = null;   // класс из HERO_CLASSES (data/heroes.js)
    let abilities = null; // панель способностей — при спавне героя
    const projectiles = createProjectiles({
        world, ECS, COMPONENTS, DATA, addSystem: gatedAddSystem, assets, rows, TS,
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
    const fx = createFX({ app, layer: fxLayer, addSystem: gatedAddSystem });
    combat = createCombat({
        world, ECS, COMPONENTS, DATA, addSystem: gatedAddSystem, characters, projectiles, fx,
        onRemove(id) { // мёртвый враг уходит из рядов ног и хендлов сцены
            const k = creatureRowTrack.findIndex((e) => e.id === id);
            if (k !== -1) { creatureRowTrack.splice(k, 1); creatureRowCache.splice(k, 1); }
            const e = enemies.findIndex((en) => en.id === id);
            if (e !== -1) enemies.splice(e, 1);
        },
        // Убийство героем — событие квестов: вид жертвы берём из enemies (жертва
        // покинет список позже, при уборке трупа, а событие приходит в момент смерти)
        onKill(killerId, victimId) {
            const en = enemies.find((e) => e.id === victimId);
            if (!en) return;
            const info = ENEMY_BESTIARY.find((b) => b.key === en.name);
            logEvent(`Убийство: ${info ? info.name : en.name} (+${ENEMY_STATS[en.name] ? ENEMY_STATS[en.name].xp : "?"} опыта)`, "#a8e05f");
            if (unlockKind(en.name)) {
                const nm = info ? info.name : en.name;
                logEvent(`Библиотека: открыт «${nm}»`, "#ffd98e");
            }
            if (quests) quests.notifyKill(en.name);
        },
        // уровень героя — в журнал
        onLevelUp(id, lvl) {
            logEvent(`Достигнут уровень ${lvl}: +1 очко характеристик, +1 очко умений`, "#cc7dee");
        },
        // смерть героя — в журнал (возрождение через 2.5с)
        onDeath(id) {
            if (id === heroId) logEvent("Герой пал в бою… возрождение", "#ff7d6e");
        },
        // «Получив урон, зовёт соратников» — особая способность гоблина
        // (special.call, ENEMY_STATS): соратники в радиусе N клеток бросают
        // патруль и бегут на героя
        onDamaged(victimId) {
            const sp = combat.stat(victimId) && combat.stat(victimId).special;
            if (sp && sp.call) ai.alert(COMPONENTS.positionX[victimId], COMPONENTS.positionY[victimId], sp.call * TS);
        },
    });
    // Герой появится здесь после выбора класса в лобби (spawnHero ниже) —
    // волк героем больше не является, он монстр открытого мира.
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

    // Герой ходит по «рядам ног» объектов: между рядами порядок задают
    // контейнеры, внутри ряда героя каждый кадр пересортировывает его zIndex
    // (ставит система персонажей). Ряды героя — единственное, что тасуется.
    let heroSprite = null;
    let heroRow = -1;
    function heroRowFollow() {
        if (heroId === null || !heroSprite) return;
        const r = Math.max(0, Math.min(H, Math.floor(COMPONENTS.positionY[heroId] / TS)));
        if (r === heroRow) return;
        if (heroRow >= 0) heroSprite.removeFromParent();
        rows[r].addChild(heroSprite);
        heroRow = r;
    }
    gatedAddSystem(heroRowFollow);
    // Кроны деревьев над героем становятся прозрачными (бой в лесу не «вслепую»);
    // проверка раз в 0.2с — кроны статичны, герой меняет клетку не чаще
    let canopyT = 0;
    gatedAddSystem((ticker) => {
        canopyT -= (ticker && ticker.deltaMS || 16) / 1000;
        if (canopyT > 0) return;
        canopyT = 0.2;
        if (heroId === null) return;
        const hx = COMPONENTS.positionX[heroId] / TS, hy = COMPONENTS.positionY[heroId] / TS;
        for (const t of treeObjects) {
            const sp = DATA.spriteMap[t.id];
            if (!sp) continue;
            const over = hx >= t.x0 && hx <= t.x1 && hy >= t.y0 && hy <= t.y1;
            sp.alpha = over ? 0.35 : 1;
        }
    });

    // ── СПАВН ГЕРОЯ выбранного класса (лобби/«Продолжить») ──────────────────
    // Лист класса, ECS-сущность, привязка атаки, ролевые статы класса
    // (HERO_CLASSES), квесты и панель способностей — создаются один раз.
    let heroReach = 36; // «зона достижимости оружия» — по атаке класса
    // меню игры (полоса + панели), кэш иконок дерева, мини-карта мира
    let gamemenu = null;
    const menuIcons = {};
    function getMapImage() { // 1px карты = 1 тайл: вода/лес/поля + планировка данжа
        if (!mapTex) {
            const canvas = document.createElement("canvas");
            canvas.width = W; canvas.height = H;
            const ctx = canvas.getContext("2d");
            for (let gy = 0; gy < H; gy++) {
                for (let gx = 0; gx < W; gx++) {
                    const k = gy * W + gx;
                    let c;
                    if (inDun(gx, gy) && DUN.layout) {
                        c = DUN.layout.walls[(gy - DUN.y0) * DUN.w + (gx - DUN.x0)]
                            ? "#2b2933" : "#8a8578";
                    } else {
                        c = waterMask[k] === 1 ? "#3a6ea8"
                            : forest[k] === 1 ? "#2d5a2d" : "#7d9c55";
                    }
                    ctx.fillStyle = c;
                    ctx.fillRect(gx, gy, 1, 1);
                }
            }
            mapTex = PIXI.Texture.from(canvas);
        }
        return { texture: mapTex, w: W, h: H, ts: TS };
    }
    function recomputePassives() { // learned-узлы → плоский словарь эффектов боя
        const s = combat.stat(heroId);
        if (!s || !heroCls) return;
        s.passives = {};
        const pmap = HERO_TREE_PASSIVES[heroCls.key] || {};
        for (const [idx, name] of Object.entries(pmap)) {
            const lvl = (s.learned && s.learned[idx]) || 0;
            if (lvl > 0) s.passives[name] = lvl;
        }
    }
    async function spawnHero(classKey) {
        if (heroId !== null) return heroId;
        const cls = HERO_CLASSES.find((c) => c.key === classKey) || HERO_CLASSES[0];
        const ch = FILE_MODE
            ? await assets.loadCharacter(cls.sheet, EMBED.chars[cls.sheet])
            : await assets.loadCharacter(`${SPRITES_DIR}${cls.sheet}`);
        const sprite = new PIXI.AnimatedSprite(ch.animations.wait, false);
        sprite.anchor.set(0.5, 1); // позиция сущности = точка ног
        const id = characters.spawn({
            x: spawn.x, y: spawn.y, sprite, anims: ch.animations,
            speed: 150, fps: ch.fps,
            halfW: 3.5, halfH: 2.5, // «ноги» — вдвое уже тайла (спрайт 64px)
        });
        ECS.addComponent(world, id, "cullPad", ch.size);
        projectiles.bind(id, cls.key);
        // Ролевые статы класса (формулы — data/stats.js)
        combat.init(id, {
            faction: 0, hero: true, size: ch.size, lvl: 1,
            prim: { ...cls.prim }, growth: null, // рост — только очками игрока
            weaponMin: cls.weaponMin,
        });
        heroId = id;
        heroCls = cls;
        heroSprite = sprite;
        heroReach = ATTACK_CONFIGS[CHARACTER_ATTACKS[cls.key].attack].reach;
        heroRowFollow(); // сразу в правильный ряд
        // Квесты и способности — один раз на сессию (герой спавнится один раз)
        if (!quests) {
            quests = createQuests({
                app, combat, fx, heroId,
                heroPos: () => ({ x: COMPONENTS.positionX[heroId], y: COMPONENTS.positionY[heroId] }),
            });
            app.renderer.on("resize", quests.place);
        }
        if (!abilities) {
            abilities = createAbilities({
                app, combat, characters, projectiles, fx, assets,
                heroId, blocked, COMPONENTS, DATA,
                loadout: HERO_ABILITIES[cls.key],
            });
            await abilities.load({ fileMode: FILE_MODE, embed: globalThis.EMBED_ABILITIES || null });
            app.renderer.on("resize", abilities.place);
        }
        // Иконки узлов дерева для меню (только изучаемые узлы) — кэш синхронный
        const tree = ABILITY_TREES[cls.tree];
        for (let i = 0; i < tree.length; i++) {
            const has = HERO_ABILITIES[cls.key].some((d) => d.node === i)
                || (HERO_TREE_PASSIVES[cls.key] || {})[i];
            if (!has) continue;
            const key = cls.key + "/" + tree[i].icon;
            if (!menuIcons[key]) {
                menuIcons[key] = FILE_MODE
                    ? await assets.textureFromDataURL(globalThis.EMBED_ABILITIES[key])
                    : await assets.loadTexture(`./images/abilities/${key}.png`);
            }
        }
        // Меню игры (полоса кнопок + панели) — один раз на сессию
        if (!gamemenu) {
            gamemenu = createGameMenu({
                app, combat, quests,
                getHero: () => ({ id: heroId, cls: heroCls, onLearned: recomputePassives }),
                getIcon: (classKey, num) => menuIcons[classKey + "/" + num] || PIXI.Texture.EMPTY,
                getDoll: (key) => heroDolls[key],
                getMapImage,
                enemyKinds: () => enemyKinds,
                gameLog: () => gameLog,
                library: { unlocked: libraryUnlocked },
                onToggleFullscreen: toggleFullscreen,
                onToMenu: () => scenes.go("menu"),
            });
            gamemenu.onOpenTab = (tab) => {
                if (tab) { setWorldPaused(true); scenes.go("panel"); }
                else { setWorldPaused(false); scenes.go("game"); }
            };
            app.renderer.on("resize", gamemenu.place);
            gamemenu.show(true);
        }
        return id;
    }

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
    gatedAddSystem(creatureRowFollow);

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
        wolf:    { speed: 135, detect: 165, leash: 330, patrol: 120 }, // лесной охотник
        octopus: { speed: 100, detect: 110, leash: 200, patrol: 80, swim: true },
        // ── подземелье
        bat:      { speed: 150, detect: 190, leash: 320, patrol: 90 },
        spike:    { speed: 110, detect: 150, leash: 260, patrol: 80 },
        spiderman:{ speed: 120, detect: 170, leash: 320, patrol: 90 },
        mummy:    { speed: 105, detect: 160, leash: 300, patrol: 80 },
        hound:    { speed: 140, detect: 180, leash: 340, patrol: 100 },
        imp:      { speed: 125, detect: 160, leash: 300, patrol: 90 },
        succubus: { speed: 115, detect: 170, leash: 320, patrol: 90 },
        vampire:  { speed: 130, detect: 180, leash: 340, patrol: 100 },
        dark:     { speed: 110, detect: 170, leash: 320, patrol: 90 },
    };
    // «Зона достижимости оружия» (reach из ATTACK_CONFIGS) — дистанция атаки ИИ.
    // Ближний бой подходит БЛИЖЕ (0.6·reach): эффект оружия бьёт перед взглядом,
    // на диагональной дистанции reach он не достаёт до цели. Темп атак — cd
    // атаки из образца (ATTACK_CONFIGS.cd).
    const weaponAttackR = (kind) => {
        const cfg = ATTACK_CONFIGS[CHARACTER_ATTACKS[kind].attack];
        return cfg.kind === "melee" ? cfg.reach * 0.6 : cfg.reach;
    };
    const weaponAttackCd = (kind) => ATTACK_CONFIGS[CHARACTER_ATTACKS[kind].attack].cd || 1.4;
    const ai = createEnemyAI({
        world, ECS, COMPONENTS, DATA, addSystem: gatedAddSystem, characters,
        blocked,
        blockedAlt: blockedSwim, // пловец: вода проходима, всё остальное — нет
        // героя до выбора класса нет — «он» бесконечно далеко, никто не агрится
        getPlayerPos: () => (heroId !== null
            ? { x: COMPONENTS.positionX[heroId], y: COMPONENTS.positionY[heroId] }
            : { x: -1e9, y: -1e9 }),
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
        ai.register(id, { detectR: st.detect, leashR: st.leash, patrolR: st.patrol, attackR: weaponAttackR(kind), attackCd: weaponAttackCd(kind) });
        creatureRowTrack.push({ sprite, id });
        creatureRowCache.push(-1);
        projectiles.bind(id, kind);
        // Ролевые статы вида (data/stats.js) с лёгкой индивидуальной разброской;
        // special — особые способности вида (зов/каменная кожа/яд — combat.js)
        const es = ENEMY_STATS[kind];
        const v = (base) => base + ((Math.random() * 2) | 0);
        combat.init(id, {
            faction: 1, size: ch.size, lvl: es.lvl,
            prim: {
                str: v(es.prim.str), agi: v(es.prim.agi), vit: v(es.prim.vit),
                spd: v(es.prim.spd), wis: v(es.prim.wis),
            },
            weaponMin: es.weaponMin, xpReward: es.xp, special: es.special || null,
        });
        const en = { name: kind, id, size: ch.size };
        enemies.push(en);
        return en;
    }
    // Листы врагов — один вид грузится один раз (кэш менеджера ассетов);
    // волк на file:// берётся из EMBED.wolf (в chars его нет — лист героя)
    const enemyKinds = {};
    const ENEMY_SHEETS = ["goba", "shaman", "dwarf", "orc", "ogr", "spider", "rat", "wolf", "octopus",
        "bat", "spike", "spiderman", "mummy", "hound", "imp", "succubus", "vampire", "dark"];
    for (let i = 0; i < ENEMY_SHEETS.length; i++) {
        const kind = ENEMY_SHEETS[i];
        setStage(`расселение врагов… (${kind})`, 0.76 + (i / ENEMY_SHEETS.length) * 0.14);
        if (i % 4 === 0) await frame();
        enemyKinds[kind] = FILE_MODE
            ? await assets.loadCharacter(`${kind}_64`, EMBED.chars[`${kind}_64`] || EMBED.wolf)
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
            if (inDun(gx, gy)) continue; // дикие враги не живут в данже
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
        if (inDun(gx, gy)) continue; // регион данжа — только подземельные враги
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
    // ── Лесные и водные: в лесах пауки, крысы и ВОЛКИ (бывший герой — теперь
    // дикий хищник), в глубокой воде октопусы
    for (let i = 0; i < 40 && forestSpots.length; i++) {
        const [x, y] = forestSpots[i];
        const roll = Math.random();
        spawnEnemy(roll < 0.16 ? "wolf" : roll < 0.58 ? "spider" : "rat", x, y);
    }
    for (let i = 0; i < 14 && waterSpots.length; i++) {
        const [x, y] = waterSpots[i];
        spawnEnemy("octopus", x, y);
    }

    // ── Порталы подземелья: вход в мире, выход/спуск внутри ──────────────────
    // Гарнизон: 1-2 врага на комнату, пул зависит от глубины; на дне (3 этаж)
    // в дальней комнате — элитный вампир.
    const DUN_POOLS = {
        1: ["bat", "spike", "spiderman"],
        2: ["mummy", "hound", "imp", "bat"],
        3: ["succubus", "vampire", "dark", "hound"],
    };
    let portals = [];       // активные порталы: { x, y, kind, sprite? }
    let dunPortalSprites = []; // спрайты порталов внутри данжа (чистятся при смене)
    function placePortalSprite(objName, x, y) {
        const item = objItems.find((o) => o.name === objName) || objItems.find((o) => o.name === "rune_gate") || objItems[0];
        const sprite = new PIXI.Sprite(item.texture);
        sprite.anchor.set(0.5, 1);
        sprite.position.set(x, y);
        sprite.zIndex = y;
        const gy = Math.max(0, Math.min(H, Math.floor(y / TS)));
        rows[gy].addChild(sprite);
        return sprite;
    }
    function clearDunPortals() {
        for (const p of dunPortalSprites) p.removeFromParent();
        dunPortalSprites.length = 0;
    }
    function despawnGarrison() {
        for (const en of DUN.garrison) {
            if (!DATA.spriteMap[en.id]) continue; // уже убран боевой системой (смерть+тление)
            const sp = DATA.spriteMap[en.id];
            sp.removeFromParent();
            DATA.spriteMap[en.id] = null;
            projectiles.BOUND[en.id] = null;
            ECS.removeEntity(world, en.id);
            const k = creatureRowTrack.findIndex((e) => e.id === en.id);
            if (k !== -1) { creatureRowTrack.splice(k, 1); creatureRowCache.splice(k, 1); }
            const e2 = enemies.findIndex((x) => x.id === en.id);
            if (e2 !== -1) enemies.splice(e2, 1);
        }
        DUN.garrison.length = 0;
    }
    function roomCenter(ri) {
        const r = DUN.layout.rooms[ri];
        return { x: (DUN.x0 + r.x + r.w / 2) * TS, y: (DUN.y0 + r.y + r.h / 2 + 0.5) * TS };
    }
    function enterDungeon(depth) {
        if (depth > DUN.maxDepth) return;
        clearDunPortals();
        despawnGarrison();
        carveDungeon(depth);
        // гарнизон по комнатам (кроме комнаты входа)
        const pool = DUN_POOLS[depth] || DUN_POOLS[1];
        for (let ri = 1; ri < DUN.layout.rooms.length; ri++) {
            const r = DUN.layout.rooms[ri];
            const n = 1 + ((Math.random() * 2) | 0);
            for (let k = 0; k < n; k++) {
                const gx = DUN.x0 + r.x + ((Math.random() * r.w) | 0);
                const gy = DUN.y0 + r.y + ((Math.random() * r.h) | 0);
                const spot = freeSpotNear((gx + 0.5) * TS, (gy + 1) * TS);
                const kind = pool[(Math.random() * pool.length) | 0];
                DUN.garrison.push(spawnEnemy(kind, spot.x, spot.y));
            }
        }
        portals = [];
        const spawnC = roomCenter(DUN.layout.spawn);
        dunPortalSprites.push(placePortalSprite("rune_gate", spawnC.x, spawnC.y));
        portals.push({ x: spawnC.x, y: spawnC.y, kind: "exit" });
        if (depth < DUN.maxDepth) {
            const exitC = roomCenter(DUN.layout.exit);
            dunPortalSprites.push(placePortalSprite("rune_gate", exitC.x, exitC.y));
            portals.push({ x: exitC.x, y: exitC.y, kind: "descend" });
        } else {
            const c = roomCenter(DUN.layout.exit); // дно: элитный страж
            DUN.garrison.push(spawnEnemy("vampire", c.x + TS, c.y));
        }
        // рядом с порталом выхода, НЕ на нём (иначе кд истечёт — и тут же выход)
        COMPONENTS.positionX[heroId] = spawnC.x + 56;
        COMPONENTS.positionY[heroId] = spawnC.y;
        DUN.portalCd = 2;
        logEvent(`Подземелье: этаж ${depth} — врагов ${DUN.garrison.length}`, "#cc7dee");
        fx.text(spawnC.x, spawnC.y - 60, `ЭТАЖ ${depth}`, { color: "#cc7dee", size: 30, life: 1.6, rise: 20 });
        tiles.rebuild();
    }
    function backToWorld() {
        clearDunPortals();
        despawnGarrison();
        portals = [worldPortal];
        COMPONENTS.positionX[heroId] = worldPortal.x + 34;
        COMPONENTS.positionY[heroId] = worldPortal.y;
        DUN.portalCd = 2;
        logEvent("Возврат в открытый мир", "#cc7dee");
        tiles.rebuild();
    }
    function usePortal(p) {
        DUN.portalCd = 2.5;
        fx.burst(COMPONENTS.positionX[heroId], COMPONENTS.positionY[heroId] - 16,
            { count: 14, color: 0xcc7dee, speedMax: 130, life: 0.6 });
        if (p.kind === "enter") enterDungeon(1);
        else if (p.kind === "descend") enterDungeon(DUN.depth + 1);
        else backToWorld();
    }
    // Вход в подземелье: пещера в 25..55 клетках от спавна (кольца, 3×3 свободно)
    let worldPortal = null;
    (function placeEntrance() {
        const sx = Math.floor(spawn.x / TS), sy = Math.floor(spawn.y / TS);
        for (let r = 25; r <= 55; r++) {
            for (let dy = -r; dy <= r; dy += 2) {
                for (let dx = -r; dx <= r; dx += 2) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const gx = sx + dx, gy = sy + dy;
                    if (gx < 2 || gy < 2 || gx >= W - 2 || gy >= H - 2) continue;
                    let ok = true;
                    for (let oy = -1; oy <= 1 && ok; oy++)
                        for (let ox = -1; ox <= 1 && ok; ox++)
                            if (blocked((gx + ox + 0.5) * TS, (gy + oy + 1) * TS)) ok = false;
                    if (!ok) continue;
                    const px = (gx + 0.5) * TS, py = (gy + 1) * TS;
                    placePortalSprite("cave_rock", px, py);
                    worldPortal = { x: px, y: py, kind: "enter" };
                    portals.push(worldPortal);
                    return;
                }
            }
        }
    })();

    // ===== Модули: ввод, камера-слежение, отладка =====
    const input = createInput(); // endFrame зовёт сцена В КОНЦЕ кадра (см. ниже)
    const camera = createCamera({ app, container: worldContainer, addSystem: gatedAddSystem });
    // Средняя кнопка мыши — вернуть изначальный зум (preventDefault гасит autoscroll)
    const INITIAL_ZOOM = 2.5;
    app.canvas.addEventListener("mousedown", (e) => {
        if (e.button === 1) { e.preventDefault(); camera.setZoom(INITIAL_ZOOM); }
    });
    // Камера следит за КОМПОНЕНТАМИ сущности (живой взгляд на positionX/Y);
    // до спавна героя — точка спавна
    const heroPos = {
        get x() { return heroId !== null ? COMPONENTS.positionX[heroId] : spawn.x; },
        get y() { return heroId !== null ? COMPONENTS.positionY[heroId] : spawn.y; },
    };
    camera.follow(heroPos, 8);
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
        app, addSystem: gatedAddSystem, world, grid: SpatialHashGrid, components: COMPONENTS,
        layer: worldContainer, overlayPos: { x: 16, y: 48 },
    });

    // ===== Сцены: game / pause =====
    const scenes = createScenes({ addSystem });
    // Автоатака героя: враг в «зоне достижимости оружия» (reach атаки героя)
    // бьётся сам, без клавиши; кулдаун между взмахами
    // heroReach объявлен в spawnHero (по атаке выбранного класса)
    let heroAtkCd = 0;
    scenes.add("game", {
        enter() {
            hud.removeText("pauseLabel");
            hintLabel.visible = true;
            if (quests) quests.show(true);
            if (abilities) abilities.show(true);
            if (gamemenu) gamemenu.show(true);
            debug.info["Сцена"] = "game";
        },
        update(ticker) {
            if (heroId === null) { input.endFrame(); return; } // герой ещё не выбран
            characters.update(ticker); // ввод → коллизии/скольжение → анимация (по компонентам)
            const dt = (ticker && ticker.deltaMS || 1000 / 60) / 1000;
            heroAtkCd -= dt;
            if (heroAtkCd <= 0 && !COMPONENTS.ctrlLock[heroId]) {
                const px = COMPONENTS.positionX[heroId], py = COMPONENTS.positionY[heroId];
                const r2 = heroReach * heroReach;
                for (let i = 0; i < enemies.length; i++) {
                    const en = enemies[i];
                    if (COMPONENTS.hp[en.id] <= 0) continue; // при смерти не добиваем
                    const dx = COMPONENTS.positionX[en.id] - px;
                    const dy = COMPONENTS.positionY[en.id] - py;
                    if (dx * dx + dy * dy <= r2) {
                        // снаряд выпустит модуль projectiles; прицел — в цель,
                        // чтобы выстрел летел точно во врага с любой диагонали
                        characters.playAttack(heroId, { x: COMPONENTS.positionX[en.id], y: COMPONENTS.positionY[en.id] });
                        // Рефлексы (Скорость/2) сокращают кулдаун основной атаки
                        heroAtkCd = 0.9 * (1 - combat.dopOf(heroId).cdrAttack / 100);
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
            // Журнал заданий: L — открыть/закрыть, Escape закрывает открытый
            if (input.wasPressed("KeyL") || (quests.isLogOpen() && input.wasPressed("Escape"))) {
                quests.toggleLog();
            }
            quests.update(ticker); // «достичь уровня» + очередь объявлений квестов
            // Способности: клавиши 1–3 — каст, тик кулдаунов (в паузе замирают)
            if (input.wasPressed("Digit1")) abilities.use(0);
            if (input.wasPressed("Digit2")) abilities.use(1);
            if (input.wasPressed("Digit3")) abilities.use(2);
            abilities.update(ticker);
            // Порталы подземелья: подходишь вплотную — переход (с перезарядкой)
            if (DUN.portalCd > 0) DUN.portalCd -= dt;
            else {
                for (const p of portals) {
                    const dx = COMPONENTS.positionX[heroId] - p.x;
                    const dy = COMPONENTS.positionY[heroId] - p.y;
                    if (dx * dx + dy * dy < 26 * 26) { usePortal(p); break; }
                }
            }
            // Оверлей отладки: параметры мира и живое состояние сущности из компонентов
            debug.info["Сид"] = SEED;
            debug.info["Карта"] = `${W}×${H}, объектов ${gen.placements.length}, POI ${gen.pois.length}`;
            debug.info["Герой"] = heroCls.name;
            debug.info["Позиция"] = `${COMPONENTS.positionX[heroId] | 0}, ${COMPONENTS.positionY[heroId] | 0}`;
            debug.info["Анимация"] = DATA.ctrlAnim[heroId];
            debug.info["Взгляд"] = characters.facingName(heroId);
            debug.info["Тайлов на экране"] = tiles.stats().tiles;
            debug.info["Сущностей ECS"] = world.entities.length;
            // Полоски героя + боевые статы в оверлее отладки
            const hs = combat.stat(heroId);
            heroHpBar.set(combat.hpRatio(heroId));
            heroXpBar.set(combat.xpRatio(heroId));
            debug.info["ХП"] = `${Math.ceil(COMPONENTS.hp[heroId])}/${COMPONENTS.maxHp[heroId]} · опыт ${hs.xp}/${xpToNext(hs.lvl)}`;
            input.endFrame(); // сброс однокадровых флагов В КОНЦЕ кадра
        },
    });
    scenes.add("pause", {
        enter() {
            setWorldPaused(true); // мир замирает целиком (ИИ/снаряды/бой)
            hud.text("pauseLabel", "ПАУЗА", {
                x: app.screen.width / 2 - 110, y: app.screen.height / 2 - 45,
                size: 64, color: "#ffee66",
            });
            hintLabel.visible = false;
            if (gamemenu) gamemenu.show(false);
            debug.info["Сцена"] = "pause";
        },
        exit() {
            setWorldPaused(false);
            if (gamemenu) gamemenu.show(true);
        },
        update() {
            if (input.wasPressed("KeyP")) scenes.go("game");
            if (input.wasPressed("KeyL") && quests) quests.toggleLog(); // журнал читаем и в паузе
            input.endFrame();
        },
    });
    // Панели игрового меню: мир на паузе, Escape/крестик закрывают
    scenes.add("panel", {
        enter() { setWorldPaused(true); debug.info["Сцена"] = "panel"; },
        exit() { setWorldPaused(false); },
        update() {
            if (input.wasPressed("Escape") && gamemenu) gamemenu.close();
            input.endFrame();
        },
    });
    scenes.add("lobby", {
        enter() {
            placeLobby(); // раскладка могла измениться со старта
            lobbyUi.visible = true;
            hintLabel.visible = false;
            if (gamemenu) gamemenu.show(false);
            debug.info["Сцена"] = "lobby";
        },
        exit() {
            lobbyUi.visible = false;
        },
        update() {
            input.endFrame();
        },
    });
    scenes.add("menu", {
        enter() {
            placeMenu(); // пересчёт раскладки: размер панели мог измениться со старта
            menuUi.visible = true;
            hintLabel.visible = false;
            if (quests) quests.show(false);   // интерфейс квестов в меню не нужен
            if (abilities) abilities.show(false); // панель умений тоже
            if (gamemenu) gamemenu.show(false);   // полоса меню тоже
            debug.info["Сцена"] = "menu";
        },
        exit() {
            menuUi.visible = false;
            if (heroId !== null) hintLabel.visible = true;
            if (quests) quests.show(true);
            if (abilities) abilities.show(true);
        },
        update() {
            if (settingsOpen && input.wasPressed("Escape")) closeSettings();
            input.endFrame();
        },
    });
    // Мир загружен: «Новая игра» ведёт в лобби выбора героя, иначе — меню
    // (флаг ставит кнопка «Новая игра» перед перезагрузкой с новым сидом)
    const pickHeroFlag = sessionStorage.getItem("pickHero");
    if (pickHeroFlag) sessionStorage.removeItem("pickHero");
    scenes.go(pickHeroFlag ? "lobby" : "menu");
    loader.root.destroy({ children: true }); // экран загрузки больше не нужен

    console.log(`[game] мир ${W}×${H} сид ${SEED}: объектов ${gen.placements.length}, POI ${gen.pois.length}; ` +
        `врагов ${enemies.length}; герой появится после выбора класса (лобби); рендерер ${app.renderer.name}`);

    // ===== Хендл для автотестов из консоли браузера =====
    window.__TEST = {
        get heroId() { return heroId; },
        get heroCls() { return heroCls; },
        spawnHero,
        characters, camera, input, scenes, blocked, tiles, tilesHolder, bake: cornerTex,
        components: COMPONENTS, data: DATA, enemies, ai, projectiles, combat, quests,
        get abilities() { return abilities; },
        abilitiesState: () => (abilities ? abilities.snapshot() : null),
        get gamemenu() { return gamemenu; },
        get DUN() { return DUN; },
        get portals() { return portals; },
        enterDungeon, backToWorld,
        gameLog: () => gameLog,
        libraryUnlocked,
        learn: (idx) => {
            // тестовый проход: изучение узла дерева текущего класса
            const tree = ABILITY_TREES[heroCls.tree];
            const lvl = combat.learn(heroId, idx, tree[idx].maxLvl, tree[idx].prev);
            recomputePassives();
            if (abilities) abilities.syncSlots();
            return lvl;
        },
        allocate: (key) => combat.allocateStat(heroId, key),
        questState: () => (quests ? quests.snapshot() : null),
        heroStat: () => combat.stat(heroId),
        heroDop: () => combat.dopOf(heroId),
        giveXp: (n) => combat.giveXp(heroId, n),
        world: () => ({ w: W, h: H, seed: SEED, objects: gen.placements.length, pois: gen.pois.length }),
        info: (id = heroId) => ({
            x: COMPONENTS.positionX[id], y: COMPONENTS.positionY[id],
            anim: DATA.ctrlAnim[id], facing: characters.facingName(id),
            moving: !!COMPONENTS.ctrlMove[id],
        }),
        keyDown: (code) => window.dispatchEvent(new KeyboardEvent("keydown", { code })),
        keyUp: (code) => window.dispatchEvent(new KeyboardEvent("keyup", { code })),
        renderer: () => app.renderer.name,
    };
})();
