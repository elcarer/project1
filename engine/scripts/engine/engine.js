import { UNIT_CONFIGS } from "../data/units.js";
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
    cols: Math.ceil(window.innerWidth / 32), // Количество колонок
    cells: new Map(), // Карта: ключ — ID ячейки, значение — массив ID сущностей
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
        const col = Math.floor(x / this.cellSize);
        const row = Math.floor(y / this.cellSize);
        // Хэш-функция, превращающая координаты сетки в уникальный индекс
        return col + row * this.cols;
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
// Система движения с отскоком (пробегает по массиву world.queries.movable.entities)
function movementSystem(app, world) {
    // Берём чистый отфильтрованный массив ID
    const entities = world.queries.movable.entities;
    // Итерируем с конца, так как внутри можем удалить сущность
    for (let i = entities.length - 1; i >= 0; i--) {
        const id = entities[i];
        COMPONENTS.positionX[id] += COMPONENTS.velocityX[id];
        COMPONENTS.positionY[id] += COMPONENTS.velocityY[id];
        if (COMPONENTS.positionX[id] < 8 || COMPONENTS.positionX[id] > app.screen.width - 8) COMPONENTS.velocityX[id] *= -1;
        if (COMPONENTS.positionY[id] < 8 || COMPONENTS.positionY[id] > app.screen.height - 8) COMPONENTS.velocityY[id] *= -1;
    }
}
// Система анимации: AnimatedSprite сам переключает кадры внутри себя,
// здесь мы только передаём ему тикер. Важно: в PixiJS 8 метод update()
// ожидает ОБЪЕКТ ТИКЕРА (читает ticker.deltaTime), а не число —
// при передаче числа кадр становится NaN и спрайт перестаёт отрисовываться.
function animationSystem(world, ticker) {
    const entities = world.queries.animated.entities;
    const length = entities.length;
    for (let i = 0; i < length; i++) {
        const id = entities[i];
        const sprite = DATA.spriteMap[id];
        if (sprite && sprite.textures) {
            sprite.animationSpeed = COMPONENTS.animationSpeed[id];
            sprite.update(ticker);
        }
    }
}
// Система построения пространственной сетки (перестраивается каждый кадр)
function spatialGridSystem(app, world) {
    SpatialHashGrid.clear();
    SpatialHashGrid.cols = Math.ceil(app.screen.width / SpatialHashGrid.cellSize);
    const entities = world.queries.physics.entities;
    const length = entities.length;
    for (let i = 0; i < length; i++) {
        const id = entities[i];
        SpatialHashGrid.insert(id, COMPONENTS.positionX[id], COMPONENTS.positionY[id]);
    }
}
// Система столкновений: сетка 3x3 вокруг каждой сущности, расталкивание и отскок
function collisionSystem(world) {
    const entities = world.queries.physics.entities;
    const length = entities.length;
    const size = SpatialHashGrid.cellSize;
    const cols = SpatialHashGrid.cols;
    for (let i = 0; i < length; i++) {
        const idA = entities[i];
        const xA = COMPONENTS.positionX[idA];
        const yA = COMPONENTS.positionY[idA];
        const rA = COMPONENTS.radius[idA];
        // Вычисляем координаты текущей ячейки в сетке
        const centerCol = Math.floor(xA / size);
        const centerRow = Math.floor(yA / size);
        // Перебираем текущую ячейку и 8 соседних (сетка 3х3)
        for (let dc = -1; dc <= 1; dc++) {
            for (let dr = -1; dr <= 1; dr++) {
                const neighborCellId = (centerCol + dc) + (centerRow + dr) * cols;
                const cellEntities = SpatialHashGrid.cells.get(neighborCellId);
                if (!cellEntities) continue;
                const cellLength = cellEntities.length;
                for (let j = 0; j < cellLength; j++) {
                    const idB = cellEntities[j];
                    // Не проверяем объект сам с собой и избегаем дублирующих проверок (idA < idB)
                    if (idA >= idB) continue;
                    const xB = COMPONENTS.positionX[idB];
                    const yB = COMPONENTS.positionY[idB];
                    const rB = COMPONENTS.radius[idB];
                    // Быстрая проверка расстояния без Math.sqrt (проверка квадратов расстояний)
                    const dx = xB - xA;
                    const dy = yB - yA;
                    const distanceSq = dx * dx + dy * dy;
                    const minDist = rA + rB;
                    const minDistSq = minDist * minDist;
                    if (distanceSq < minDistSq) {
                        // Столкновение произошло! Рассчитываем точную физику отскока
                        const distance = Math.sqrt(distanceSq) || 0.001; // Избегаем деления на 0
                        // Нормаль столкновения
                        const nx = dx / distance;
                        const ny = dy / distance;
                        // 1. Расталкиваем объекты, чтобы они не слипались (Penetration Resolution)
                        const overlap = minDist - distance;
                        COMPONENTS.positionX[idA] -= nx * overlap * 0.5;
                        COMPONENTS.positionY[idA] -= ny * overlap * 0.5;
                        COMPONENTS.positionX[idB] += nx * overlap * 0.5;
                        COMPONENTS.positionY[idB] += ny * overlap * 0.5;
                        // 2. Меняем вектора скоростей (отскок)
                        // Относительная скорость
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
                }
            }
        }
    }
}
// Система рендера: переносит позиции из компонентов на спрайты
function renderSystem(world) {
    const entities = world.queries.renderable.entities;
    const length = entities.length;
    for (let i = 0; i < length; i++) {
        const id = entities[i];
        const sprite = DATA.spriteMap[id];
        if (sprite) {
            // И Sprite, и AnimatedSprite имеют x/y — ветка для массивов кадров больше не нужна
            sprite.x = COMPONENTS.positionX[id];
            sprite.y = COMPONENTS.positionY[id];
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
        antialias: false //отключаем сглаживание пиксельарта (???)
    });
    document.body.appendChild(app.canvas);
    // Создаем контейнер для частиц
    const particleContainer = new PIXI.Container();
    app.stage.addChild(particleContainer);

    // getSpriteFromPool() Возвращает готовый статический спрайт для конкретного типа юнита
    // @param {number} typeIndex - ID конфигурации из UNIT_CONFIGS
    // @param {PIXI.Texture} [preGeneratedTexture] - Текстура, если нужно создать новый спрайт
    function getSpriteFromPool(typeIndex, preGeneratedTexture) {
        const pool = STATIC_SPRITE_POOLS[typeIndex];
        // Если в пуле есть готовый спящий спрайт
        if (pool && pool.length > 0) {
            const recycledSprite = pool.pop();
            recycledSprite.visible = true; // Снова делаем его видимым
            return recycledSprite;
        }
        // Если пул пуст — создаем новый спрайт с нуля (это произойдет только на старте или при нехватке спрайтов в пуле)
        const config = UNIT_CONFIGS[typeIndex];
        let texture = preGeneratedTexture;
        //Если пул пуст и если текстуру не передали, генерируем её на основе конфига
        !texture && (texture = createTextureFromConfig(config))
        const newSprite = new PIXI.Sprite(texture);
        newSprite.anchor.set(0.5);
        // Сразу добавляем на сцену. Он останется в контейнере навсегда, мы будем лишь менять visible
        app.stage.addChild(newSprite);
        return newSprite;
    }
    // getAnimatedSpriteFromPool() Возвращает AnimatedSprite для конкретного типа юнита
    // @param {number} typeIndex - ID конфигурации из UNIT_CONFIGS
    function getAnimatedSpriteFromPool(typeIndex) {
        const pool = ANIMATED_SPRITE_POOLS[typeIndex];
        if (pool && pool.length > 0) {
            const recycledSprite = pool.pop();
            recycledSprite.animationSpeed = UNIT_CONFIGS[typeIndex].animationSpeed;
            recycledSprite.gotoAndPlay(0);
            recycledSprite.visible = true;
            return recycledSprite;
        }
        const config = UNIT_CONFIGS[typeIndex];
        // Один AnimatedSprite вместо массива спрайтов-кадров: 1 объект сцены на юнита
        // вместо N, переключение кадров встроено в сам спрайт.
        // autoUpdate=false: кадрами управляет наша система анимации (детерминированный
        // порядок обновления в общем игровом цикле, а не Ticker.shared)
        const animatedSprite = new PIXI.AnimatedSprite(config.textures, false);
        animatedSprite.anchor.set(0.5);
        animatedSprite.animationSpeed = config.animationSpeed;
        animatedSprite.gotoAndPlay(0);
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
    // Игровой цикл: порядок систем фиксирован движком
    app.ticker.add((ticker) => {
        movementSystem(app, world); // 1. Двигаем объекты
        spatialGridSystem(app, world); // 2. Строим пространственную сетку по новым координатам
        collisionSystem(world); // 3. Считаем столкновения на основе сетки и корректируем позиции/скорости
        animationSystem(world, ticker); // 4. Обновляем анимацию (передаём тикер целиком)
        renderSystem(world); // 5. Отрисовываем графику
    });
    // Отладочный хендл: доступ к состоянию движка из консоли браузера (window.__ENGINE)
    window.__ENGINE = { app, ECS, world, COMPONENTS, DATA, SpatialHashGrid, particleContainer, STATIC_SPRITE_POOLS, ANIMATED_SPRITE_POOLS };
    // API движка для игровой логики
    return {
        app,
        particleContainer,
        world,
        spawnUnit, // (typeIndex, startX, startY, preGeneratedTexture?)
        spawnAnimatedUnit, // (configId, startX, startY)
        createTextureFromConfig, // (config)
        createProgrammaticSpritesheet, // (graphicsArray, frameWidth, frameHeight)
        loadSpritesheetFromImage, // (imagePath, frameWidth, frameHeight)
    };
}
export {ECS, world, COMPONENTS, DATA, COMPONENT_MASKS, STATIC_SPRITE_POOLS, ANIMATED_SPRITE_POOLS, init,  }
