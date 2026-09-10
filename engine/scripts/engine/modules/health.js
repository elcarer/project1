// ЗДОРОВЬЕ И УРОН — опциональный модуль поверх ядра.
// Регистрирует компоненты hp/maxHp через ECS.registerComponent (ядро при этом
// не меняется) и предоставляет API урона/лечения. Смерть — событие на шине:
// эффекты, звук и счёт подписываются сами, модуль про них ничего не знает.
//
// Пример:
//   const health = createHealth();
//   const id = engine.spawnUnit(0, 100, 100);
//   health.attach(id, 50);                 // выдать 50 HP
//   health.damage(id, 20);                 // → события unit:damaged
//   health.damage(id, 100);                // → событие unit:died, сущность удалена
import { ECS, world, COMPONENTS, events } from "../engine.js";
import { UNITS_EVENTS } from "../../data/units.js";

// Компоненты регистрируются один раз при первом создании модуля
const HP_MASK = ECS.registerComponent("hp", Float32Array);
const MAX_HP_MASK = ECS.registerComponent("maxHp", Float32Array);

function createHealth() {
    // Выдать сущности здоровье (вызывать после спавна)
    function attach(id, maxHp) {
        ECS.addComponent(world, id, "hp", maxHp);
        ECS.addComponent(world, id, "maxHp", maxHp);
        return id;
    }
    // Есть ли у сущности здоровье вообще
    function has(id) {
        return world.active[id] === 1 && (world.masks[id] & HP_MASK) !== 0;
    }
    // Текущий HP
    function get(id) {
        return has(id) ? COMPONENTS.hp[id] : 0;
    }
    // Доля HP 0..1 — для полосок HUD
    function ratio(id) {
        if (!has(id)) return 0;
        const max = COMPONENTS.maxHp[id];
        return max > 0 ? COMPONENTS.hp[id] / max : 0;
    }
    // Нанести урон. Возвращает оставшееся HP (0, если сущность умерла или без HP)
    function damage(id, amount) {
        if (!has(id) || amount <= 0) return 0;
        const hp = Math.max(0, COMPONENTS.hp[id] - amount);
        COMPONENTS.hp[id] = hp;
        events.emit(UNITS_EVENTS.DAMAGED, { id, amount, hp });
        if (hp <= 0) kill(id);
        return hp;
    }
    // Лечить (не выше максимума)
    function heal(id, amount) {
        if (!has(id)) return 0;
        const hp = Math.min(COMPONENTS.maxHp[id], COMPONENTS.hp[id] + amount);
        COMPONENTS.hp[id] = hp;
        return hp;
    }
    // Убить: сначала событие (слушатели ещё могут читать позицию и т.п.),
    // затем удаление сущности — removeComponent сам вернёт спрайт в пул
    function kill(id) {
        if (!world.active[id]) return;
        events.emit(UNITS_EVENTS.DIED, { id, configId: COMPONENTS.configId[id] });
        ECS.removeEntity(world, id);
    }

    return { attach, has, get, ratio, damage, heal, kill };
}

export { createHealth };
