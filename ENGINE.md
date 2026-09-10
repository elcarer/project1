# Документация движка (engine)

ECS-движок 2D-игры на **PixiJS 8.19** без сборщика и зависимостей (кроме самой PixiJS, подключённой локально).
Дата последнего обновления: 2026-09-10 (модульное расширение). Бэкап кода до первого рефакторинга: `../engine-backup-before-refactor/`.

## Как запустить

ES-модули не работают с `file://` — нужен любой статический HTTP-сервер из папки `engine/`:

```bash
python -m http.server 8123
# открыть http://127.0.0.1:8123/
```

## Структура файлов

```
engine/
├── index.html                  # входная точка: подключает pixi.min.js и game.js (type="module")
├── dll/pixi.min.js             # PixiJS 8.19 (локальная копия, включает AnimatedSprite)
├── images/
│   ├── bullets/all.png         # спрайтшит пуль 4×32px кадра (используется)
│   └── tiles/tile1.png         # тайл (пока не используется)
└── scripts/
    ├── game.js                 # ИГРОВАЯ ЛОГИКА + полигон модулей (движок здесь только вызывается)
    ├── data/units.js           # UNIT_CONFIGS (конфиги типов юнитов) + UNITS_EVENTS (константы событий)
    └── engine/
        ├── engine.js           # ядро: ECS, хранилища, системы, пулы, фабрики спавна, API
        ├── eventSystem.js      # шина событий on/off/emit/once/clear (подключена, экспортируется ядром как events)
        └── modules/            # ОПЦИОНАЛЬНЫЕ МОДУЛИ — игра подключает нужные
            ├── math.js         # чистая математика: clamp/lerp/damp/rand/dist/angleTo
            ├── scheduler.js    # таймеры: after/every/update, кадронезависимо, замораживаются на паузе
            ├── pool.js         # дженерик-пул объектов (factory + onRelease)
            ├── input.js        # клавиатура+мышь: isDown/wasPressed/axis/pointer, endFrame
            ├── health.js       # компоненты hp/maxHp, damage/heal/kill, события unit:damaged/unit:died
            ├── camera.js       # следование, зум, тряска, границы мира, screenToWorld
            ├── fx.js           # частицы burst() и всплывающий text() через пул
            ├── audio.js        # Web Audio: синтез tone/noise, пресеты, unlock по жесту
            ├── assets.js       # загрузка с прогрессом и кэшем, нарезка спрайтшитов
            ├── hud.js          # полоски (с авто-get) и тексты поверх мира, вне камеры
            ├── scenes.js       # конечный автомат состояний: add/go/is, хуки enter/exit/update
            └── debug.js        # оверлей FPS/сущностей, визуализация сетки (G) и хитбоксов (H), F3
```

**Принцип разделения:** `engine.js` не содержит ни одного конкретного объекта — только
переиспользуемые механизмы. Всё, что относится к конкретной игре (какие текстуры, какие
типы юнитов, сколько и кого спавнить) — в `game.js`. Модули опциональны: ядро не знает
о них, каждый модуль подключается импортом и фабрикой в `game.js`.

## Ядро: ECS-подход

- **Сущность (Entity)** — просто числовой ID (`0..99999`). Никаких методов и полей.
- **Компонент (Component)** — чистые данные без логики.
- **Система (System)** — вся логика; работает только с группами-запросами.

### 1. Данные компонентов

Два хранилища (SoA — structure of arrays):

| Хранилище | Что лежит | Доступ |
|---|---|---|
| `COMPONENTS` | числовые данные в **типизированных массивах** | `COMPONENTS.positionX[id]` — O(1), кэш-дружелюбно |
| `DATA` | ссылочные данные: спрайты и т.п. | `DATA.spriteMap[id]` |

Компоненты ядра: `positionX/Y`, `velocityX/Y`, `configId`, `radius`, `gridCellId`,
анимационные `currentFrame/totalFrames/animationSpeed/animationTime` (кадры считает сам
AnimatedSprite, `animationSpeed` — маркер группы «animated»).

**Динамическая регистрация:** `ECS.registerComponent(name, type, length)` — модуль может
добавить свой компонент без правки ядра (так делает `health.js`: `hp` = бит 12, `maxHp` = бит 13).
Повторная регистрация идемпотентна. **Лимит: 32 компонента** (Uint32Array-маска), свободные
биты ищутся автоматически, при исчерпании — warning и `null`.

### 2. Группы-запросы (queries)

`ECS.createQuery(world, имя, [компоненты])` собирает битовую маску требований. Система
перебирает только плотный массив `world.queries.<имя>.entities`; попадание/удаление —
автоматически через `updateQueries` при изменении маски, удаление O(1) swap-and-pop.

Группы ядра: `movable`, `renderable`, `aliveUnits`, `animated`, `physics`; модуль health
добавляет `vulnerable` (зарегистрирован, используется игрой по необходимости).

### 3. Игровой цикл и системы модулей

```
app.ticker (каждый кадр):
  1. movementSystem     — movable:   позиция += скорость × dt (нормализация к 60 FPS),
                                     отскок от setWorldBounds() или краёв экрана
  2. spatialGridSystem  — physics:   очистка и перестройка пространственной сетки
  3. collisionSystem    — physics:   столкновения кругов, расталкивание + упругий отскок
  4. animationSystem    — animated:  sprite.update(ticker)
  5. renderSystem       — renderable: спрайт.x/y = позиция из компонентов
  6. СИСТЕМЫ МОДУЛЕЙ    — всё, что зарегистрировано через engine.addSystem(fn)
                          (камера, fx, hud, scenes, debug — в порядке подключения)
```

`addSystem(fn)` — точка расширения: ядро не знает числе систем модулей, вызывает каждый
кадр после своих. Скорости задаются в «пикселях за кадр при 60 FPS» — на 144 Гц движение
то же самое (проверено: 240 px/с при 143 FPS).

### 4. Сцена и контейнеры (PixiJS)

```
app.stage
├── worldContainer      ← МИРОВЫЕ координаты: им управляет камера (позиция/масштаб/тряска)
│   ├── частицы FX, визуализация отладки (сетка/хитбоксы)
│   ├── particleContainer (анимированные спрайты)
│   └── статические спрайты юнитов
├── hud.container       ← ЭКРАННЫЕ координаты: HUD, не зависит от камеры
├── debug.overlay       ← оверлей статистики
└── canvas
```

- **Пулы спрайтов.** Спрайты не создаются/не уничтожаются в рантайме: при смерти сущности
  спрайт прячется и возвращается в пул своего типа. Пулы **раздельные**:
  `STATIC_SPRITE_POOLS[typeIndex]` для `PIXI.Sprite` и `ANIMATED_SPRITE_POOLS[typeIndex]`
  для `PIXI.AnimatedSprite`. Прочие объекты (частицы, тексты FX) — через дженерик-пул `pool.js`.
- **Анимация.** `PIXI.AnimatedSprite(textures, false)`: 1 объект сцены на юнита,
  `autoUpdate=false` — кадрами управляет `animationSystem`.
  ⚠️ **Нюанс API:** в PixiJS 8.19 `AnimatedSprite.update(t)` ждёт **объект тикера** (читает
  `t.deltaTime`). Передача числа даёт NaN → спрайт исчезает из рендера.
- **Текстуры.** Программный атлас (`createProgrammaticSpritesheet`), загрузка спрайтшита
  (`loadSpritesheetFromImage` в ядре, `assets.loadSpritesheet` в модуле — с кэшем и прогрессом).

### 5. Пространственная сетка (SpatialHashGrid)

Равномерная сетка с ячейкой 32px поверх `Map`. Каждый кадр: `clear()` возвращает массивы
ячеек в пул `freeArrays` → `insert()` по `getCellKey(x,y) = col + row*cols`. `collisionSystem`
проверяет только свою ячейку и 8 соседних; повторные пары отсекаются `idA < idB`; дистанция —
сравнение квадратов.

### 6. События (шина `events`)

Ядро и модули генерируют, игра подписывается (`events.on`):

| Событие | Когда | payload |
|---|---|---|
| `unit:spawned` | spawnUnit / spawnAnimatedUnit | `{ id, configId }` |
| `unit:damaged` | health.damage() | `{ id, amount, hp }` |
| `unit:died` | health.kill() (до удаления — позиция ещё читается) | `{ id, configId }` |

Константы имён — `UNITS_EVENTS` в `data/units.js`.

## Модули (подключаются опционально)

| Модуль | Фабрика | Ключевое API |
|---|---|---|
| math | функции | `clamp, lerp, damp, rand, randInt, dist, angleTo, TAU` |
| scheduler | `createScheduler()` | `after(sec,fn)→cancel, every(sec,fn)→cancel, update(deltaMS), clear()` |
| pool | `createPool(factory, onRelease)` | `acquire(), release(obj)`, счётчики createdTotal/activeCount |
| input | `createInput()` | `isDown(code), wasPressed(code), axis(), pointer{x,y,isDown,pressed,wheel}, endFrame()` |
| health | `createHealth()` | `attach(id,max), damage(id,n), heal(id,n), ratio(id), kill(id)` |
| camera | `createCamera({app, container, addSystem})` | `follow(obj), setBounds, zoomBy, shake(power,dur), screenToWorld` |
| fx | `createFX({app, layer, addSystem})` | `burst(x,y,opts), text(x,y,str,opts)` — всё через пул |
| audio | `createAudio()` | `unlock()` по жесту, `tone({...}), noise({...}), register(name,fn), play(name)` |
| assets | `createAssets()` | `load(urls, onProgress), loadSpritesheet(url,fw,fh), get(url)` |
| hud | `createHUD({app, addSystem})` | `bar(name,{get}) — автообновление, text(name,str), setText` |
| scenes | `createScenes({addSystem})` | `add(name,{enter,exit,update}), go(name), is(name), current` |
| debug | `createDebug({app, addSystem, world, grid, components, layer, overlayPos})` | оверлей; `info[ключ]=значение`; клавиши F3/G/H |

Паттерн подключения (в `game.js`):

```js
const camera = createCamera({ app, container: engine.worldContainer, addSystem });
```

Модули, которым нужен тик (camera, fx, hud, scenes, debug), сами регистрируются через
`addSystem`. Планировщик и ввод — без авто-тика: `scheduler.update(ticker.deltaMS)` вызывается
в update сцены (поэтому на паузе таймеры стоят), `input.endFrame()` — в конце кадра сцены
(сброс однокадровых флагов после того, как сцена их прочитала).

## Отладка

Глобальные хендлы (после `init()`):

```js
window.__ENGINE  // { app, ECS, world, COMPONENTS, DATA, SpatialHashGrid,
                 //   particleContainer, worldContainer, STATIC/ANIMATED_SPRITE_POOLS, events }
window.__TEST    // полигон game.js: счёт, health, camera, scheduler, fx, audio, input, scenes
```

Горячие клавиши: **F3** — оверлей отладки, **G** — сетка коллизий, **H** — хитбоксы (рисуются
в мировых координатах, двигаются с камерой).

Тестовый полигон `game.js`: мир 1600×1200 (больше экрана), игрок (синий, WASD/стрелки),
60 блуждающих юнитов с HP. Таймер бьёт случайного юнита на 35 каждые 2 с (смерть → взрыв
частиц + звук + счёт), каждые 3 с популяция восполняется, игрок регенерирует 5 HP/с.
**P** — пауза (таймеры замирают), **K** — урон игроку, колесо — зум, ЛКМ — всплеск частиц
(и разблокировка звука).

## История изменений

### Модульное расширение (2026-09-10, вторая итерация)

1. **Ядро:** `ECS.registerComponent` (динамические биты), шина `events` подключена и
   генерирует `unit:spawned`, единый `worldContainer` (слой мира для камеры), движение
   умножается на dt (нормализация к 60 FPS), `setWorldBounds()` вместо жёстких стенок ±8,
   `addSystem(fn)` для систем модулей, `spawnAnimatedUnit` теперь возвращает id.
2. **11 модулей** в `engine/modules/` (см. таблицу выше) — все опциональные, ядро о них не знает.
3. `game.js` переписан в интеграционный полигон модулей.

Проверено: node-тесты чистых модулей (math/scheduler/pool/events — тайминги, отмена, переиспользование); node-тесты registerComponent+health (биты 12/13, урон/лечение/смерть/события, сброс масок); браузерные интеграционные (движение 240 px/с при 143 FPS, следование и границы камеры, зум колесом — ровно шаг на событие, тряска с возвратом в центр, пауза замораживает таймеры, урон/смерть/эффекты/счёт через события, сплеск частиц 11 шт. с затуханием, разблокировка аудио кликом, сетка и хитбоксы в мировых координатах, загрузка ассетов с прогрессом).

### Рефакторинг (2026-09-10, первая итерация)

1. **Исправлен критический баг сетки коллизий:** `cells` был `Map`, но читался через квадратные
   скобки — `clear()` не очищал накопленное → ячейки росли вечно. Теперь честный `Map` +
   переиспользование массивов ячеек.
2. **Анимация переведена на `PIXI.AnimatedSprite`**: 150 юнитов × 4 кадра = 600 спрайтов
   стало 150 объектами.
3. **Разделены пулы** статических и анимированных спрайтов (латентный краш при смерти юнитов).
4. `removeEntity`: swap-and-pop вместо `splice` (O(1)).
5. `gridCellId` урезан до 100 000 элементов (−3.6 МБ).
6. `defineComponent`: default-случай (Float32Array + warning).
7. **Переименования:** `pozitionX/Y → positionX/Y`, `eventSistem.js → eventSystem.js`.

## Известные ограничения и идеи на будущее

- **32 компонента максимум** (битовая маска Uint32). При исчерпании — две половины Uint32 или
  таблица соответствий.
- `ECS.nextId` — глобальный, а не на world: несколько миров будут конфликтовать по ID.
- `getCellKey` с отрицательными координатами может дать коллизии ключей (мир с отрицательными
  координатами пока не использовать).
- Скорости столкновений (импульс отскока) остаются в «пикселях за кадр» — при смене dt-масштаба
  скоростей проверить collisionSystem.
- Анимации AnimatedSprite уже кадронезависимы (сам спрайт читает deltaTime тикера).
- `images/tiles/tile1.png` не используется; звук — синтез, файлы не подключены.
