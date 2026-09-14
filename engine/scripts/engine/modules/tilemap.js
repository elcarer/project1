// ПОТОКОВЫЙ СЛОЙ ПОЛА — держит в живых только ВИДИМЫЕ тайлы карты.
// Карта целиком в игру не грузится: тайл существует, только пока его угол (i, j)
// в окне камеры. Каждый тайл — полноценная сущность ECS (positionX/positionY/
// spriteMap): на место его ставит и вне вида скрывает renderSystem ядра, как и
// у юнитов. Пул растёт лишь до размера видимого окна (плюс запас); когда камера
// уходит, сущность «паркуется»: снятие positionX выводит её из группы renderable,
// ядро перестаёт её трогать, спрайт гаснет. Паркованных сущностей в кадре нет.
//
// Один тайл на угол: многослойный пол редактора запекается в один слой ДО этой
// системы (в игре — «запекание слоя пола» в game.js: верхний непустой тайл
// угла, всё под ним отбрасывается).
//
// Пример:
//   const tiles = createTilemapSystem({
//       world, ECS, DATA, addSystem,
//       container: tilesHolder, Sprite: PIXI.Sprite,
//       getView: () => ({ left, top, right, bottom }), // вид камеры, px мира
//       mapW: W, mapH: H, ts: 32, margin: 2,
//       tileAt: (i, j) => cornerTexture(i, j),         // текстура угла или null
//   });
//   tiles.stats(); // { tiles, parked, window } — для отладки
function createTilemapSystem({
    world, ECS, DATA, addSystem = null,
    container,           // контейнер сцены для спрайтов тайлов (ниже объектов)
    Sprite,              // класс спрайта (в Node-тестах — своя заглушка)
    getView,             // () => {left, top, right, bottom} — вид камеры, px мира
    mapW, mapH,          // размер карты в тайлах
    ts = 32,             // размер тайла, px
    margin = 2,          // запас окна в тайлах (не мигать при движении камеры)
    tileAt,              // (i, j) => текстура тайла угла (i, j) | null — не рисовать
    maxTiles = 60000,    // предохранитель пула (при сильном отдалении)
}) {
    if (!container || !Sprite || !getView || !tileAt) {
        throw new Error("createTilemapSystem: нужны container, Sprite, getView и tileAt");
    }
    const slots = [];  // активные сущности-тайлы; порядок слотов = порядок отрисовки
    const parked = []; // припаркованные сущности — ждут возврата камеры
    let win = null;    // окно (в углах карты), под которое назначены текущие слоты

    // Новый тайл = новая сущность ECS. Спрайт навсегда остаётся в контейнере —
    // при ходьбе переиспользуется сменой текстуры, новых спрайтов не создаётся.
    function spawnSlot() {
        const id = ECS.addEntity(world);
        if (id === null || id === undefined) return null; // шкала сущностей исчерпана
        const sprite = new Sprite();
        sprite.visible = false;
        container.addChild(sprite);
        ECS.addComponent(world, id, "spriteMap", sprite);
        return id;
    }

    // Парковка: снимаем ТОЛЬКО positionX — сущность выпадает из группы renderable,
    // и ядро перестаёт задавать спрайту видимость. Спрайт остаётся своим и не идёт
    // в пул ядра: тот привязан к configId юнитов и перемешал бы текстуры.
    function park(id) {
        ECS.removeComponent(world, id, "positionX");
        const sprite = DATA.spriteMap[id];
        if (sprite) sprite.visible = false;
        return id;
    }

    // Окно камеры → переназначение тайлов пулу. O(видимых тайлов); вызывается
    // только когда камера пересекла границу тайла или сменился зум.
    function rebuild() {
        const v = getView();
        const i0 = Math.max(0, Math.floor(v.left / ts) - margin);
        const j0 = Math.max(0, Math.floor(v.top / ts) - margin);
        const i1 = Math.min(mapW, Math.ceil(v.right / ts) + margin);
        const j1 = Math.min(mapH, Math.ceil(v.bottom / ts) + margin);
        if (win && win.i0 === i0 && win.j0 === j0 && win.i1 === i1 && win.j1 === j1) return;
        win = { i0, j0, i1, j1 };

        let k = 0;
        outer:
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                if (k >= maxTiles) break outer;
                const texture = tileAt(i, j);
                if (!texture) continue;
                let id = slots[k];
                if (id === undefined) {
                    id = parked.pop();
                    if (id === undefined) {
                        id = spawnSlot();
                        if (id === null) break outer;
                    }
                    slots.push(id);
                }
                ECS.addComponent(world, id, "positionX", i * ts);
                ECS.addComponent(world, id, "positionY", j * ts);
                const sprite = DATA.spriteMap[id];
                sprite.texture = texture;
                // Позиция и видимость на спрайт — СРАЗУ: ядро переносит компоненты
                // на спрайты в renderSystem, который отрабатывает ДО систем
                // модулей. Если ждать следующего кадра, одну фазу тайлы
                // отрисовываются на старом месте (призрачная вода на клетку
                // выше/ниже при движении) или с погашенной видимостью (дырки).
                sprite.position.set(i * ts, j * ts);
                sprite.visible = true;
                k++;
            }
        }
        // Хвост окна уехал за камеру: паркуем с конца, сущности ждут в parked
        while (slots.length > k) parked.push(park(slots.pop()));
    }

    if (addSystem) addSystem(() => rebuild());
    return {
        rebuild,
        stats: () => ({ tiles: slots.length, parked: parked.length, window: win }),
    };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобаль (работает и на file://);
//   2) import "./tilemap.js" — глобаль ставится как побочный эффект.
globalThis.createTilemapSystem = createTilemapSystem;
