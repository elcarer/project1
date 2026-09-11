// РИСОВАЛЬЩИК НЕКРОМАНТА 128×128 (референс: рогалик/png/necros.png).
// Отличие от воина: мелкая детализация (1–2 px), эллипсы и кривые Безье вместо
// крупных блоков, автообводка силуэта 1 px → плавные линии без угловатости.
// Исполняется в редакторе: new Function('E', src + ';return run;')(E) → run(E).
// СТАНДАРТНЫЙ НАБОР: walk_front/back/left/right ×4, attack_front/back/left/right ×4,
// wait ×4, death ×5, damage ×2 → 11 строк, 43 кадра.
function run(E) {
    // ---- палитра по референсу ----
    const ROBE    = "#262b30"; // ряса
    const ROBE_L  = "#3b4249"; // блик
    const ROBE_D  = "#171b1f"; // тень
    const ROBE_XD = "#0e1113"; // плащ сзади
    const GRN     = "#3f9e63"; // зелёная подкладка
    const GRN_D   = "#276541";
    const GRN_L   = "#8fe6ae"; // свечение
    const GRN_XL  = "#d9ffe6";
    const SKIN    = "#ccd5c3"; // мертвенно-бледная кожа
    const SKIN_D  = "#a2af99";
    const HAIR    = "#b4bac1"; // седые волосы
    const HAIR_D  = "#848b93";
    const HAIR_L  = "#e3e7eb";
    const EYE_G   = "#5ee08a"; // горящие глаза
    const BONE    = "#d9d3c2";
    const BONE_D  = "#a79e88";
    const WOOD    = "#4a3b28"; // посох
    const WOOD_D  = "#2d2417";
    const SKULL   = "#d6ecd9"; // череп-набалдашник
    const SKULL_D = "#93ab97";
    const K       = "#0a0c0d"; // контур

    // ---- помощники ----
    const R = (x, y, w, h, c) => E.rect(x, y, w, h, c);
    const P = (x, y, c) => E.px(x, y, c);
    const G = (x, y) => E.get(x, y);
    const LN = (x0, y0, x1, y1, c, t = 1) => {
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy, x = x0, y = y0;
        const o = (t / 2) | 0;
        while (true) {
            R(x - o, y - o, t, t, c);
            if (x === x1 && y === y1) break;
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
    // Автообводка: каждый пустой пиксель рядом с фигурой (у соседа ≥2 заполненных
    // соседей — точки-«пылинки» не обводятся) → контур 1 px вокруг силуэта.
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

    // ===== ЧАСТИ =====
    function hoodFront(b, tilt = 0) {
        const cx = 58 + tilt;
        ell(cx, 24 + b, 17, 14, ROBE);
        for (let i = 0; i <= 9; i++) {           // острый верх — сглаженный конус
            const t = i / 9, hw = Math.round(9 * t * t * (3 - 2 * t));
            R(cx - hw, 1 + i + b, hw * 2 + 1, 1, ROBE);
        }
        ell(cx, 30 + b, 12, 11, ROBE_D);         // проём лица (глубокая тень)
    }
    function faceFront(b, tilt = 0, grim = false) {
        const cx = 58 + tilt;
        ell(cx, 30 + b, 9, 9, SKIN);
        R(cx - 7, 27 + b, 5, 1, SKIN_D); R(cx + 2, 27 + b, 5, 1, SKIN_D); // теневые дуги
        R(cx - 6, 28 + b, 3, 4, EYE_G); R(cx + 3, 28 + b, 3, 4, EYE_G);   // глаза
        P(cx - 5, 28 + b, GRN_XL); P(cx + 4, 28 + b, GRN_XL);
        P(cx, 33 + b, SKIN_D);
        if (grim) R(cx - 2, 35 + b, 5, 2, "#3a2f2f"); else R(cx - 1, 35 + b, 3, 1, SKIN_D);
        P(cx - 8, 32 + b, SKIN_D); P(cx + 8, 32 + b, SKIN_D);
    }
    function hairFront(b) {
        for (let y = 24; y <= 56; y++) {
            const t = (y - 24) / 32;
            const hw = Math.max(1, Math.round(5 - 4 * t));
            const wob = Math.round(Math.sin(y * 0.5));
            R(41 + wob, y + b, 6 + hw, 1, HAIR);
            R(71 - wob - hw, y + b, 6 + hw, 1, HAIR);
        }
        strand(43, 26, 52, HAIR_D, 1, 0); strand(45, 26, 52, HAIR_D, 1, 2);
        strand(73, 26, 52, HAIR_D, 1, 1); strand(75, 26, 52, HAIR_D, 1, 3);
        strand(44, 26, 50, HAIR_L, 1, 1); strand(74, 26, 50, HAIR_L, 1, 2);
    }
    function shouldersFront(b) {
        R(48, 44 + b, 20, 8, ROBE);              // воротник-стойка
        R(48, 44 + b, 20, 1, GRN_D);
        ell(40, 58 + b, 12, 8, ROBE);            // плечи
        ell(76, 58 + b, 12, 8, ROBE);
        R(31, 55 + b, 9, 2, ROBE_L); R(73, 55 + b, 9, 2, ROBE_L);
        // костяные шипы-когти
        LN(33, 52 + b, 29, 44 + b, BONE, 2); LN(40, 50 + b, 38, 42 + b, BONE, 2); LN(47, 52 + b, 47, 45 + b, BONE, 2);
        LN(83, 52 + b, 87, 44 + b, BONE, 2); LN(76, 50 + b, 78, 42 + b, BONE, 2); LN(69, 52 + b, 69, 45 + b, BONE, 2);
    }
    const ribBone = (cx, y, hw) => {
        bez(cx - hw, y - 1, cx, y + 2, cx + hw, y - 1, BONE, 2);
        R(cx - hw - 1, y - 2, 2, 2, BONE); R(cx + hw, y - 2, 2, 2, BONE);
    };
    function torsoFront(b, sway = 0) {
        for (let y = 52; y <= 88; y++) {
            const t = (y - 52) / 36, hw = Math.round(11 + 3 * t);
            R(58 + sway - hw, y + b, hw * 2, 1, ROBE);
        }
        R(57 + sway, 52 + b, 1, 37, GRN_D); R(59 + sway, 52 + b, 1, 37, GRN_D); R(58 + sway, 52 + b, 1, 37, GRN);
        bez(50 + sway, 56 + b, 47 + sway, 70 + b, 50 + sway, 86 + b, ROBE_D, 1);
        bez(66 + sway, 56 + b, 69 + sway, 70 + b, 66 + sway, 86 + b, ROBE_D, 1);
        ribBone(58 + sway, 62 + b, 8); ribBone(58 + sway, 70 + b, 10); ribBone(58 + sway, 78 + b, 8);
    }
    function beltFront(b, sway = 0) {
        R(45 + sway, 84 + b, 26, 4, ROBE_D);
        ell(58 + sway, 87 + b, 4, 3, BONE);      // череп-пряжка
        P(56 + sway, 86 + b, K); P(60 + sway, 86 + b, K); P(58 + sway, 89 + b, BONE_D);
    }
    function skirt(b, sway = 0, yTop = 88, hw0 = 14, hw1 = 22, hemY = 121, folds = 3) {
        for (let y = yTop; y <= hemY; y++) {
            const t = (y - yTop) / (hemY - yTop);
            const hw = Math.round(hw0 + (hw1 - hw0) * t);
            const cx = 58 + Math.round(sway * t);
            R(cx - hw, y + b, hw * 2, 1, ROBE);
            R(cx - hw, y + b, 2, 1, GRN_D); R(cx + hw - 2, y + b, 2, 1, GRN_D); // подкладка
        }
        for (let i = 0; i < folds; i++) {
            const x0 = 58 - 8 + i * 8;
            bez(x0, yTop + 3 + b, x0 + Math.round(sway * 0.6) + (i - 1) * 2,
                ((yTop + hemY) / 2) + b, x0 + sway + (i - 1) * 3, hemY - 3 + b, ROBE_D, 1);
        }
        for (let x = 58 - hw1; x <= 58 + hw1; x += 4) R(x + sway, hemY + 1 + b, 2, 1, ROBE); // зубцы подола
    }
    function sleeveL(b, sway = 0) {
        bez(42 + sway, 60 + b, 38 + sway, 74 + b, 36 + sway, 88 + b, ROBE, 4);
        R(34 + sway, 88 + b, 5, 2, GRN_D);
    }
    function book(b) {
        R(26, 92 + b, 13, 16, GRN_D);            // фолиант
        R(26, 92 + b, 13, 1, GRN); R(26, 92 + b, 1, 16, GRN); R(38, 92 + b, 1, 16, GRN);
        R(36, 92 + b, 2, 16, BONE);              // обрез страниц
        R(31, 99 + b, 4, 3, BONE_D);             // застёжка
        P(44, 89, BONE_D); P(42, 90, BONE_D); P(40, 90, BONE_D); P(38, 91, BONE_D); // цепочка
    }
    function sleeveR(b, sway = 0) {
        bez(74 + sway, 60 + b, 84 + sway, 68 + b, 91 + sway, 78 + b, ROBE, 4);
        R(88 + sway, 78 + b, 6, 2, GRN_D);
        R(92 + sway, 80 + b, 6, 5, ROBE_D);      // кисть
    }
    function staffShaft(x0, y0, x1, y1) {
        LN(x0, y0, x1, y1, WOOD, 2);
        LN(x0 + 1, y0, x1 + 1, y1, WOOD_D, 1);
    }
    const wrap = (x, y) => R(x - 2, y, 5, 9, ROBE_D);
    function orbSkull(ox, oy, dead = false) {
        bez(ox - 5, oy + 6, ox - 8, oy - 2, ox - 3, oy - 9, BONE_D, 1);  // клетка-рога
        bez(ox + 5, oy + 6, ox + 8, oy - 2, ox + 3, oy - 9, BONE_D, 1);
        ell(ox, oy, 5, 5, dead ? SKULL_D : SKULL);
        R(ox - 3, oy + 4, 7, 3, dead ? SKULL_D : SKULL);
        for (let i = -3; i <= 3; i += 2) P(ox + i, oy + 6, K);
        R(ox - 3, oy - 1, 2, 2, K); R(ox + 2, oy - 1, 2, 2, K);
        P(ox - 2, oy, dead ? SKULL_D : EYE_G); P(ox + 3, oy, dead ? SKULL_D : EYE_G);
        P(ox, oy + 1, K);
    }
    function orbGlow(ox, oy, power = 1) {       // ПОСЛЕ обводки
        if (power <= 0) return;
        const r = 7 + power;
        for (let a = 0; a < 20; a++) {
            const ang = (a / 20) * Math.PI * 2;
            P(ox + Math.round(Math.cos(ang) * r), oy + Math.round(Math.sin(ang) * r * 0.9), a % 2 ? GRN_L : GRN);
        }
        if (power >= 2) {
            LN(ox, oy - r - 2, ox, oy - r - 5, GRN_XL, 1); LN(ox, oy + r + 2, ox, oy + r + 4, GRN_L, 1);
            LN(ox - r - 2, oy, ox - r - 5, oy, GRN_L, 1); LN(ox + r + 2, oy, ox + r + 5, oy, GRN_L, 1);
        }
    }

    // ===== ФИГУРЫ =====
    // o.behind — рисуется ДО тела (эффекты удара «по ту сторону»: их частично
    // перекрывает фигура), o.front — ПОСЛЕ обводки (эффекты поверх).
    // ВАЖНО: flipX() вызывается только на уровне КАДРА, после всех эффектов —
    // иначе персонаж отражается, а эффект остаётся на старой стороне.
    function figureFront(b, o = {}) {
        if (o.behind) o.behind();
        const sway = o.sway || 0;
        hoodFront(b, o.tiltH || 0);
        hairFront(b);
        faceFront(b, o.tiltH || 0, o.grim);
        shouldersFront(b);
        torsoFront(b, sway);
        beltFront(b, sway);
        skirt(b, sway, 88, 14, 22, 121);
        sleeveL(b, sway); book(b);
        sleeveR(b, sway);
        const gx = 95 + sway;                    // посох у кисти
        if (!o.noStaff) {
            staffShaft(gx + 2 + (o.tiltB || 0), 121 + b, gx + 2 + (o.tiltT || 0), 26 + b);
            wrap(gx + 2, 78 + b);
            orbSkull(gx + 2 + (o.tiltT || 0), 17 + b, o.dead);
        }
        outlineAll();
        if (o.front) o.front();
        if (!o.noStaff) orbGlow(gx + 2 + (o.tiltT || 0), 17 + b, o.glow ?? 1);
    }
    function figureBack(b, o = {}) {
        if (o.behind) o.behind();
        const sway = o.sway || 0;
        hoodFront(b, 0);                         // тот же купол
        R(57, 12 + b, 2, 20, ROBE_D);            // шов
        bez(46, 32 + b, 58, 42 + b, 70, 32 + b, ROBE_D, 1); // кромка
        shouldersFront(b);
        for (let y = 52; y <= 100; y++) {        // плащ
            const t = (y - 52) / 48, hw = Math.round(15 + 5 * t);
            R(58 - hw + Math.round(sway * t), y + b, hw * 2, 1, ROBE_XD);
            R(58 - hw + Math.round(sway * t), y + b, 1, 1, GRN_D);
            R(59 + hw + Math.round(sway * t), y + b, 1, 1, GRN_D);
        }
        bez(48, 56 + b, 45, 78 + b, 49, 98 + b, ROBE_D, 1);
        bez(68, 56 + b, 71, 78 + b, 67, 98 + b, ROBE_D, 1);
        skirt(b, sway, 100, 20, 22, 121, 2);
        for (let y = 28; y <= 58; y++) {         // волосы по спине
            const t = (y - 28) / 30, hw = Math.max(2, Math.round(8 - 5 * t));
            const wob = Math.round(Math.sin(y * 0.4));
            R(58 - hw + wob, y + b, hw * 2, 1, HAIR);
        }
        strand(52, 30, 54, HAIR_D, 1, 0); strand(58, 30, 56, HAIR_D, 1, 2);
        strand(64, 30, 54, HAIR_D, 1, 1); strand(55, 30, 52, HAIR_L, 1, 1); strand(62, 30, 52, HAIR_L, 1, 3);
        sleeveR(b, sway);
        const gx = 95 + sway;
        if (!o.noStaff) {
            staffShaft(gx + 2, 121 + b, gx + 2 + (o.tiltT || 0), 26 + b);
            wrap(gx + 2, 78 + b);
            orbSkull(gx + 2 + (o.tiltT || 0), 17 + b, o.dead);
        }
        outlineAll();
        if (o.front) o.front();
        if (!o.noStaff) orbGlow(gx + 2 + (o.tiltT || 0), 17 + b, o.glow ?? 1);
    }
    function figureSide(b, o = {}) {
        if (o.behind) o.behind();
        ell(56, 24 + b, 15, 13, ROBE);           // капюшон
        bez(52, 12 + b, 42, 14 + b, 37, 22 + b, ROBE, 4);   // хвост назад
        bez(56, 11 + b, 58, 6 + b, 62, 5 + b, ROBE, 3);     // остриё
        ell(64, 31 + b, 7, 8, SKIN);             // лицо в профиль
        P(71, 31 + b, SKIN); P(71, 32 + b, SKIN);
        R(66, 28 + b, 3, 3, EYE_G); P(66, 28 + b, GRN_XL);
        P(67, 34 + b, SKIN_D); R(68, 36 + b, 3, 1, SKIN_D);
        bez(60, 20 + b, 70, 24 + b, 68, 37 + b, ROBE_D, 1); // кромка капюшона
        for (let y = 26; y <= 54; y++) {         // волосы сзади
            const t = (y - 26) / 28, hw = Math.max(1, Math.round(6 - 5 * t));
            R(44 - hw, y + b, hw * 2 + 3, 1, HAIR);
        }
        strand(46, 28, 50, HAIR_D, 1, 0); strand(43, 28, 48, HAIR_D, 1, 2);
        ell(56, 58 + b, 14, 8, ROBE);            // плечо
        R(45, 55 + b, 10, 2, ROBE_L);
        LN(46, 52 + b, 42, 45 + b, BONE, 2); LN(54, 50 + b, 53, 43 + b, BONE, 2); LN(62, 52 + b, 64, 45 + b, BONE, 2);
        for (let y = 52; y <= 88; y++) {         // торс
            const t = (y - 52) / 36, hw = Math.round(10 + 3 * t);
            R(58 - hw, y + b, hw * 2, 1, ROBE);
        }
        R(67, 52 + b, 1, 37, GRN_D);             // зелёный край спереди
        bez(50, 56 + b, 47, 70 + b, 50, 86 + b, ROBE_D, 1);
        R(50, 84 + b, 16, 4, ROBE_D);            // ремень
        ell(60, 87 + b, 3, 2, BONE);
        skirt(b, -1, 88, 13, 20, 121, 2);
        bez(62, 60 + b, 72, 66 + b, 79, 74 + b, ROBE, 4);   // рука к посоху
        R(77, 74 + b, 5, 2, GRN_D); R(80, 76 + b, 5, 5, ROBE_D);
        const sx = 84 + (o.tiltT || 0);
        if (!o.noStaff) {
            staffShaft(sx, 121 + b, sx, 26 + b);
            wrap(sx, 74 + b);
            orbSkull(sx, 17 + b, o.dead);
        }
        outlineAll();
        if (o.front) o.front();
        if (!o.noStaff) orbGlow(sx, 17 + b, o.glow ?? 1);
    }
    const flash = () => {                        // вспышка урона — ПОСЛЕ обводки
        R(52, 54, 1, 22, GRN_XL); R(60, 58, 1, 26, GRN_L); R(68, 52, 1, 20, GRN_XL);
        P(56, 50, GRN_XL); P(64, 78, GRN_L); P(48, 66, GRN_L);
    };

    // ===== КАДРЫ =====
    const B4 = [0, 1, 1, 0], SW4 = [1, 0, -1, 0];
    function frameWalkFront(p) {
        const f = figureFront(B4[p], { sway: SW4[p], tiltB: SW4[p], tiltT: SW4[p] * 2 });
        if (p === 1) P(52, 122, ROBE_XD); else if (p === 3) P(64, 122, ROBE_XD);
    }
    function frameWalkBack(p) {
        figureBack(B4[p], { sway: SW4[p], tiltT: SW4[p] * 2 });
    }
    function frameWalkSide(p, flip) {
        figureSide(B4[p], {});
        if (flip) E.flipX(); // отражение — всегда последняя операция кадра
    }
    function frameAttackFront(p) {
        if (p === 0) {                           // замах: левая рука к шару, шар разгорается
            figureFront(0, { glow: 0, noStaff: true });
            staffShaft(97, 121, 97, 26); wrap(97, 78); orbSkull(97, 17);
            bez(46, 58, 50, 48, 60, 42, ROBE, 4); R(58, 40, 5, 4, ROBE_D);
            outlineAll(); orbGlow(97, 17, 2);
        } else if (p === 1) {                    // посох над головой, обе руки на древке
            figureFront(0, { sway: -2, glow: 0, noStaff: true });
            staffShaft(90, 78, 64, 12);
            wrap(82, 64); wrap(72, 48);
            bez(44, 60, 48, 56, 66, 50, ROBE, 4); R(64, 48, 5, 4, ROBE_D);   // левая рука к древку
            outlineAll(); orbSkull(62, 11); orbGlow(62, 11, 3);
        } else if (p === 2) {                    // удар: посох вниз-вперёд, дуга
            figureFront(1, { sway: -4, glow: 0, noStaff: true, tiltH: -1, grim: true });
            staffShaft(88, 80, 50, 102);
            wrap(84, 78);
            bez(44, 60, 40, 72, 54, 82, ROBE, 4);   // левая рука выброшена вперёд
            outlineAll();
            orbSkull(48, 104); orbGlow(48, 104, 3);
            bez(66, 14, 38, 44, 46, 96, GRN_L, 2); bez(72, 18, 48, 48, 54, 94, GRN, 1);
            dither(40, 96, 14, 12, GRN_L);
        } else {                                 // возврат, искры
            figureFront(0, { glow: 1 });
            P(48, 72, GRN_L); P(52, 80, GRN_XL); P(46, 86, GRN); P(56, 68, GRN_L); P(50, 94, GRN);
        }
    }
    function frameAttackBack(p) {
        if (p === 0) {                           // шар разгорается
            figureBack(0, { glow: 2 });
        } else if (p === 1) {                    // посох уходит вверх-влево (над фигурой)
            figureBack(0, {
                sway: -2, glow: 0, noStaff: true,
                front: () => {                   // посох поднят над головой — поверх
                    staffShaft(88, 76, 62, 12);
                    wrap(80, 62); wrap(70, 46);
                    orbSkull(60, 11);
                },
            });
            orbGlow(60, 11, 3);
        } else if (p === 2) {                    // удар ВПЕРЕДИ фигуры → ВСЁ за спиной:
            figureBack(1, {                      // посох, дуга, всплеск и свечение — ДО
                sway: -4, glow: 0, noStaff: true,
                behind: () => {                  // тела: видны только края в воздухе
                    staffShaft(86, 80, 50, 102);
                    orbSkull(48, 104);
                    bez(64, 14, 36, 44, 44, 90, GRN_L, 2);  // след дуги (перекрыт телом)
                    dither(40, 96, 14, 12, GRN_L);
                    orbGlow(48, 104, 2);
                },
                front: () => { wrap(82, 78); },  // кисть на древке — сбоку, поверх
            });
        } else {                                 // возврат
            figureBack(0, { glow: 1 });
            P(48, 74, GRN_L); P(54, 84, GRN_XL); P(46, 90, GRN);
        }
    }
    function frameAttackSide(p, flip) {
        // Вся сцена строится «вправо», отражение — последним шагом.
        if (p === 0) {
            figureSide(0, { glow: 2 });
        } else if (p === 1) {                    // посох отклонён назад-вверх
            figureSide(0, {
                glow: 0, noStaff: true,
                front: () => {
                    staffShaft(78, 80, 90, 12); wrap(80, 74);
                    orbSkull(91, 11);
                },
            });
            orbGlow(91, 11, 3);
        } else if (p === 2) {                    // рубящий вперёд
            figureSide(1, {
                glow: 0, noStaff: true,
                front: () => {
                    staffShaft(80, 78, 106, 96); wrap(82, 76);
                    orbSkull(108, 98);
                    bez(92, 14, 114, 48, 108, 92, GRN_L, 2);
                    dither(104, 92, 12, 12, GRN_L);
                },
            });
            orbGlow(108, 98, 3);
        } else {
            figureSide(0, { glow: 1 });
            P(100, 70, GRN_L); P(104, 82, GRN_XL); P(98, 88, GRN);
        }
        if (flip) E.flipX(); // эффекты отражаются вместе с персонажем
    }
    function frameWait(p) {
        figureFront(B4[p], { glow: p % 2 ? 1 : 2 });
    }
    function frameDamage(p) {
        if (p === 0) {                           // сдвиг + вспышка
            figureFront(0, { glow: 0.5, grim: true });
            flash();
        } else {                                 // согнулся
            figureFront(2, { glow: 0.5, grim: true, tiltH: 2 });
        }
    }
    function frameDeath(p) {
        if (p === 0) {
            figureFront(0, { glow: 0.5, grim: true }); flash();
        } else if (p === 1) {                    // оседает
            figureFront(6, { glow: 0.4, grim: true, tiltH: 2 });
        } else if (p === 2) {                    // падает
            figureFront(14, { glow: 0.3, grim: true, tiltH: 4 });
        } else {                                 // куча одежды
            const dead = p === 4;
            ell(58, 113, 27, 10, ROBE);          // холм рясы
            dither(38, 106, 40, 12, ROBE_D);
            bez(36, 115, 58, 124, 80, 115, ROBE_D, 1);
            R(33, 119, 50, 2, GRN_D);            // подкладка видна
            ell(58, 102, 12, 9, ROBE);           // капюшон
            ell(58, 103, 8, 6, ROBE_D);
            for (let y = 98; y <= 114; y++) {    // волосы растеклись
                const hw = Math.max(1, Math.round(5 - 3 * (y - 98) / 16));
                R(47 - hw, y, hw, 1, HAIR); R(69, y, hw, 1, HAIR);
            }
            staffShaft(30, 122, 86, 112);        // посох лёг
            orbSkull(89, 111, dead);
            outlineAll();
            if (!dead) orbGlow(89, 111, 1);
            P(40, 121, BONE); P(76, 118, BONE);  // кости
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
                E.clear();          // БЕЗ этого фазы рисуются поверх предыдущих — призраки
                draw(p);
                if (p >= have - 1 && p < count - 1) E.newFrame(); // только недостающие кадры
            }
        }
        E.setRow("wait"); E.setFrame(0);
    });
    return E.rows();
}
