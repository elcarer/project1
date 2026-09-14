// ВВОД — клавиатура и мышь как источник данных для игровых систем.
// Модуль только собирает состояние: isDown / wasPressed («нажато в этом кадре»).
// Системы читают его в игровом цикле — никакой игровой логики внутри.
//
// Пример:
//   const input = createInput({ addSystem });           // addSystem — из API движка
//   if (input.wasPressed('KeyP')) pauseGame();
//   const { x, y } = input.axis();                       // WASD + стрелки, нормализовано
//   if (input.pointer.pressed) shoot(input.pointer.x, input.pointer.y);
function createInput({ addSystem = null, target = window } = {}) {
    const down = new Set();     // коды, зажатые прямо сейчас (KeyboardEvent.code)
    const pressed = new Set();  // коды, нажатые в ЭТОМ кадре (сбрасывается в конце кадра)
    const pointer = {
        x: 0, y: 0,
        isDown: false,      // ЛКМ зажата
        pressed: false,     // ЛКМ нажата в этом кадре
        rightDown: false,
        rightPressed: false,
        wheel: 0,           // прокрутка за кадр (со знаком)
    };

    function onKeyDown(event) {
        if (!down.has(event.code)) pressed.add(event.code);
        down.add(event.code);
    }
    function onKeyUp(event) {
        down.delete(event.code);
    }
    function onPointerMove(event) {
        // Координаты относительно канваса PixiJS (он растянут на окно — совпадают с client)
        pointer.x = event.clientX;
        pointer.y = event.clientY;
    }
    function onPointerDown(event) {
        if (event.button === 0) { pointer.isDown = true; pointer.pressed = true; }
        if (event.button === 2) { pointer.rightDown = true; pointer.rightPressed = true; }
    }
    function onPointerUp(event) {
        if (event.button === 0) pointer.isDown = false;
        if (event.button === 2) pointer.rightDown = false;
    }
    function onWheel(event) {
        pointer.wheel += Math.sign(event.deltaY);
    }

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('wheel', onWheel, { passive: true });
    // Без contextmenu правая кнопка открывает меню браузера
    target.addEventListener('contextmenu', (e) => e.preventDefault());

    // Клавиша зажата?
    function isDown(code) { return down.has(code); }
    // Клавиша была нажата в этом кадре (одноразовые действия: пауза, прыжок, выстрел)
    function wasPressed(code) { return pressed.has(code); }
    // Оси движения с WASD и стрелок, нормализованы до длины 1 (диагональ не быстрее)
    function axis() {
        let x = 0, y = 0;
        if (isDown('KeyW') || isDown('ArrowUp')) y -= 1;
        if (isDown('KeyS') || isDown('ArrowDown')) y += 1;
        if (isDown('KeyA') || isDown('ArrowLeft')) x -= 1;
        if (isDown('KeyD') || isDown('ArrowRight')) x += 1;
        if (x !== 0 && y !== 0) {
            const inv = 1 / Math.SQRT2;
            x *= inv; y *= inv;
        }
        return { x, y };
    }
    // Сброс «однокадровых» флагов. Вызывается автоматически, если передан addSystem
    function endFrame() {
        pressed.clear();
        pointer.pressed = false;
        pointer.rightPressed = false;
        pointer.wheel = 0;
    }
    if (addSystem) addSystem(endFrame);

    function dispose() {
        target.removeEventListener('keydown', onKeyDown);
        target.removeEventListener('keyup', onKeyUp);
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerdown', onPointerDown);
        target.removeEventListener('pointerup', onPointerUp);
        target.removeEventListener('wheel', onWheel);
        down.clear(); pressed.clear();
    }

    return { isDown, wasPressed, axis, pointer, endFrame, dispose };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createInput = createInput;
