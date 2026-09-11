// РИСОВАЛЬЩИК ВОИНА 128×128 (референс: рогатый шлем, красный плащ, меч и щит).
// Исполняется в редакторе: new Function('E', src + ';return run;')(E) → run(E).
// Создаёт СТАНДАРТНЫЙ НАБОР анимаций персонажа игры:
//   walk_front/back/left/right ×4, attack_front/back/left/right ×4,
//   wait ×4, death ×5, damage ×2  →  11 строк, 43 кадра.
function run(E) {
    // Палитра по референсу
    const A_L = "#b9c6d4", A = "#8fa0b2", A_D = "#5f6d7e", A_XD = "#3d4854"; // сталь
    const HORN = "#d8cfc0", HORN_D = "#b0a690";
    const SKIN = "#e8c39e", SKIN_D = "#c99b6f", EYE = "#20242a";
    const CAPE = "#c0392b", CAPE_D = "#7a1f1a";
    const LEA = "#6e4a28", LEA_D = "#4c3119";
    const GOLD = "#d8b23a", GOLD_D = "#a8842a";
    const BLADE = "#dbe4ee", BLADE_D = "#9fb0c0";
    const SH = "#98a6b5", SH_D = "#5f6d7e", K = "#15181c";

    const R = (x, y, w, h, c) => E.rect(x, y, w, h, c);
    const P = (x, y, c) => E.px(x, y, c);
    const LN = (x0, y0, x1, y1, c, t = 2) => {
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy, x = x0, y = y0;
        while (true) {
            R(x, y, t, t, c);
            if (x === x1 && y === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
    };

    // ============ ЧАСТИ (вид спереди) ============
    function helmetFront(b) {
        R(48, 12 + b, 32, 10, A_L);          // купол
        R(46, 20 + b, 36, 16, A);            // тулья
        R(62, 12 + b, 4, 24, A_D);           // гребень-прорезь
        R(46, 32 + b, 36, 4, A_D);           // надбровье
        R(48, 36 + b, 32, 6, A);             // нижняя пластина
        // рога
        R(38, 10 + b, 10, 8, HORN); R(32, 4 + b, 10, 8, HORN); R(28, 0 + b, 8, 6, HORN);
        R(38, 16 + b, 10, 2, HORN_D); R(32, 10 + b, 10, 2, HORN_D);
        R(80, 10 + b, 10, 8, HORN); R(86, 4 + b, 10, 8, HORN); R(92, 0 + b, 8, 6, HORN);
        R(80, 16 + b, 10, 2, HORN_D); R(86, 10 + b, 10, 2, HORN_D);
    }
    function faceFront(b, closed) {
        R(54, 38 + b, 20, 16, SKIN);
        if (closed) {
            R(57, 44 + b, 5, 2, K); R(66, 44 + b, 5, 2, K);
        } else {
            R(57, 43 + b, 5, 5, EYE); R(66, 43 + b, 5, 5, EYE);
            P(57, 43 + b, "#ffffff"); P(66, 43 + b, "#ffffff");
        }
        R(60, 50 + b, 8, 2, SKIN_D);
    }
    function torsoFront(b) {
        R(52, 54 + b, 24, 6, A_D);           // горжет
        R(28, 54 + b, 20, 18, A);            // наплечники
        R(30, 54 + b, 16, 4, A_L);
        R(80, 54 + b, 20, 18, A);
        R(82, 54 + b, 16, 4, A_L);
        R(28, 70 + b, 20, 2, K); R(80, 70 + b, 20, 2, K);
        R(46, 58 + b, 36, 26, A);            // кираса
        R(48, 60 + b, 12, 22, A_L);
        R(62, 58 + b, 4, 26, A_D);
        R(46, 58 + b, 36, 3, GOLD);
        P(48, 64 + b, GOLD); P(79, 64 + b, GOLD); P(48, 80 + b, GOLD); P(79, 80 + b, GOLD);
    }
    function capeFront(b, sway) {
        R(30 + Math.max(sway, 0), 58 + b, 14, 52, CAPE);
        R(30 + Math.max(sway, 0), 58 + b, 4, 52, CAPE_D);
        R(84 + Math.min(sway, 0), 58 + b, 14, 52, CAPE);
        R(94 + Math.min(sway, 0), 58 + b, 4, 52, CAPE_D);
    }
    function beltSkirtFront(b) {
        R(46, 84 + b, 36, 8, LEA_D);
        R(58, 84 + b, 12, 8, GOLD); P(63, 87 + b, GOLD_D);
        R(44, 92 + b, 40, 12, LEA);
        for (let x = 52; x <= 76; x += 8) R(x, 92 + b, 3, 12, LEA_D);
    }
    function legsFront(dyA, dyB) {
        R(48, 104 + dyA, 13, 10, A);
        R(67, 104 + dyB, 13, 10, A);
        R(46, 112 + dyA, 15, 10, LEA_D); R(44, 120 + dyA, 17, 4, K);
        R(67, 112 + dyB, 15, 10, LEA_D); R(67, 120 + dyB, 17, 4, K);
    }
    // меч опущен (в покое и ходьбе)
    function swordDown(b) {
        R(26, 78 + b, 7, 6, GOLD_D);         // навершие
        R(27, 84 + b, 5, 6, LEA_D);          // рукоять
        R(22, 90 + b, 15, 4, GOLD);          // гарда
        R(29, 94 + b, 6, 28, BLADE);         // клинок
        R(30, 94 + b, 1, 28, "#ffffff");
        R(26, 84 + b, 12, 10, A_D);          // рука-перчатка
        for (let y = 86; y < 93; y += 2) R(26, y + b, 12, 1, K);
    }
    function shieldFront() {
        R(84, 62, 30, 50, SH_D);
        R(87, 65, 24, 44, SH);
        R(94, 82, 10, 10, A_L);              // умбон
        P(87, 65, K); P(110, 65, K); P(87, 108, K); P(110, 108, K);
    }
    // позы меча для атаки спереди
    function swordWindup(b) {
        R(24, 26, 6, 54, BLADE); R(25, 26, 1, 54, "#ffffff");   // клинок вверх
        R(19, 78, 16, 5, GOLD);
        R(26, 70 + b, 12, 10, A_D);          // рука поднята
        R(25, 83 + b, 5, 6, LEA_D);
        R(28, 78 + b, 7, 6, GOLD_D);
    }
    function swordSwing(b) {
        LN(26, 34, 62, 92, BLADE, 6); LN(29, 36, 64, 92, BLADE_D, 3);
        LN(22, 30, 30, 38, GOLD, 4);
        R(30, 78 + b, 14, 10, A_D);
    }
    function swordStrike(b) {
        LN(14, 112, 74, 90, BLADE, 6); LN(16, 114, 74, 93, BLADE_D, 3);
        LN(12, 116, 20, 112, GOLD, 5);
        R(28, 88 + b, 14, 10, A_D);
    }

    function frameWalkFront(p) {
        const bob = (p === 0 || p === 2) ? 1 : 0;
        const dyA = [0, 2, 4, 2][p], dyB = [4, 2, 0, 2][p];
        const sway = [0, 1, 0, -1][p];
        capeFront(bob, sway);
        legsFront(dyA, dyB);
        beltSkirtFront(bob);
        torsoFront(bob);
        helmetFront(bob);
        faceFront(bob, false);
        swordDown(bob);
        shieldFront();
    }
    function frameAttackFront(p) {
        const bob = [1, 0, 2, 0][p];
        capeFront(bob, p === 2 ? 2 : 0);
        legsFront(p === 2 ? 3 : 0, p === 2 ? 3 : 0);
        beltSkirtFront(bob);
        torsoFront(bob);
        helmetFront(bob);
        faceFront(bob, false);
        if (p === 0) swordWindup(bob);
        else if (p === 1) swordSwing(bob);
        else if (p === 2) swordStrike(bob);
        else swordDown(bob);
        shieldFront();
    }
    function frameWait(p) {
        const bob = (p === 1 || p === 2) ? 1 : 0;
        const sway = [0, 1, 0, -1][p];
        capeFront(bob, sway);
        legsFront(0, 0);
        beltSkirtFront(bob);
        torsoFront(bob);
        helmetFront(bob);
        faceFront(bob, false);
        swordDown(bob);
        shieldFront();
    }
    function frameDamage(p) {
        const lean = p === 0 ? 4 : 2;
        const bob = 0;
        capeFront(bob, -2);
        legsFront(0, 0);
        beltSkirtFront(bob);
        torsoFront(bob);
        helmetFront(bob);
        faceFront(bob, true);
        // красная вспышка попадания
        for (let i = 0; i < 26; i++) {
            const x = 46 + ((i * 37) % 36), y = 58 + ((i * 13) % 26);
            P(x + lean, y + bob, CAPE);
        }
        R(48 + lean, 40 + bob, 32, 8, CAPE);  // заливка ударившей волной
        swordDown(bob);
        shieldFront();
    }
    function frameDeath(p) {
        if (p === 0) { frameDamage(0); return; }
        if (p <= 2) {
            const sink = p === 1 ? 14 : 26;
            capeFront(sink, 0);
            beltSkirtFront(sink);
            torsoFront(sink);
            helmetFront(sink);
            faceFront(sink, true);
            // меч воткнут в землю
            R(29, 94, 6, 30, BLADE); R(30, 94, 1, 30, "#ffffff");
            R(25, 90, 14, 4, GOLD);
            shieldFront();
            return;
        }
        if (p === 3) {
            // рухнул: груда доспеха
            R(30, 92, 68, 32, A);
            R(30, 92, 68, 6, A_L);
            R(30, 100, 10, 24, CAPE); R(88, 100, 10, 24, CAPE);
            R(30, 118, 68, 6, K);
            R(44, 84, 40, 12, LEA_D);       // смятый пояс/юбка
            helmetFront(78);                 // шлем съехал
            // меч воткнут рядом
            R(101, 88, 6, 36, BLADE); R(97, 84, 14, 5, GOLD);
            return;
        }
        // финал: лежит, шлем отдельно, щит плашмя, меч воткнут
        R(34, 104, 62, 20, A);
        R(34, 104, 62, 5, A_L);
        R(34, 100, 62, 6, CAPE);
        R(30, 116, 70, 6, K);
        // шлем валяется слева
        R(12, 108, 24, 12, A);
        R(14, 104, 20, 5, A_L);
        R(6, 102, 9, 6, HORN); R(33, 102, 9, 6, HORN);
        // щит плашмя справа
        R(92, 110, 30, 12, SH);
        R(92, 110, 30, 3, SH_D);
        // меч в земле
        R(80, 84, 6, 38, BLADE); R(81, 84, 1, 38, "#ffffff");
        R(74, 80, 18, 5, GOLD);
    }

    // ============ ВИД СЗАДИ ============
    function frameWalkBack(p) {
        const bob = (p === 0 || p === 2) ? 1 : 0;
        const dyA = [0, 2, 4, 2][p], dyB = [4, 2, 0, 2][p];
        // сплошной плащ на всю спину
        const sway = [0, 1, 0, -1][p];
        R(34 + sway, 56 + bob, 60, 58, CAPE);
        R(34 + sway, 56 + bob, 6, 58, CAPE_D);
        R(52 + sway, 58 + bob, 4, 54, CAPE_D); R(72 + sway, 58 + bob, 4, 54, CAPE_D);
        // наплечники поверх плаща
        R(26, 54 + bob, 22, 18, A); R(28, 54 + bob, 18, 4, A_L);
        R(80, 54 + bob, 22, 18, A); R(82, 54 + bob, 18, 4, A_L);
        // шлем сзади
        R(48, 12 + bob, 32, 10, A_L);
        R(46, 20 + bob, 36, 18, A);
        R(62, 12 + bob, 4, 26, A_D);
        R(38, 10 + bob, 10, 8, HORN); R(32, 4 + bob, 10, 8, HORN); R(28, 0 + bob, 8, 6, HORN);
        R(80, 10 + bob, 10, 8, HORN); R(86, 4 + bob, 10, 8, HORN); R(92, 0 + bob, 8, 6, HORN);
        // пояс под плащом и ноги
        R(46, 100 + bob, 36, 6, LEA_D);
        E.rect(48, 106 + dyA, 13, 8, A);
        E.rect(67, 106 + dyB, 13, 8, A);
        R(46, 114 + dyA, 15, 9, LEA_D); R(67, 114 + dyB, 15, 9, LEA_D);
        // руки-посох... меч слева
        R(24, 80 + bob, 8, 30, BLADE);
        R(25, 80 + bob, 2, 30, "#ffffff");
        R(20, 76 + bob, 16, 5, GOLD);
    }
    // attack_back — как front (меч и плащ видны), лицо не важно
    function frameAttackBack(p) {
        frameWalkBack(1);
        if (p === 0) { R(20, 20, 8, 60, BLADE); R(21, 20, 2, 60, "#ffffff"); R(14, 76, 20, 6, GOLD); }
        if (p === 1) { LN(24, 30, 64, 88, BLADE, 7); }
        if (p === 2) { LN(12, 110, 74, 88, BLADE, 7); }
    }

    // ============ ВИД СБОКУ (лицом вправо) ============
    function frameWalkSide(p, flip) {
        const bob = (p === 0 || p === 2) ? 1 : 0;
        const stride = [4, 0, -4, 0][p];
        // плащ сзади (слева)
        R(30, 58 + bob, 18, 54, CAPE);
        R(30, 58 + bob, 5, 54, CAPE_D);
        // ноги-шаг
        const fx = 62 + stride, bx = 50 - stride;
        R(fx, 106, 14, 8 - Math.abs(stride) / 2, A);
        R(fx - 2, 112, 18, 10, LEA_D); R(fx - 2, 120, 20, 4, K);
        R(bx, 108, 14, 6, A);
        R(bx - 2, 114, 18, 8, LEA_D);
        // корпус
        R(48, 54 + bob, 34, 30, A);
        R(50, 56 + bob, 10, 26, A_L);
        R(48, 82 + bob, 36, 7, LEA_D);
        R(50, 88 + bob, 34, 12, LEA);
        // шлем профиль
        R(54, 12 + bob, 34, 12, A_L);
        R(52, 22 + bob, 38, 16, A);
        R(64, 12 + bob, 4, 26, A_D);
        R(78, 36 + bob, 10, 8, A);
        R(80, 38 + bob, 8, 12, SKIN);        // лицо в профиль
        R(84, 42 + bob, 3, 3, EYE);
        // рога: передний и задний
        R(74, 4 + bob, 12, 8, HORN); R(84, 0 + bob, 10, 8, HORN);
        R(50, 6 + bob, 10, 8, HORN); R(46, 2 + bob, 8, 6, HORN);
        // наплечник
        R(50, 52 + bob, 22, 16, A); R(52, 52 + bob, 18, 4, A_L);
        // рука с мечом вперёд
        R(74, 62 + bob, 12, 8, A_D);
        R(84, 70 + bob, 8, 8, A_D);
        // меч наклонён вперёд-вверх
        LN(92, 76, 116, 44, BLADE, 5); LN(94, 77, 116, 46, BLADE_D, 2);
        R(88, 74, 10, 5, GOLD);
        if (flip) E.flipX();
    }
    // attack бок: замах → рубящий вперёд
    function frameAttackSide(p, flip) {
        const bob = (p === 0 || p === 2) ? 1 : 0;
        const lunge = p === 2 ? 6 : 0;
        R(30 - lunge / 2, 58 + bob, 18, 54, CAPE);
        R(30 - lunge / 2, 58 + bob, 5, 54, CAPE_D);
        const fx = 62 + (p === 2 ? 10 : 0), bx = 50 - (p === 2 ? 4 : 0);
        R(fx, 106, 14, 8, A); R(fx - 2, 112, 18, 10, LEA_D); R(fx - 2, 120, 20, 4, K);
        R(bx, 108, 14, 6, A); R(bx - 2, 114, 18, 8, LEA_D);
        R(48, 54 + bob, 34, 30, A);
        R(50, 56 + bob, 10, 26, A_L);
        R(48, 82 + bob, 36, 7, LEA_D);
        R(50, 88 + bob, 34, 12, LEA);
        R(54, 12 + bob, 34, 12, A_L);
        R(52, 22 + bob, 38, 16, A);
        R(64, 12 + bob, 4, 26, A_D);
        R(78, 36 + bob, 10, 8, A);
        R(80, 38 + bob, 8, 12, SKIN);
        R(84, 42 + bob, 3, 3, EYE);
        R(74, 4 + bob, 12, 8, HORN); R(84, 0 + bob, 10, 8, HORN);
        R(50, 6 + bob, 10, 8, HORN); R(46, 2 + bob, 8, 6, HORN);
        R(50, 52 + bob, 22, 16, A); R(52, 52 + bob, 18, 4, A_L);
        // рука и меч в фазах
        R(70, 62 + bob, 14, 8, A_D);
        if (p === 0) { LN(88, 70, 108, 30, BLADE, 5); R(84, 66, 10, 5, GOLD); }   // замах вверх-назад
        if (p === 1) { LN(90, 62, 116, 62, BLADE, 5); R(86, 58, 10, 5, GOLD); }   // горизонталь
        if (p === 2) { LN(90, 76, 120, 96, BLADE, 5); R(86, 72, 10, 5, GOLD); }   // удар вниз-вперёд
        if (p === 3) { LN(92, 76, 116, 44, BLADE, 5); R(88, 74, 10, 5, GOLD); }   // возврат
        if (flip) E.flipX();
    }

    // ================= СБОРКА ЛИСТА =================
    E.resize(128);
    E.renameRow("wait", "wait");
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
            for (let p = 0; p < count; p++) {
                E.setFrame(p);
                draw(p);
                if (p < count - 1) E.newFrame();
            }
        }
        E.setRow("wait"); E.setFrame(0);
    });
    return E.rows();
}
