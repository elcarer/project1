// КАМЕРА — управление видом мира через контейнер worldContainer.
// Двигает/масштабирует только его, поэтому HUD и отладка (лежащие в app.stage)
// остаются на месте. Умеет: следование за целью с плавностью, зум, тряска,
// границы мира, перевод координат экран↔мир.
//
// Пример:
//   const camera = createCamera({ app, container: engine.worldContainer, addSystem });
//   camera.follow(playerSprite);        // плавно следовать
//   camera.shake(10, 0.4);              // тряска при взрыве
//   camera.zoomBy(1.25);                // приблизить
import { clamp, damp } from "./math.js";

function createCamera({ app, container, addSystem }) {
    const cam = {
        x: 0, y: 0,          // центр взгляда в мировых координатах
        zoom: 1,
        target: null,        // объект с полями x/y (спрайт игрока и т.п.)
        followDamping: 6,    // плавность следования (больше = быстрее догоняет)
        bounds: null,        // {x, y, width, height} — не показывать за пределами мира
    };
    let shakeTime = 0;       // сколько трясти осталось (сек)
    let shakeDuration = 0;
    let shakePower = 0;      // амплитуда в пикселях мира

    function follow(target, damping = 6) {
        cam.target = target;
        if (damping !== undefined) cam.followDamping = damping;
    }
    function stopFollowing() { cam.target = null; }
    function centerOn(x, y) { cam.x = x; cam.y = y; }
    function setBounds(rect) { cam.bounds = rect; }
    function setZoom(zoom) { cam.zoom = clamp(zoom, 0.1, 8); }
    function zoomBy(factor) { setZoom(cam.zoom * factor); }
    function shake(power = 8, duration = 0.3) {
        shakePower = power;
        shakeDuration = duration;
        shakeTime = duration;
    }

    // Экран → мир (например, для прицеливания мышью)
    function screenToWorld(sx, sy) {
        return {
            x: cam.x + (sx - app.screen.width / 2) / cam.zoom,
            y: cam.y + (sy - app.screen.height / 2) / cam.zoom,
        };
    }

    // Регистрируется в игровом цикле движка через addSystem
    function update(ticker) {
        const dt = ticker.deltaMS / 1000;
        // 1. Плавное следование (кадронезависимый damp — скорость не зависит от FPS)
        if (cam.target) {
            cam.x = damp(cam.x, cam.target.x, cam.followDamping, dt);
            cam.y = damp(cam.y, cam.target.y, cam.followDamping, dt);
        }
        // 2. Не показывать за границами мира (если мир меньше экрана — центрируем)
        if (cam.bounds) {
            const halfW = app.screen.width / (2 * cam.zoom);
            const halfH = app.screen.height / (2 * cam.zoom);
            if (cam.bounds.width >= halfW * 2) {
                cam.x = clamp(cam.x, cam.bounds.x + halfW, cam.bounds.x + cam.bounds.width - halfW);
            } else {
                cam.x = cam.bounds.x + cam.bounds.width / 2;
            }
            if (cam.bounds.height >= halfH * 2) {
                cam.y = clamp(cam.y, cam.bounds.y + halfH, cam.bounds.y + cam.bounds.height - halfH);
            } else {
                cam.y = cam.bounds.y + cam.bounds.height / 2;
            }
        }
        // 3. Тряска: затухающие случайные смещения ТОЛЬКО позиции контейнера
        let ox = 0, oy = 0;
        if (shakeTime > 0) {
            shakeTime -= dt;
            const falloff = Math.max(shakeTime, 0) / shakeDuration;
            ox = (Math.random() * 2 - 1) * shakePower * falloff;
            oy = (Math.random() * 2 - 1) * shakePower * falloff;
        }
        // 4. Применяем трансформацию: центр экрана смотрит в точку (cam.x, cam.y)
        container.scale.set(cam.zoom);
        container.pivot.set(cam.x, cam.y);
        container.position.set(app.screen.width / 2 + ox, app.screen.height / 2 + oy);
    }
    if (addSystem) addSystem(update);

    return { cam, follow, stopFollowing, centerOn, setBounds, setZoom, zoomBy, shake, screenToWorld, update };
}

export { createCamera };
