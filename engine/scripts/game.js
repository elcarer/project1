// ИГРОВАЯ ЛОГИКА
// Весь конкретный игровой контент живёт здесь: текстуры, конфигурации юнитов,
// состав и количество спавна. Движок (scripts/engine/engine.js) только вызывается.
import { UNIT_CONFIGS } from "./data/units.js";
import { init } from "./engine/engine.js";

// Запускаем движок (PixiJS, системы, игровой цикл)
const engine = await init();
const {
    app,
    spawnUnit,
    spawnAnimatedUnit,
    createTextureFromConfig,
    createProgrammaticSpritesheet,
    loadSpritesheetFromImage,
} = engine;

// --- Тип 0: пульсирующий серый юнит (4 кадра, запекаем в атлас на лету) ---
const rawGraphicsFrames = [];
for (let i = 0; i < 4; i++) {
    const graphic = new PIXI.Graphics()
        .circle(0, 0, i < 3 ? 8 + i : 13 - i) // Анимация пульсации (круг растет)
        .fill("grey")
    rawGraphicsFrames.push(graphic);
}
UNIT_CONFIGS[0].textures = createProgrammaticSpritesheet(rawGraphicsFrames, 32, 32);

// --- Тип 0 (статичный вариант): простая зелёная текстура для примера ---
const greenGraphic = new PIXI.Graphics().circle(0, 0, 8).fill("green").stroke({ width: 1.5, color: "green" });
const greenTexture = app.renderer.generateTexture(greenGraphic);

// --- Спавн: 100 статичных зелёных сущностей ---
for (let i = 0; i < 100; i++) {
    const startX = 50 + Math.random() * (app.screen.width - 100)
    const startY = 50 + Math.random() * (app.screen.height - 100)
    spawnUnit(0, startX, startY, greenTexture)
}

// --- Тип 1: пули из загруженного спрайтшита ---
const bulletTextures = await loadSpritesheetFromImage('./images/bullets/all.png', 32, 32);
if (bulletTextures) {
    UNIT_CONFIGS[1] = {
        ...UNIT_CONFIGS[0],       // Копируем базовые параметры
        textures: bulletTextures, // Кадры из изображения
        baseSpeed: 3,
        radius: 10,
        animationSpeed: 0.2,
        animationTime: 0
    };
    // 50 пуль
    for (let i = 0; i < 50; i++) {
        spawnAnimatedUnit(
            1,
            Math.random() * app.screen.width,
            Math.random() * app.screen.height
        );
    }
}

// --- Спавн: 100 анимированных пульсирующих юнитов (тип 0) ---
for (let i = 0; i < 100; i++) {
    spawnAnimatedUnit(
        0,
        Math.random() * app.screen.width,
        Math.random() * app.screen.height
    );
}
