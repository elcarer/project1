// СПОСОБНОСТИ ГЕРОЯ — панель слотов с кулдаунами (клавиши 1..N).
// Набор — HERO_ABILITIES[classKey] (data/abilities.js, адаптации умений
// образца forWork/example); механика каста — здесь (RUN по ключу).
// Панель живёт в app.stage (экранные координаты), внизу по центру;
// place() пересчитывает на resize, show() прячет в меню (как квесты).
//
// ТИК ТОЛЬКО В ИГРОВОЙ СЦЕНЕ: update(ticker) зовётся из scene update
// (НЕ addSystem) — кулдауны и отложенные эффекты (метеорит) замораживаются
// на паузе и в меню.
//
// Механики опираются на боевые данные combat (уровень/статы/цели),
// characters (позиция героя), projectiles.spawn (снаряд с СНИМКОМ урона
// владельца) и combat.applySlow (замедление/ускорение).
//
// Битовый бюджет: НОЛЬ новых компонентов — кулдауны в массиве слотов фабрики.
//
// Пример:
//   const abilities = createAbilities({ app, combat, characters, projectiles,
//                                       fx, assets, heroId, blocked,
//                                       COMPONENTS, DATA, loadout });
//   await abilities.load({ fileMode, embed: EMBED_ABILITIES });
//   // в scene update game: abilities.update(ticker); клавиши 1..N — abilities.use(i)

const ABILITY_SLOT = 52;   // размер слота, px
const ABILITY_GAP = 8;     // зазор между слотами
const ABILITY_BOTTOM = 16; // отступ панели от низа экрана
const ABILITY_DIRS = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] };

function createAbilities({ app, combat, characters, projectiles, fx, assets,
                           heroId, blocked, COMPONENTS, DATA, loadout }) {
    if (!combat || !characters || !projectiles || !fx || !assets) {
        throw new Error("createAbilities: нужны combat, characters, projectiles, fx, assets");
    }
    const defs = loadout;
    if (!defs || !defs.length) throw new Error("createAbilities: не передан loadout");

    // ── СОСТОЯНИЕ СЛОТОВ (кулдауны вне битовой маски — обычные объекты) ────
    const slots = defs.map((def) => ({ def, cd: 0, iconTex: null, root: null,
                                      overlay: null, label: null, secs: null }));
    // Отложенные эффекты (метеорит): { t, x, y, base, critPower, radius }
    const pendings = [];

    // ── ПАНЕЛЬ (app.stage: экран bottom-center) ─────────────────────────────
    const container = new PIXI.Container();
    container.visible = false; // до первого show(true)
    app.stage.addChild(container);
    for (let i = 0; i < slots.length; i++) buildSlot(slots[i], i);
    place();
    function buildSlot(slot, i) {
        const root = new PIXI.Container();
        const S = ABILITY_SLOT;
        const frame = new PIXI.Graphics();
        drawFrame(frame, S, false);
        const icon = new PIXI.Sprite();
        icon.anchor.set(0.5, 0.5);
        icon.width = icon.height = S - 8;
        icon.position.set(S / 2, S / 2);
        const overlay = new PIXI.Graphics();
        const label = new PIXI.Text(String(i + 1), {
            fontFamily: globalThis.GAME_FONT || "monospace",
            fontSize: 15, fill: "#ffd98e", fontWeight: "bold",
        });
        label.position.set(4, 2);
        const secs = new PIXI.Text("", {
            fontFamily: globalThis.GAME_FONT || "monospace",
            fontSize: 19, fill: "#ffffff", fontWeight: "bold",
        });
        secs.anchor.set(0.5);
        secs.position.set(S / 2, S / 2);
        root.addChild(frame, icon, overlay, label, secs);
        container.addChild(root);
        slot.root = root;
        slot.icon = icon;
        slot.overlay = overlay;
        slot.frame = frame;
        slot.secs = secs;
    }
    function drawFrame(g, S, ready) {
        g.clear()
            .roundRect(0, 0, S, S, 8).fill({ color: 0x140f08, alpha: 0.85 })
            .roundRect(0, 0, S, S, 8).stroke({ width: 2, color: ready ? 0xffd98e : 0x6b4a2f });
    }

    function place() {
        const w = app.screen.width, h = app.screen.height;
        const total = slots.length * ABILITY_SLOT + (slots.length - 1) * ABILITY_GAP;
        slots.forEach((slot, i) => {
            slot.root.position.set((w - total) / 2 + i * (ABILITY_SLOT + ABILITY_GAP),
                                   h - ABILITY_SLOT - ABILITY_BOTTOM);
        });
    }

    // ── ЗАГРУЗКА ИКОНОК: по http — живые файлы, на file:// — вшитые data-URL ─
    async function load({ fileMode = false, embed = null, dir = "./images/abilities/" } = {}) {
        for (const slot of slots) {
            const path = dir + slot.def.icon + ".png";
            if (fileMode) {
                if (!embed || !embed[slot.def.icon]) {
                    throw new Error(`abilities.load: нет вшитой иконки ${slot.def.icon} (make_embedded_abilities.py)`);
                }
                slot.iconTex = assets.textureFromDataURL(embed[slot.def.icon]);
            } else {
                slot.iconTex = await assets.loadTexture(path);
            }
            slot.icon.texture = slot.iconTex;
        }
    }

    // ── КАСТ: use(i) → механика по ключу; false = «нельзя» (кулдаун не тратится)
    function use(i) {
        const slot = slots[i];
        if (!slot || slot.cd > 0 || !slot.iconTex) return false;
        const ok = RUN[slot.def.key] ? RUN[slot.def.key](slot.def.params) : false;
        if (ok) slot.cd = slot.def.cooldown;
        return ok;
    }

    function heroPos() {
        return { x: COMPONENTS.positionX[heroId], y: COMPONENTS.positionY[heroId] };
    }

    // ── МЕХАНИКИ (адаптации умений образца) ─────────────────────────────────
    const RUN = {
        // ОГНЕННЫЙ ШАР: снаряд в ближайшего врага, урон = damage + spellPerWis×мудрость
        fireball(p) {
            const from = heroPos();
            const s = combat.stat(heroId);
            let best = null, bd = p.range * p.range;
            for (const t of combat.targetsOf(0)) {
                const dx = COMPONENTS.positionX[t] - from.x;
                const dy = COMPONENTS.positionY[t] - from.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < bd) { bd = d2; best = t; }
            }
            if (!best) {
                fx.text(from.x, from.y - 46, "Нет цели",
                    { color: "#9aa4ad", size: 20, life: 0.7, rise: 20 });
                return false;
            }
            const dx = COMPONENTS.positionX[best] - from.x;
            const dy = COMPONENTS.positionY[best] - from.y - 16;
            const d = Math.hypot(dx, dy) || 1;
            projectiles.spawn({
                type: "fireball", dir: "front",
                x: from.x, y: from.y - 16, // из «груди» героя
                vx: dx / d * p.speed, vy: dy / d * p.speed,
                lifetime: Math.min(2.2, Math.sqrt(bd) / p.speed + 0.6),
                owner: heroId, faction: 0,
                // снимок урона едет на снаряде (как у автоатаки) — SPELL может убить
                attack: { base: p.damage + p.spellPerWis * s.dop.spellPower,
                          critPower: s.dop.critPower },
            });
            fx.burst(from.x, from.y - 16, { count: 8, color: 0xff8833, speedMax: 80, life: 0.4 });
            return true;
        },

        // ПРОНЗАЮЩИЙ РЫВОК / ЗАРЯЖЕННАЯ АТАКА: шагами по взгляду до params.dist;
        // задетые получают 2 + подвижность/2 (dash) или 4 + сила (charge);
        // melee:false — контратака в рывке неуместна
        dash(p) {
            const from = heroPos();
            const s = combat.stat(heroId);
            const anim = DATA.ctrlAnim[heroId] || "walk_front";
            const v = ABILITY_DIRS[anim.slice("walk_".length)] || ABILITY_DIRS.front;
            const step = 4;
            let x = from.x, y = from.y, travelled = 0;
            const hit = new Set();
            const r2 = p.hitR * p.hitR;
            const base = p.damage + Math.round(s.dop.move * (p.moveScale || 0))
                       + Math.round(s.prim.str * (p.strScale || 0));
            while (travelled < p.dist) {
                const nx = x + v[0] * step, ny = y + v[1] * step;
                if (blocked(nx, ny)) break; // стена — рывок гаснет
                x = nx; y = ny; travelled += step;
                for (const t of combat.targetsOf(0)) {
                    if (hit.has(t)) continue;
                    const dx = COMPONENTS.positionX[t] - x;
                    const dy = COMPONENTS.positionY[t] - y;
                    if (dx * dx + dy * dy <= r2) {
                        hit.add(t);
                        combat.dealDamage(heroId, t, { base });
                        fx.burst(COMPONENTS.positionX[t], COMPONENTS.positionY[t] - 16,
                            { count: 6, color: 0x9ad8ff, speedMax: 100, life: 0.5 });
                    }
                }
            }
            COMPONENTS.positionX[heroId] = x;
            COMPONENTS.positionY[heroId] = y;
            fx.burst(from.x, from.y - 12, { count: 10, color: 0xcfe8ff, speedMax: 90, life: 0.5 });
            return true;
        },

        // МОРОЗ: волна вокруг героя — урон + замедление всем в радиусе
        frost(p) {
            const from = heroPos();
            const s = combat.stat(heroId);
            const base = p.damage + Math.round(s.dop.spellPower * p.spellScale);
            for (const t of combat.targetsOf(0)) {
                const dx = COMPONENTS.positionX[t] - from.x;
                const dy = COMPONENTS.positionY[t] - from.y;
                if (dx * dx + dy * dy > p.radius * p.radius) continue;
                combat.dealDamage(heroId, t, { base });
                combat.applySlow(t, p.slowMul, p.slowT);
                fx.burst(COMPONENTS.positionX[t], COMPONENTS.positionY[t] - 14,
                    { count: 5, color: 0x9fd8ff, speedMax: 70, life: 0.5 });
            }
            fx.burst(from.x, from.y - 12, { count: 16, color: 0x9fd8ff, speedMax: 140, life: 0.6 });
            return true; // АоЕ вокруг себя — кастуется всегда
        },

        // ЗАРЯЖЕННАЯ АТАКА рыцаря: тот же рывок, урон от Силы (strScale)
        charge(p) {
            return RUN.dash(p);
        },

        // ВЕЕРНЫЙ БРОСОК плута: count ножей веером по взгляду (±spread радиан),
        // урон каждого = damage + ловкость×agiScale; строка анимации — ближайшая
        // из 8 направлений листа knife к вектору полёта
        fan(p) {
            const from = heroPos();
            const s = combat.stat(heroId);
            const anim = DATA.ctrlAnim[heroId] || "walk_front";
            const base = ABILITY_DIRS[anim.slice("walk_".length)] || ABILITY_DIRS.front;
            const a0 = Math.atan2(base[1], base[0]);
            const dmg = p.damage + Math.round(s.prim.agi * p.agiScale);
            for (let i = 0; i < p.count; i++) {
                const a = a0 + (i - (p.count - 1) / 2) * p.spread;
                const vx = Math.cos(a) * p.speed, vy = Math.sin(a) * p.speed;
                projectiles.spawn({
                    type: "knife", dir: angleDir(a),
                    x: from.x, y: from.y - 16,
                    vx, vy, lifetime: 1.1,
                    owner: heroId, faction: 0,
                    attack: { base: dmg, critPower: s.dop.critPower },
                });
            }
            fx.burst(from.x, from.y - 16, { count: 6, color: 0xcfd8e8, speedMax: 70, life: 0.35 });
            return true;
        },

        // КРЮК-КОШКА плута: притягивает ближайшего врага (шагами, без стен)
        // и наносит 2 + мудрость×wisScale — урон НЕ зависит от того,
        // удалось ли дотащить (так в образце: «Притягивает. Наносит урон.»)
        pull(p) {
            const from = heroPos();
            const s = combat.stat(heroId);
            let best = null, bd = p.range * p.range;
            for (const t of combat.targetsOf(0)) {
                const dx = COMPONENTS.positionX[t] - from.x;
                const dy = COMPONENTS.positionY[t] - from.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < bd) { bd = d2; best = t; }
            }
            if (!best) {
                fx.text(from.x, from.y - 46, "Нет цели",
                    { color: "#9aa4ad", size: 20, life: 0.7, rise: 20 });
                return false;
            }
            const step = 8;
            while (true) {
                const dx = from.x - COMPONENTS.positionX[best];
                const dy = from.y - COMPONENTS.positionY[best];
                const d = Math.hypot(dx, dy);
                if (d <= p.stopDist) break;
                const nx = COMPONENTS.positionX[best] + dx / d * step;
                const ny = COMPONENTS.positionY[best] + dy / d * step;
                if (blocked(nx, ny)) break; // упёрся в препятствие — тяга кончилась
                COMPONENTS.positionX[best] = nx;
                COMPONENTS.positionY[best] = ny;
            }
            combat.dealDamage(heroId, best,
                { base: p.damage + Math.round(s.dop.spellPower * p.wisScale) });
            fx.burst(COMPONENTS.positionX[best], COMPONENTS.positionY[best] - 16,
                { count: 8, color: 0xbfa96f, speedMax: 90, life: 0.45 });
            return true;
        },

        // УСКОРЕНИЕ (Теневое скольжение / Разгон): combat.applySlow с mul > 1 —
        // тот же таймер, что у замедления, восстанавливает скорость сам
        haste(p) {
            combat.applySlow(heroId, 1 + p.bonus / 100, p.dur);
            fx.burst(heroPos().x, heroPos().y - 14,
                { count: 10, color: 0xffe9a8, speedMax: 80, life: 0.5 });
            return true;
        },

        // ЛЕЧЕНИЕ (Восстановление / Аура восстановления): amount + вит×vitScale,
        // выносливость усиливает внутри combat.heal; при полных ХП каст не тратится
        heal(p) {
            const s = combat.stat(heroId);
            const max = COMPONENTS.maxHp[heroId];
            if (COMPONENTS.hp[heroId] >= max) {
                fx.text(heroPos().x, heroPos().y - 46, "Здоров",
                    { color: "#9aa4ad", size: 20, life: 0.7, rise: 20 });
                return false;
            }
            combat.heal(heroId, p.amount + Math.round(s.prim.vit * p.vitScale));
            fx.burst(heroPos().x, heroPos().y - 20,
                { count: 10, color: 0x7fe07f, speedMax: 60, life: 0.6 });
            return true;
        },

        // КАЗНЬ рыцаря: добивает ближайшего врага с ХП ≤ threshold; убийство
        // идёт через dealDamage — засчитывается квестам и даёт опыт
        execute(p) {
            const from = heroPos();
            let best = null, bd = p.range * p.range;
            for (const t of combat.targetsOf(0)) {
                const dx = COMPONENTS.positionX[t] - from.x;
                const dy = COMPONENTS.positionY[t] - from.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < bd && COMPONENTS.hp[t] / COMPONENTS.maxHp[t] <= p.threshold) {
                    bd = d2; best = t;
                }
            }
            if (!best) {
                fx.text(from.x, from.y - 46, "Нет жертвы",
                    { color: "#9aa4ad", size: 20, life: 0.7, rise: 20 });
                return false;
            }
            combat.dealDamage(heroId, best, { base: 99999 });
            fx.burst(COMPONENTS.positionX[best], COMPONENTS.positionY[best] - 16,
                { count: 14, color: 0xff5c4d, speedMax: 130, life: 0.6 });
            return true;
        },

        // МЕТЕОРИТ волшебницы: падает через delay сек в точку ближайшего врага
        // (≤range), урон по площади; отложенный тик — в update() (заморожен на паузе)
        meteor(p) {
            const from = heroPos();
            const s = combat.stat(heroId);
            let best = null, bd = p.range * p.range;
            for (const t of combat.targetsOf(0)) {
                const dx = COMPONENTS.positionX[t] - from.x;
                const dy = COMPONENTS.positionY[t] - from.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < bd) { bd = d2; best = t; }
            }
            if (!best) {
                fx.text(from.x, from.y - 46, "Нет цели",
                    { color: "#9aa4ad", size: 20, life: 0.7, rise: 20 });
                return false;
            }
            pendings.push({
                t: p.delay,
                x: COMPONENTS.positionX[best],
                y: COMPONENTS.positionY[best],
                base: p.damage + p.spellPerWis * s.dop.spellPower,
                critPower: s.dop.critPower,
                radius: p.radius,
            });
            fx.burst(COMPONENTS.positionX[best], COMPONENTS.positionY[best] - 6,
                { count: 6, color: 0xff8833, speedMax: 40, life: p.delay });
            return true;
        },
    };

    // Ближайшая из 8 строк анимации knife к углу полёта (для веера ножей).
    // Экранная ось Y направлена ВНИЗ: угол 0 — right, π/2 — front (вниз),
    // π — left, 3π/2 — back (вверх)
    const ANGLE_DIRS = ["right", "downright", "front", "downleft",
        "left", "topleft", "back", "topright"];
    function angleDir(a) {
        const k = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
        return ANGLE_DIRS[k];
    }

    // ── КАДР: тик кулдаунов/отложенных эффектов + перерисовка шторок ───────
    function update(ticker) {
        const dt = Math.min((ticker && ticker.deltaMS) || 1000 / 60, 50) / 1000;
        for (const slot of slots) {
            if (slot.cd <= 0) continue;
            slot.cd = Math.max(0, slot.cd - dt);
            drawCooldown(slot);
        }
        // Метеориты: падение в назначенную точку — урон по площади
        for (let i = pendings.length - 1; i >= 0; i--) {
            const m = pendings[i];
            m.t -= dt;
            if (m.t > 0) continue;
            pendings.splice(i, 1);
            const r2 = m.radius * m.radius;
            for (const t of combat.targetsOf(0)) {
                const dx = COMPONENTS.positionX[t] - m.x;
                const dy = COMPONENTS.positionY[t] - m.y;
                if (dx * dx + dy * dy <= r2) {
                    combat.dealDamage(heroId, t, { base: m.base, critPower: m.critPower });
                }
            }
            fx.burst(m.x, m.y - 10, { count: 24, color: 0xff8833, speedMax: 180,
                life: 0.7, gravity: 300 });
        }
    }
    function drawCooldown(slot) {
        const S = ABILITY_SLOT;
        const g = slot.overlay;
        g.clear();
        if (slot.cd > 0) {
            const frac = slot.cd / slot.def.cooldown;
            g.rect(0, 0, S, S * frac).fill({ color: 0x000000, alpha: 0.62 });
            slot.secs.text = slot.cd >= 1 ? String(Math.ceil(slot.cd)) : slot.cd.toFixed(1);
            slot.secs.visible = true;
        } else {
            slot.secs.visible = false;
        }
    }

    function show(v) { container.visible = v; }
    function snapshot() {
        return slots.map((s) => ({ key: s.def.key, name: s.def.name,
                                   cd: Math.round(s.cd * 100) / 100, max: s.def.cooldown }));
    }

    return { load, use, update, place, show, snapshot, container };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createAbilities = createAbilities;
