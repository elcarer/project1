// ОТЛАДКА — оверлей статистики + визуализация коллизий.
// Показывает FPS, число сущностей, пулы и любые пары из debug.info (игра кладёт
// туда например имя сцены или счёт). F3 переключает оверлей, G — сетку, H — хитбоксы.
//
// Пример:
//   const debug = createDebug({ app, addSystem, world, grid, components: engine.COMPONENTS });
//   debug.info["Сцена"] = scenes.current;
function createDebug({ app, addSystem = null, world = null, grid = null, components = null, layer = null, overlayPos = { x: 10, y: 10 }, hotkeys = true } = {}) {
    const state = {
        visible: true,
        showGrid: false,
        showHitboxes: false,
    };
    const info = {}; // игра может дописывать свои строки: info["Счёт"] = score

    // Оверлей статистики: обновляем текст 4 раза в секунду, не каждый кадр
    // (шрифт — игровой, game_font.js; фабрика вызывается после loadGameFont)
    const overlay = new PIXI.Text({
        text: "",
        style: { fontFamily: globalThis.GAME_FONT || "monospace", fontSize: 24, fill: "#00ff88", lineHeight: 32 },
    });
    overlay.x = overlayPos.x; overlay.y = overlayPos.y;
    overlay.resolution = 2;
    app.stage.addChild(overlay);
    let overlayTimer = 0;

    // Графика визуализации — в контейнере МИРА (layer), чтобы сетка и хитбоксы
    // двигались вместе с камерой и совпадали с объектами
    const visual = new PIXI.Graphics();
    (layer || app.stage).addChild(visual);

    function formatStats(ticker) {
        const lines = [
            `FPS: ${ticker.FPS.toFixed(0)}  (deltaMS: ${ticker.deltaMS.toFixed(1)})`,
        ];
        if (world) lines.push(`Сущности: ${world.entities.length}`);
        if (grid) lines.push(`Ячеек сетки: ${grid.cells.size}`);
        for (const key in info) lines.push(`${key}: ${info[key]}`);
        lines.push(`[F3] оверлей  [G] сетка  [H] хитбоксы`);
        return lines.join("\n");
    }

    function update(ticker) {
        // Текст — 4 раза в секунду (toFixed и конкатенация каждый кадр не нужны)
        overlayTimer -= ticker.deltaMS;
        if (overlayTimer <= 0) {
            overlayTimer = 250;
            if (state.visible) overlay.text = formatStats(ticker);
        }
        if (state.showGrid || state.showHitboxes) drawVisual();
        else visual.clear();
    }
    if (addSystem) addSystem(update);

    function drawVisual() {
        visual.clear();
        if (state.showGrid && grid) {
            // Рисуем только занятые ячейки сетки коллизий
            for (const [cellId, entities] of grid.cells) {
                if (entities.length === 0) continue;
                const coords = grid.getCellCoords(cellId);
                const s = grid.cellSize;
                visual.rect(coords.col * s, coords.row * s, s, s).stroke({ width: 1, color: 0x0044ff, alpha: 0.5 });
            }
        }
        if (state.showHitboxes && components && world) {
            // Круги радиуса коллизии вокруг всех физических сущностей
            for (let i = 0; i < world.entities.length; i++) {
                const id = world.entities[i];
                const r = components.radius[id];
                if (!r) continue;
                visual.circle(components.positionX[id], components.positionY[id], r)
                    .stroke({ width: 1, color: 0xff4444, alpha: 0.9 });
            }
        }
    }

    function toggleOverlay() { state.visible = !state.visible; overlay.visible = state.visible; }
    function toggleGrid() { state.showGrid = !state.showGrid; }
    function toggleHitboxes() { state.showHitboxes = !state.showHitboxes; }

    if (hotkeys) {
        window.addEventListener("keydown", (event) => {
            if (event.code === "F3") { event.preventDefault(); toggleOverlay(); }
            if (event.code === "KeyG") toggleGrid();
            if (event.code === "KeyH") toggleHitboxes();
        });
    }

    return { state, info, toggleOverlay, toggleGrid, toggleHitboxes, update };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createDebug = createDebug;
