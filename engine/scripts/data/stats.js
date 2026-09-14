// РОЛЕВАЯ СИСТЕМА — основные характеристики, вторичные статы, опыт и уровни.
// Модель: 5 основных характеристик (Сила/Ловкость/Здоровье/Скорость/Мудрость),
// от каждой из них формулами считаются 3 вторичных стата — проценты и значения,
// которые использует боевая система (modules/combat.js).
//
// Формулы перенесены из образца forWork/countDopStats.js (без реликвий,
// инвентаря и мета-бонусов — слагаемые оттуда здесь равны нулю):
//   countLog(i) — универсальный переводчик «значение стата → процент»;
//   блок = countLog(Сила/2), контратака = countLog(Сила), крит = countLog(Ловк),
//   мощь крита = 150 + 2·countLog(Ловк) (у образца 100 + 2·… — по требованию
//   пользователя мощь крита начинается со 150%), уклонение = countLog(Ловк/2),
//   ХП = 10 + 5·Здоровье, сопротивление = countLog(Здоровье),
//   выносливость = countLog(2·Здоровье), подвижность = countLog(Скорость) и т.д.
//
// Опыт до следующего уровня — кривая пользователя:
//   xpToNext(lvl) = trunc(((1 + 10/lvl)^(lvl/10) − 1) / (e − 1) · 100)
// (та же форма, что countLog, с коэффициентом 10; растёт от 15 на 1-м уровне
// к асимптоте 100).

// Универсальный переводчик значения стата в процент (образец countDopStats.js)
function countLog(i) {
    return Math.trunc(((1 + 40 / i) ** (i / 40) - 1) / (Math.exp(1) - 1) * 100);
}

// Опыт до следующего уровня (кривая пользователя)
function xpToNext(lvl) {
    return Math.trunc(((1 + 10 / lvl) ** (lvl / 10) - 1) / (Math.exp(1) - 1) * 100);
}

// Группы статов — подписи для будущих экранов персонажа
const STAT_LABELS = [
    { key: "str", name: "Сила",     dops: ["атака", "блок", "контратака"] },
    { key: "agi", name: "Ловкость", dops: ["шанс крита", "уклонение", "мощь крита"] },
    { key: "vit", name: "Здоровье", dops: ["ХП", "сопротивление", "выносливость"] },
    { key: "spd", name: "Скорость", dops: ["подвижность", "находчивость", "рефлексы"] },
    { key: "wis", name: "Мудрость", dops: ["сила воли", "обучаемость", "контрмагия"] },
];

// Пересчёт вторичных статов из основных (формулы countDopStats.js).
// Заделы на будущее (способностей/дебафов/лечения пока нет в игре):
// resist/endurance/cdrAbility/spellPower/counterMagic считаются, но не применяются.
function calcDop(prim) {
    const t = Math.trunc;
    return {
        attack: prim.str,                          // макс. урон удара (мин = weaponMin)
        block: countLog(t(prim.str / 2)),          // % получить половину урона
        counter: countLog(prim.str),               // % ответить своей атакой
        crit: countLog(prim.agi),                  // % крита
        critPower: 150 + 2 * countLog(prim.agi),   // % урона критом (со 150)
        dodge: countLog(t(prim.agi / 2)),          // % уклониться (весь урон мимо)
        hpMax: 10 + 5 * prim.vit,                  // запас здоровья
        resist: countLog(prim.vit),                // % резиста способностям (задел)
        endurance: countLog(2 * prim.vit),         // −дебаффы / +лечение (задел)
        move: countLog(prim.spd),                  // + % скорости передвижения
        cdrAbility: countLog(prim.spd),            // − % кд способностей (задел)
        cdrAttack: countLog(t(prim.spd / 2)),      // − % кд основной атаки
        spellPower: prim.wis,                      // урон способностей (задел)
        xpBoost: countLog(t(prim.wis / 3)),        // % удвоить получаемый опыт
        counterMagic: countLog(prim.wis),          // % контрмагии (задел)
    };
}

// Герой (волк): базовые основные статы и прирост за уровень
const HERO_BASE = {
    lvl: 1,
    prim: { str: 8, agi: 8, vit: 8, spd: 8, wis: 5 },
    growth: { str: 2, agi: 2, vit: 2, spd: 2, wis: 2 },
    weaponMin: 3, // минимальный урон основного удара (укуса)
};

// Враги: уровень, основные статы, минимальный урон и награда опытом.
// game.js при спавне добавляет индивидуальную разброску +0..1 к каждому стату.
const ENEMY_STATS = {
    goba:    { lvl: 1, prim: { str: 3, agi: 3, vit: 3, spd: 4, wis: 1 }, weaponMin: 1, xp: 8 },
    shaman:  { lvl: 3, prim: { str: 4, agi: 4, vit: 4, spd: 3, wis: 6 }, weaponMin: 2, xp: 20 },
    dwarf:   { lvl: 2, prim: { str: 5, agi: 2, vit: 5, spd: 2, wis: 1 }, weaponMin: 2, xp: 12 },
    orc:     { lvl: 3, prim: { str: 6, agi: 3, vit: 5, spd: 3, wis: 1 }, weaponMin: 2, xp: 16 },
    ogr:     { lvl: 5, prim: { str: 9, agi: 2, vit: 9, spd: 2, wis: 2 }, weaponMin: 3, xp: 35 },
    spider:  { lvl: 2, prim: { str: 4, agi: 4, vit: 3, spd: 4, wis: 1 }, weaponMin: 1, xp: 10 },
    rat:     { lvl: 1, prim: { str: 2, agi: 4, vit: 2, spd: 5, wis: 1 }, weaponMin: 1, xp: 5 },
    octopus: { lvl: 2, prim: { str: 4, agi: 3, vit: 4, spd: 3, wis: 2 }, weaponMin: 1, xp: 10 },
};

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.countLog = countLog;
globalThis.xpToNext = xpToNext;
globalThis.STAT_LABELS = STAT_LABELS;
globalThis.calcDop = calcDop;
globalThis.HERO_BASE = HERO_BASE;
globalThis.ENEMY_STATS = ENEMY_STATS;
