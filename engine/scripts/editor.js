// ПИКСЕЛЬНЫЙ РЕДАКТОР ПЕРСОНАЖЕЙ И АНИМАЦИЙ (engine/editor.html)
// Модель спрайтшита: СТРОКА = именованная анимация (wait, death, ...),
// КОЛОНКА = кадр. Экспорт: сетка PNG + JSON-манифест (имена/порядок строк,
// число кадров) через POST /save на локальный сервер → images/sprites/.
// Загрузка в игре: assets.loadSpritesheet(url, 64, 64) нарезает построчно;
// кадры анимации i = текстуры.slice(i * columns, i * columns + frames).
//
// Автоматизация (консоль/агент): window.__EDITOR
//   E.px/rect/mirror/get/clear            — рисование текущего кадра
//   E.newFrame/deleteFrame/setFrame/frameCount — кадры текущей строки
//   E.addRow(name) E.setRow(name) E.rows()     — строки-анимации
//   E.saveSpec({size, palette, animations})     — кадры строками символов
//   await E.export("mage_64.png")               → mage_64.png + mage_64.json
const SIZE = 64;        // размер спрайта в пикселях
const ZOOM = 8;         // масштаб сетки на экране
const GRID_PX = SIZE * ZOOM;

const canvas = document.getElementById("board");
canvas.width = GRID_PX;
canvas.height = GRID_PX;
const ctx = canvas.getContext("2d");

const emptyFrame = () => new Array(SIZE * SIZE).fill(null);

// ===== СОСТОЯНИЕ: лист анимаций =====
let sheet = { rows: [{ name: "wait", frames: [emptyFrame()] }] };
let rowIndex = 0;             // текущая строка-анимация
let current = 0;              // текущий кадр внутри строки
let color = "#9aa7b5";
let tool = "pixel";           // pixel | fill | eraser | pick
let playing = false;
let playTimer = null;

const curRow = () => sheet.rows[rowIndex];
const curFrames = () => curRow().frames;

// ===== ОТРИСОВКА ДОСКИ =====
function render() {
    ctx.fillStyle = "#15171b";
    ctx.fillRect(0, 0, GRID_PX, GRID_PX);
    const frame = curFrames()[current] || curFrames()[0];
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const c = frame[y * SIZE + x];
            if (c) {
                ctx.fillStyle = c;
                ctx.fillRect(x * ZOOM, y * ZOOM, ZOOM, ZOOM);
            }
        }
    }
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
    curFrames()[current][y * SIZE + x] = c;
}

function getPixel(x, y) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return curFrames()[current][y * SIZE + x];
}

function lineTo(x0, y0, x1, y1, c) {
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
let lastPixel = null;
canvas.addEventListener("pointerdown", (event) => {
    const { x, y } = canvasPos(event);
    if (tool === "pick") { pickColor(x, y); return; }
    painting = true;
    lastPixel = { x, y };
    if (tool === "fill") floodFill(x, y, color);
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
    "#6b3fa0", "#4a2b73", "#7fe8ff", "#e5e7eb",
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

// ===== СТРОКИ-АНИМАЦИИ =====
const rowsEl = document.getElementById("rows");

function renderRowsStrip() {
    rowsEl.innerHTML = "";
    sheet.rows.forEach((row, i) => {
        const btn = document.createElement("button");
        btn.className = "rowtab" + (i === rowIndex ? " active" : "");
        btn.textContent = `${row.name} (${row.frames.length})`;
        btn.onclick = () => { rowIndex = i; current = 0; render(); };
        rowsEl.appendChild(btn);
    });
}

function addRow(name) {
    sheet.rows.push({ name, frames: [emptyFrame()] });
    rowIndex = sheet.rows.length - 1;
    current = 0;
    render();
    return rowIndex;
}

document.getElementById("addRow").onclick = () => {
    const input = document.getElementById("rowName");
    const name = input.value.trim() || `anim${sheet.rows.length + 1}`;
    addRow(name);
    input.value = "";
};

// ===== КАДРЫ ТЕКУЩЕЙ СТРОКИ =====
const framesEl = document.getElementById("frames");

function renderFramesStrip() {
    framesEl.innerHTML = "";
    curFrames().forEach((frame, i) => {
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
    renderRowsStrip();
}

function newFrame(copyCurrent = true) {
    const data = copyCurrent ? [...curFrames()[current]] : emptyFrame();
    curFrames().splice(current + 1, 0, data);
    current++;
    render();
}
function deleteFrame() {
    if (curFrames().length === 1) { curFrames()[0] = emptyFrame(); render(); return; }
    curFrames().splice(current, 1);
    current = Math.max(0, current - 1);
    render();
}

document.getElementById("addFrame").onclick = () => newFrame(true);
document.getElementById("emptyFrame").onclick = () => newFrame(false);
document.getElementById("delFrame").onclick = deleteFrame;
document.getElementById("clearFrame").onclick = () => {
    curFrames()[current] = emptyFrame();
    render();
};

// ===== ПРОИГРЫВАНИЕ ТЕКУЩЕЙ СТРОКИ =====
const playBtn = document.getElementById("play");
playBtn.onclick = () => {
    playing = !playing;
    playBtn.classList.toggle("active", playing);
    if (playing) {
        let idx = 0;
        playTimer = setInterval(() => {
            idx = (idx + 1) % curFrames().length;
            current = idx;
            render();
        }, 150);
    } else {
        clearInterval(playTimer);
    }
};

// ===== ЭКСПОРТ: СЕТКА (строки=анимации, колонки=кадры) + JSON-манифест =====
document.getElementById("export").onclick = () => {
    const name = document.getElementById("name").value.trim() || "sprite.png";
    __EDITOR.export(name).then(r => {
        document.getElementById("status").textContent = r.ok
            ? `Сохранено: ${r.files.join(", ")} (${r.columns} колонок × ${r.rows} строк)`
            : `Ошибка: ${r.error}`;
    });
};

async function saveFile(name, dataURL) {
    const response = await fetch("/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data: dataURL }),
    });
    return response.json();
}

async function exportSheet(name) {
    // Выравниваем строки по максимальному числу колонок: недостающие кадры
    // заполняются повтором последнего (анимация зацикливается без дыр)
    const columns = Math.max(...sheet.rows.map(r => r.frames.length));
    const sheetCanvas = document.createElement("canvas");
    sheetCanvas.width = SIZE * columns;
    sheetCanvas.height = SIZE * sheet.rows.length;
    const sctx = sheetCanvas.getContext("2d");

    const drawFrame = (frame, col, row) => {
        const img = sctx.createImageData(SIZE, SIZE);
        for (let p = 0; p < frame.length; p++) {
            const c = frame[p];
            if (!c) continue;
            img.data[p * 4] = parseInt(c.slice(1, 3), 16);
            img.data[p * 4 + 1] = parseInt(c.slice(3, 5), 16);
            img.data[p * 4 + 2] = parseInt(c.slice(5, 7), 16);
            img.data[p * 4 + 3] = 255;
        }
        sctx.putImageData(img, col * SIZE, row * SIZE);
    };

    sheet.rows.forEach((row, r) => {
        row.frames.forEach((frame, c) => drawFrame(frame, c, r));
        for (let c = row.frames.length; c < columns; c++) {
            drawFrame(row.frames[row.frames.length - 1], c, r);
        }
    });

    const pngResult = await saveFile(name, sheetCanvas.toDataURL("image/png"));
    if (!pngResult.saved) return { ok: false, error: pngResult.error || "save failed" };

    const base = name.replace(/\.png$/, "");
    const manifest = {
        size: SIZE,
        columns,
        animations: sheet.rows.map((row, i) => ({ name: row.name, row: i, frames: row.frames.length })),
    };
    await saveFile(`${base}.json`, "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 2)))));

    return { ok: true, saved: pngResult.saved, files: [name, `${base}.json`], columns, rows: sheet.rows.length };
}

// ===== API ДЛЯ АВТОМАТИЗАЦИИ (агент/консоль) =====
const __EDITOR = {
    px: (x, y, c) => { setPixel(x, y, c); render(); return true; },
    get: (x, y) => getPixel(x, y),
    rect: (x, y, w, h, c) => {
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) setPixel(x + dx, y + dy, c);
        render(); return true;
    },
    mirror: () => {
        const f = curFrames()[current];
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE / 2; x++) {
            f[y * SIZE + (SIZE - 1 - x)] = f[y * SIZE + x];
        }
        render(); return true;
    },
    // ---- строки-анимации ----
    addRow: (name) => addRow(name || `anim${sheet.rows.length + 1}`),
    setRow: (ref) => {
        const i = typeof ref === "number" ? ref : sheet.rows.findIndex(r => r.name === ref);
        if (i < 0 || i >= sheet.rows.length) return false;
        rowIndex = i; current = 0;
        render(); return true;
    },
    rows: () => sheet.rows.map(r => ({ name: r.name, frames: r.frames.length })),
    currentRow: () => curRow().name,
    // ---- кадры текущей строки ----
    newFrame: () => { newFrame(true); return curFrames().length; },
    deleteFrame: (i = current) => {
        const frames = curFrames();
        if (i < 0 || i >= frames.length || frames.length === 1) return frames.length;
        frames.splice(i, 1);
        current = Math.max(0, Math.min(current, frames.length - 1));
        render();
        return frames.length;
    },
    setFrame: (i) => { current = Math.max(0, Math.min(i, curFrames().length - 1)); render(); return current; },
    frameCount: () => curFrames().length,
    clear: () => { curFrames()[current] = emptyFrame(); render(); return true; },
    // ---- экспорт ----
    export: (name) => exportSheet(name),
    // Кадры строками: символ → цвет палитры, '.' или ' ' → прозрачный.
    // spec.animations = { wait: [строки кадра...], death: [...] } — добавляет строки.
    saveSpec: (spec) => {
        const parse = (rows) => rows.flatMap((row) => [...row].map((ch) => {
            if (ch === "." || ch === " ") return null;
            return spec.palette[ch] ?? null;
        }));
        if (spec.animations) {
            for (const [name, rows] of Object.entries(spec.animations)) {
                const existing = sheet.rows.findIndex(r => r.name === name);
                const frames = [];
                for (let i = 0; i < rows.length; i += spec.size) {
                    frames.push(parse(rows.slice(i, i + spec.size)));
                }
                if (existing >= 0) sheet.rows[existing].frames = frames;
                else sheet.rows.push({ name, frames });
            }
            rowIndex = 0;
        } else {
            sheet.rows[0].frames = [parse(spec.frames)];
            rowIndex = 0; current = 0;
        }
        render();
        return sheet.rows.map(r => ({ name: r.name, frames: r.frames.length }));
    },
};
window.__EDITOR = __EDITOR;

buildPalette();
render();
