// ДЖЕНЕРИК-ПУЛ ОБЪЕКТОВ — одна реализация переиспользования для любых сущностей:
// частиц FX, всплывающих цифр урона, пуль игровой логики.
// Специализированные пулы спрайтов движка (STATIC/ANIMATED_SPRITE_POOLS) остаются
// как есть намеренно: у них разная логика сброса Sprite и AnimatedSprite.
//
// Пример:
//   const pool = createPool(() => new PIXI.Sprite(tex),
//                           (sprite) => { sprite.visible = false; });
//   const p = pool.acquire(); // объект с полями из фабрики (factory вызывается только при пустом пуле)
//   pool.release(p);          // вернётся в пул, следующий acquire() переиспользует его
function createPool(factory, onRelease = null) {
    const free = [];
    let createdTotal = 0;   // сколько объектов создано за всё время (для отладки утечек)
    let activeCount = 0;    // сколько сейчас на руках

    function acquire(...args) {
        let obj = free.pop();
        if (!obj) {
            obj = factory();
            createdTotal++;
        }
        activeCount++;
        return obj;
    }

    function release(obj) {
        if (onRelease) onRelease(obj);
        free.push(obj);
        activeCount--;
    }

    // Отдать сразу пачку (полезно при очистке эффекта из множества частиц)
    function releaseAll(objects) {
        for (let i = 0; i < objects.length; i++) release(objects[i]);
    }

    function clear() {
        free.length = 0;
    }

    return {
        acquire,
        release,
        releaseAll,
        clear,
        get freeCount() { return free.length; },
        get activeCount() { return activeCount; },
        get createdTotal() { return createdTotal; },
    };
}

export { createPool };
