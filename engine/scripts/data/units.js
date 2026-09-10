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
export {UNIT_CONFIGS, UNITS_EVENTS}