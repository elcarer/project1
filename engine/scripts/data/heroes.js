// КЛАССЫ ГЕРОЕВ — перенос параметров героев из образца forWork/example
// (data.js «heroes» + localization.js): распределение 20 очков по пяти
// основным статам, оружие и дерево умений (индекс в ABILITY_TREES,
// data/abilities.js). Листы персонажей уже есть (images/sprites/<sheet>),
// атаки привязаны в CHARACTER_ATTACKS (data/attacks.js).
//
// Классы — образец баланса под БУДУЩИЙ экран выбора класса: в мире пока
// не спавнятся. Текущий герой игры — волк (охотник стаи), его статы живут
// в HERO_BASE (data/stats.js) и масштаб мира у него свой (8/8/8/8/5 —
// 37 очков против 20 у «человеческих» классов образца: другой масштаб силы).
const HERO_CLASSES = [
    { key: "rogue", name: "Плут", sheet: "rogue_64", attack: "knife", tree: 0,
      prim: { str: 3, agi: 7, vit: 3, spd: 5, wis: 2 } },
    { key: "sorca", name: "Волшебница", sheet: "sorca_64", attack: "fireball", tree: 1,
      prim: { str: 2, agi: 3, vit: 3, spd: 3, wis: 9 } },
    { key: "knight", name: "Рыцарь", sheet: "knight_64", attack: "sword", tree: 2,
      prim: { str: 5, agi: 3, vit: 7, spd: 2, wis: 3 } },
    { key: "valca", name: "Валькирия", sheet: "valca_64", attack: "bow", tree: 3,
      prim: { str: 3, agi: 4, vit: 5, spd: 7, wis: 1 } },
];

// Волк — действующий герой (статы/рост — в HERO_BASE, data/stats.js)
const HERO_WOLF = {
    key: "wolf", name: "Волк", sheet: "wolf_64", attack: "bite", tree: -1,
    prim: null, // HERO_BASE.prim — масштаб открытого мира, не равнение на классы
};

globalThis.HERO_CLASSES = HERO_CLASSES;
globalThis.HERO_WOLF = HERO_WOLF;
