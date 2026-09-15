// БЕСТИАРИЙ — перенос параметров врагов из образца forWork/example
// (data.js «enemes» + localization.js). 23 вида: 15 рядовых, 6 элитных,
// 5 боссов (медуза и циклоп — 4-й этаж «Пустота»).
//
// Поля:
//   key    — наш ключ вида (= ключ спрайта images/sprites/<key>_64 и
//            CHARACTER_ATTACKS, data/attacks.js);
//   name   — RU-имя (образец);
//   tier   — common | elite | boss;
//   attack — атака по образцу (ключ ATTACK_CONFIGS; в скобках в комментарии —
//            название атаки из образца);
//   hp/dmg/exp/speed/range — СЫРЫЕ параметры образца (другой масштаб игры:
//            hp в их очках, exp — их награда, speed — их единицы/тик,
//            range — клетки 32px). Это СПРАВОЧНЫЙ контент: наши боевые статы
//            (уровень, основные статы, награда XP) живут в ENEMY_STATS
//            (data/stats.js) — там уже 8 видов открытого мира, остальные
//            оживут вместе с данжами;
//   special — особая способность вида (ключи наших механик combat.js):
//            call        — получив урон, зовёт соратников в радиусе N клеток;
//            stoneskin   — один удар не наносит больше N урона;
//            poison      — атаки отравляют на N (у нас: N сек по 1 урона/с);
//            rage        — каждые N сек ярость: скорость ×1.5;
//            reanimate   — 1-й смертельный удар: встаёт через 3 сек с N долей ХП;
//            flame       — атаки поджигают на N за удар героя;
//            shadow      — каждые N сек уход в тень, всплывает у героя;
//            dash        — рывок с уроном на N клеток;
//            charm       — раз в 5 сек чарующий снаряд;
//            howl        — при смерти воет: урон врагов +N;
//            summoning   — получая урон, призывает врагов раз в N сек;
//            vampirism   — атакуя, лечится на N раз в 3 сек;
//            crush       — атака раскалывается на осколки;
//            voidBlob    — раз в N сек Сгусток пустоты (6–18 урона);
//            segmentation— при ХП ≤ половины делится надвое (N деления);
//            invulnerability — N сек неуязвимости в цикле босса.
const ENEMY_BESTIARY = [
    // ── 1-й этаж образца (наш открытый мир: goba/shaman/orc/ogr/dwarf/…) ──
    { key: "goba", name: "Гоблин", tier: "common", attack: "dagger",   // «Точечный укол»
      hp: 5, dmg: [1, 5], exp: 1, speed: 10, range: 6, special: { call: 8 },
      desc: "Получив урон, зовёт соратников в радиусе 8 клеток." },
    { key: "orc", name: "Орк", tier: "common", attack: "mace",         // «Удар»
      hp: 7, dmg: [3, 5], exp: 1, speed: 7, range: 6, special: { stoneskin: 12 },
      desc: "Один удар не наносит ему больше 12 урона." },
    { key: "shaman", name: "Шаман гоблинов", tier: "elite", attack: "staff", // «Разряд»
      hp: 8, dmg: [2, 5], exp: 4, speed: 6, range: 7, special: null, desc: "" },
    { key: "ogr", name: "Огр", tier: "elite", attack: "club",          // «Бросок дубины»
      hp: 10, dmg: [3, 5], exp: 4, speed: 5, range: 7, special: null, desc: "" },
    { key: "rat", name: "Крыса", tier: "common", attack: "bite",       // «Укус»
      hp: 1, dmg: [1, 2], exp: 1, speed: 12, range: 12, special: null, desc: "Голодная." },
    { key: "wolf", name: "Волк", tier: "common", attack: "bite",       // «Укус»
      hp: 25, dmg: [4, 8], exp: 4, speed: 11, range: 6, special: null,
      desc: "Быстрый лесной хищник. Прежний герой этих земель — теперь охотится в стае." },
    { key: "dwarf", name: "Дворф", tier: "common", attack: "axe",      // «Рубка»
      hp: 20, dmg: [4, 7], exp: 1, speed: 9, range: 6, special: null, desc: "" },
    { key: "lider", name: "Лидер гоблинов", tier: "boss", attack: "alebard", // «Разрубание»
      hp: 40, dmg: [5, 6], exp: 10, speed: 10, range: 7, special: { rage: 8 },
      desc: "Каждые 8 секунд впадает в ярость: скорость ×1.5." },
    { key: "spider", name: "Паук", tier: "common", attack: "bite",     // «Укус»
      hp: 8, dmg: [1, 4], exp: 1, speed: 10, range: 12, special: { poison: 2 },
      desc: "Атаки отравляют героя." },
    { key: "spiderRed", name: "Красный паук", tier: "common", attack: "bite", // «Укус»
      hp: 16, dmg: [2, 6], exp: 1, speed: 10, range: 12, special: { flame: 1 },
      desc: "Атаки поджигают героя: каждый ваш удар обжигает героя на 1." },
    { key: "spiderman", name: "Паукоид", tier: "elite", attack: "web", // «Паутина»
      hp: 32, dmg: [1, 3], exp: 4, speed: 6, range: 7, special: { poison: 6 },
      desc: "Атаки отравляют героя на 6." },
    { key: "octopus", name: "Отродье", tier: "elite", attack: "octo",  // «Окто-разряд»
      hp: 42, dmg: [1, 4], exp: 4, speed: 7, range: 8, special: null, desc: "" },
    { key: "spiderboss", name: "Босс-паук", tier: "boss", attack: "poison", // «Плевок босса»
      hp: 300, dmg: [8, 14], exp: 10, speed: 9, range: 7, special: { poison: 6 },
      desc: "Атаки оставляют ядовитые лужи и коконы с пауками." },
    // ── 2-й этаж образца (данжи будущего) ─────────────────────────────────
    { key: "mummy", name: "Мумия", tier: "elite", attack: "twoHandedSword", // «Взмах»
      hp: 20, dmg: [2, 6], exp: 6, speed: 8, range: 6, special: { reanimate: 0.5 },
      desc: "Первый смертельный удар: через 3 секунды встаёт с половиной жизней." },
    { key: "spike", name: "Шип", tier: "common", attack: "rock",       // «Каменный удар»
      hp: 35, dmg: [7, 12], exp: 1, speed: 9, range: 6, special: { crush: 1 },
      desc: "Каменный удар раскалывается на осколки." },
    { key: "bat", name: "Нетопырь", tier: "common", attack: "dagger",  // «Точечный укол»
      hp: 45, dmg: [7, 12], exp: 1, speed: 6, range: 6, special: { dash: 4 },
      desc: "Враг делает рывок с уроном на 4 клетки." },
    { key: "dark", name: "Тёмный воин", tier: "elite", attack: "spear", // «Укол»
      hp: 80, dmg: [6, 12], exp: 6, speed: 8, range: 6, special: { shadow: 5 },
      desc: "Каждые 5 секунд уход в тень и всплывает около героя." },
    { key: "imp", name: "Имп", tier: "common", attack: "alebard",      // «Разрубание»
      hp: 50, dmg: [6, 9], exp: 1, speed: 8, range: 5, special: { flame: 2 },
      desc: "Атаки поджигают героя: каждый ваш удар обжигает героя на 2." },
    { key: "hound", name: "Хаунд", tier: "elite", attack: "swordHound", // «Разрез хаунда»
      hp: 55, dmg: [12, 14], exp: 4, speed: 10, range: 8, special: { howl: 6 },
      desc: "При смерти воет, увеличивая урон врагов на 6." },
    { key: "succubus", name: "Суккуб", tier: "elite", attack: "wand",  // «Миниразряд»
      hp: 70, dmg: [4, 9], exp: 4, speed: 6, range: 8, special: { charm: 1 },
      desc: "Раз в 5 секунд выпускает чарующий снаряд." },
    { key: "vampire", name: "Вампир", tier: "elite", attack: "bite",   // «Укус»
      hp: 120, dmg: [6, 12], exp: 6, speed: 9, range: 8, special: { vampirism: 10 },
      desc: "Атакуя героя восстанавливает себе 10 жизней раз в 3с." },
    // ── 3-й этаж образца ──────────────────────────────────────────────────
    { key: "demon", name: "Демон", tier: "boss", attack: "boss3attack", // «Молния демона»
      hp: 500, dmg: [16, 20], exp: 10, speed: 10, range: 11, special: { summoning: 4 },
      desc: "Получая урон - призывает врагов раз в 4 секунды." },
    // ── 4-й этаж образца «Пустота» ────────────────────────────────────────
    { key: "cyclop", name: "Циклоп Пустоты", tier: "boss", attack: "void", // «Звезда пустоты»
      hp: 1000, dmg: [20, 26], exp: 10, speed: 11, range: 11,
      special: { voidBlob: 4, invulnerability: 16 },
      desc: "Раз в 4 секунды выпускает Сгусток пустоты: тот летит по спирали через всю комнату и наносит 6-18 урона при попадании." },
    { key: "medusa", name: "Медуза пустоты", tier: "boss", attack: "void", // «Звезда пустоты»
      hp: 1000, dmg: [14, 20], exp: 10, speed: 8, range: 14, special: { segmentation: 2 },
      desc: "Когда здоровье падает до половины, разделяется надвое: осколки вдвое меньше, и каждый получает её остаток здоровья как максимум. Осколки делятся ещё раз." },
];

globalThis.ENEMY_BESTIARY = ENEMY_BESTIARY;
