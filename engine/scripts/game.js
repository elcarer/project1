// ИГРОВАЯ ЛОГИКА / ПОЛИГОН МОДУЛЕЙ
// Интеграционный тест всех модулей движка: мир больше экрана, управляемый
// герой под камерой, здоровье и урон по таймеру, события, эффекты, звук, HUD,
// пауза и отладочный оверлей. Каждый блок помечен, какой модуль проверяет.
import { UNIT_CONFIGS, UNITS_EVENTS } from "./data/units.js?v=2";
import { init } from "./engine/engine.js?v=2";
import { createScheduler } from "./engine/modules/scheduler.js?v=2";
import { createInput } from "./engine/modules/input.js?v=2";
import { createHealth } from "./engine/modules/health.js?v=2";
import { createCamera } from "./engine/modules/camera.js?v=2";
import { createFX } from "./engine/modules/fx.js?v=2";
import { createAudio } from "./engine/modules/audio.js?v=2";
import { createAssets } from "./engine/modules/assets.js?v=2";
import { createHUD } from "./engine/modules/hud.js?v=2";
import { createScenes } from "./engine/modules/scenes.js?v=2";
import { createDebug } from "./engine/modules/debug.js?v=2";
import { rand } from "./engine/modules/math.js?v=2";

const engine = await init();
const {
    app,
    worldContainer,
    world,
    events,
    COMPONENTS,
    DATA,
    SpatialHashGrid,
    spawnUnit,
    spawnAnimatedUnit,
    createProgrammaticSpritesheet,
    addSystem,
    setWorldBounds,
} = engine;

console.log(`[engine] рендерер: ${app.renderer.name}`); // webgpu или webgl (откат)

// ===== [assets] Загрузка спрайтшита с прогрессом =====
const assets = createAssets();
await assets.load(["./images/bullets/all.png"], (p) => console.log(`[assets] прогресс: ${(p * 100) | 0}%`));
// Пули нарезаем по НАТИВНОМУ размеру кадра арта (32×32), а уполовнивание
// делаем масштабом спрайта (spriteScale: 0.5) — иначе кадры режутся на четверти
const bulletTextures = await assets.loadSpritesheet("./images/bullets/all.png", 32, 32);
console.log(`[assets] кадров нарезано: ${bulletTextures.length}`);

// ===== Текстуры и конфиги (тип 0 — пульсирующий, 1 — пуля, 2 — игрок) =====
// Размеры объектов уполовнены (радиус 5 вместо 10, кадры 16px вместо 32):
// в кадре помещается вдвое больше, замеры производительности честнее.
const rawGraphicsFrames = [];
for (let i = 0; i < 4; i++) {
    const graphic = new PIXI.Graphics()
        .circle(0, 0, i < 3 ? 4 + i : 6.5 - i)
        .fill("grey")
    rawGraphicsFrames.push(graphic);
}
UNIT_CONFIGS[0].textures = createProgrammaticSpritesheet(rawGraphicsFrames, 16, 16);

UNIT_CONFIGS[1] = {
    ...UNIT_CONFIGS[0],
    textures: bulletTextures,
    baseSpeed: 3,
    radius: 5,
    spriteScale: 0.5, // арт 32×32, отображаем в половинном масштабе
    animationSpeed: 0.2,
};

const greenGraphic = new PIXI.Graphics().circle(0, 0, 6).fill("royalblue").stroke({ width: 2, color: "lightblue" });
const playerTexture = app.renderer.generateTexture(greenGraphic);
UNIT_CONFIGS[2] = {
    name: "Игрок",
    maxHp: 100,
    baseSpeed: 4, // используется только для начального разлёта — игроком управляем напрямую
    radius: 6,
    color: "royalblue",
};

// ===== [setWorldBounds] Мир больше экрана — камере есть что показывать =====
const WORLD = { x: 0, y: 0, width: 1600, height: 1200 };
setWorldBounds(WORLD);

// ===== Создание модулей =====
const scheduler = createScheduler();
// endFrame НЕ регистрируем в addSystem: ввод должен читаться сценой ПОСЛЕ,
// а сбрасываться в конце её update (см. конец updateGame)
const input = createInput();
const health = createHealth();
const camera = createCamera({ app, container: worldContainer, addSystem });
const fx = createFX({ app, layer: worldContainer, addSystem });
const audio = createAudio();
const hud = createHUD({ app });
const scenes = createScenes({ addSystem });
const debug = createDebug({ app, addSystem, world, grid: SpatialHashGrid, components: COMPONENTS, layer: worldContainer, overlayPos: { x: 10, y: 86 } });
// [audio] Контекст браузера можно разблокировать только жестом пользователя
window.addEventListener("pointerdown", () => audio.unlock());

// ===== Спавн: игрок + блуждающая популяция =====
const PLAYER_SPEED = 4;
const playerId = spawnUnit(2, WORLD.width / 2, WORLD.height / 2, playerTexture);
health.attach(playerId, UNIT_CONFIGS[2].maxHp);
const playerSprite = DATA.spriteMap[playerId];

// Блуждающие юниты, все с здоровьем — по ним тестируем урон/смерть/эффекты
const POPULATION = 60;
function spawnWanderer() {
    const isBullet = Math.random() < 0.3;
    const id = isBullet
        ? spawnAnimatedUnit(1, rand(50, WORLD.width - 50), rand(50, WORLD.height - 50))
        : spawnAnimatedUnit(0, rand(50, WORLD.width - 50), rand(50, WORLD.height - 50));
    health.attach(id, 60);
    return id;
}
for (let i = 0; i < POPULATION; i++) spawnWanderer();

// ===== [camera] Следование за игроком, границы мира =====
camera.follow(playerSprite);
camera.setBounds(WORLD);
camera.centerOn(WORLD.width / 2, WORLD.height / 2);

// ===== [events + audio] Пресеты звука =====
audio.register("hit", () => audio.tone({ freq: 220, endFreq: 110, dur: 0.08, type: "square", volume: 0.15 }));
audio.register("explosion", () => audio.noise({ dur: 0.45, volume: 0.35, filterFreq: 500 }));
audio.register("heal", () => audio.tone({ freq: 440, endFreq: 880, dur: 0.15, type: "sine", volume: 0.1 }));

// ===== [events + fx + hud] Реакция на урон и смерть =====
let score = 0;
events.on(UNITS_EVENTS.DAMAGED, ({ id, amount }) => {
    fx.text(COMPONENTS.positionX[id], COMPONENTS.positionY[id] - 14, `-${amount}`, { color: "#ff6666", size: 13 });
});
events.on(UNITS_EVENTS.DIED, ({ id }) => {
    const x = COMPONENTS.positionX[id];
    const y = COMPONENTS.positionY[id];
    fx.burst(x, y, { count: 18, color: 0xffaa33, speedMin: 60, speedMax: 220, size: 1.2 });
    audio.play("explosion");
    score++;
    hud.setText("score", `Счёт: ${score}`);
});

// ===== [hud] Полоска здоровья игрока, счёт, подсказка =====
hud.bar("playerHp", {
    x: 16, y: 16, width: 220, height: 14, color: 0x44dd66,
    get: () => health.ratio(playerId),
});
hud.text("score", "Счёт: 0", { x: 16, y: 38, size: 18, color: "#ffffff" });
hud.text("hint", "WASD/стрелки — движение | колесо — зум | ЛКМ — всплеск | K — урон игроку | P — пауза | F3/G/H — отладка", {
    x: 16, y: 64, size: 12, color: "#88ffcc",
});

// ===== [scheduler + scenes] Волны урона и поддержка популяции =====
// Таймеры обновляются ТОЛЬКО в update сцены game — на паузе замирают
const damageTimer = scheduler.every(2, () => {
    // Бьём случайного живого юнита (не игрока)
    const wanderers = world.queries.animated.entities;
    if (wanderers.length === 0) return;
    const victim = wanderers[Math.floor(Math.random() * wanderers.length)];
    audio.play("hit");
    health.damage(victim, 35);
});
scheduler.every(3, () => {
    if (world.entities.length < POPULATION + 1) spawnWanderer();
});
scheduler.every(1, () => {
    // Регенерация игрока, чтобы полоска «жила»
    if (health.get(playerId) > 0 && health.get(playerId) < UNIT_CONFIGS[2].maxHp) {
        health.heal(playerId, 5);
        audio.play("heal");
    }
});

// ===== Сцены: game и pause =====
scenes.add("game", {
    enter() {
        hud.removeText("pauseLabel");
        debug.info["Сцена"] = "game";
    },
    update(ticker) {
        // [scheduler] все таймеры крутятся только здесь
        scheduler.update(ticker.deltaMS);

        // [input + ECS] Игрок: оси с клавиатуры → скорость сущности
        const axis = input.axis();
        COMPONENTS.velocityX[playerId] = axis.x * PLAYER_SPEED;
        COMPONENTS.velocityY[playerId] = axis.y * PLAYER_SPEED;

        // [camera] зум колесом: вверх (deltaY<0) — приближаем, вниз — отдаляем
        if (input.pointer.wheel !== 0) camera.zoomBy(1 - input.pointer.wheel * 0.1);
        // [input + audio + fx + camera.screenToWorld] Клик — всплеск частиц в точке мира
        if (input.pointer.pressed) {
            const p = camera.screenToWorld(input.pointer.x, input.pointer.y);
            fx.burst(p.x, p.y, { count: 10, color: 0x66ccff, speedMin: 30, speedMax: 120 });
            audio.tone({ freq: 880, endFreq: 440, dur: 0.1, type: "triangle", volume: 0.12 });
        }
        // [health] K — урон игроку (полоска HUD обновится через get)
        if (input.wasPressed("KeyK")) {
            audio.play("hit");
            health.damage(playerId, 10);
        }
        // [scenes] P — пауза
        if (input.wasPressed("KeyP")) scenes.go("pause");

        // [debug] динамические строки оверлея
        debug.info["Счёт"] = score;
        debug.info["Юнитов"] = world.entities.length;

        input.endFrame(); // сброс однокадровых флагов В КОНЦЕ кадра
    },
});

scenes.add("pause", {
    enter() {
        hud.text("pauseLabel", "ПАУЗА", { x: app.screen.width / 2 - 50, y: app.screen.height / 2 - 20, size: 32, color: "#ffee66" });
        debug.info["Сцена"] = "pause";
    },
    update() {
        // Мир заморожен (scheduler не тикает), но выйти из паузы можно
        if (input.wasPressed("KeyP")) {
            scenes.go("game");
        }
        input.endFrame();
    },
    exit() {
        // позиция подписи паузы была по размерам экрана на момент входа — пересоздаётся при входе
    },
});

scenes.go("game");

// ===== Хендл для автотестов из консоли браузера =====
window.__TEST = {
    score: () => score,
    playerId,
    health,
    camera,
    scheduler,
    fx,
    audio,
    input,
    scenes,
    assets,
    spawnWanderer,
    setWorldBounds,
    renderer: () => app.renderer.name,
    unitsAlive: () => world.entities.length,
    damagePlayer: (n) => health.damage(playerId, n),
    damageRandom: (n = 35) => {
        const wanderers = world.queries.animated.entities;
        if (!wanderers.length) return null;
        const victim = wanderers[Math.floor(Math.random() * wanderers.length)];
        health.damage(victim, n);
        return victim;
    },
};
