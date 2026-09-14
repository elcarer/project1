// КОНТРОЛЛЕР ПЕРСОНАЖА — ECS-СИСТЕМА управления персонажем на карте.
// Управление: курсорные клавиши, WASD и джойстик (левый стик + крестовина).
//   • 4 направления; при двух зажатых СОСЕДНИХ — движение по диагонали с той же
//     скоростью (нормализация). Диагональных анимаций нет — играет строка
//     ПОСЛЕДНЕГО нажатого ещё удерживаемого направления (стек нажатий);
//   • «скольжение» вдоль препятствий: оси двигаются НЕЗАВИСИМО — если персонаж
//     идёт вправо и упёрся в стену, нажатое «вверх» везёт его вдоль неё;
//   • анимации: walk_front/back/left/right в движении; в покое персонаж
//     ЗАМИРАЕТ в кадре 0 walk-строки своего взгляда (спавн — walk_front[0],
//     взгляд вниз); после IDLE_WAIT_DELAY секунд бездействия wait играется
//     ОДИН раз и персонаж снова замирает в стоп-кадре;
//     play(id, name) — одиночные строки (attack_*, death, damage): блокируют
//     авто-выбор, по завершении система сама возвращается к движению.
//
// МЕТОДОЛОГИЯ ECS. Персонаж — обычная сущность: positionX/positionY + spriteMap
// ставит на экран ядро (renderSystem: синхронизация спрайта + culling), кадрами
// управляет ядро (animationSystem: группа "animated" по animationSpeed).
// Система добавляет свои компоненты поверх ядра:
//   ctrlSpeed/ctrlHalfW/ctrlHalfH (Float32) — скорость и коробка коллизии «ног»;
//   ctrlFacing/ctrlMove/ctrlLock (Uint8)    — взгляд, «идёт», блок однократной;
//   DATA.ctrlAnim (текущая строка) и DATA.ctrlAnims (таблица строк сущности).
// Персонаж НЕ входит в группу "movable": ядро интегрирует скорость с ОТСКОКОМ
// от границ мира, а персонажу нужно скольжение вдоль непроходимых клеток —
// перемещение считает эта система и пишет positionX/Y (дальше всё делает ядро).
//
// Пример:
//   const input = createCharacterInput();                       // клавиатура+джойстик
//   const chars = createCharacterSystem({ world, ECS, COMPONENTS, DATA, blocked, input });
//   const id = chars.spawn({ x, y, sprite, anims, speed: 150, fps: 8 });
//   chars.update(ticker);            // каждый кадр игровой сцены (на паузе — замирает)
//   chars.playAttack(id);            // Space: одиночная атака в сторону взгляда
// ВАЖНО (классический <script>): хелперы объявляются ВНУТРИ фабрик — верхний
// лексический уровень у всех скриптов страницы общий, и второй `const clamp`
// (например, как в camera.js) убил бы весь файл SyntaxError-ом.

const DIRS = ["up", "down", "left", "right"];
const DIR_INDEX = { up: 0, down: 1, left: 2, right: 3 };
// Направление → строка листа анимаций (стандартный набор 11 анимаций)
const DIR_WALK = { up: "walk_back", down: "walk_front", left: "walk_left", right: "walk_right" };
const DIR_ATTACK = { up: "attack_back", down: "attack_front", left: "attack_left", right: "attack_right" };
// Секунд бездействия до одиночного проигрывания wait (потом снова стоп-кадр)
const IDLE_WAIT_DELAY = 4;
// Мёртвая зона стика: бюджет дрожи ручки — не путать с нажатием
const PAD_DEADZONE = 0.4;
const KEY_DIRS = {
    ArrowUp: "up", KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
};

// ── УСТРОЙСТВО ВВОДА (клавиатура + джойстик) ────────────────────────────────
// Синглтон-устройство, не компонент: физические кнопки общие для всех персонажей
// локальной игры. даёт вектор осей и «взгляд» (последнее нажатое направление).
function createCharacterInput({ target = window } = {}) {
    // Зажатые КОДЫ по направлениям: W и ArrowUp держат «up» вместе — направление
    // отпускается только когда отпущены ВСЕ его клавиши
    const held = { up: new Set(), down: new Set(), left: new Set(), right: new Set() };
    // Активность направлений джойстика (крестовина/стик), заполняет pollPad
    const padActive = { up: false, down: false, left: false, right: false };
    // Стек нажатий: наверху — последнее нажатое ещё удерживаемое направление
    const stack = [];
    let lastDir = "down"; // взгляд живёт и после отпускания всего

    function press(dir) {
        const i = stack.indexOf(dir);
        if (i !== -1) stack.splice(i, 1); // перенаверх при повторном нажатии
        stack.push(dir);
    }
    function release(dir) {
        // Направление уходит из стека, только если его больше никто не держит
        if (held[dir].size || padActive[dir]) return;
        const i = stack.indexOf(dir);
        if (i !== -1) stack.splice(i, 1);
    }
    function onKeyDown(event) {
        const dir = KEY_DIRS[event.code];
        if (!dir || event.repeat) return;
        const first = held[dir].size === 0;
        held[dir].add(event.code);
        if (first) press(dir); // вторая клавиша того же направления взгляд не меняет
    }
    function onKeyUp(event) {
        const dir = KEY_DIRS[event.code];
        if (!dir) return;
        held[dir].delete(event.code);
        release(dir);
    }
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);

    let padSeen = false; // ручка была подключена — при исчезновении отпустить её направления
    function poll() {
        // ── джойстик (опрашивается раз в кадр) ──
        if (typeof navigator !== "undefined" && navigator.getGamepads) {
            let pad = null;
            for (const p of navigator.getGamepads()) { if (p && p.connected) { pad = p; break; } }
            if (!pad) {
                if (padSeen) {
                    padSeen = false;
                    for (const dir of DIRS) { padActive[dir] = false; release(dir); }
                }
            } else {
                padSeen = true;
                const ax = Math.abs(pad.axes[0]) > PAD_DEADZONE ? pad.axes[0] : 0;
                const ay = Math.abs(pad.axes[1]) > PAD_DEADZONE ? pad.axes[1] : 0;
                const btn = (i) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
                const want = {
                    left: ax < 0 || btn(14), right: ax > 0 || btn(15),
                    up: ay < 0 || btn(12), down: ay > 0 || btn(13),
                };
                // Диагональ стика «нажимает» оба направления разом: первым в стек
                // идёт ДОМИНИРУЮЩАЯ ось — её анимация и сыграет (аналог нажатия)
                const order = Math.abs(ay) >= Math.abs(ax)
                    ? ["up", "down", "left", "right"]
                    : ["left", "right", "up", "down"];
                for (const dir of order) {
                    if (want[dir] && !padActive[dir]) {
                        padActive[dir] = true;
                        if (!held[dir].size) press(dir); // клавиши по этому направлению главнее
                    } else if (!want[dir] && padActive[dir]) {
                        padActive[dir] = false;
                        release(dir);
                    }
                }
            }
        }
        // ── итоговые оси: клавиши ∪ джойстик ──
        this.ix = 0; this.iy = 0;
        if (held.left.size || padActive.left) this.ix -= 1;
        if (held.right.size || padActive.right) this.ix += 1;
        if (held.up.size || padActive.up) this.iy -= 1;
        if (held.down.size || padActive.down) this.iy += 1;
        if (stack.length) lastDir = stack[stack.length - 1];
    }

    function dispose() {
        target.removeEventListener("keydown", onKeyDown);
        target.removeEventListener("keyup", onKeyUp);
    }

    return {
        poll, dispose,
        ix: 0, iy: 0,
        get dir() { return stack.length ? stack[stack.length - 1] : lastDir; },
    };
}

// ── СИСТЕМА ПЕРСОНАЖЕЙ ──────────────────────────────────────────────────────
// blocked(px, py) => true — точка мира (пиксели) непроходима: клетки объектов,
// вода, границы карты. Скорость в ПИКСЕЛЯХ В СЕКУНДУ (как у камеры — от deltaMS).
function createCharacterSystem({ world, ECS, COMPONENTS, DATA, blocked, input, addSystem = null }) {
    if (!blocked || !input) throw new Error("createCharacterSystem: нужны blocked и input");
    // Ограничение значения диапазоном (локально — см. памятку про <script> выше)
    const clamp = (value, min, max) => (value < min ? min : (value > max ? max : value));
    // Свои компоненты поверх ядра (повторная регистрация идемпотентна)
    ECS.registerComponent("ctrlSpeed", Float32Array);
    ECS.registerComponent("ctrlHalfW", Float32Array);
    ECS.registerComponent("ctrlHalfH", Float32Array);
    ECS.registerComponent("ctrlFacing", Uint8Array);
    ECS.registerComponent("ctrlMove", Uint8Array);
    ECS.registerComponent("ctrlLock", Uint8Array);
    ECS.registerComponent("ctrlIdleT", Float32Array); // сек бездействия (до одиночного wait)
    ECS.registerComponent("ctrlAnim", Array);  // DATA: имя текущей строки анимаций
    ECS.registerComponent("ctrlAnims", Array); // DATA: { wait, walk_front, … } сущности
    // Персонаж = позиция + спрайт + параметры движения (без velocityX/Y: ядро
    // интегрирует скорость с отскоком, персонажу нужно скольжение вдоль клеток)
    ECS.createQuery(world, "characters",
        ["positionX", "positionY", "spriteMap", "ctrlSpeed", "ctrlHalfW", "ctrlHalfH"]);

    // Коллизия — маленький AABB «ног» (уже тайла 32px). По оси движения
    // проверяется ТОЛЬКО его переднее ребро (3 точки): персонаж останавливается
    // вплотную к препятствию и при зажатой второй оси свободно скользит вдоль
    // стены. (Круг с диагональными пробами здесь не годится: он останавливает
    // персонажа «не доезжая» до стены, и его край навсегда цепляет угол клетки.)
    function edgeBlockedX(nx, cy, dirX, hw, hh) {
        const lead = nx + (dirX > 0 ? hw : -hw);
        return blocked(lead, cy - hh) || blocked(lead, cy) || blocked(lead, cy + hh);
    }
    function edgeBlockedY(cx, ny, dirY, hw, hh) {
        const lead = ny + (dirY > 0 ? hh : -hh);
        return blocked(cx - hw, lead) || blocked(cx, lead) || blocked(cx + hw, lead);
    }

    // ── ФАБРИКА ПЕРСОНАЖА ───────────────────────────────────────────────────
    // sprite — PIXI.AnimatedSprite из кадров сущности (anchor ставит вызывающий:
    // обычно (0.5, 1) — позиция сущности = точка ног). anims — { имя: [текстуры] }.
    function spawn({ x = 0, y = 0, sprite, anims, speed = 140, halfW = 7, halfH = 5, fps = 8 }) {
        if (!sprite || !anims) throw new Error("characters.spawn: нужны sprite и anims");
        const id = ECS.addEntity(world);
        ECS.addComponent(world, id, "positionX", x);
        ECS.addComponent(world, id, "positionY", y);
        ECS.addComponent(world, id, "spriteMap", sprite); // renderSystem: спрайт на экране
        ECS.addComponent(world, id, "animationSpeed", fps / 60); // animated: кадры крутит ядро
        ECS.addComponent(world, id, "ctrlSpeed", speed);
        ECS.addComponent(world, id, "ctrlHalfW", halfW);
        ECS.addComponent(world, id, "ctrlHalfH", halfH);
        ECS.addComponent(world, id, "ctrlFacing", DIR_INDEX[input.dir] ?? DIR_INDEX.down);
        ECS.addComponent(world, id, "ctrlMove", 0);
        ECS.addComponent(world, id, "ctrlLock", 0);
        ECS.addComponent(world, id, "ctrlIdleT", 0);
        DATA.ctrlAnim[id] = DIR_WALK.down;
        DATA.ctrlAnims[id] = anims;
        // autoUpdate=false: кадрами управляет animationSystem ядра в общем цикле
        sprite.autoUpdate = false;
        // Появление: стоп-кадр move front 0 — стоит, смотрит вниз
        sprite.textures = anims[DIR_WALK.down] ?? anims.wait;
        sprite.loop = false;
        sprite.gotoAndStop(0);
        // Однократная анимация доиграла — снять блок, система вернёт ходьбу/стоп-кадр
        sprite.onComplete = () => { if (world.active[id]) COMPONENTS.ctrlLock[id] = 0; };
        return id;
    }

    function remove(id) {
        const sprite = DATA.spriteMap[id];
        if (sprite) sprite.onComplete = null;
        ECS.removeEntity(world, id);
    }

    // ── АНИМАЦИИ ────────────────────────────────────────────────────────────
    function setAnim(id, name) {
        if (DATA.ctrlAnim[id] === name) return;
        DATA.ctrlAnim[id] = name;
        const sprite = DATA.spriteMap[id];
        const frames = DATA.ctrlAnims[id] && DATA.ctrlAnims[id][name];
        if (!sprite || !frames) return;
        sprite.textures = frames;
        sprite.loop = true;
        sprite.gotoAndPlay(0);
    }
    // Стоп-кадр: персонаж стоит в кадре 0 walk-строки своего взгляда
    // (не играет; повторный вызов для той же строки — без изменений)
    function freezePose(id, name) {
        if (DATA.ctrlAnim[id] === name && !DATA.spriteMap[id]?.playing) return;
        const sprite = DATA.spriteMap[id];
        const frames = DATA.ctrlAnims[id] && DATA.ctrlAnims[id][name];
        if (!sprite || !frames) return;
        DATA.ctrlAnim[id] = name;
        sprite.textures = frames;
        sprite.loop = false;
        sprite.gotoAndStop(0);
    }
    // Однократная (attack_*, death, damage): прокручивается до конца, затем
    // система сама вернётся к walk/wait. Пока идёт — движение анимацию не
    // перебивает (персонаж при этом физически двигаться может).
    function play(id, name) {
        const frames = DATA.ctrlAnims[id] && DATA.ctrlAnims[id][name];
        if (!frames) return false;
        DATA.ctrlAnim[id] = name;
        COMPONENTS.ctrlLock[id] = 1;
        const sprite = DATA.spriteMap[id];
        sprite.textures = frames;
        sprite.loop = false;
        sprite.gotoAndPlay(0);
        return true;
    }
    function playAttack(id) {
        return play(id, DIR_ATTACK[DIRS[COMPONENTS.ctrlFacing[id]] ?? "down"]);
    }
    function facingName(id) { return DIRS[COMPONENTS.ctrlFacing[id]] ?? "down"; }

    // ── КАДР СИСТЕМЫ: ввод → перемещение с коллизиями → анимация ───────────
    // Ввод — общее устройство на всех персонажей локальной игры; состояние
    // каждого персонажа живёт в его компонентах.
    function update(ticker) {
        input.poll();
        const dt = clamp((ticker && ticker.deltaMS) || 1000 / 60, 0, 50) / 1000;
        const ix = input.ix, iy = input.iy;
        const moving = ix !== 0 || iy !== 0;
        const face = input.dir;
        const entities = world.queries.characters.entities;
        for (let k = entities.length - 1; k >= 0; k--) {
            const id = entities[k];
            if (moving) {
                // СКОЛЬЖЕНИЕ: оси пробуются независимо. Упёрлись в стену по X —
                // Y всё равно тащит персонажа вдоль препятствия (и наоборот).
                const norm = ix !== 0 && iy !== 0 ? Math.SQRT1_2 : 1;
                const step = COMPONENTS.ctrlSpeed[id] * dt * norm;
                const hw = COMPONENTS.ctrlHalfW[id], hh = COMPONENTS.ctrlHalfH[id];
                const px = COMPONENTS.positionX[id], py = COMPONENTS.positionY[id];
                if (ix !== 0) { const tx = px + ix * step; if (!edgeBlockedX(tx, py, ix, hw, hh)) COMPONENTS.positionX[id] = tx; }
                if (iy !== 0) { const ty = py + iy * step; if (!edgeBlockedY(px, ty, iy, hw, hh)) COMPONENTS.positionY[id] = ty; }
            }
            COMPONENTS.ctrlMove[id] = moving ? 1 : 0;
            COMPONENTS.ctrlFacing[id] = DIR_INDEX[face] ?? 1;
            if (!COMPONENTS.ctrlLock[id]) {
                if (moving) {
                    COMPONENTS.ctrlIdleT[id] = 0;
                    setAnim(id, DIR_WALK[face]);
                } else {
                    // Покой: замереть в стоп-кадре walk-строки взгляда; спустя
                    // IDLE_WAIT_DELAY секунд бездействия wait играется ОДИН раз
                    // (доиграет → ctrlLock снимется, персонаж снова замрёт)
                    COMPONENTS.ctrlIdleT[id] += dt;
                    if (COMPONENTS.ctrlIdleT[id] >= IDLE_WAIT_DELAY) {
                        COMPONENTS.ctrlIdleT[id] = 0;
                        play(id, "wait");
                    } else {
                        freezePose(id, DIR_WALK[face]);
                    }
                }
            }
            // y-сортировка среди объектов карты (контейнер со sortableChildren)
            const sprite = DATA.spriteMap[id];
            if (sprite) sprite.zIndex = COMPONENTS.positionY[id];
        }
    }
    if (addSystem) addSystem(update);

    return { spawn, remove, update, play, playAttack, facingName };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createCharacterInput = createCharacterInput;
globalThis.createCharacterSystem = createCharacterSystem;
