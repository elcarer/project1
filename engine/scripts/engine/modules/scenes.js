// СЦЕНЫ — конечный автомат игровых состояний: меню / игра / пауза / конец игры.
// Сцена — просто три хука: enter (вход), exit (выход), update (каждый кадр).
// Никакой магии с системами ядра: заморозка геймплея = сцена паузы просто
// не спавнит и не наносит урон. Что показывать — решает игровая логика.
//
// Пример:
//   const scenes = createScenes({ addSystem });
//   scenes.add("game", { enter: startWave, update: tickGame });
//   scenes.add("pause", { enter: () => hud.setText("state", "ПАУЗА") });
//   if (input.wasPressed("KeyP")) scenes.go(scenes.is("pause") ? "game" : "pause");
function createScenes({ addSystem = null, onUpdateError = null } = {}) {
    const registry = new Map();
    let currentName = null;

    function add(name, hooks = {}) {
        registry.set(name, hooks);
    }

    // Переключение сцены: старая получает exit, новая — enter(payload).
    // Переключение внутри enter разрешено (enter следующей сцены отработает корректно)
    function go(name, payload = null) {
        if (name === currentName) return false;
        const next = registry.get(name);
        if (!next) {
            console.warn(`Сцена "${name}" не зарегистрирована!`);
            return false;
        }
        const prev = registry.get(currentName);
        currentName = name;
        try {
            if (prev && prev.exit) prev.exit();
        } catch (error) {
            console.error(`Ошибка exit сцены "${currentName}":`, error);
        }
        try {
            if (next.enter) next.enter(payload);
        } catch (error) {
            console.error(`Ошибка enter сцены "${name}":`, error);
        }
        return true;
    }

    function is(name) { return currentName === name; }

    // Обновление текущей сцены — регистрируется в цикле движка, если передан addSystem.
    // Пока сцена не выбрана (или без update), ничего не происходит
    function update(ticker) {
        if (!currentName) return;
        const scene = registry.get(currentName);
        if (scene && scene.update) {
            try {
                scene.update(ticker);
            } catch (error) {
                if (onUpdateError) onUpdateError(error, currentName);
                else console.error(`Ошибка update сцены "${currentName}":`, error);
            }
        }
    }
    if (addSystem) addSystem(update);

    return { add, go, is, update, get current() { return currentName; } };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createScenes = createScenes;
