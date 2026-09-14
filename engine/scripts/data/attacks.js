// АТАКИ И СНАРЯДЫ — привязка «персонаж → атака → снаряд».
// ATTACK_CONFIGS — типы снарядов: лист images/projectiles/<sheet>.png (+.json,
// строка листа = направление: all/front/back/left/right, у knife ещё диагонали),
// speed — скорость полёта (px/с), fps — скорость прокрутки кадров (пока летит).
// CHARACTER_ATTACKS — атака персонажа: attack — тип снаряда, spawnTick — кадр
// анимации атаки, на котором снаряд выпускается (кадры с 0), lifetime — время
// существования снаряда (сек). Раскладка по персонажам тематическая, легко правится.
const ATTACK_CONFIGS = {
    bite:           { sheet: "bite",           speed: 300, fps: 8 },
    bow:            { sheet: "bow",            speed: 360, fps: 8 },
    rock:           { sheet: "rock",           speed: 170, fps: 8 },
    spear:          { sheet: "spear",          speed: 300, fps: 8 },
    dagger:         { sheet: "dagger",         speed: 320, fps: 8 },
    knife:          { sheet: "knife",          speed: 320, fps: 8 },
    sword:          { sheet: "sword",          speed: 260, fps: 8 },
    swordHound:     { sheet: "swordHound",     speed: 260, fps: 8 },
    axe:            { sheet: "axe",            speed: 220, fps: 8 },
    mace:           { sheet: "mace",           speed: 200, fps: 8 },
    club:           { sheet: "club",           speed: 190, fps: 8 },
    twoHandedSword: { sheet: "twoHandedSword", speed: 200, fps: 8 },
    alebard:        { sheet: "alebard",        speed: 240, fps: 8 },
    fireball:       { sheet: "fireball",       speed: 240, fps: 8 },
    staff:          { sheet: "staff",          speed: 240, fps: 8 },
    wand:           { sheet: "wand",           speed: 260, fps: 8 },
    cold:           { sheet: "cold",           speed: 200, fps: 8 },
    poison:         { sheet: "poison",         speed: 220, fps: 8 },
    void:           { sheet: "void",           speed: 200, fps: 8 },
    web:            { sheet: "web",            speed: 190, fps: 8 },
    octo:           { sheet: "octo",           speed: 230, fps: 8 },
    boss3attack:    { sheet: "boss3attack",    speed: 280, fps: 10 },
};
// spawnTick по умолчанию: физические метательные — кадр 2 (замах ещё виден),
// магия и выстрелы — кадр 3 (снаряд срывается в конце замаха)
const CHARACTER_ATTACKS = {
    // ── герой и герои
    wolf:    { attack: "bite",   spawnTick: 1, lifetime: 0.7 },
    knight:  { attack: "sword",  spawnTick: 2, lifetime: 0.8 },
    rogue:   { attack: "knife",  spawnTick: 2, lifetime: 0.8 },
    sorca:   { attack: "fireball", spawnTick: 3, lifetime: 1.1 },
    valca:   { attack: "bow",    spawnTick: 3, lifetime: 0.9 },
    // ── деревни
    goba:    { attack: "dagger", spawnTick: 2, lifetime: 0.8 },
    shaman:  { attack: "staff",  spawnTick: 3, lifetime: 1.2 },
    dwarf:   { attack: "axe",    spawnTick: 2, lifetime: 0.9 },
    orc:     { attack: "spear",  spawnTick: 2, lifetime: 1.0 },
    ogr:     { attack: "club",   spawnTick: 2, lifetime: 1.0 },
    lider:   { attack: "mace",   spawnTick: 2, lifetime: 1.0 },
    // ── лес
    spider:  { attack: "web",    spawnTick: 3, lifetime: 1.0 },
    spiderRed: { attack: "web",  spawnTick: 3, lifetime: 1.0 },
    spiderman: { attack: "web",  spawnTick: 3, lifetime: 1.1 },
    rat:     { attack: "bite",   spawnTick: 1, lifetime: 0.6 },
    hound:   { attack: "swordHound", spawnTick: 2, lifetime: 0.9 },
    // ── вода
    octopus: { attack: "octo",   spawnTick: 3, lifetime: 1.1 },
    // ── прочие враги
    bat:     { attack: "bite",   spawnTick: 1, lifetime: 0.6 },
    cyclop:  { attack: "rock",   spawnTick: 2, lifetime: 1.3 },
    dark:    { attack: "void",   spawnTick: 3, lifetime: 1.3 },
    demon:   { attack: "twoHandedSword", spawnTick: 2, lifetime: 1.0 },
    imp:     { attack: "fireball", spawnTick: 3, lifetime: 1.0 },
    medusa:  { attack: "poison", spawnTick: 3, lifetime: 1.2 },
    mummy:   { attack: "cold",   spawnTick: 3, lifetime: 1.2 },
    spike:   { attack: "alebard", spawnTick: 2, lifetime: 1.0 },
    succubus: { attack: "wand",  spawnTick: 3, lifetime: 1.1 },
    vampire: { attack: "dagger", spawnTick: 2, lifetime: 0.9 },
    spiderboss: { attack: "boss3attack", spawnTick: 3, lifetime: 1.4 },
};

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.ATTACK_CONFIGS = ATTACK_CONFIGS;
globalThis.CHARACTER_ATTACKS = CHARACTER_ATTACKS;
