// МАТЕМАТИКА — чистые функции без зависимостей.
// Всё, что раньше размазывалось по системам магическими числами, собираем здесь.
const TAU = Math.PI * 2;

// Ограничить значение диапазоном [min, max]
function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
}

// Линейная интерполяция (плавное приближение a к b на долю t)
function lerp(a, b, t) {
    return a + (b - a) * t;
}

// Кадронезависимый lerp: приближение, стабильное при любом FPS.
// damping — коэффициент «вязкости» (0.1 — быстрое следование, 0.001 — медленное)
function damp(current, target, damping, deltaSeconds) {
    return lerp(current, target, 1 - Math.exp(-damping * deltaSeconds));
}

// Случайное число в диапазоне [min, max)
function rand(min = 0, max = 1) {
    return min + Math.random() * (max - min);
}

// Случайное целое в диапазоне [min, max] включительно
function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
}

// Случайный угол (0..TAU) — часто нужен для разлёта частиц и спавна
function randAngle() {
    return Math.random() * TAU;
}

// Квадрат расстояния между точками — без Math.sqrt, для быстрых проверок
function distSq(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
}

// Расстояние между точками
function dist(x1, y1, x2, y2) {
    return Math.sqrt(distSq(x1, y1, x2, y2));
}

// Угол из точки 1 в точку 2
function angleTo(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.TAU = TAU;
globalThis.clamp = clamp;
globalThis.lerp = lerp;
globalThis.damp = damp;
globalThis.rand = rand;
globalThis.randInt = randInt;
globalThis.randAngle = randAngle;
globalThis.distSq = distSq;
globalThis.dist = dist;
globalThis.angleTo = angleTo;
