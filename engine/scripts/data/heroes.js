// КЛАССЫ ГЕРОЕВ — перенос параметров героев из образца forWork/example
// (data.js «heroes» + localization.js): распределение 20 очков по пяти
// основным статам, оружие и дерево умений (индекс в ABILITY_TREES,
// data/abilities.js). Листы персонажей уже есть (images/sprites/<sheet>),
// атаки привязаны в CHARACTER_ATTACKS (data/attacks.js).
//
// Герой выбирается в ЛОББИ (сцена "lobby" после «Новая игра»); выбор
// запоминается в localStorage ("heroKey"). Волк героем больше не является —
// он монстр открытого мира (ENEMY_STATS.wolf, data/stats.js).
//
// Поля класса:
//   prim/growth — основные статы и прирост за уровень (+2 всё, как у образца
//                 масштаба; разбросы классов — точно из образца);
//   weaponMin   — минимальный урон оружия (basicWeapons образца: нож 1,
//                 посох 2, меч 1, лук 1);
//   loadout     — ключи боевых умений (HERO_ABILITIES, data/abilities.js);
//   doll        — портрет для лобби (images/heroes/doll/, из образца;
//                 на file:// вшит EMBED_LOBBY — make_embedded_lobby.py).
const HERO_CLASSES = [
    { key: "rogue", name: "Плут", sheet: "rogue_64", attack: "knife", tree: 0,
      weaponMin: 1, doll: "rogue",
      prim: { str: 3, agi: 7, vit: 3, spd: 5, wis: 2 },
      growth: { str: 2, agi: 2, vit: 2, spd: 2, wis: 2 },
      loadout: ["fan", "pull", "haste"],
      desc: "Ловкий бродяга с меткими ножами: веерный бросок, крюк-кошка и теневое скольжение." },
    { key: "sorca", name: "Волшебница", sheet: "sorca_64", attack: "fireball", tree: 1,
      weaponMin: 2, doll: "sorca",
      prim: { str: 2, agi: 3, vit: 3, spd: 3, wis: 9 },
      growth: { str: 2, agi: 2, vit: 2, spd: 2, wis: 2 },
      loadout: ["fireball", "frost", "meteor"],
      desc: "Повелительница стихий: огненные шары, мороз и метеорит по скоплению врагов." },
    { key: "knight", name: "Рыцарь", sheet: "knight_64", attack: "sword", tree: 2,
      weaponMin: 1, doll: "knight",
      prim: { str: 5, agi: 3, vit: 7, spd: 2, wis: 3 },
      growth: { str: 2, agi: 2, vit: 2, spd: 2, wis: 2 },
      loadout: ["charge", "heal", "execute"],
      desc: "Стена брони: заряженная атака сквозь строй, восстановление и казнь ослабевших." },
    { key: "valca", name: "Валькирия", sheet: "valca_64", attack: "bow", tree: 3,
      weaponMin: 1, doll: "valca",
      prim: { str: 3, agi: 4, vit: 5, spd: 7, wis: 1 },
      growth: { str: 2, agi: 2, vit: 2, spd: 2, wis: 2 },
      loadout: ["dash", "haste", "heal"],
      desc: "Копьё и ветер: пронзающий рывок, разгон и аура восстановления." },
];

globalThis.HERO_CLASSES = HERO_CLASSES;
