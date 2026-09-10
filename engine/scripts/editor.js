// ПИКСЕЛЬНЫЙ РЕДАКТОР ПЕРСОНАЖЕЙ И АНИМАЦИЙ (engine/editor.html)
// Рисование по сетке (мышь), кадры анимации с превью, экспорт спрайтшита
// PNG через POST /save на локальный сервер → images/sprites/<имя>.png
// Спрайтшит грузится движком напрямую: assets.loadSpritesheet(url, 64, 64).
//
// Автоматизация (из консоли или агентом): window.__EDITOR — пиксельный API:
//   E.px(x,y,'#ff0000')  E.rect(x,y,w,h,c)  E.mirror()  E.newFrame()
//   E.setFrame(i)  E.frameCount()  E.clear()  E.export('name.png')
//   E.saveSpec({size, palette, frames}) — кадры строками символов палитры
const SIZE = 64;        // размер спрайта в пикселях
const ZOOM = 8;         // масштаб сетки на экране
const GRID_PX = SIZE * ZOOM;

const canvas = document.getElementById("board");
canvas.width = GRID_PX;
canvas.height = GRID_PX;
const ctx = canvas.getContext("2d");

// ===== СОСТОЯНИЕ =====
let frames = [new Array(SIZE * SIZE).fill(null)]; // цвет-строка или null (прозрачный)
let current = 0;              // индекс текущего кадра
let color = "#9aa7b5";        // активный цвет
let tool = "pixel";           // pixel | fill | eraser | pick
let playing = false;
let playTimer = null;
let playIndex = 0;
let lastPixel = null;         // для непрерывной линии при зажатой мыши

// ===== ОТРИСОВКА ДОСКИ =====
function render() {
    ctx.fillStyle = "#15171b";
    ctx.fillRect(0, 0, GRID_PX, GRID_PX);
    const frame = frames[current];
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const c = frame[y * SIZE + x];
            if (c) {
                ctx.fillStyle = c;
                ctx.fillRect(x * ZOOM, y * ZOOM, ZOOM, ZOOM);
            }
        }
    }
    // сетка: тонкая каждые 8px, жирнее каждые 16px
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let i = 8; i < SIZE; i += 8) {
        if (i % 16 === 0) continue;
        line(i * ZOOM, 0, i * ZOOM, GRID_PX);
        line(0, i * ZOOM, GRID_PX, i * ZOOM);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    for (let i = 16; i < SIZE; i += 16) {
        line(i * ZOOM, 0, i * ZOOM, GRID_PX);
        line(0, i * ZOOM, GRID_PX, i * ZOOM);
    }
    renderFramesStrip();
}

function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1 + 0.5, y1 + 0.5);
    ctx.lineTo(x2 + 0.5, y2 + 0.5);
    ctx.stroke();
}

// ===== РИСОВАНИЕ =====
function setPixel(x, y, c) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    frames[current][y * SIZE + x] = c;
}

function getPixel(x, y) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return frames[current][y * SIZE + x];
}

function lineTo(x0, y0, x1, y1, c) {
    // Алгоритм Брезенхэма — непрерывная линия при протаскивании мыши
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
        setPixel(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}

function floodFill(x, y, c) {
    const target = getPixel(x, y);
    if (target === c) return;
    const stack = [[x, y]];
    while (stack.length) {
        const [cx, cy] = stack.pop();
        if (getPixel(cx, cy) !== target) continue;
        setPixel(cx, cy, c);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
}

function canvasPos(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.floor((event.clientX - rect.left) / ZOOM),
        y: Math.floor((event.clientY - rect.top) / ZOOM),
    };
}

let painting = false;
canvas.addEventListener("pointerdown", (event) => {
    const { x, y } = canvasPos(event);
    if (tool === "pick") { pickColor(x, y); return; }
    painting = true;
    lastPixel = { x, y };
    if (tool === "fill") { floodFill(x, y, tool === "eraser" ? null : color); }
    else setPixel(x, y, event.button === 2 ? null : color);
    render();
});
canvas.addEventListener("pointermove", (event) => {
    if (!painting) return;
    const { x, y } = canvasPos(event);
    if (tool === "pixel" || tool === "eraser") {
        const c = tool === "eraser" ? null : color;
        lineTo(lastPixel.x, lastPixel.y, x, y, c);
        lastPixel = { x, y };
    }
    render();
});
window.addEventListener("pointerup", () => { painting = false; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function pickColor(x, y) {
    const c = getPixel(x, y);
    if (c) { color = c; colorInput.value = c; syncSwatches(); }
}

// ===== ПАЛИТРА И ИНСТРУМЕНТЫ =====
const DEFAULT_PALETTE = [
    "#9aa7b5", "#5c6672", "#cfd8e3", "#1a1d21",
    "#d8b23a", "#c0392b", "#7a1f1a", "#3d6bb3",
    "#2e5329", "#8a5a2b", "#e8c39e", "#ffffff",
];
const paletteEl = document.getElementById("palette");
const colorInput = document.getElementById("colorInput");

function buildPalette() {
    paletteEl.innerHTML = "";
    for (const c of DEFAULT_PALETTE) {
        const swatch = document.createElement("button");
        swatch.className = "swatch";
        swatch.style.background = c;
        swatch.title = c;
        swatch.onclick = () => { color = c; colorInput.value = c; syncSwatches(); };
        paletteEl.appendChild(swatch);
    }
    syncSwatches();
}
function syncSwatches() {
    [...paletteEl.children].forEach((swatch, i) => {
        swatch.classList.toggle("active", DEFAULT_PALETTE[i] === color);
    });
}
colorInput.addEventListener("input", () => { color = colorInput.value; syncSwatches(); });

for (const btn of document.querySelectorAll("[data-tool]")) {
    btn.onclick = () => {
        tool = btn.dataset.tool;
        document.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b === btn));
    };
}

// ===== КАДРЫ =====
const framesEl = document.getElementById("frames");

function renderFramesStrip() {
    framesEl.innerHTML = "";
    frames.forEach((frame, i) => {
        const thumb = document.createElement("canvas");
        thumb.width = SIZE; thumb.height = SIZE;
        thumb.className = "thumb" + (i === current ? " active" : "");
        const tctx = thumb.getContext("2d");
        tctx.fillStyle = "#15171b";
        tctx.fillRect(0, 0, SIZE, SIZE);
        for (let p = 0; p < frame.length; p++) {
            if (!frame[p]) continue;
            tctx.fillStyle = frame[p];
            tctx.fillRect(p % SIZE, Math.floor(p / SIZE), 1, 1);
        }
        thumb.onclick = () => { current = i; render(); };
        framesEl.appendChild(thumb);
    });
}

function newFrame(copyCurrent = true) {
    const data = copyCurrent ? [...frames[current]] : new Array(SIZE * SIZE).fill(null);
    frames.splice(current + 1, 0, data);
    current++;
    render();
}
function deleteFrame() {
    if (frames.length === 1) { frames[0] = new Array(SIZE * SIZE).fill(null); render(); return; }
    frames.splice(current, 1);
    current = Math.max(0, current - 1);
    render();
}

document.getElementById("addFrame").onclick = () => newFrame(true);
document.getElementById("emptyFrame").onclick = () => newFrame(false);
document.getElementById("delFrame").onclick = deleteFrame;
document.getElementById("clearFrame").onclick = () => {
    frames[current] = new Array(SIZE * SIZE).fill(null);
    render();
};

// ===== ПРОИГРЫВАНИЕ АНИМАЦИИ =====
const playBtn = document.getElementById("play");
playBtn.onclick = () => {
    playing = !playing;
    playBtn.classList.toggle("active", playing);
    if (playing) {
        playTimer = setInterval(() => {
            playIndex = (playIndex + 1) % frames.length;
            current = playIndex;
            render();
        }, 150);
    } else {
        clearInterval(playTimer);
    }
};

// ===== ЭКСПОРТ СПРАЙТШИТА =====
document.getElementById("export").onclick = () => {
    const name = document.getElementById("name").value.trim() || "sprite.png";
    __EDITOR.export(name).then(r => {
        document.getElementById("status").textContent = r.ok
            ? `Сохранено: ${r.saved} (${r.bytes} байт)`
            : `Ошибка: ${r.error}`;
    });
};

async function exportSpritesheet(name) {
    const sheet = document.createElement("canvas");
    sheet.width = SIZE * frames.length;
    sheet.height = SIZE;
    const sctx = sheet.getContext("2d");
    frames.forEach((frame, i) => {
        const img = sctx.createImageData(SIZE, SIZE);
        for (let p = 0; p < frame.length; p++) {
            const c = frame[p];
            if (!c) continue;
            const r = parseInt(c.slice(1, 3), 16);
            const g = parseInt(c.slice(3, 5), 16);
            const b = parseInt(c.slice(5, 7), 16);
            img.data[p * 4] = r;
            img.data[p * 4 + 1] = g;
            img.data[p * 4 + 2] = b;
            img.data[p * 4 + 3] = 255;
        }
        sctx.putImageData(img, i * SIZE, 0);
    });
    const data = sheet.toDataURL("image/png");
    const response = await fetch("/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data }),
    });
    return response.json();
}

// ===== API ДЛЯ АВТОМАТИЗАЦИИ (агент/консоль) =====
const __EDITOR = {
    px: (x, y, c) => { setPixel(x, y, c); render(); return true; },
    get: (x, y) => getPixel(x, y),
    rect: (x, y, w, h, c) => {
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) setPixel(x + dx, y + dy, c);
        render(); return true;
    },
    // Зеркалирует левую половину (x < SIZE/2) в правую
    mirror: () => {
        const f = frames[current];
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE / 2; x++) {
            f[y * SIZE + (SIZE - 1 - x)] = f[y * SIZE + x];
        }
        render(); return true;
    },
    newFrame: () => { newFrame(true); return frames.length; },
    deleteFrame: (i = current) => {
        if (i < 0 || i >= frames.length || frames.length === 1) return frames.length;
        frames.splice(i, 1);
        current = Math.max(0, Math.min(current, frames.length - 1));
        render();
        return frames.length;
    },
    setFrame: (i) => { current = Math.max(0, Math.min(i, frames.length - 1)); render(); return current; },
    frameCount: () => frames.length,
    clear: () => { frames[current] = new Array(SIZE * SIZE).fill(null); render(); return true; },
    export: (name) => exportSpritesheet(name),
    // Кадры строками: символ → цвет палитры, '.' или ' ' → прозрачный
    saveSpec: (spec) => {
        frames = spec.frames.map((rows) => rows.flatMap((row) => [...row].map((ch) => {
            if (ch === "." || ch === " ") return null;
            return spec.palette[ch] ?? null;
        })));
        current = 0;
        render();
        return frames.length;
    },
    exportAllSpec: (name) => exportSpritesheet(name),
};
window.__EDITOR = __EDITOR;

buildPalette();
render();
