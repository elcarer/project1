// ИГРОВАЯ ЛОГИКА — открытый мир (dualgrid) + контроллер персонажа.
// При старте генерируется карта «открытого мира» теми же функциями, что и в
// редакторе (dual.generateWorld + dual.generateWorldObjects), поверх неё
// спавнится оборотень (wolf_128, стандартный набор 11 анимаций) под управлением
// modules/character.js: стрелки/WASD/джойстик, диагональ играет анимацию
// последнего нажатого направления, скольжение вдоль непроходимых клеток.
//
// Параметры запуска: index.html?w=500&h=500&seed=7 (по умолчанию 500×500,
// случайный сид — он показывается в оверлее отладки, чтобы мир можно было
// воспроизвести). Запуск по http (python -m http.server) — ES-модули.
import { init } from "./engine/engine.js?v=2";
import { createInput } from "./engine/modules/input.js?v=2";
import { createCamera } from "./engine/modules/camera.js?v=2";
import { createCharacterInput, createCharacterSystem } from "./engine/modules/character.js?v=4";
import { createHUD } from "./engine/modules/hud.js?v=2";
import { createScenes } from "./engine/modules/scenes.js?v=2";
import { createDebug } from "./engine/modules/debug.js?v=2";
import "./engine/modules/dualgrid.js?v=2"; // dual-mode модуль: даёт глобаль createDualGrid

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

// ===== Текстуры тайлсетов =====
setStage("загрузка тайлсетов…");
await frame();
const TILESETS = ["grass_dirt.png", "grass_water.png", "snow_dirt.png", "sand_dirt.png"];
// Флаги слоёв как в редакторе: база рисует фон, наслагаемые — только фичи
const HIDE_BG = { "grass_dirt.png": false, "grass_water.png": true, "snow_dirt.png": true, "sand_dirt.png": true };
const tileTex = {};
for (const name of TILESETS) {
    const tex = await PIXI.Assets.load(`./images/tiles/${name}`);
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

// ===== Слои пола (порядок и флаги — как в редакторе) =====
setStage("сборка слоёв пола…");
await frame();
for (const name of TILESETS) {
    worldContainer.addChild(dual.build({
        texture: tileTex[name],
        map: { w: W, h: H, data: worldData.masks[name] },
        outside: 0,
        layout: dual.TILE_CORNERS,
        hideBackground: HIDE_BG[name],
    }));
}

// ===== Объекты (y-сортировка включена в buildObjects) =====
setStage(`расстановка объектов (${gen.placements.length})…`);
await frame();
const objHolder = dual.buildObjects({ items: objItems, ts: TS, w: W, h: H });
dual.syncObjects(objHolder, gen.placements);
worldContainer.addChild(objHolder);

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
const sheetTex = await PIXI.Assets.load("./images/sprites/wolf_128.png");
sheetTex.source.scaleMode = "nearest";
const manifest = await (await fetch("./images/sprites/wolf_128.json")).json();
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
objHolder.addChild(wolfSprite); // y-сортировка: заходит за стволы и перед ними

// ===== Персонаж — ECS-сущность, контроллер — система (modules/character.js) ==
// Спрайт ставит на место renderSystem ядра, кадры крутит animationSystem,
// системе персонажей принадлежит только движение с коллизиями и выбор анимаций.
const charInput = createCharacterInput(); // WASD/стрелки + джойстик
const characters = createCharacterSystem({ world, ECS, COMPONENTS, DATA, blocked, input: charInput });
const wolfId = characters.spawn({
    x: spawn.x, y: spawn.y, sprite: wolfSprite, anims,
    speed: 150, fps: manifest.fps, // коллизия «ног» — по умолчанию 14×10
});

// ===== Модули: ввод, камера-слежение, отладка =====
const input = createInput(); // endFrame зовёт сцена В КОНЦЕ кадра (см. ниже)
const camera = createCamera({ app, container: worldContainer, addSystem });
// Камера следит за КОМПОНЕНТАМИ сущности (живой взгляд на positionX/Y)
const wolfPos = {
    get x() { return COMPONENTS.positionX[wolfId]; },
    get y() { return COMPONENTS.positionY[wolfId]; },
};
camera.follow(wolfPos, 8);
camera.setBounds({ x: 0, y: 0, width: W * TS, height: H * TS });
camera.setZoom(2);
camera.centerOn(spawn.x, spawn.y);
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
        // Колесо — зум (вверх — ближе)
        if (input.pointer.wheel !== 0) camera.zoomBy(1 - input.pointer.wheel * 0.1);
        if (input.wasPressed("KeyP")) scenes.go("pause");
        // Оверлей отладки: параметры мира и живое состояние сущности из компонентов
        debug.info["Сид"] = SEED;
        debug.info["Карта"] = `${W}×${H}, объектов ${gen.placements.length}, POI ${gen.pois.length}`;
        debug.info["Позиция"] = `${COMPONENTS.positionX[wolfId] | 0}, ${COMPONENTS.positionY[wolfId] | 0}`;
        debug.info["Анимация"] = DATA.ctrlAnim[wolfId];
        debug.info["Взгляд"] = characters.facingName(wolfId);
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
    wolfId, characters, camera, input, scenes, blocked,
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
