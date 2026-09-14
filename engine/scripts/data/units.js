// Массив данных по всем юнитам
const UNIT_CONFIGS = [{ 
    name: "Взрывающийся Воин", 
    maxHp: 100, 
    baseSpeed: 3, 
    textures: [], // Сюда мы запишем массив текстур кадров при старте
    animationSpeed: 0.2,
    animationTime: 0,
    radius: 5, // уполовнен радиус: в кадре помещается вдвое больше объектов
    color: "grey",
}]
const UNITS_EVENTS = {
    SPAWNED: 'unit:spawned',
    DIED: 'unit:died',
    DAMAGED: 'unit:damaged',
    LEVEL_UP: 'unit:levelUp',
    HEALTH_CHANGED: 'unit:healthChanged'
};

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.UNIT_CONFIGS = UNIT_CONFIGS;
globalThis.UNITS_EVENTS = UNITS_EVENTS;
