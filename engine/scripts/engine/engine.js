import { UNIT_CONFIGS, UNITS_EVENTS } from "../data/units.js";
import { EventSystem } from "./eventSystem.js";
// Единая шина событий движка: спавн/урон/смерть сущностей и т.д.
// Модули и игровая логика подписываются через events.on(...), ядро — генерирует
const events = EventSystem;
// 1. ====== ECS ДВИЖОК ======
// Файл содержит ТОЛЬКО переиспользуемое ядро: ECS, хранилища данных, системы и
// фабрики спавна. Конкретные объекты (текстуры, конфиги юнитов, состав спавна)
// находятся в игровой логике — scripts/game.js
const ECS = {
    nextId: 0,
    createWorld: () => ({
        entities: [],
        freeIds: [],
        active: new Uint16Array(100000),
        masks: new Uint32Array(100000),
        // Сюда системы будут регистрировать свои группы
        queries: {} }),
    // defineComponent — это просто функция, возвращающая типизированный массив на 100 000 сущностей
    defineComponent: (type = Float32Array, length = 100000) => {
        switch (type) {
                // Целые числа без знака (только положительные) Uint8Array — 8-битное беззнаковое число (диапазон от 0 до 255). Часто используется для работы с байтами и изображениями.
                //Uint16Array — 16-битное беззнаковое число (диапазон от 0 до 65 535).
                //Uint32Array — 32-битное беззнаковое число (диапазон от 0 до 4 294 967 295).
            case Uint8Array: return new Uint8Array(length)
            case Uint16Array: return new Uint16Array(length)
            case Uint32Array: return new Uint32Array(length)
            case Int32Array: return new Int32Array(length)
                // Числа с плавающей точкой: Float32Array — 32-битное число с плавающей точкой (максимальное нормальное значение: ≈ 3.40 × 10³⁸ ).
            case Float32Array: return new Float32Array(length)
            default:
                // Неизвестный тип — работаем как с обычными числами с плавающей точкой
                console.warn(`Неизвестный тип компонента: ${type.name}. Используется Float32Array.`);
                return new Float32Array(length)
        }
    },
    addEntity: (world) => {
        let nextId;
        if (world.freeIds.length > 0) {
            nextId = world.freeIds.pop();
        } else {
            if (ECS.nextId >= world.active.length) {
                console.log('Превышен лимит сущностей!');
                return null;
            }
            nextId = ECS.nextId++;
        }
        world.active[nextId] = 1;
        world.entities.push(nextId);
        return nextId;
    },
    removeEntity: (world, id, container) => {
        if (!world.active[id]) return;
        world.active[id] = 0;
        world.freeIds.push(id);
        // Порядок сущностей в world.entities системам не важен, поэтому
        // удаляем через swap-and-pop (O(1)) вместо splice (O(n))
        const index = world.entities.indexOf(id);
        if (index !== -1) {
            const lastId = world.entities.pop();
            if (index < world.entities.length) {
                world.entities[index] = lastId;
            }
        }
        // Вместо долгого перебора всех массивов, мы смотрим на маску сущности
        // и удаляем только те компоненты, которые у неё РЕАЛЬНО были
        for (const componentName in COMPONENT_MASKS) {
            ECS.removeComponent(world, id, componentName, container);
        }
        world.masks[id] = 0; // Сбрасываем маску в ноль
    },
    addComponent: (world, id, componentName, initialValue = 0) => {
        // Проверяем, существует ли вообще такой компонент в нашей базе масок
        const mask = COMPONENT_MASKS[componentName];
        if (!mask) {
            console.warn(`Компонент ${componentName} не зарегистрирован в COMPONENT_MASKS!`);
            return;
        }
        // Включаем бит компонента с помощью побитового ИЛИ (|=)
        world.masks[id] |= mask;
        // Если это обычный SoA компонент (типизированный массив) — инициализируем его числом
        if (COMPONENTS[componentName]) {
            COMPONENTS[componentName][id] = initialValue;
        }
        // Если это массив объектов (например, DATA.spriteMap) — инициализируем null/объектом
        else if (DATA[componentName]) {
            DATA[componentName][id] = initialValue;
        }
        // ТРИГГЕР: маска изменилась, проверяем группы!
        ECS.updateQueries(world, id);
    },
    removeComponent: (world, id, componentName, container = null) => {
        const mask = COMPONENT_MASKS[componentName];
        if (!mask || (world.masks[id] & mask) === 0) return;
        world.masks[id] &= ~mask;
        if (COMPONENTS[componentName]) {
            COMPONENTS[componentName][id] = 0;
        } else if (DATA[componentName]) {
            if (componentName === "spriteMap" && DATA.spriteMap[id]) {
                const sprite = DATA.spriteMap[id];
                const configIndex = COMPONENTS.configId[id];
                // AnimatedSprite отличается от обычного Sprite наличием массива textures
                const isAnimated = Array.isArray(sprite.textures);
                if (isAnimated) sprite.gotoAndStop(0);
                sprite.visible = false;
                // Возвращаем спрайт в пул своего типа (статические и анимированные — раздельно,
                // чтобы не перепутать Sprite и AnimatedSprite при переиспользовании)
                const pools = isAnimated ? ANIMATED_SPRITE_POOLS : STATIC_SPRITE_POOLS;
                if (!pools[configIndex]) pools[configIndex] = [];
                pools[configIndex].push(sprite);
            }
            DATA[componentName][id] = undefined;
        }
        ECS.updateQueries(world, id);
    },
    // Динамическая регистрация НОВОГО компонента (нужна модулям, чтобы добавлять
    // свои данные, не трогая ядро). type — типизированный массив для SoA-чисел
    // (Float32Array и т.д.) или Array для ссылочных данных. Возвращает маску.
    registerComponent: (name, type = Float32Array, length = 100000) => {
        // Повторная регистрация того же имени — идемпотентна
        if (COMPONENT_MASKS[name]) return COMPONENT_MASKS[name];
        // Ищем свободный бит: всего 32 (Uint32Array-маска), часть занята ядром
        for (let bit = 1; bit <= 2147483648; bit <<= 1) {
            let used = false;
            for (const existing in COMPONENT_MASKS) {
                if (COMPONENT_MASKS[existing] & bit) { used = true; break; }
            }
            if (!used) { COMPONENT_MASKS[name] = bit; break; }
        }
        if (!COMPONENT_MASKS[name]) {
            console.warn(`Не хватило 32 бит для компонента "${name}"! Компонент не зарегистрирован.`);
            return null;
        }
        if (type === Array) {
            DATA[name] = new Array(length);
        } else {
            COMPONENTS[name] = ECS.defineComponent(type, length);
        }
        return COMPONENT_MASKS[name];
    },
    //  Создает и регистрирует группу для систем
    //  @param {Object} world
    //  @param {string} queryName - Уникальное имя (например, 'movable')
    //  @param {Array<string>} componentNames - Список обязательных компонентов
    createQuery: (world, queryName, componentNames) => {
        // Собираем общую маску из массива названий компонентов
        let bits = 0;
        for (const name of componentNames) {
            bits |= COMPONENT_MASKS[name];
        }
        // Инициализируем пустую структуру для запроса
        world.queries[queryName] = {
            mask: bits,
            entities: [] // Сюда будут попадать ТОЛЬКО нужные ID
        };
        return world.queries[queryName];
    },
    // Внутренняя функция: проверяет, соответствует ли сущность запросам,
    // и обновляет их списки. Вызывается при изменении маски сущности.
    updateQueries: (world, id) => {
        const entityMask = world.masks[id];
        const isActive = world.active[id];
        for (const queryName in world.queries) {
            const query = world.queries[queryName];
            const hasComponents = (entityMask & query.mask) === query.mask;
            // Используем Set для быстрой проверки
            if (!query.entitySet) {
                query.entitySet = new Set();
            }
            const inQuery = query.entitySet.has(id);
            if (isActive && hasComponents) {
                // Если должна быть в группе, но её там нет — добавляем
                if (!inQuery) {
                    query.entities.push(id);
                    query.entitySet.add(id);
                }
            } else {
                // Если не должна быть в группе, но она там есть — удаляем (Fast Remove)
                if (inQuery) {
                    query.entitySet.delete(id);
                    // Переносим последний элемент на место удаляемого (O(1) swap-and-pop)
                    const index = query.entities.indexOf(id);
                    const lastId = query.entities.pop();
                    if (index < query.entities.length) {
                        query.entities[index] = lastId;
                    }
                }
            }
        }
    },
};
// 2. ==========СТРУКТУРА ДАННЫХ================
//Компоненты это обычные (DATA) или чистые типизированные массивы (COMPONENTS)
const world = ECS.createWorld() //создаём общий контейнер для экземпляра всего
const COMPONENTS = { //Ограничение в 32 компонента!!!
    "positionX": ECS.defineComponent(), //позиция по x
    "positionY": ECS.defineComponent(), //позиция по y
    "velocityX": ECS.defineComponent(), //скорость по x
    "velocityY": ECS.defineComponent(), //скорость по y
    "configId":  ECS.defineComponent(Uint8Array), //ссылка на строку в массиве данных всех объектов
    // массивы для анимации
    "currentFrame": ECS.defineComponent(Uint8Array),  // Текущий индекс кадра (0, 1, 2...)
    "totalFrames":  ECS.defineComponent(Uint8Array),  // Сколько всего кадров у этого юнита
    "animationSpeed": ECS.defineComponent(), // Скорость анимации для сущности
    "animationTime":  ECS.defineComponent(), // Текущий прогресс анимации
    "radius": ECS.defineComponent(), //4 радиус ячейки для коллизий
    "gridCellId": ECS.defineComponent(Int32Array), // Int32, так как -1 будет означать "вне сетки"
}
//Компоненты не укладывающиеся в типизированные массивы (спрайты и т.д.)
const DATA = {
    "spriteMap": [], //отрисованный в PixiJS спрайт (Sprite или AnimatedSprite)
}
// Регистрируем компоненты с битовыми масками (до 32 компонентов на Uint32Array)
const COMPONENT_MASKS = {
    "positionX": 1 << 0, // 1 (...001)
    "positionY": 1 << 1, // 2 (...0010)
    "velocityX": 1 << 2, // 4 (...00100)
    "velocityY": 1 << 3, // 8 (...001000)
    "spriteMap": 1 << 4, // 16 (...0010000)
    "configId":  1 << 5, // 32 (...00100000)
    "currentFrame": 1 << 6, // 64
    "totalFrames": 1 << 7,  // 128
    "animationSpeed": 1 << 8, // 256
    "animationTime":  1 << 9,  // 512
    "radius": 1 << 10, // 1024 радиус ячейки для коллизий
    "gridCellId": 1 << 11, // 2048 Хранит индекс текущей ячейки для коллизий
}
//------------Группы entity---------------------------
// Группа для системы движения (нужны все 4 компонента)
const movableGroup = ECS.createQuery(world, "movable", ["positionX", "positionY", "velocityX", "velocityY"]);
// Группа для системы рендера (нужны только координаты и спрайт)
const renderableGroup = ECS.createQuery(world, "renderable", ["positionX", "positionY", "spriteMap"]);
// Группа для рендера и боевой логики (им важен тип юнита)
const aliveUnitsGroup = ECS.createQuery(world, "aliveUnits", ["positionX", "positionY", "configId"]);
// Группа для анимированных объектов (animationSpeed — маркер анимированности)
const animatedGroup = ECS.createQuery(world, "animated", ["spriteMap", "animationSpeed"]);
// Группа для физических объектов с коллайдерами "radius"
const physicsGroup = ECS.createQuery(world, "physics", ["positionX", "positionY", "radius"]);
//-----------------------------------------------------
// Хранилища «спящих» спрайтов для каждого типа юнита.
// Статические Sprite и анимированные AnimatedSprite держим В РАЗНЫХ пулах:
// раньше они лежали в одном SPRITE_POOLS и при переиспользовании можно было
// достать спрайт не того вида (латентный краш при смерти юнитов).
const STATIC_SPRITE_POOLS = {};
const ANIMATED_SPRITE_POOLS = {};
// Объект сетки коллизий
const SpatialHashGrid = {
    cellSize: 32, // Размер ячейки в пикселях (чуть больше максимального диаметра объекта)
    cells: new Map(), // Карта: ключ — ID ячейки, значение — массив ID сущностей
    // Смещение ключа ячейки: ключ уникален для координат ячеек в диапазоне ±32768
    // (≈ ±1 млн пикселей) — прежняя схема «col + row*cols» конфликтовала ключами
    // при отрицательных координатах, теперь коллизий ключей нет в принципе.
    _KEY_OFFSET: 32768,
    // Переиспользуемые массивы ячеек: вместо аллокации нового массива на каждую
    // ячейку каждый кадр — забираем «спящие» массивы из freeArrays (меньше мусора для GC)
    freeArrays: [],
    // Очистка сетки каждый кадр перед заполнением
    clear: function() {
        for (const cellArray of this.cells.values()) {
            cellArray.length = 0;
            this.freeArrays.push(cellArray);
        }
        this.cells.clear();
    },
    // Получить уникальный ID ячейки по координатам X и Y
    getCellKey: function(x, y) {
        const col = Math.floor(x / this.cellSize) + this._KEY_OFFSET;
        const row = Math.floor(y / this.cellSize) + this._KEY_OFFSET;
        // Старший и младший компоненты ключа не пересекаются: ключ уникален всегда
        return col * 65536 + row;
    },
    // Разбор ключа обратно в координаты ячейки (нужен коллизиям по парам ячеек и отладке)
    getCellCoords: function(key) {
        return {
            col: Math.floor(key / 65536) - this._KEY_OFFSET,
            row: (key % 65536) - this._KEY_OFFSET,
        };
    },
    // Добавить сущность в сетку
    insert: function(id, x, y) {
        const cellId = this.getCellKey(x, y);
        COMPONENTS.gridCellId[id] = cellId;
        let cellArray = this.cells.get(cellId);
        if (!cellArray) {
            cellArray = this.freeArrays.pop() || [];
            this.cells.set(cellId, cellArray);
        }
        cellArray.push(id);
    }
};
//СИСТЕМЫ-------------------------------------------------------
// Границы мира для отскока. null = стены совпадают с экраном (отступ 8px,
// прежнее поведение). Меняется через setWorldBounds() — например, когда
// камера открывает мир больше экрана.
let worldBounds = null;
function setWorldBounds(rect) { worldBounds = rect; } // {x, y, width, height}
// Система движения (пробегает по массиву world.queries.movable.entities).
// Движение умножается на dt — нормализацию к 60 FPS: на мониторе 144 Гц
// dt≈0.42 и объекты не улетают в 2.4 раза быстрее. Скорости по-прежнему
// задаются в «пикселях за кадр при 60 FPS».
function movementSystem(app, world, deltaMS) {
    const dt = deltaMS / (1000 / 60);
    const b = worldBounds || { x: 8, y: 8, width: app.screen.width - 16, height: app.screen.height - 16 };
    const right = b.x + b.width;
    const bottom = b.y + b.height;
    // Берём чистый отфильтрованный массив ID
    const entities = world.queries.movable.entities;
    // Итерируем с конца, так как внутри можем удалить сущность
    for (let i = entities.length - 1; i >= 0; i--) {
        const id = entities[i];
        COMPONENTS.positionX[id] += COMPONENTS.velocityX[id] * dt;
        COMPONENTS.positionY[id] += COMPONENTS.velocityY[id] * dt;
        if (COMPONENTS.positionX[id] < b.x || COMPONENTS.positionX[id] > right) COMPONENTS.velocityX[id] *= -1;
        if (COMPONENTS.positionY[id] < b.y || COMPONENTS.positionY[id] > bottom) COMPONENTS.velocityY[id] *= -1;
    }
}
// Система анимации: AnimatedSprite сам переключает кадры внутри себя,
// здесь мы только передаём ему тикер. Важно: в PixiJS 8 метод update()
// ожидает ОБЪЕКТ ТИКЕРА (читает ticker.deltaTime), а не число —
// при передаче числа кадр становится NaN и спрайт перестаёт отрисовываться.
// CULLING: у скрытых (вне вида камеры) спрайтов кадры не тикают — это самая
// дорогая линейная операция. Видимость считается renderSystem-ом прошлого кадра,
// лаг в 1 кадр незаметен. Вернувшись в кадр, анимация продолжается с места останова.
function animationSystem(world, ticker) {
    const entities = world.queries.animated.entities;
    const length = entities.length;
    for (let i = 0; i < length; i++) {
        const id = entities[i];
        const sprite = DATA.spriteMap[id];
        if (sprite && sprite.textures) {
            if (!sprite.visible) continue; // вне экрана — не тратим время на кадры
            sprite.animationSpeed = COMPONENTS.animationSpeed[id];
            sprite.update(ticker);
        }
    }
}
// Система построения пространственной сетки (перестраивается каждый кадр)
function spatialGridSystem(app, world) {
    SpatialHashGrid.clear();
    const entities = world.queries.physics.entities;
    const length = entities.length;
    for (let i = 0; i < length; i++) {
        const id = entities[i];
        SpatialHashGrid.insert(id, COMPONENTS.positionX[id], COMPONENTS.positionY[id]);
    }
}
// Полу-соседство ячеек: право, низ-лево, низ, низ-право. Каждая пара ячеек
// (а значит и каждая пара сущностей) рассматривается РОВНО ОДИН РАЗ —
// раньше каждая сущность сканировала 3×3 ячейки и пары проверялись дважды.
const CELL_NEIGHBOR_OFFSETS = [[1, 0], [-1, 1], [0, 1], [1, 1]];
// Разрешение столкновения пары сущностей: расталкивание (penetration resolution)
// и упругий отскок вдоль нормали. Горячая функция — вызывается для каждой пары.
function resolveCollision(idA, idB) {
    const xA = COMPONENTS.positionX[idA];
    const yA = COMPONENTS.positionY[idA];
    const xB = COMPONENTS.positionX[idB];
    const yB = COMPONENTS.positionY[idB];
    const rA = COMPONENTS.radius[idA];
    const rB = COMPONENTS.radius[idB];
    // Быстрая проверка расстояния без Math.sqrt (сравнение квадратов расстояний)
    const dx = xB - xA;
    const dy = yB - yA;
    const distanceSq = dx * dx + dy * dy;
    const minDist = rA + rB;
    const minDistSq = minDist * minDist;
    if (distanceSq >= minDistSq) return;
    // Столкновение произошло! Рассчитываем точную физику отскока
    const distance = Math.sqrt(distanceSq) || 0.001; // Избегаем деления на 0
    // Нормаль столкновения
    const nx = dx / distance;
    const ny = dy / distance;
    // 1. Расталкиваем объекты, чтобы они не слипались
    const overlap = minDist - distance;
    COMPONENTS.positionX[idA] -= nx * overlap * 0.5;
    COMPONENTS.positionY[idA] -= ny * overlap * 0.5;
    COMPONENTS.positionX[idB] += nx * overlap * 0.5;
    COMPONENTS.positionY[idB] += ny * overlap * 0.5;
    // 2. Меняем вектора скоростей (отскок)
    const kx = COMPONENTS.velocityX[idA] - COMPONENTS.velocityX[idB];
    const ky = COMPONENTS.velocityY[idA] - COMPONENTS.velocityY[idB];
    // Скорость вдоль нормали
    const p = kx * nx + ky * ny;
    // Если объекты уже движутся в разные стороны, игнорируем
    if (p > 0) {
        COMPONENTS.velocityX[idA] -= p * nx;
        COMPONENTS.velocityY[idA] -= p * ny;
        COMPONENTS.velocityX[idB] += p * nx;
        COMPONENTS.velocityY[idB] += p * ny;
    }
}
// Система столкновений: обходит ЯЧЕЙКИ (а не сущности). Для каждой ячейки —
// пары внутри неё и пары с четырьмя «передними» соседями. Число обращений к
// карте ячеек падает с 9 на сущность до 5 на ячейку, дубликаты пар исчезают.
function collisionSystem(world) {
    const offset = SpatialHashGrid._KEY_OFFSET;
    for (const [cellId, cellEntities] of SpatialHashGrid.cells) {
        const n = cellEntities.length;
        if (n === 0) continue;
        // 1. Пары внутри ячейки
        for (let i = 0; i < n - 1; i++) {
            const idA = cellEntities[i];
            for (let j = i + 1; j < n; j++) {
                resolveCollision(idA, cellEntities[j]);
            }
        }
        // 2. Пары с половиной соседних ячеек
        const coords = SpatialHashGrid.getCellCoords(cellId);
        const col = coords.col + offset;
        const row = coords.row + offset;
        for (let k = 0; k < 4; k++) {
            const neighbor = SpatialHashGrid.cells.get(
                (col + CELL_NEIGHBOR_OFFSETS[k][0]) * 65536 + (row + CELL_NEIGHBOR_OFFSETS[k][1])
            );
            if (!neighbor) continue;
            const m = neighbor.length;
            for (let i = 0; i < n; i++) {
                const idA = cellEntities[i];
                for (let j = 0; j < m; j++) {
                    resolveCollision(idA, neighbor[j]);
                }
            }
        }
    }
}
// CULLING: запас на габарит спрайта, чтобы объекты исчезали чуть за краем кадра,
// а не в момент пересечения центра. В мировых пикселях.
const CULL_MARGIN = 32;
// Система рендера: переносит позиции из компонентов на спрайты и скрывает то,
// что вне вида камеры (PixiJS полностью пропускает невидимые объекты — экономим
// обход сцены и GPU). Вид-прямоугольник вычисляется из трансформа КОНТЕЙНЕРА МИРА:
// без модуля камеры (scale=1, pivot=0) это просто экран, поведение корректно само
// по себе. Камера двигает контейнер после renderSystem — видимость отстаёт на кадр,
// запас CULL_MARGIN это перекрывает.
function renderSystem(app, world, worldContainer) {
    const scale = worldContainer.scale.x || 1;
    const halfW = app.screen.width / (2 * scale) + CULL_MARGIN;
    const halfH = app.screen.height / (2 * scale) + CULL_MARGIN;
    const camX = worldContainer.pivot.x;
    const camY = worldContainer.pivot.y;
    const left = camX - halfW;
    const right = camX + halfW;
    const top = camY - halfH;
    const bottom = camY + halfH;
    const entities = world.queries.renderable.entities;
    const length = entities.length;
    for (let i = 0; i < length; i++) {
        const id = entities[i];
        const sprite = DATA.spriteMap[id];
        if (sprite) {
            const x = COMPONENTS.positionX[id];
            const y = COMPONENTS.positionY[id];
            sprite.x = x;
            sprite.y = y;
            sprite.visible = x >= left && x <= right && y >= top && y <= bottom;
        }
    }
}
// 3. ==========ИНИЦИАЛИЗАЦИЯ И API================
// Инициализирует PixiJS и возвращает API движка. Конкретную игровую начинку
// (текстуры, конфиги, спавн) создаёт игровая логика в scripts/game.js
async function init() {
    // Инициализируем PixiJS (v8)
    const app = new PIXI.Application();
    await app.init({
        // width: 800, //ширина экрана в пикселях
        // height: 600, //высота экрана в пикселях
        backgroundColor: "black",
        resizeTo: window, //растянуть на всё окно
        antialias: false, //отключаем сглаживание пиксельарта (???)
        preference: "webgpu" // предпочитаемый рендерер: нет WebGPU — PixiJS сам откатится на WebGL
    });
    document.body.appendChild(app.canvas);
    // Единый контейнер МИРА: всё, что живёт в мировых координатах (юниты, эффекты),
    // — внутри него. Камера двигает/масштабирует только этот контейнер, а HUD и
    // оверлеи отладки лежат напрямую в app.stage и остаются неподвижными.
    const worldContainer = new PIXI.Container();
    app.stage.addChild(worldContainer);
    // Создаем контейнер для частиц
    const particleContainer = new PIXI.Container();
    worldContainer.addChild(particleContainer);

    // getSpriteFromPool() Возвращает готовый статический спрайт для конкретного типа юнита
    // @param {number} typeIndex - ID конфигурации из UNIT_CONFIGS
    // @param {PIXI.Texture} [preGeneratedTexture] - Текстура, если нужно создать новый спрайт
    function getSpriteFromPool(typeIndex, preGeneratedTexture) {
        const pool = STATIC_SPRITE_POOLS[typeIndex];
        const config = UNIT_CONFIGS[typeIndex];
        const scale = config.spriteScale || 1;
        // Если в пуле есть готовый спящий спрайт
        if (pool && pool.length > 0) {
            const recycledSprite = pool.pop();
            recycledSprite.visible = true; // Снова делаем его видимым
            recycledSprite.scale.set(scale);
            return recycledSprite;
        }
        // Если пул пуст — создаем новый спрайт с нуля (это произойдет только на старте или при нехватке спрайтов в пуле)
        let texture = preGeneratedTexture;
        //Если пул пуст и если текстуру не передали, генерируем её на основе конфига
        !texture && (texture = createTextureFromConfig(config))
        const newSprite = new PIXI.Sprite(texture);
        newSprite.anchor.set(0.5);
        newSprite.scale.set(scale);
        // Сразу добавляем в контейнер мира. Он останется в нём навсегда, мы будем лишь менять visible
        worldContainer.addChild(newSprite);
        return newSprite;
    }
    // getAnimatedSpriteFromPool() Возвращает AnimatedSprite для конкретного типа юнита
    // @param {number} typeIndex - ID конфигурации из UNIT_CONFIGS
    function getAnimatedSpriteFromPool(typeIndex) {
        const pool = ANIMATED_SPRITE_POOLS[typeIndex];
        const config = UNIT_CONFIGS[typeIndex];
        const scale = config.spriteScale || 1;
        if (pool && pool.length > 0) {
            const recycledSprite = pool.pop();
            recycledSprite.animationSpeed = config.animationSpeed;
            recycledSprite.gotoAndPlay(0);
            recycledSprite.visible = true;
            recycledSprite.scale.set(scale);
            return recycledSprite;
        }
        // Один AnimatedSprite вместо массива спрайтов-кадров: 1 объект сцены на юнита
        // вместо N, переключение кадров встроено в сам спрайт.
        // autoUpdate=false: кадрами управляет наша система анимации (детерминированный
        // порядок обновления в общем игровом цикле, а не Ticker.shared)
        const animatedSprite = new PIXI.AnimatedSprite(config.textures, false);
        animatedSprite.anchor.set(0.5);
        animatedSprite.animationSpeed = config.animationSpeed;
        animatedSprite.gotoAndPlay(0);
        animatedSprite.scale.set(scale);
        particleContainer.addChild(animatedSprite);
        return animatedSprite;
    }
    // генерируем текстуру на основе конфига
    function createTextureFromConfig(config) {
        const graphic = new PIXI.Graphics()
            .circle(0, 0, config.radius)
            .fill(config.color)
            //.stroke({ width: 1.5, color: "grey" });
        return app.renderer.generateTexture(graphic);
    }
    // ФАБРИКА СПАВНА
    // @param {number} typeIndex - ID конфигурации из UNIT_CONFIGS
    // @param {number} startX, startY - начальная позиция
    // @param {PIXI.Texture} [preGeneratedTexture] - готовая текстура (иначе берётся из пула/конфига)
    function spawnUnit(typeIndex, startX, startY, preGeneratedTexture) {
        const id = ECS.addEntity(world);
        const config = UNIT_CONFIGS[typeIndex];
        const angle = Math.random() * Math.PI * 2;
        // Динамически собираем компоненты для сущности
        ECS.addComponent(world, id, "positionX", startX);
        ECS.addComponent(world, id, "positionY", startY);
        ECS.addComponent(world, id, "velocityX", Math.cos(angle) * config.baseSpeed);
        ECS.addComponent(world, id, "velocityY", Math.sin(angle) * config.baseSpeed);
        ECS.addComponent(world, id, "configId", typeIndex);
        // Записываем радиус для физики
        ECS.addComponent(world, id, "radius", config.radius);
        ECS.addComponent(world, id, "gridCellId", -1); // Изначально вне сетки
        // ПОЛУЧАЕМ СПРАЙТ ЧЕРЕЗ ПУЛ
        const sprite = getSpriteFromPool(typeIndex, preGeneratedTexture);
        ECS.addComponent(world, id, "spriteMap", sprite);
        events.emit(UNITS_EVENTS.SPAWNED, { id, configId: typeIndex });
        return id;
    }
    // ФАБРИКА СПАВНА АНИМИРОВАННЫХ ОБЪЕКТОВ
    function spawnAnimatedUnit(configId, startX, startY) {
        const id = ECS.addEntity(world);
        ECS.addComponent(world, id, "positionX", startX);
        ECS.addComponent(world, id, "positionY", startY);
        const angle = Math.random() * Math.PI * 2;
        ECS.addComponent(world, id, "velocityX", Math.cos(angle) * UNIT_CONFIGS[configId].baseSpeed);
        ECS.addComponent(world, id, "velocityY", Math.sin(angle) * UNIT_CONFIGS[configId].baseSpeed);
        ECS.addComponent(world, id, "configId", configId);
        // animationSpeed остаётся компонентом-маркером для группы "animated"
        ECS.addComponent(world, id, "animationSpeed", UNIT_CONFIGS[configId].animationSpeed);
        // Получаем AnimatedSprite через пул
        const sprite = getAnimatedSpriteFromPool(configId);
        sprite.x = startX;
        sprite.y = startY;
        ECS.addComponent(world, id, "spriteMap", sprite);
        // Записываем параметры для физики
        ECS.addComponent(world, id, "radius", UNIT_CONFIGS[configId].radius);
        ECS.addComponent(world, id, "gridCellId", -1);
        events.emit(UNITS_EVENTS.SPAWNED, { id, configId });
        return id;
    }
//  Генерирует единый атлас текстур из массива PIXI.Graphics на лету
//  @param {Array<PIXI.Graphics>} graphicsArray - Массив кадров анимации
//  @param {number} frameWidth - Ширина одного кадра (например, 32)
//  @param {number} frameHeight - Высота одного кадра (например, 32)
//  @returns {Array<PIXI.Texture>} Массив готовых текстур для ECS, делящих один текстурный источник
    function createProgrammaticSpritesheet(graphicsArray, frameWidth, frameHeight) {
        const totalFrames = graphicsArray.length;
        // 1. Создаем один большой холст в памяти (все кадры выстроены в один горизонтальный ряд)
        const baseRenderTexture = PIXI.RenderTexture.create({
            width: frameWidth * totalFrames,
            height: frameHeight
        });
        // 2. Отрендерим каждый Graphics-объект в свою позицию на этом холсте
        for (let i = 0; i < totalFrames; i++) {
            const graphic = graphicsArray[i];
            // Смещаем графику на нужный шаг по горизонтали
            graphic.x = (i * frameWidth) + (frameWidth / 2);
            graphic.y = frameHeight / 2;
            // Рисуем графику поверх RenderTexture
            app.renderer.render({
                container: graphic,
                target: baseRenderTexture,
                clear: false // Важно: не стирать то, что нарисовали на предыдущих шагах
            });
        }
        // 3. Нарезаем большой холст на массив отдельных текстур для анимации
        const textures = [];
        for (let i = 0; i < totalFrames; i++) {
            // Задаем прямоугольную область (кусок атласа) для каждого кадра
            const frameRectangle = new PIXI.Rectangle(i * frameWidth, 0, frameWidth, frameHeight);
            // Создаем текстуру, которая делит источник baseRenderTexture
            const frameTexture = new PIXI.Texture({
                source: baseRenderTexture.source,
                frame: frameRectangle
            });
            textures.push(frameTexture);
        }
        return textures;
    }
    // Функция для загрузки спрайтшита из изображения
    async function loadSpritesheetFromImage(imagePath, frameWidth, frameHeight) {
        try {
            // 1. Загружаем изображение как текстуру
            const texture = await PIXI.Assets.load(imagePath);

            // 2. Вычисляем количество кадров на основе размера текстуры
            const totalFramesX = Math.floor(texture.width / frameWidth);
            const totalFramesY = Math.floor(texture.height / frameHeight);
            const totalFrames = totalFramesX * totalFramesY;

            // 3. Нарезаем текстуру на отдельные кадры
            const textures = [];
            for (let row = 0; row < totalFramesY; row++) {
                for (let col = 0; col < totalFramesX; col++) {
                    const frameRectangle = new PIXI.Rectangle(
                        col * frameWidth,
                        row * frameHeight,
                        frameWidth,
                        frameHeight
                    );

                    const frameTexture = new PIXI.Texture({
                        source: texture.source,
                        frame: frameRectangle
                    });

                    textures.push(frameTexture);
                }
            }

            return textures;
        } catch (error) {
            console.error('Ошибка загрузки спрайтшита:', error);
            return null;
        }
    }
    // Системы модулей: ядро не знает об их числе и назначении, просто вызывает
    // каждый кадр ПОСЛЕ своих пяти систем. Модули (камера, FX, HUD, планировщик,
    // отладка) регистрируются через addSystem и потому подключаются опционально.
    const moduleSystems = [];
    function addSystem(fn) { moduleSystems.push(fn); }
    // Игровой цикл: порядок систем фиксирован движком
    app.ticker.add((ticker) => {
        movementSystem(app, world, ticker.deltaMS); // 1. Двигаем объекты (с учётом FPS)
        spatialGridSystem(app, world); // 2. Строим пространственную сетку по новым координатам
        collisionSystem(world); // 3. Считаем столкновения на основе сетки и корректируем позиции/скорости
        animationSystem(world, ticker); // 4. Обновляем анимацию (передаём тикер целиком)
        renderSystem(app, world, worldContainer); // 5. Отрисовываем графику (+ culling вне вида)
        for (let i = 0; i < moduleSystems.length; i++) moduleSystems[i](ticker); // 6. Системы модулей
    });
    // Отладочный хендл: доступ к состоянию движка из консоли браузера (window.__ENGINE)
    window.__ENGINE = { app, ECS, world, COMPONENTS, DATA, SpatialHashGrid, particleContainer, worldContainer, STATIC_SPRITE_POOLS, ANIMATED_SPRITE_POOLS, events };
    // API движка для игровой логики
    return {
        app,
        worldContainer,
        particleContainer,
        world,
        events, // шина событий (EventSystem)
        ECS, // доступ к registerComponent/createQuery для модулей
        COMPONENTS, DATA, // хранилища — модулям и отладке
        SpatialHashGrid,
        spawnUnit, // (typeIndex, startX, startY, preGeneratedTexture?)
        spawnAnimatedUnit, // (configId, startX, startY)
        createTextureFromConfig, // (config)
        createProgrammaticSpritesheet, // (graphicsArray, frameWidth, frameHeight)
        loadSpritesheetFromImage, // (imagePath, frameWidth, frameHeight)
        addSystem, // (fn(ticker)) — система модуля, вызывается после ядра
        setWorldBounds, // ({x, y, width, height}) или null — границы отскока
    };
}
export {ECS, world, COMPONENTS, DATA, COMPONENT_MASKS, SpatialHashGrid, STATIC_SPRITE_POOLS, ANIMATED_SPRITE_POOLS, events, init,  }
