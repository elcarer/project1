// СНАРЯДЫ — ECS-сущности-снаряды: выпуск атакой, полёт, время жизни.
// Каждый персонаж (герой, NPC, враг) может быть ПРИВЯЗАН к атаке
// (bind(id, вид)): когда контроллер персонажей играет attack_* и анимация
// доходит до spawnTick кадра — модуль выпускает снаряд своего типа в сторону
// взгляда. Снаряд — ECS-сущность (positionX/Y + spriteMap → рендер и culling
// ядра, animationSpeed → кадры крутит ядро, loop — прокручивается, пока летит).
// Движение прямолинейное (система пишет positionX/Y), по истечении lifetime
// снаряд гасится и возвращается в пул своего типа. Коллизии/урон — следующий
// этап (компоненты уже оставляют место: добавится своя система поверх тех же id).
//
// Битовый бюджет: НИ ОДНОГО нового компонента — маркеры в обычных массивах
// BOUND/ACTIVE внутри фабрики.
//
// Пример:
//   const proj = createProjectiles({ world, ECS, COMPONENTS, DATA, addSystem,
//                                    assets, rows, TS });
//   await proj.load(["fireball", "bow"]);       // типы = ключи ATTACK_CONFIGS
//   proj.bind(wolfId, "wolf");                  // привязка вида персонажа
//   // ... в бою контроллер играет attack_*, снаряд рождается сам на spawnTick
const DIR_VECTORS = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] };

function createProjectiles({ world, ECS, COMPONENTS, DATA, addSystem = null,
                             assets, rows = null, TS = 32 }) {
    if (!assets) throw new Error("createProjectiles: нужен assets");
    const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
    const TYPES = {};   // attack → { anims, size, fps } (загружено load())
    const BOUND = [];   // id персонажа → { attack, spawnTick, lifetime, fired }
    const PROJ = [];    // id снаряда → { vx, vy, life, type }
    const ACTIVE = new Set();
    const POOLS = {};   // attack → [AnimatedSprite] — пул на тип снаряда

    // ── ЗАГРУЗКА типов снарядов (листы <атака>.png + .json) ────────────────
    // По http — живые файлы, на file:// — вшитые EMBED.proj
    async function load(attacks, { fileMode = false, embed = null, dir = "./images/projectiles/" } = {}) {
        for (const attack of attacks) {
            const cfg = globalThis.ATTACK_CONFIGS[attack];
            if (!cfg) throw new Error(`projectiles.load: нет ATTACK_CONFIGS[${attack}]`);
            const ch = fileMode
                ? await assets.loadCharacter(cfg.sheet, embed[cfg.sheet])
                : await assets.loadCharacter(dir + cfg.sheet);
            TYPES[attack] = { anims: ch.animations, size: ch.size, fps: cfg.fps || ch.fps || 8 };
        }
    }

    // ── ПРИВЯЗКА персонажа к атаке ( CHARACTER_ATTACKS[вид] ) ──────────────
    function bind(id, kind) {
        const cfg = globalThis.CHARACTER_ATTACKS[kind];
        if (!cfg) return false; // у вида нет атаки со снарядом
        BOUND[id] = { attack: cfg.attack, spawnTick: cfg.spawnTick, lifetime: cfg.lifetime, fired: 0 };
        return true;
    }

    // ── ПОРОЖДЕНИЕ снаряда атакой ──────────────────────────────────────────
    // type — ключ ATTACK_CONFIGS; dir — направление (строка анимации листа);
    // vx/vy — скорость полёта (melee передаёт 0/0 и once: true);
    // возвращает id сущности (или null при ошибке).
    function spawn({ type, dir = "front", x, y, vx, vy, lifetime, once = false }) {
        const t = TYPES[type];
        if (!t) return null;
        const animName = t.anims[dir] ? dir : "all";
        let sprite = (POOLS[type] && POOLS[type].pop()) || null;
        if (!sprite) {
            sprite = new PIXI.AnimatedSprite(t.anims[animName], false);
            sprite.anchor.set(0.5, 0.5); // снаряд летит «ядром»
        }
        sprite.textures = t.anims[animName];
        sprite.visible = true;
        sprite.loop = !once; // ranged прокручивается, пока летит; melee — один раз
        sprite.gotoAndPlay(0);
        const id = ECS.addEntity(world);
        ECS.addComponent(world, id, "positionX", x);
        ECS.addComponent(world, id, "positionY", y);
        ECS.addComponent(world, id, "spriteMap", sprite);
        ECS.addComponent(world, id, "animationSpeed", t.fps / 60);
        ECS.addComponent(world, id, "cullPad", t.size); // не мигать на краю экрана
        PROJ[id] = { vx, vy, life: lifetime, type, row: -1 };
        ACTIVE.add(id);
        placeInRow(id, sprite, y);
        return id;
    }

    // Снаряды ходят по «рядам ног» карты — честно заходят за стволы и кроны
    function placeInRow(id, sprite, y) {
        if (!rows) return;
        const r = clamp(Math.floor(y / TS), 0, rows.length - 1);
        if (r === PROJ[id].row) return;
        if (PROJ[id].row >= 0) sprite.removeFromParent();
        rows[r].addChild(sprite);
        PROJ[id].row = r;
    }

    function kill(id) {
        const p = PROJ[id];
        if (!p) return;
        const sprite = DATA.spriteMap[id];
        if (sprite) {
            sprite.removeFromParent();
            sprite.visible = false;
            (POOLS[p.type] = POOLS[p.type] || []).push(sprite);
            DATA.spriteMap[id] = null; // убрать из компонента ДО removeEntity:
        }                              // пул спрайтов ведём сами, ядро не трогаем
        delete PROJ[id];
        ACTIVE.delete(id);
        ECS.removeEntity(world, id);
    }

// ── КАДР СИСТЕМЫ: выпуск атаками → полёт → истечение времени жизни ─────
    function update(ticker) {
        const dt = clamp((ticker && ticker.deltaMS) || 1000 / 60, 0, 50) / 1000;

        // 1) Атаки: персонаж с привязкой играет attack_* — на кадре spawnTick
        //    выпускаем снаряд в сторону взгляда (один раз за атаку).
        //    melee — эффект ПЕРЕД персонажем без движения, однократно
        //    (время жизни = длительность анимации); ranged — летит по vx/vy.
        const entities = world.queries.characters.entities;
        for (let k = entities.length - 1; k >= 0; k--) {
            const id = entities[k];
            const b = BOUND[id];
            if (!b) continue;
            if (!COMPONENTS.ctrlLock[id]) { b.fired = 0; continue; }
            if (b.fired) continue;
            const anim = DATA.ctrlAnim[id];
            if (!anim || !anim.startsWith("attack_")) continue;
            const sprite = DATA.spriteMap[id];
            if (!sprite) continue;
            const tick = Math.min(b.spawnTick, sprite.textures.length - 1);
            if (sprite.currentFrame < tick) continue;
            const dir = anim.slice("attack_".length);
            const v = DIR_VECTORS[dir] || DIR_VECTORS.front;
            const cfg = globalThis.ATTACK_CONFIGS[b.attack];
            const t = TYPES[b.attack];
            const melee = cfg.kind === "melee";
            const px = COMPONENTS.positionX[id], py = COMPONENTS.positionY[id];
            b.fired = 1;
            // melee: анимация однократно — живём ровно её длину
            const animName = t.anims[dir] ? dir : "all";
            const lifetime = melee
                ? t.anims[animName].length / (cfg.fps || 8)
                : b.lifetime;
            spawn({
                type: b.attack, dir,
                x: px + v[0] * 12,
                y: py - 16 + v[1] * 10, // из «груди» персонажа, чуть впереди
                vx: melee ? 0 : v[0] * cfg.speed,
                vy: melee ? 0 : v[1] * cfg.speed,
                lifetime,
                once: melee,
            });
        }

        // 2) Полёт и время жизни (melee стоит на месте — движутся только ranged)
        for (const id of ACTIVE) {
            const p = PROJ[id];
            p.life -= dt;
            if (p.life <= 0) { kill(id); continue; }
            COMPONENTS.positionX[id] += p.vx * dt;
            COMPONENTS.positionY[id] += p.vy * dt;
            const sprite = DATA.spriteMap[id];
            if (sprite) {
                sprite.zIndex = COMPONENTS.positionY[id];
                placeInRow(id, sprite, COMPONENTS.positionY[id]);
            }
        }
    }
    if (addSystem) addSystem(update);

    return { load, bind, spawn, kill, update, TYPES, BOUND, PROJ, ACTIVE };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createProjectiles = createProjectiles;
