// ИИ ВРАГОВ — классическая схема RPG/MMO (FSM): ПАТРУЛЬ по waypoints вокруг
// точки спавна → герой вошёл в aggro-радиус → ПОГОНЯ → герой ушёл или враг
// вытянулся за ПОВОДКОМ от дома → ВОЗВРАТ домой и снова патруль.
//   • Виртуальный ввод: модуль пишет сущности ctrlVI/ctrlVJ — само движение
//     с коллизиями, анимации ходьбы и модель покоя делает контроллер персонажей
//     (modules/character.js). ИИ решает только КУДА и КОГДА.
//   • Битовый бюджет: маска сущности — Uint32 (32 компонента на ВСЁ). Здесь
//     регистрируются только 3 обязательных компонента группы-запроса; всё
//     некритичное к скорости (радиусы, таймеры, waypoint, перезарядка) живёт
//     в обычном массиве STATE — один object-lookup на врага в кадр.
//   • Атака: если герой совсем рядом и перезарядка истекла — playAttack(id)
//     (однократная строка взгляда).
//   • Погоня быстрее патруля (ctrlSpeed ×CHASE_BOOST, на возврате восстанавливается).
//   • Пловцы (ctrlSwim): waypoint'ы и проходимость — по blockedAlt (вода/суша
//     наоборот); коллизии всё равно держат их в водоёме.
//
// Пример:
//   const ai = createEnemyAI({ world, ECS, COMPONENTS, DATA, addSystem,
//                              characters, blocked, blockedAlt,
//                              getPlayerPos: () => ({ x, y }) });
//   const id = characters.spawn({ ... });          // обычный персонаж-сущность
//   ai.register(id, { detectR: 140, leashR: 300, patrolR: 110 });
const AI_PATROL = 0, AI_CHASE = 1, AI_RETURN = 2;
const AI_STATE_NAMES = ["patrol", "chase", "return"];
const CHASE_BOOST = 1.25;   // скорость погони относительно базовой
const ARRIVE = 8;           // «дошёл до waypoint», px
const HOME_ARRIVE = 24;     // «вернулся домой», px
const ATTACK_CD = 1.4;      // перезарядка атаки, сек
const WP_BUDGET = 8;        // сек на обход недостижимого waypoint

function createEnemyAI({ world, ECS, COMPONENTS, addSystem = null,
                         characters, blocked, blockedAlt = null, getPlayerPos }) {
    if (!characters || !blocked || !getPlayerPos) {
        throw new Error("createEnemyAI: нужны characters, blocked и getPlayerPos");
    }
    const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
    // Обязательные компоненты группы (хот-данные: читаются каждый кадр)
    ECS.registerComponent("aiState", Uint8Array);   // AI_PATROL/CHASE/RETURN
    ECS.registerComponent("aiHomeX", Float32Array); // точка спавна (поводок от неё)
    ECS.registerComponent("aiHomeY", Float32Array);
    ECS.createQuery(world, "ai", ["aiState", "aiHomeX", "aiHomeY"]);
    // Состояние врага вне битовой маски: { detect, leash, patrol, speed0,
    // atkCd, t, pause, wpx, wpy } — см. register()
    const STATE = [];

    function passable(id, x, y) {
        return (COMPONENTS.ctrlSwim[id] && blockedAlt) ? !blockedAlt(x, y) : !blocked(x, y);
    }

    // Регистрация заспавненного персонажа как врага (дом = текущая позиция)
    // attackR — «зона достижимости оружия»: дистанция остановки и атаки;
    // attackCd — перезарядка атаки, сек (cd атаки из ATTACK_CONFIGS, образец)
    function register(id, { detectR = 140, leashR = 300, patrolR = 110, attackR = 40,
                            attackCd = ATTACK_CD } = {}) {
        ECS.addComponent(world, id, "aiState", AI_PATROL);
        ECS.addComponent(world, id, "aiHomeX", COMPONENTS.positionX[id]);
        ECS.addComponent(world, id, "aiHomeY", COMPONENTS.positionY[id]);
        STATE[id] = {
            detect: detectR, leash: leashR, patrol: patrolR,
            attackR, attackCd,
            speed0: COMPONENTS.ctrlSpeed[id],
            atkCd: 0,
            stuckT: 0, lastX: COMPONENTS.positionX[id], lastY: COMPONENTS.positionY[id],
            side: 0,
            t: 0.5 + Math.random() * 2, // старт патруля вразнобой
            pause: 1,                   // 1 = стоит на паузе между waypoint'ами
            wpx: COMPONENTS.positionX[id],
            wpy: COMPONENTS.positionY[id],
        };
        ECS.addComponent(world, id, "ctrlVI", 0); // бит = сущность на виртуальном вводе
        ECS.addComponent(world, id, "ctrlVJ", 0);
    }

    // ЗОВ СОРАТНИКОВ (особая способность гоблина «call», ENEMY_BESTIARY):
    // все враги в радиусе от точки бросают патруль и бегут на героя —
    // тот же переход, что при естественной aggro-обнаружении.
    function alert(x, y, radius) {
        const entities = world.queries.ai.entities;
        const r2 = radius * radius;
        for (let k = 0; k < entities.length; k++) {
            const id = entities[k], s = STATE[id];
            if (!s) continue;
            const dx = COMPONENTS.positionX[id] - x, dy = COMPONENTS.positionY[id] - y;
            if (dx * dx + dy * dy > r2) continue;
            if (COMPONENTS.aiState[id] !== AI_CHASE) {
                COMPONENTS.aiState[id] = AI_CHASE;
                COMPONENTS.ctrlSpeed[id] = s.speed0 * CHASE_BOOST;
                if (s.atkCd <= 0) s.atkCd = 0.3; // не бить в первый же кадр
            }
        }
    }

    function drive(id, ix, iy) {
        COMPONENTS.ctrlVI[id] = ix;
        COMPONENTS.ctrlVJ[id] = iy;
    }

    // Новый случайный waypoint в круге патруля (проходимый), возле дома
    function pickWaypoint(id, s) {
        for (let t = 0; t < 8; t++) {
            const a = Math.random() * Math.PI * 2;
            const r = s.patrol * (0.3 + Math.random() * 0.7);
            const x = COMPONENTS.aiHomeX[id] + Math.cos(a) * r;
            const y = COMPONENTS.aiHomeY[id] + Math.sin(a) * r;
            if (passable(id, x, y)) {
                s.wpx = x;
                s.wpy = y;
                return;
            }
        }
        s.wpx = COMPONENTS.aiHomeX[id];
        s.wpy = COMPONENTS.aiHomeY[id];
    }

    // Идти к точке: ненулевые оси пишет в виртуальный ввод; вернёт дистанцию
    function seek(id, s, tx, ty) {
        const dx = tx - COMPONENTS.positionX[id];
        const dy = ty - COMPONENTS.positionY[id];
        const d = Math.hypot(dx, dy);
        if (d <= ARRIVE) { drive(id, 0, 0); return d; }
        drive(id, dx / d, dy / d);
        return d;
    }

    function update(ticker) {
        const dt = clamp((ticker && ticker.deltaMS) || 1000 / 60, 0, 50) / 1000;
        const hero = getPlayerPos();
        const entities = world.queries.ai.entities;
        for (let k = entities.length - 1; k >= 0; k--) {
            const id = entities[k];
            const s = STATE[id];
            if (!s) continue;
            const x = COMPONENTS.positionX[id], y = COMPONENTS.positionY[id];
            const dh = Math.hypot(x - COMPONENTS.aiHomeX[id], y - COMPONENTS.aiHomeY[id]);
            const dd = Math.hypot(x - hero.x, y - hero.y);
            if (s.atkCd > 0) s.atkCd -= dt;

            switch (COMPONENTS.aiState[id]) {
                case AI_PATROL: {
                    // Герой в aggro-радиусе — прыжок в погоню (с бустом скорости)
                    if (dd <= s.detect) {
                        COMPONENTS.aiState[id] = AI_CHASE;
                        COMPONENTS.ctrlSpeed[id] = s.speed0 * CHASE_BOOST;
                        s.atkCd = 0.3; // не бить в первый же кадр
                        drive(id, 0, 0);
                        break;
                    }
                    if (s.pause) {
                        drive(id, 0, 0);
                        s.t -= dt;
                        if (s.t <= 0) {
                            s.pause = 0;
                            s.t = WP_BUDGET;
                        }
                    } else {
                        const d = seek(id, s, s.wpx, s.wpy);
                        s.t -= dt;
                        if (d <= ARRIVE || s.t <= 0) {
                            s.pause = 1;
                            s.t = 1 + Math.random() * 2;
                            pickWaypoint(id, s);
                        }
                    }
                    break;
                }
                case AI_CHASE: {
                    // Поводок вытянут или герой ушёл — возврат (скорость базовая)
                    if (dd > s.detect * 1.6 || dh > s.leash) {
                        COMPONENTS.aiState[id] = AI_RETURN;
                        COMPONENTS.ctrlSpeed[id] = s.speed0;
                        drive(id, 0, 0);
                        break;
                    }
                    if (dd <= s.attackR) {
                        // В зоне достижимости оружия: стоим и атакуем с перезарядкой
                        // (цель передаётся прицелом — летящий снаряд летит в неё)
                        drive(id, 0, 0);
                        s.stuckT = 0;
                        if (s.atkCd <= 0 && !COMPONENTS.ctrlLock[id]) {
                            characters.playAttack(id, hero);
                            s.atkCd = s.attackCd;
                        }
                    } else {
                        // Обход препятствий (лёгкий): преследуя героя по прямой,
                        // враг вязнет на камнях/деревьях — если 1.2с нет смещения,
                        // 1.2с идём перпендикуляром, потом снова прямо
                        const moved = Math.hypot(COMPONENTS.positionX[id] - s.lastX,
                                                 COMPONENTS.positionY[id] - s.lastY);
                        s.lastX = COMPONENTS.positionX[id]; s.lastY = COMPONENTS.positionY[id];
                        if (moved < 2) {
                            s.stuckT += dt;
                            if (s.stuckT > 1.2 && !s.side) {
                                s.side = (Math.random() < 0.5 ? 1 : -1);
                                s.sideT = 1.2;
                                s.stuckT = 0;
                            }
                        } else s.stuckT = 0;
                        if (s.side) {
                            s.sideT -= dt;
                            const vx = hero.x - x, vy = hero.y - y;
                            const vd = Math.hypot(vx, vy) || 1;
                            seek(id, s, x + (-vy / vd) * 48 * s.side, y + (vx / vd) * 48 * s.side);
                            if (s.sideT <= 0) s.side = 0;
                        } else {
                            seek(id, s, hero.x, hero.y);
                        }
                    }
                    break;
                }
                case AI_RETURN: {
                    // Домой, героя не замечаем до прихода (классический reset)
                    const d = seek(id, s, COMPONENTS.aiHomeX[id], COMPONENTS.aiHomeY[id]);
                    if (d <= HOME_ARRIVE) {
                        COMPONENTS.aiState[id] = AI_PATROL;
                        s.pause = 1;
                        s.t = 0.5 + Math.random();
                        pickWaypoint(id, s);
                    }
                    break;
                }
            }
        }
    }
    if (addSystem) addSystem(update);

    return { register, alert, update, STATE, STATE_NAMES: AI_STATE_NAMES };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createEnemyAI = createEnemyAI;
