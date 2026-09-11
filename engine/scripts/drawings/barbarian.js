// РИСОВАЛЬЩИК ВАРВАРА 128×128 (референс: рогалик/png/barbarian.png).
// Техника некроманта (кривые, эллипсы, автообводка) ПЛЮС:
//  1) ТЕНИ: свет сверху-слева — блики SKIN_L сверху-слева форм, тени SKIN_D/D_D
//     снизу-справа, переходы дизерингом; наземная тень под ногами (мягкий край).
//  2) СЛОИ ЭФФЕКТОВ: o.behind — до тела (удар «по ту сторону» фигуры, частично
//     перекрыт), o.front — после обводки (поверх). flipX() — только на уровне
//     КАДРА и последним: персонаж и эффект отражаются вместе.
// СТАНДАРТНЫЙ НАБОР: walk_* ×4, attack_* ×4, wait ×4, death ×5, damage ×2
// → 11 строк, 43 кадра. Сборка идемпотентна (перезапуск не плодит кадры).
function run(E) {
    // ---- палитра по референсу ----
    const SKIN   = "#d9a06a";  // загорелая кожа
    const SKIN_L = "#e9b681";  // блик (свет сверху-слева)
    const SKIN_D = "#b57e4c";  // тень
    const SKIN_DD= "#8f5f36";  // глубокая тень
    const HAIR   = "#8a5a2e";  // каштановые волосы/борода
    const HAIR_L = "#a8723c";
    const HAIR_D = "#5e3a1a";
    const BAND   = "#3a2e26";  // кожаная повязка
    const STUD   = "#c8b892";  // заклёпки
    const FUR    = "#8a6a42";  // мех
    const FUR_L  = "#a58455";
    const FUR_D  = "#644a2c";
    const LEA    = "#5a3a22";  // ремни
    const LEA_D  = "#3d2513";
    const PANT   = "#6b6f42";  // зеленоватые штаны
    const PANT_D = "#4c4f2e";
    const BOOT   = "#7a5632";  // меховые сапоги
    const BOOT_D = "#57391e";
    const STEEL  = "#c8d2dc";  // топор
    const STEEL_D= "#8a97a5";
    const STEEL_L= "#eef4f8";
    const WOOD   = "#6a4a2c";
    const WOOD_D = "#4a3018";
    const EYE    = "#241a10";
    const SH_C   = "#0e0c0a";  // наземная тень
    const K      = "#14100c";  // контур

    // ---- помощники ----
    // ВАЖНО: LN получает ТОЛЬКО целые (округляем на входе) — Брезенхэм
    // завершается точным равенством, с float координатами он зависает навсегда.
    const R = (x, y, w, h, c) => E.rect(Math.round(x), Math.round(y), w, h, c);
    const P = (x, y, c) => E.px(Math.round(x), Math.round(y), c);
    const G = (x, y) => E.get(x, y);
    const LN = (x0, y0, x1, y1, c, t = 1) => {
        x0 = Math.round(x0); y0 = Math.round(y0);
        x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy, x = x0, y = y0;
        const o = (t / 2) | 0;
        let guard = dx + dy + 4;                 // предохранитель от зависания
        while (true) {
            R(x - o, y - o, t, t, c);
            if ((x === x1 && y === y1) || guard-- <= 0) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
    };
    const ell = (cx, cy, rx, ry, c) => {
        for (let dy = -ry; dy <= ry; dy++) {
            const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
            R(cx - w, cy + dy, w * 2 + 1, 1, c);
        }
    };
    const bez = (x0, y0, cx, cy, x1, y1, c, t = 1) => {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 8);
        const o = (t / 2) | 0;
        for (let i = 0; i <= n; i++) {
            const u = i / n, v = 1 - u;
            R(Math.round(v * v * x0 + 2 * v * u * cx + u * u * x1) - o,
              Math.round(v * v * y0 + 2 * v * u * cy + u * u * y1) - o, t, t, c);
        }
    };
    const strand = (x, y0, y1, c, amp = 1, ph = 0) => {
        for (let y = y0; y <= y1; y++) P(x + Math.round(Math.sin((y - y0) * 0.5 + ph) * amp), y, c);
    };
    const dither = (x, y, w, h, c) => {
        for (let j = 0; j < h; j++) for (let i = (j % 2); i < w; i += 2) P(x + i, y + j, c);
    };
    // Наземная тень: мягкий рваный край (клетка по периметру), плотная середина.
    const shadow = (cx, cy, rx, ry) => {
        for (let j = -ry; j <= ry; j++) {
            const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (j * j) / (ry * ry))));
            for (let i = -w; i <= w; i++) {
                const edge = i <= -w + 2 || i >= w - 2 || j >= ry - 1;
                if (edge && ((i + j) & 1)) continue;
                P(cx + i, cy + j, SH_C);
            }
        }
    };
    // Автообводка силуэта 1 px (пылинки не обводятся).
    const outlineAll = () => {
        const has = (x, y) => x >= 0 && x < 128 && y >= 0 && y < 128 && !!G(x, y);
        const nb = (x, y) => has(x - 1, y) + has(x + 1, y) + has(x, y - 1) + has(x, y + 1);
        const to = [];
        for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
            if (has(x, y)) continue;
            if ((has(x - 1, y) && nb(x - 1, y) >= 2) || (has(x + 1, y) && nb(x + 1, y) >= 2) ||
                (has(x, y - 1) && nb(x, y - 1) >= 2) || (has(x, y + 1) && nb(x, y + 1) >= 2)) to.push(x + y * 128);
        }
        for (const i of to) P(i % 128, (i / 128) | 0, K);
    };

    // ---- топор: древко + параметрическая голова ----
    function shaftLine(x0, y0, x1, y1) {
        LN(x0, y0, x1, y1, WOOD, 3);
        LN(x0 + 1, y0, x1 + 1, y1, WOOD_D, 1);
    }
    // Голова топора в (hx,hy); древко идёт вдоль (dx,dy); лезвие по перпендикуляр
    // со стороной side (+1/-1). Свет сверху-слева: кромка STEEL_L, внутренняя тень.
    function axeHead(hx, hy, dx, dy, side) {
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const vx = -uy * side, vy = ux * side;    // направление на лезвие
        // клюв-обух с обратной стороны
        LN(hx - vx * 2, hy - vy * 2, hx - vx * 8 + ux * 2, hy - vy * 8 + uy * 2, STEEL_D, 3);
        LN(hx - vx * 2, hy - vy * 2, hx - vx * 8 + ux * 2, hy - vy * 8 + uy * 2, STEEL, 1);
        // втулка
        ell(hx, hy, 3, 3, STEEL_D);
        ell(hx - 1, hy - 1, 2, 2, STEEL);
        // лезвие: заполняем между верхней и нижней кромками (квадратичные кривые)
        const N = 16;
        const pt = (a, b, c, t) => {
            const v = 1 - t;
            return {
                x: v * v * a.x + 2 * v * t * b.x + t * t * c.x,
                y: v * v * a.y + 2 * v * t * b.y + t * t * c.y,
            };
        };
        const A = { x: hx + ux * 6, y: hy + uy * 6 };          // верх у втулки
        const B = { x: hx - ux * 6, y: hy - uy * 6 };          // низ у втулки
        const CA = { x: hx + ux * 3 + vx * 13, y: hy + uy * 3 + vy * 13 };
        const CB = { x: hx - ux * 3 + vx * 13, y: hy - uy * 3 + vy * 13 };
        const tip = { x: hx + vx * 17, y: hy + vy * 17 };
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const pA = pt(A, CA, tip, t), pB = pt(B, CB, tip, t);
            LN(Math.round(pA.x), Math.round(pA.y), Math.round(pB.x), Math.round(pB.y), STEEL, 2);
        }
        // режущая кромка (дуга через остриё) — светлая; внутренняя часть — темнее
        const E0 = { x: hx + ux * 3 + vx * 9, y: hy + uy * 3 + vy * 9 };
        const E1 = { x: hx - ux * 3 + vx * 9, y: hy - uy * 3 + vy * 9 };
        bez(E0.x, E0.y, tip.x, tip.y, E1.x, E1.y, STEEL_L, 1);
        bez(hx + ux * 5, hy + uy * 5, hx + vx * 6, hy + vy * 6, hx - ux * 5, hy - uy * 5, STEEL_D, 1);
    }

    // ---- части (спереди). Свет сверху-слева ----
    function legsFront(b, dyL = 0, dyR = 0) {
        // штаны
        R(45, 88 + b, 11, 14 + dyL, PANT); R(60, 88 + b, 11, 14 + dyR, PANT);
        R(45, 96 + b, 3, 6 + dyL, PANT_D); R(68, 96 + b, 3, 6 + dyR, PANT_D); // тень сбоку
        R(49, 88 + b, 2, 12 + dyL, PANT_D); R(63, 92 + b, 2, 8 + dyR, PANT_D); // складки
        // сапоги с мехом
        const boot = (x, dy) => {
            R(x, 102 + b + dy, 13, 16, BOOT);                          // весь сапог поднимается
            for (let yy = 102 + b + dy; yy < 110 + b + dy; yy += 2) {  // лохмотья меха
                for (let xx = x; xx < x + 13; xx += 3) P(xx + ((yy / 2) | 0) % 2, yy, BOOT_D);
            }
            R(x, 118 + b + dy, 13, 2, BOOT_D);                         // подошва вместе с шагом
            R(x - 1, 104 + b + dy, 2, 6, BOOT_D);                      // пятка
        };
        boot(44, dyL); boot(61, dyR);
    }
    function torsoFront(b, sway = 0) {
        for (let y = 52; y <= 88; y++) {
            const t = (y - 52) / 36;
            const hw = Math.round(23 - 7 * t);
            R(58 + sway - hw, y + b, hw * 2, 1, SKIN);
            R(58 + sway + hw - 3, y + b, 3, 1, SKIN_D);               // тень справа
            if (y % 2 === 0) P(58 + sway + hw - 4, y + b, SKIN_D);     // переход дизерингом
            P(58 + sway - hw + 1, y + b, SKIN_L);                      // блик слева
        }
        // грудные мышцы
        bez(46 + sway, 64 + b, 52 + sway, 70 + b, 57 + sway, 64 + b, SKIN_D, 1);
        bez(59 + sway, 64 + b, 64 + sway, 70 + b, 70 + sway, 64 + b, SKIN_D, 1);
        R(57 + sway, 56 + b, 2, 8, SKIN_D);                            // центр
        R(42 + sway, 56 + b, 6, 2, SKIN_L); R(70 + sway, 56 + b, 5, 2, SKIN_L);
        // пресс
        R(57 + sway, 72 + b, 2, 10, SKIN_D);
        R(50 + sway, 74 + b, 6, 1, SKIN_D); R(60 + sway, 74 + b, 6, 1, SKIN_D);
        R(50 + sway, 80 + b, 6, 1, SKIN_D); R(60 + sway, 80 + b, 6, 1, SKIN_D);
    }
    function beltFront(b, sway = 0) {
        R(42 + sway, 84 + b, 32, 6, LEA);
        R(42 + sway, 88 + b, 32, 2, LEA_D);
        R(55 + sway, 84 + b, 7, 6, STEEL_D); R(56 + sway, 85 + b, 5, 4, STEEL); // пряжка
        for (let x = 46 + sway; x <= 70 + sway; x += 6) P(x, 86 + b, LEA_D);    // дырки
    }
    function strapFront(b, sway = 0) {
        // меховой ремень через грудь: правое плечо → левый бок
        for (let y = 52; y <= 84; y++) {
            const t = (y - 52) / 32;
            const x = Math.round(72 - 26 * t) + sway;
            R(x - 3, y + b, 7, 1, FUR);
            P(x - 4, y + b, FUR_D); R(x + 2, y + b, 2, 1, FUR_D);
            if (y % 3 === 0) P(x - 5, y + b, FUR);                     // ворс
        }
    }
    function pauldronFront(b) {
        // меховое наплечье слева
        ell(36, 56 + b, 12, 8, FUR);
        bez(26, 58 + b, 34, 64 + b, 44, 60 + b, FUR_D, 1);
        bez(27, 53 + b, 36, 47 + b, 45, 53 + b, FUR_L, 1);   // блик сверху
        for (let x = 28; x <= 44; x += 3) P(x, 50 + b + (x % 3), FUR_D); // ворс вверх
    }
    function armFront(sx, sy, ex, ey, hx, hy, b) {
        bez(sx, sy + b, (sx + ex) / 2, (sy + ey) / 2 + 2 + b, ex, ey + b, SKIN, 6);  // плечо+бицепс
        bez(ex, ey + b, (ex + hx) / 2 + 1, (ey + hy) / 2 + b, hx, hy + b, SKIN, 5);  // предплечье
        // тень по нижнему краю руки
        bez(sx + 2, sy + 4 + b, (sx + ex) / 2 + 2, (sy + ey) / 2 + 6 + b, ex + 2, ey + 4 + b, SKIN_D, 1);
    }
    function fist(x, y, b) {
        ell(x, y + b, 6, 5, SKIN);
        for (let i = -1; i <= 2; i++) R(x - 4 + i * 3, y - 3 + b, 1, 6, SKIN_D); // пальцы
        R(x - 5, y + 2 + b, 11, 2, SKIN_DD);                                     // тень снизу
    }
    function shaftFront(b) {
        R(46, 26 + b, 3, 94, WOOD);               // древко чуть левее лица (как в референсе)
        R(48, 26 + b, 1, 94, WOOD_D);
        for (let y = 60; y <= 84; y += 4) R(46, y + b, 3, 2, LEA_D);  // обмотка
    }
    function headFront(b) {
        // волосы: макушка с пробором
        ell(58, 14 + b, 12, 7, HAIR);
        R(57, 8 + b, 2, 8, HAIR_D);
        R(48, 10 + b, 4, 6, HAIR_L);                                    // блик
        ell(58, 27 + b, 10, 11, SKIN);                                  // лицо
        R(49, 24 + b, 3, 12, SKIN_L);                                   // блик слева
        R(64, 24 + b, 4, 12, SKIN_D);                                   // тень справа
        R(47, 17 + b, 22, 5, BAND);                                     // повязка
        R(47, 20 + b, 22, 2, "#2a211b");
        P(52, 18 + b, STUD); P(58, 18 + b, STUD); P(64, 18 + b, STUD);  // заклёпки
        // брови, глаза, нос
        R(52, 24 + b, 5, 1, HAIR_D); R(61, 24 + b, 5, 1, HAIR_D);
        R(53, 26 + b, 2, 2, EYE); R(62, 26 + b, 2, 2, EYE);
        R(57, 29 + b, 3, 2, SKIN_D); P(56, 31 + b, SKIN_DD); P(61, 31 + b, SKIN_DD);
    }
    function beardFront(b) {
        ell(58, 42 + b, 10, 9, HAIR);                                   // борода
        for (let x = 48; x <= 68; x += 3) R(x, 48 + b + (x % 3), 2, 4, HAIR); // рваный низ
        bez(48, 46 + b, 58, 58 + b, 68, 46 + b, HAIR_D, 1);
        strand(52, 40, 52, HAIR_D, 1, 0); strand(58, 42, 55, HAIR_D, 1, 2); strand(64, 40, 52, HAIR_D, 1, 1);
        strand(54, 40, 52, HAIR_L, 1, 1); strand(62, 40, 50, HAIR_L, 1, 0);
        R(50, 30 + b, 4, 8, HAIR); R(62, 30 + b, 4, 8, HAIR);           // бакенбарды
        R(53, 34 + b, 10, 2, HAIR_D);                                   // усы
    }
    function hairSideBack(b) {  // волосы, упавшие на плечи (вид спереди, по бокам)
        for (let y = 18; y <= 50; y++) {
            const t = (y - 18) / 32;
            const hw = Math.max(2, Math.round(5 - 3 * t));
            const wob = Math.round(Math.sin(y * 0.5));
            R(46 + wob - hw, y + b, hw * 2, 1, HAIR);
            R(70 - wob - hw, y + b, hw * 2, 1, HAIR);
        }
        strand(47, 20, 46, HAIR_D, 1, 0); strand(69, 20, 46, HAIR_D, 1, 2);
        strand(45, 20, 42, HAIR_L, 1, 1);
    }

    // ===== ФИГУРЫ (behind/pose/front-слои, flip — только на уровне кадра) =====
    // o.behind — до тела (эффект «по ту сторону», частично перекрыт фигурой);
    // o.pose — позы рук/топора ДО обводки (обводятся вместе с телом);
    // o.front — после обводки (эффекты поверх: пыль, следы дуги).
    function figureFront(b, o = {}) {
        if (o.behind) o.behind();
        const sway = o.sway || 0;
        shadow(58, 123 + Math.max(b, 0), 30, 5);
        legsFront(b, o.dyL || 0, o.dyR || 0);
        torsoFront(b, sway);
        beltFront(b, sway);
        strapFront(b, sway);
        pauldronFront(b);
        headFront(b);
        hairSideBack(b);
        beardFront(b);
        if (o.pose) o.pose(b);
        if (!o.noAxe) shaftFront(b);
        if (!o.noArms) {
            armFront(34, 58, 40, 82, 44, 66, b);      // левая к верхней рукояти
            armFront(82, 58, 76, 84, 50, 80, b);      // правая к нижней
            fist(48, 64, b); fist(48, 78, b);
            axeHead(47, 24 + b, 0, -1, -1);           // лезвие влево от лица
        }
        outlineAll();
        if (o.front) o.front();
    }
    function figureBack(b, o = {}) {
        if (o.behind) o.behind();
        const sway = o.sway || 0;
        shadow(58, 123 + Math.max(b, 0), 30, 5);
        legsFront(b, o.dyL || 0, o.dyR || 0);
        for (let y = 52; y <= 88; y++) {          // спина
            const t = (y - 52) / 36;
            const hw = Math.round(22 - 6 * t);
            R(58 + sway - hw, y + b, hw * 2, 1, SKIN);
            R(58 + sway + hw - 3, y + b, 3, 1, SKIN_D);
            P(58 + sway - hw + 1, y + b, SKIN_L);
        }
        R(57 + sway, 58 + b, 2, 24, SKIN_D);      // позвоночник
        bez(46 + sway, 60 + b, 52 + sway, 68 + b, 46 + sway, 74 + b, SKIN_D, 1);  // мышцы спины
        bez(70 + sway, 60 + b, 64 + sway, 68 + b, 70 + sway, 74 + b, SKIN_D, 1);
        beltFront(b, sway);
        ell(80, 56 + b, 11, 8, FUR);              // меховое наплечье справа
        bez(70, 58 + b, 80, 64 + b, 90, 58 + b, FUR_D, 1);
        bez(71, 52 + b, 80, 47 + b, 89, 52 + b, FUR_L, 1);
        // волосы на спину
        for (let y = 14; y <= 66; y++) {
            const t = (y - 14) / 52;
            const hw = Math.max(3, Math.round(13 - 9 * t));
            const wob = Math.round(Math.sin(y * 0.35));
            R(58 + sway - hw + wob, y + b, hw * 2, 1, HAIR);
        }
        R(57 + sway, 8 + b, 2, 10, HAIR_D);
        strand(50, 18, 60, HAIR_D, 1, 0); strand(58, 18, 64, HAIR_D, 1, 2);
        strand(66, 18, 60, HAIR_D, 1, 1); strand(54, 18, 56, HAIR_L, 1, 1);
        if (o.pose) o.pose(b);
        if (!o.noAxe) {                           // топор на правом плече — поверх волос
            shaftLine(44, 106 + b, 80, 28 + b);
            axeHead(82, 25 + b, 34, -74, 1);
            bez(80, 58 + b, 78, 62 + b, 70, 62 + b, SKIN, 5);   // рука к древку
            fist(68, 62, b);
        }
        outlineAll();
        if (o.front) o.front();
    }
    function figureSide(b, o = {}) {
        if (o.behind) o.behind();
        shadow(58, 123 + Math.max(b, 0), 28, 5);
        // ноги шагом: передняя и задняя
        const stride = o.stride || 0;
        R(50, 88 + b, 11, 16, PANT); R(60 + stride, 88 + b, 11, 16, PANT);
        R(60 + stride, 96 + b, 3, 8, PANT_D); R(52, 96 + b, 3, 8, PANT_D);
        R(49 + stride, 102 + b, 14, 16, BOOT); R(61, 104 + b, 12, 14, BOOT);
        R(49 + stride, 116 + b, 14, 2, BOOT_D); R(61, 116 + b, 12, 2, BOOT_D);
        for (let yy = 102 + b; yy < 112 + b; yy += 2) for (let xx = 49 + stride; xx < 73; xx += 3) P(xx, yy, BOOT_D);
        // торс в профиль
        for (let y = 52; y <= 88; y++) {
            const t = (y - 52) / 36;
            const hw = Math.round(15 - 3 * t);
            R(58 - hw, y + b, hw * 2, 1, SKIN);
            R(58 + hw - 3, y + b, 3, 1, SKIN_D);
            P(58 - hw + 1, y + b, SKIN_L);
        }
        bez(66, 58 + b, 70, 66 + b, 67, 74 + b, SKIN_D, 1);   // грудь/ключица
        R(70, 60 + b, 2, 26, SKIN_D);
        R(46, 84 + b, 22, 6, LEA); R(46, 88 + b, 22, 2, LEA_D);   // ремень
        // голова в профиль
        ell(58, 26 + b, 10, 11, SKIN);
        R(64, 22 + b, 5, 10, SKIN); P(69, 28 + b, SKIN); P(69, 29 + b, SKIN);  // нос
        R(66, 24 + b, 2, 2, EYE); R(64, 22 + b, 4, 1, HAIR_D);
        R(48, 16 + b, 22, 5, BAND); P(52, 17 + b, STUD); P(62, 17 + b, STUD);
        R(48, 10 + b, 14, 7, HAIR); R(48, 10 + b, 3, 5, HAIR_L);
        // затылок: волосы вниз
        for (let y = 18; y <= 52; y++) {
            const t = (y - 18) / 34;
            const hw = Math.max(2, Math.round(7 - 5 * t));
            R(48 - hw, y + b, hw * 2 + 4, 1, HAIR);
        }
        strand(46, 20, 48, HAIR_D, 1, 0); strand(50, 20, 46, HAIR_D, 1, 2);
        // борода в профиль (перед)
        R(62, 34 + b, 9, 14, HAIR);
        for (let x = 62; x <= 70; x += 2) R(x, 46 + b + (x % 3), 2, 4, HAIR);
        R(64, 32 + b, 7, 2, HAIR_D);
        strand(66, 36, 48, HAIR_D, 1, 1);
        if (o.pose) o.pose(b);
        // топор в опущенной руке у бедра: древко вертикально, лезвие вперёд
        if (!o.noAxe) {
            shaftLine(74, 118 + b, 74, 26 + b);
            axeHead(74, 23 + b, 0, -1, 1);
            bez(62, 58 + b, 66, 64 + b, 70, 74 + b, SKIN, 5);   // рука к древку
            fist(72, 78 + b);
        }
        outlineAll();
        if (o.front) o.front();
    }

    // ===== КАДРЫ =====
    const B4 = [0, 1, 1, 0], SW4 = [1, 0, -1, 0];
    function frameWalkFront(p) {
        const dyL = p === 1 ? 4 : 0, dyR = p === 3 ? 4 : 0;
        figureFront(B4[p], {
            dyL, dyR, sway: SW4[p],
            front: () => { if (p === 1) P(46, 96, SKIN_L); if (p === 3) P(70, 96, SKIN_L); },
        });
    }
    function frameWalkBack(p) {
        const dyL = p === 1 ? 4 : 0, dyR = p === 3 ? 4 : 0;
        figureBack(B4[p], { dyL, dyR, sway: SW4[p] });
    }
    function frameWalkSide(p, flip) {
        figureSide(B4[p], { stride: SW4[p] > 0 ? 2 : 0 });
        if (flip) E.flipX();
    }
    const impact = (x, y, power) => {  // пыль и щепки от удара — рисуется по ситуации
        dither(x - 10, y - 6, 20, 8, "#cbb79a");
        dither(x - 6, y - 10, 12, 5, "#e2d4bc");
        P(x - 12, y - 2, "#cbb79a"); P(x + 12, y - 4, "#e2d4bc"); P(x, y - 12, "#cbb79a");
    };
    function frameAttackFront(p) {
        if (p === 0) {                           // замах вправо-вверх
            figureFront(0, {
                sway: 2, noAxe: true, noArms: true,
                pose: () => {
                    shaftLine(52, 96, 74, 34);
                    axeHead(76, 31, 24, -65, 1);
                    armFront(36, 58, 44, 68, 56, 78, 0);   // левая к нижней части древка
                    armFront(82, 58, 80, 62, 68, 58, 0);   // правая к верхней
                    fist(58, 80, 0); fist(70, 56, 0);
                },
            });
        } else if (p === 1) {                    // топор над головой
            figureFront(1, {
                noAxe: true, noArms: true,
                pose: () => {
                    shaftLine(57, 100, 57, 20);
                    axeHead(57, 17, 0, -1, -1);
                    armFront(34, 58, 42, 66, 52, 60, 1);
                    armFront(82, 58, 74, 66, 62, 60, 1);
                    fist(56, 58, 1); fist(60, 70, 1);
                },
            });
        } else if (p === 2) {                    // удар в землю перед собой
            figureFront(3, {
                noAxe: true, noArms: true, dyL: 1, dyR: 1,
                behind: () => dither(46, 106, 24, 6, "#cbb79a"),   // пыль за лезвием
                pose: () => {
                    shaftLine(57, 44, 57, 112);
                    axeHead(57, 114, 0, 1, -1);
                    armFront(34, 58, 40, 70, 50, 62, 3);
                    armFront(82, 58, 76, 72, 60, 62, 3);
                    fist(54, 60, 3); fist(62, 60, 3);
                },
                front: () => {                   // эффект поверх: пыль + след дуги
                    impact(57, 116, 1);
                    bez(70, 20, 46, 30, 40, 60, STEEL_L, 1);
                },
            });
        } else {                                 // выход из удара
            figureFront(0, {
                front: () => { P(44, 118, "#cbb79a"); P(70, 119, "#e2d4bc"); },
            });
        }
    }
    function frameAttackBack(p) {
        if (p === 0) {                           // замах: топор уходит влево-вверх
            figureBack(0, {
                sway: -2, noAxe: true, noArms: true,
                pose: () => {
                    shaftLine(50, 96, 34, 34);
                    axeHead(32, 31, -24, -65, -1);
                    bez(80, 58, 72, 66, 58, 78, SKIN, 5);   // правая рука тянется к древку
                    fist(56, 80, 0);
                },
            });
        } else if (p === 1) {                    // над головой
            figureBack(1, {
                noAxe: true, noArms: true,
                pose: () => {
                    shaftLine(57, 100, 57, 18);
                    axeHead(57, 15, 0, -1, 1);
                    bez(80, 58, 76, 56, 64, 54, SKIN, 5);
                    fist(60, 52, 1);
                },
            });
        } else if (p === 2) {                    // удар ПОЗАДИ фигуры → эффект ДО тела
            figureBack(3, {
                noAxe: true, noArms: true, dyL: 1, dyR: 1,
                behind: () => {                  // топор, пыль и след дуги за спиной —
                    shaftLine(57, 44, 57, 112);  // фигура перекрывает; видны края в воздухе
                    axeHead(57, 114, 0, 1, 1);
                    bez(44, 20, 70, 30, 74, 60, STEEL_L, 1);
                    impact(57, 116, 1);
                },
                pose: () => {
                    bez(80, 58, 78, 62, 66, 62, SKIN, 5);   // руки вниз к древку
                    fist(64, 62, 3);
                },
            });
        } else {
            figureBack(0, {
                front: () => { P(44, 118, "#cbb79a"); P(70, 119, "#e2d4bc"); },
            });
        }
    }
    function frameAttackSide(p, flip) {
        // Сцена строится «вправо», отражение — последним шагом.
        if (p === 0) {                           // замах назад
            figureSide(0, {
                noAxe: true, stride: -2,
                pose: () => {
                    shaftLine(62, 84, 34, 40);
                    axeHead(32, 38, -28, -30, -1);
                    bez(62, 58, 64, 70, 62, 78, SKIN, 5);   // рука к древку
                    fist(60, 80, 0);
                },
            });
        } else if (p === 1) {                    // топор над головой вперёд
            figureSide(1, {
                noAxe: true,
                pose: () => {
                    shaftLine(64, 78, 66, 18);
                    axeHead(67, 15, 4, -60, 1);
                    bez(60, 59, 64, 64, 64, 72, SKIN, 5);
                    fist(64, 74, 1);
                },
                front: () => bez(90, 30, 100, 50, 92, 70, "#ffffff", 1),  // отсвет дуги
            });
        } else if (p === 2) {                    // рубящий вперёд
            figureSide(2, {
                noAxe: true, stride: 2,
                pose: () => {
                    shaftLine(62, 70, 92, 96);
                    axeHead(94, 98, 30, 26, 1);
                    bez(60, 60, 62, 62, 60, 66, SKIN, 5);
                    fist(60, 68, 2);
                },
                front: () => {                   // эффект поверх
                    bez(88, 16, 112, 44, 100, 84, STEEL_L, 2);
                    impact(100, 104, 1);
                },
            });
        } else {                                 // возврат
            figureSide(0, {
                front: () => P(96, 100, "#cbb79a"),
            });
        }
        if (flip) E.flipX(); // эффекты отражаются вместе с персонажем
    }
    function frameWait(p) {
        figureFront(B4[p], {});
    }
    function frameDamage(p) {
        if (p === 0) {                           // сдвиг + вспышка
            figureFront(0, {
                sway: 3,
                front: () => {                   // вспышка поверх — после обводки
                    R(50, 54, 1, 20, "#ffe8d8"); R(62, 58, 1, 24, "#ffffff"); R(72, 52, 1, 18, "#ffe8d8");
                    P(56, 50, "#ffffff"); P(68, 80, "#ffe8d8");
                },
            });
        } else {                                 // согнулся
            figureFront(2, { sway: -2 });
        }
    }
    function frameDeath(p) {
        if (p === 0) {                           // ранен: топор накренился
            figureFront(0, {
                sway: 3, noAxe: true,
                front: () => {
                    shaftLine(52, 98, 66, 40);
                    axeHead(68, 37, 22, -60, 1);
                    R(50, 54, 1, 18, "#ffe8d8"); R(62, 58, 1, 22, "#ffffff");
                },
            });
        } else if (p === 1) {                    // на колени, топор падает
            figureFront(8, {
                sway: 2, noAxe: true, dyL: 6, dyR: 6,
                behind: () => {                  // топор уже на земле — частично за телом
                    shaftLine(76, 120, 100, 112);
                    axeHead(102, 111, 26, -8, 1);
                },
            });
        } else if (p === 2) {                    // оседает
            figureFront(16, {
                sway: 1, noAxe: true, dyL: 8, dyR: 8,
                behind: () => {
                    shaftLine(76, 120, 100, 112);
                    axeHead(102, 111, 26, -8, 1);
                },
            });
        } else {                                 // куча: мех, волосы, борода, топор рядом
            const still = p === 4;
            shadow(58, 123, 32, 5);
            ell(58, 112, 27, 11, FUR);           // холм
            dither(36, 104, 44, 12, FUR_D);
            bez(34, 114, 58, 124, 82, 114, FUR_D, 1);
            ell(58, 100, 12, 9, HAIR);           // голова с волосами
            ell(58, 102, 8, 6, HAIR_D);
            for (let y = 94; y <= 112; y++) {
                const hw = Math.max(1, Math.round(5 - 3 * (y - 94) / 18));
                R(47 - hw, y, hw, 1, HAIR); R(69, y, hw, 1, HAIR);
            }
            R(48, 96, 20, 3, BAND);              // повязка на куче
            P(52, 97, STUD); P(62, 97, STUD);
            for (let x = 48; x <= 68; x += 3) R(x, 116 + (x % 3), 2, 4, HAIR); // борода торчит
            shaftLine(24, 121, 84, 114);         // топор лежит
            axeHead(87, 113, 26, -7, 1);
            outlineAll();
            if (!still) impact(88, 118, 0);      // последняя пыль оседает
        }
    }

    // ================= СБОРКА ЛИСТА =================
    E.resize(128);
    const first = E.rows()[0];
    if (first && first.name !== "wait") E.renameRow(first.name, "wait");
    E.setRow("wait"); E.setFrame(0); E.clear();
    E.silent(() => {
        const rowsSpec = [
            ["walk_front", (p) => frameWalkFront(p)],
            ["walk_back", (p) => frameWalkBack(p)],
            ["walk_right", (p) => frameWalkSide(p, false)],
            ["walk_left", (p) => frameWalkSide(p, true)],
            ["attack_front", (p) => frameAttackFront(p)],
            ["attack_back", (p) => frameAttackBack(p)],
            ["attack_right", (p) => frameAttackSide(p, false)],
            ["attack_left", (p) => frameAttackSide(p, true)],
            ["wait", (p) => frameWait(p)],
            ["death", (p) => frameDeath(p)],
            ["damage", (p) => frameDamage(p)],
        ];
        const frameCounts = { default: 4, death: 5, damage: 2 };
        for (const [name, draw] of rowsSpec) {
            if (!E.rows().some(r => r.name === name)) E.addRow(name);
            E.setRow(name);
            const count = frameCounts[name] ?? frameCounts.default;
            while (E.frameCount() > count) E.deleteFrame(E.frameCount() - 1); // перезапуск без дублей
            const have = E.frameCount();
            for (let p = 0; p < count; p++) {
                E.setFrame(Math.min(p, E.frameCount() - 1));
                E.clear();
                draw(p);
                if (p >= have - 1 && p < count - 1) E.newFrame();
            }
        }
        E.setRow("wait"); E.setFrame(0);
    });
    return E.rows();
}
