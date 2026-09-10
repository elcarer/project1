// HUD — интерфейс поверх мира: полоски здоровья, счёт, подсказки.
// Живёт в СВОЁМ контейнере прямо в app.stage (поверх worldContainer), поэтому
// камера его не двигает и не масштабирует. Полоски с опцией get обновляются сами.
//
// Пример:
//   const hud = createHUD({ app, addSystem });
//   hud.bar("playerHp", { x: 16, y: 16, width: 200, get: () => health.ratio(playerId) });
//   hud.text("score", "Счёт: 0", { x: 16, y: 32, size: 18 });
//   hud.setText("score", `Счёт: ${score}`);
function createHUD({ app, addSystem = null } = {}) {
    // Добавляется последним в stage — значит рисуется поверх мира
    const container = new PIXI.Container();
    app.stage.addChild(container);

    const bars = new Map();
    const texts = new Map();

    // Полоска (HP, перезарядка, прогресс). get — функция 0..1 для автообновления.
    // Возвращает управление: { set(ratio), position(x, y), remove() }
    function bar(name, { x = 0, y = 0, width = 100, height = 10, color = 0x44dd44, back = 0x222222, border = 0x000000, get = null } = {}) {
        removeBar(name);
        const bg = new PIXI.Graphics();
        const fill = new PIXI.Graphics();
        container.addChild(bg, fill);
        const entry = { x, y, width, height, color, back, border, get, ratio: 1, bg, fill };
        bars.set(name, entry);
        redrawBar(entry);
        return {
            set: (ratio) => { entry.ratio = Math.max(0, Math.min(1, ratio)); redrawBar(entry); },
            position: (nx, ny) => { entry.x = nx; entry.y = ny; redrawBar(entry); },
            remove: () => removeBar(name),
        };
    }

    function redrawBar(entry) {
        // Тонкая рамка + тёмный фон + цветная заливка по ratio
        entry.bg.clear()
            .rect(entry.x - 1, entry.y - 1, entry.width + 2, entry.height + 2)
            .fill(entry.border)
            .rect(entry.x, entry.y, entry.width, entry.height)
            .fill(entry.back);
        entry.fill.clear()
            .rect(entry.x, entry.y, Math.max(0, entry.width * entry.ratio), entry.height)
            .fill(entry.color);
    }

    function removeBar(name) {
        const entry = bars.get(name);
        if (!entry) return;
        container.removeChild(entry.bg, entry.fill);
        entry.bg.destroy(); entry.fill.destroy();
        bars.delete(name);
    }

    // Текстовая метка. Возвращает PIXI.Text — можно менять .text напрямую,
    // либо через setText(name, str)
    function text(name, str, { x = 0, y = 0, size = 16, color = "#ffffff", fontFamily = "monospace", align = "left" } = {}) {
        removeText(name);
        const label = new PIXI.Text({
            text: str,
            style: { fontFamily, fontSize: size, fill: color },
        });
        label.x = x; label.y = y;
        label.resolution = 2; // чётче на HiDPI
        container.addChild(label);
        texts.set(name, label);
        return label;
    }

    function setText(name, str) {
        const label = texts.get(name);
        if (label) label.text = str;
    }

    function removeText(name) {
        const label = texts.get(name);
        if (!label) return;
        container.removeChild(label);
        label.destroy();
        texts.delete(name);
    }

    // Автообновление полосок с опцией get (каждый кадр, после систем ядра)
    function update() {
        for (const entry of bars.values()) {
            if (!entry.get) continue;
            const ratio = Math.max(0, Math.min(1, entry.get()));
            if (ratio !== entry.ratio) {
                entry.ratio = ratio;
                redrawBar(entry);
            }
        }
    }
    if (addSystem) addSystem(update);

    function clear() {
        for (const name of [...bars.keys()]) removeBar(name);
        for (const name of [...texts.keys()]) removeText(name);
    }

    return { container, bar, text, setText, removeBar, removeText, update, clear };
}

export { createHUD };
