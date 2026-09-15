// АТАКИ И СНАРЯДЫ — привязка «персонаж → атака → снаряд».
// ATTACK_CONFIGS — типы атак: sheet — лист images/projectiles/<sheet>.png
// (+.json, строка листа = направление: all/front/back/left/right, у knife ещё
// диагонали); kind — класс атаки:
//   "melee"  — ближний бой: эффект появляется ПЕРЕД персонажем со стороны
//              взгляда, НЕ двигается, проигрывает анимацию ОДИН раз и гаснет
//              (время жизни = длительность анимации);
//   "ranged" — дальнобойный: снаряд ВЫЛЕТАЕТ и ЛЕТИТ по направлению взгляда,
//              гаснет по lifetime из атаки персонажа.
// reach — «зона потенциальной достижимости оружия» (px): автоатака срабатывает,
// когда цель вошла в этот радиус (и у ИИ — дистанция остановки для стрельбы).
// speed — скорость полёта (только ranged), fps — прокрутка кадров анимации.
// cd — перезарядка атаки в СЕКУНДАХ (образец forWork/example, там 0.4–1.6);
// темп атак ИИ (ai.register attackCd) берёт её отсюда.
// kind и привязки персонажей выверены по образцу: dagger — укол ВБЛИЗИ
// (attack.0), club — БРОСОК дубины огром (attack.10), rock — каменный удар
// шипа ВБЛИЗИ (attack.13).
// CHARACTER_ATTACKS — атака персонажа: attack — тип, spawnTick — кадр анимации
// атаки, на котором эффект/снаряд выпускается (кадры с 0), lifetime — время
// существования ЛЕТЯЩЕГО снаряда (сек; у melee длительность считает модуль).
const ATTACK_CONFIGS = {
    // ── ближний бой: взмах/укус перед собой
    bite:           { sheet: "bite",           kind: "melee",  reach: 36,  speed: 0,   fps: 8, cd: 0.4 },
    sword:          { sheet: "sword",          kind: "melee",  reach: 46,  speed: 0,   fps: 8, cd: 0.7 },
    swordHound:     { sheet: "swordHound",     kind: "melee",  reach: 44,  speed: 0,   fps: 8, cd: 0.7 },
    axe:            { sheet: "axe",            kind: "melee",  reach: 44,  speed: 0,   fps: 8, cd: 0.6 },
    mace:           { sheet: "mace",           kind: "melee",  reach: 46,  speed: 0,   fps: 8, cd: 0.8 },
    club:           { sheet: "club",           kind: "ranged", reach: 220, speed: 170, fps: 8, cd: 1.2 },
    twoHandedSword: { sheet: "twoHandedSword", kind: "melee",  reach: 50,  speed: 0,   fps: 8, cd: 0.9 },
    alebard:        { sheet: "alebard",        kind: "melee",  reach: 54,  speed: 0,   fps: 8, cd: 0.85 },
    rock:           { sheet: "rock",           kind: "melee",  reach: 44,  speed: 0,   fps: 8, cd: 0.7 },
    dagger:         { sheet: "dagger",         kind: "melee",  reach: 38,  speed: 0,   fps: 8, cd: 0.5 },
    // ── дальнобойные: снаряд летит
    bow:            { sheet: "bow",            kind: "ranged", reach: 240, speed: 360, fps: 8, cd: 1.2 },
    spear:          { sheet: "spear",          kind: "ranged", reach: 130, speed: 300, fps: 8, cd: 0.9 },
    knife:          { sheet: "knife",          kind: "ranged", reach: 130, speed: 320, fps: 8, cd: 1.0 },
    fireball:       { sheet: "fireball",       kind: "ranged", reach: 200, speed: 240, fps: 8, cd: 1.5 },
    staff:          { sheet: "staff",          kind: "ranged", reach: 160, speed: 240, fps: 8, cd: 1.1 },
    wand:           { sheet: "wand",           kind: "ranged", reach: 180, speed: 260, fps: 8, cd: 1.0 },
    cold:           { sheet: "cold",           kind: "ranged", reach: 170, speed: 200, fps: 8, cd: 1.5 },
    poison:         { sheet: "poison",         kind: "ranged", reach: 170, speed: 220, fps: 8, cd: 1.6 },
    void:           { sheet: "void",           kind: "ranged", reach: 170, speed: 200, fps: 8, cd: 1.6 },
    web:            { sheet: "web",            kind: "ranged", reach: 110, speed: 190, fps: 8, cd: 1.5 },
    octo:           { sheet: "octo",           kind: "ranged", reach: 100, speed: 230, fps: 8, cd: 1.0 },
    boss3attack:    { sheet: "boss3attack",    kind: "ranged", reach: 150, speed: 280, fps: 10, cd: 1.2 },
};
// spawnTick по умолчанию: физические метательные — кадр 2 (замах ещё виден),
// магия и выстрелы — кадр 3 (снаряд срывается в конце замаха)
const CHARACTER_ATTACKS = {
    // ── герой
    wolf:    { attack: "bite",   spawnTick: 1, lifetime: 0.7 },
    // ── герои (сейчас на карте не спавнятся — данные под будущие режимы)
    knight:  { attack: "sword",  spawnTick: 2, lifetime: 0.8 },
    rogue:   { attack: "knife",  spawnTick: 2, lifetime: 0.8 },
    sorca:   { attack: "fireball", spawnTick: 3, lifetime: 1.1 },
    valca:   { attack: "bow",    spawnTick: 3, lifetime: 0.9 },
    // ── враги: привязки по образцу (см. ENEMY_BESTIARY, data/enemies.js)
    goba:    { attack: "dagger", spawnTick: 2, lifetime: 0.8 },   // «Точечный укол» — вблизи
    shaman:  { attack: "staff",  spawnTick: 3, lifetime: 1.2 },   // «Разряд»
    dwarf:   { attack: "axe",    spawnTick: 2, lifetime: 0.9 },   // «Рубка»
    orc:     { attack: "mace",   spawnTick: 2, lifetime: 1.0 },   // «Удар»
    ogr:     { attack: "club",   spawnTick: 2, lifetime: 1.3 },   // «Бросок дубины»
    lider:   { attack: "alebard", spawnTick: 2, lifetime: 1.0 },  // «Разрубание»
    // ── лес
    spider:  { attack: "bite",   spawnTick: 1, lifetime: 0.6 },   // укус + яд
    spiderRed: { attack: "bite",  spawnTick: 1, lifetime: 0.6 },  // укус + поджог
    spiderman: { attack: "web",  spawnTick: 3, lifetime: 1.1 },   // «Паутина»
    rat:     { attack: "bite",   spawnTick: 1, lifetime: 0.6 },
    hound:   { attack: "swordHound", spawnTick: 2, lifetime: 0.9 },
    // ── вода
    octopus: { attack: "octo",   spawnTick: 3, lifetime: 1.1 },
    // ── прочие враги (данжи будущего)
    bat:     { attack: "dagger", spawnTick: 2, lifetime: 0.8 },
    cyclop:  { attack: "void",   spawnTick: 3, lifetime: 1.3 },   // «Звезда пустоты»
    dark:    { attack: "spear",  spawnTick: 2, lifetime: 1.0 },   // «Укол»
    demon:   { attack: "boss3attack", spawnTick: 3, lifetime: 1.4 }, // «Молния демона»
    imp:     { attack: "alebard", spawnTick: 2, lifetime: 1.0 },
    medusa:  { attack: "void",   spawnTick: 3, lifetime: 1.3 },   // «Звезда пустоты»
    mummy:   { attack: "twoHandedSword", spawnTick: 2, lifetime: 1.0 }, // «Взмах»
    spike:   { attack: "rock",   spawnTick: 2, lifetime: 1.0 },   // «Каменный удар»
    succubus: { attack: "wand",  spawnTick: 3, lifetime: 1.1 },
    vampire: { attack: "bite",   spawnTick: 1, lifetime: 0.6 },
    spiderboss: { attack: "poison", spawnTick: 3, lifetime: 1.2 }, // «Плевок босса»
};

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.ATTACK_CONFIGS = ATTACK_CONFIGS;
globalThis.CHARACTER_ATTACKS = CHARACTER_ATTACKS;
