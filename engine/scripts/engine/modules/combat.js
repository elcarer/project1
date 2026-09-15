// БОЕВАЯ И РОЛЕВАЯ СИСТЕМА — ХП, разрешение удара, смерть, опыт и уровни.
// Ролевая модель (формулы — data/stats.js, образец forWork/countDopStats.js):
// 5 основных характеристик (Сила/Ловкость/Здоровье/Скорость/Мудрость) →
// вторичные статы (attack/block/counter/crit/critPower/dodge/hpMax/resist/
// endurance/move/cdrAbility/cdrAttack/spellPower/xpBoost/counterMagic).
// Удар разрешается цепочкой: уклонение (весь урон мимо) → крит (×мощь крита,
// со 150%) → блок (половина урона) → вычет ХП → смерть/контратака.
//
// Попадания приходят ОТ СНАРЯДОВ: атака персонажа на кадре spawnTick выпускает
// снаряд (modules/projectiles.js), при выпуске снаряд получает снимок боевых
// данных владельца (фракция + бросок урона) через колбэки getFaction/getAttack.
// Оружие ближнего боя бьёт разовым АоЕ в момент появления, летящий снаряд —
// при касании противника. Смерть: полная анимация death (последний кадр
// держится), корпус тает и сущность убирается; герой возрождается с полным ХП.
// Убийства дают опыт только герою: кривая xpToNext, на уровне растут основные
// статы (growth), здоровье пополняется полностью.
//
// Битовый бюджет: НОЛЬ новых компонентов — ХП живут в компонентах hp/maxHp,
// зарегистрированных modules/health.js при загрузке страницы; ролевые данные
// (статы, фракция) — обычные массивы фабрики, как STATE в modules/ai.js.
//
// Пример:
//   const combat = createCombat({ world, ECS, COMPONENTS, DATA, addSystem,
//                                 characters, projectiles, fx });
//   combat.init(id, { faction: 1, lvl: 2, prim: ENEMY_STATS.rat.prim, ... });
//   // дальше бой идёт сам: атаки выпускают снаряды, их попадания этот модуль
//   // превращает в цифры урона, полоски ХП, смерть и опыт

const MELEE_HIT_R = 40;    // радиус разового АоЕ оружия ближнего боя (px)
const RESPAWN_DELAY = 2.5; // секунд до возрождения героя

function createCombat({ world, ECS, COMPONENTS, DATA, addSystem = null,
                        characters, projectiles, fx, onRemove = null, onKill = null }) {
    if (!characters || !projectiles || !fx) throw new Error("createCombat: нужны characters, projectiles и fx");
    const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
    // ХП — существующие компоненты health.js (повторная регистрация идемпотентна)
    ECS.registerComponent("hp", Float32Array);
    ECS.registerComponent("maxHp", Float32Array);

    // Ролевые данные БЕЗ бит компонент (как STATE в ai.js)
    const STAT = [];    // id → { hero, lvl, xp, xpReward, prim, growth, weaponMin,
                        //      dop, baseSpeed, size, dead, deathDone, respawnT,
                        //      fadeIn, flashT, ctrGuardT, bar }
    const FACTION = []; // id → 0 (сторона героя) | 1 (враги); −1 после уборки

    // ── ВЫДАЧА РОЛЕВЫХ СТАТОВ — вызывать после characters.spawn ─────────────
    // Скорость спавна считается базовой (100%); подвижность добавляет проценты.
    function init(id, { faction = 1, hero = false, lvl = 1, prim,
                        growth = null, weaponMin = 1, xpReward = 0, size = 64 }) {
        const p = { str: prim.str, agi: prim.agi, vit: prim.vit, spd: prim.spd, wis: prim.wis };
        const dop = calcDop(p);
        STAT[id] = {
            hero, lvl, xp: 0, xpReward, prim: p,
            growth: growth ? { ...growth } : null,
            weaponMin, dop,
            baseSpeed: COMPONENTS.ctrlSpeed[id], // скорость спавна = 100%
            size, dead: false, deathDone: false, respawnT: 0, fadeIn: 0,
            flashT: 0, ctrGuardT: 0, bar: null,
        };
        FACTION[id] = faction;
        ECS.addComponent(world, id, "hp", dop.hpMax);
        ECS.addComponent(world, id, "maxHp", dop.hpMax);
        if (dop.move) COMPONENTS.ctrlSpeed[id] *= 1 + dop.move / 100;
        return STAT[id];
    }

    function stat(id) { return STAT[id] || null; }
    function dopOf(id) { return STAT[id] ? STAT[id].dop : null; }
    function factionOf(id) { return FACTION[id] ?? -1; }
    function alive(id) { return !!(STAT[id] && !STAT[id].dead && world.active[id]); }
    function hpRatio(id) {
        if (!STAT[id] || !world.active[id]) return 0;
        const max = COMPONENTS.maxHp[id];
        return max > 0 ? COMPONENTS.hp[id] / max : 0;
    }
    function xpRatio(id) {
        const s = STAT[id];
        if (!s) return 0;
        const need = xpToNext(s.lvl);
        return need > 0 ? Math.min(1, s.xp / need) : 0;
    }

    // ── БРОСОК УРОНА основного удара: weaponMin..attack (attack = Сила) ──────
    // Снимок делается В МОМЕНТ ВЫЛЕТА снаряда (projectiles спрашивает через
    // колбэк getAttack) — смерть стрелка в полёте не ломает попадание.
    function rollAttack(id) {
        const s = STAT[id];
        if (!s) return null;
        const max = Math.max(s.weaponMin, s.dop.attack);
        return {
            base: s.weaponMin + Math.floor(Math.random() * (max - s.weaponMin + 1)),
            critPower: s.dop.critPower,
        };
    }

    // ── ПОЛОСКА ХП НАД ГОЛОВОЙ — ребёнок спрайта: culling и «ряды ног» ───────
    // достаются бесплатно (прячется и переезжает вместе с телом). Показывается,
    // только пока ХП не полные; перерисовывается при изменении.
    function updateBar(id) {
        const s = STAT[id];
        if (!s || !world.active[id]) return;
        const hp = COMPONENTS.hp[id], max = COMPONENTS.maxHp[id];
        if (hp >= max && !s.bar) return; // здоров — полоска не нужна
        if (!s.bar) {
            const sprite = DATA.spriteMap[id];
            if (!sprite) return;
            s.bar = new PIXI.Graphics();
            sprite.addChild(s.bar);
        }
        const g = s.bar;
        if (hp >= max) { g.visible = false; return; }
        const w = Math.max(20, s.size * 0.35), h = 3, top = -s.size + 3;
        g.clear()
            .rect(-w / 2 - 1, top - 1, w + 2, h + 2).fill(0x000000)
            .rect(-w / 2, top, w, h).fill(0x3a0d0d)
            .rect(-w / 2, top, w * clamp(hp / max, 0, 1), h).fill(0xe03c30);
        g.visible = true;
    }

    // Всплывающая подпись над головой (цифры урона, «уклон», опыт, уровни)
    function floatText(id, str, color, size = 22, life = 0.8) {
        const s = STAT[id];
        if (!s || !world.active[id]) return;
        fx.text(
            COMPONENTS.positionX[id] + (Math.random() * 18 - 9),
            COMPONENTS.positionY[id] - s.size * 0.55,
            str, { color, size, life, rise: 34 },
        );
    }

    // ── РАЗРЕШЕНИЕ УДАРА: уклон → крит → блок → ХП → смерть/контратака ───────
    function dealDamage(attackerId, targetId, { base, critPower = 150, melee = false }) {
        const t = STAT[targetId];
        if (!t || t.dead || !world.active[targetId]) return 0;
        const d = t.dop;
        // Уклонение — атака целиком уходит вмимо
        if (Math.random() * 100 < d.dodge) {
            floatText(targetId, "уклон", "#7dd8ff");
            return 0;
        }
        // Крит бьющего: урон × мощь крита (в %, начало со 150)
        let dmg = base, crit = false;
        if (STAT[attackerId] && Math.random() * 100 < STAT[attackerId].dop.crit) {
            crit = true;
            dmg = Math.round(base * critPower / 100);
        }
        // Блок — шанс получить лишь половину урона
        const blocked = Math.random() * 100 < d.block;
        if (blocked) dmg = Math.max(1, Math.floor(dmg / 2));
        COMPONENTS.hp[targetId] = Math.max(0, COMPONENTS.hp[targetId] - dmg);
        floatText(targetId, crit ? `${dmg}!` : String(dmg),
            crit ? "#ffc531" : blocked ? "#9aa4ad" : "#ffffff",
            crit ? 28 : 22, crit ? 1.1 : 0.8);
        // Вспышка попадания
        t.flashT = 0.12;
        const sprite = DATA.spriteMap[targetId];
        if (sprite) sprite.tint = 0xff9d9d;
        updateBar(targetId);
        if (COMPONENTS.hp[targetId] <= 0) {
            death(targetId, attackerId);
            return dmg;
        }
        // Контратака — выжил под ударом ближнего боя и ответил своим оружием
        // (гвард против пинг-понга: контратить можно лишь раз в 1.2 с)
        if (melee && t.ctrGuardT <= 0 && Math.random() * 100 < d.counter
            && !COMPONENTS.ctrlLock[targetId] && characters.playAttack(targetId)) {
            t.ctrGuardT = 1.2;
        }
        return dmg;
    }

    // ── ОПЫТ И УРОВНИ: кривая xpToNext, рост основных статов, полный хил ─────
    function addXP(id, xp) {
        const s = STAT[id];
        if (!s || xp <= 0) return;
        s.xp += xp;
        let need = xpToNext(s.lvl);
        while (s.xp >= need && need > 0) {
            s.xp -= need;
            s.lvl += 1;
            const g = s.growth;
            if (g) {
                s.prim.str += g.str; s.prim.agi += g.agi; s.prim.vit += g.vit;
                s.prim.spd += g.spd; s.prim.wis += g.wis;
            }
            s.dop = calcDop(s.prim);
            COMPONENTS.maxHp[id] = s.dop.hpMax;
            COMPONENTS.hp[id] = s.dop.hpMax; // новый уровень — полное здоровье
            COMPONENTS.ctrlSpeed[id] = s.baseSpeed * (1 + s.dop.move / 100);
            floatText(id, `УРОВЕНЬ ${s.lvl}`, "#cc7dee", 28, 1.6);
            updateBar(id);
            need = xpToNext(s.lvl);
        }
    }

    // Награда за убийство: только герою; обучаемость может удвоить опыт
    function awardKill(killerId, victimId) {
        const k = STAT[killerId], v = STAT[victimId];
        if (!k || !v || !k.hero || !v.xpReward) return;
        const doubled = Math.random() * 100 < k.dop.xpBoost;
        const xp = v.xpReward * (doubled ? 2 : 1);
        addXP(killerId, xp);
        floatText(killerId, `+${xp} оп${doubled ? " ×2" : ""}`, "#a8e05f");
        if (onKill) onKill(killerId, victimId); // событие для квестов и ачивок
    }

    // ── СМЕРТЬ: анимация death держит последний кадр, корпус тает ────────────
    // Герой вместо уборки возрождается через RESPAWN_DELAY секунд.
    function death(id, killerId) {
        const s = STAT[id];
        if (!s || s.dead) return;
        s.dead = true;
        COMPONENTS.ctrlLock[id] = 1;  // мёртвым не управляют ни ввод, ни покой
        COMPONENTS.ctrlMove[id] = 0;
        COMPONENTS.ctrlSpeed[id] = 0; // и не ходят
        ECS.removeComponent(world, id, "aiState"); // ИИ забывает сущность
        COMPONENTS.ctrlVI[id] = 0;
        COMPONENTS.ctrlVJ[id] = 0;
        awardKill(killerId, id);
        if (s.bar) s.bar.visible = false;
        const sprite = DATA.spriteMap[id];
        if (!sprite) { s.deathDone = true; return; }
        sprite.tint = 0xffffff;
        // Свой onComplete: после анимации ДЕРЖАТЬ последний кадр (штатный
        // onComplete спавна снял бы ctrlLock — мёртвые не встают)
        sprite.onComplete = () => {
            s.deathDone = true;
            sprite.gotoAndStop(sprite.textures.length - 1);
        };
        // play вернёт false у закуленной (culling) или без строки death — тогда
        // играть нечего, считаем анимацию сразу завершённой
        if (!characters.play(id, "death")) s.deathDone = true;
        if (s.hero) s.respawnT = RESPAWN_DELAY;
    }

    // Возрождение героя: полное ХП, спавн-поза (стоп-кадр вниз), проявление
    function revive(id) {
        const s = STAT[id];
        if (!s) return;
        s.dead = false;
        s.deathDone = false;
        COMPONENTS.hp[id] = COMPONENTS.maxHp[id];
        COMPONENTS.ctrlSpeed[id] = s.baseSpeed * (1 + s.dop.move / 100);
        COMPONENTS.ctrlLock[id] = 0;
        COMPONENTS.ctrlIdleT[id] = 0;
        const sprite = DATA.spriteMap[id];
        if (sprite) {
            sprite.onComplete = () => { if (world.active[id]) COMPONENTS.ctrlLock[id] = 0; };
            const anims = DATA.ctrlAnims[id];
            DATA.ctrlAnim[id] = "walk_front";
            if (anims && anims.walk_front) {
                sprite.textures = anims.walk_front;
                sprite.loop = false;
                sprite.gotoAndStop(0);
            }
            sprite.alpha = 0;
        }
        s.fadeIn = 1;
        updateBar(id);
    }

    // Лечение: выносливость добавляет % к количеству лечения
    function heal(id, amount) {
        const s = STAT[id];
        if (!s || !world.active[id] || s.dead || amount <= 0) return 0;
        const max = COMPONENTS.maxHp[id];
        const hp = Math.min(max, COMPONENTS.hp[id] + amount * (1 + s.dop.endurance / 100));
        const given = Math.round(hp - COMPONENTS.hp[id]);
        COMPONENTS.hp[id] = hp;
        if (given > 0) floatText(id, `+${given}`, "#7fe07f");
        updateBar(id);
        return given;
    }

    function giveXp(id, xp) { addXP(id, xp); }

    // Живые противники фракции (персонажи чужой фракции)
    function targetsOf(faction) {
        const out = [];
        const entities = world.queries.characters.entities;
        for (let i = 0; i < entities.length; i++) {
            const id = entities[i];
            if (alive(id) && FACTION[id] !== faction) out.push(id);
        }
        return out;
    }

    // ── КАДР СИСТЕМЫ: попадания снарядов → тление трупов / возрождение ───────
    function update(ticker) {
        const dt = clamp((ticker && ticker.deltaMS) || 1000 / 60, 0, 50) / 1000;

        // 1) Коллизии снарядов с противниками. Боевые данные (фракция, бросок
        //    урона) снаряд получил при выпуске — STAT владельца к моменту
        //    попадания может быть уже убран (стрелок умер в полёте).
        for (const id of projectiles.ACTIVE) {
            const p = projectiles.PROJ[id];
            if (!p || !p.attack || p.faction < 0 || p.hit === 2) continue;
            const px = COMPONENTS.positionX[id], py = COMPONENTS.positionY[id];
            if (p.vx === 0 && p.vy === 0) {
                // Оружие ближнего боя: разовое АоЕ в момент появления
                if (p.hit) continue;
                p.hit = 1;
                const r2 = MELEE_HIT_R * MELEE_HIT_R;
                for (const t of targetsOf(p.faction)) {
                    const dx = COMPONENTS.positionX[t] - px;
                    const dy = COMPONENTS.positionY[t] - py;
                    if (dx * dx + dy * dy <= r2) {
                        dealDamage(p.owner, t,
                            { base: p.attack.base, critPower: p.attack.critPower, melee: true });
                    }
                }
            } else {
                // Летящий снаряд: попадание в первую цель под ним
                for (const t of targetsOf(p.faction)) {
                    const rr = STAT[t].size * 0.3 + 4;
                    const dx = COMPONENTS.positionX[t] - px;
                    const dy = COMPONENTS.positionY[t] - py;
                    if (dx * dx + dy * dy <= rr * rr) {
                        p.hit = 2; // один снаряд — одно попадание
                        dealDamage(p.owner, t,
                            { base: p.attack.base, critPower: p.attack.critPower });
                        projectiles.kill(id);
                        break;
                    }
                }
            }
        }

        // 2) Состояния сущностей: вспышки, гварды контратак, смерть/возрождение
        for (let id = 0; id < STAT.length; id++) {
            const s = STAT[id];
            if (!s || !world.active[id]) continue;
            if (s.ctrGuardT > 0) s.ctrGuardT -= dt;
            if (s.flashT > 0) {
                s.flashT -= dt;
                if (s.flashT <= 0) {
                    const sp = DATA.spriteMap[id];
                    if (sp) sp.tint = 0xffffff;
                }
            }
            if (s.fadeIn > 0) {
                s.fadeIn = Math.max(0, s.fadeIn - dt * 1.5);
                const sp = DATA.spriteMap[id];
                if (sp) sp.alpha = 1 - s.fadeIn;
            }
            if (!s.dead) continue;
            if (s.hero) {
                if (s.deathDone) {
                    s.respawnT -= dt;
                    if (s.respawnT <= 0) revive(id);
                }
                continue;
            }
            if (!s.deathDone) continue;
            const sp = DATA.spriteMap[id];
            if (sp) {
                sp.alpha -= dt * 1.6;
                if (sp.alpha > 0) continue;
                // Корпус исчез: character-спрайты вне configId-пулов ядра —
                // убираем сами (как projectiles), в ядерный пул не возвращаем
                sp.removeFromParent();
                DATA.spriteMap[id] = null;
                projectiles.BOUND[id] = null;
            }
            STAT[id] = null;
            FACTION[id] = -1;
            ECS.removeEntity(world, id);
            if (onRemove) onRemove(id);
        }
    }
    if (addSystem) addSystem(update);

    return { init, stat, dopOf, factionOf, alive, hpRatio, xpRatio,
             rollAttack, dealDamage, heal, giveXp, revive, update };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createCombat = createCombat;
