// ПИКСЕЛЬНЫЙ РЕДАКТОР ПЕРСОНАЖЕЙ И АНИМАЦИЙ (engine/editor.html)
// Модель спрайтшита: СТРОКА = именованная анимация (wait, death, ...),
// КОЛОНКА = кадр. Экспорт/открытие: сетка PNG + JSON-манифест через
// сервер разработки → images/sprites/. Размер холста меняется (8..256),
// содержимое переносится с центровкой.
//
// Автоматизация (консоль/агент): window.__EDITOR
//   E.px/rect/mirror/get/clear                 — рисование текущего кадра
//   E.newFrame/deleteFrame/setFrame/frameCount — кадры текущей строки
//   E.addRow(name) E.setRow(name) E.rows()     — строки-анимации
//   E.resize(px) E.size()                      — размер холста
//   await E.open("mage_64.png")                — открыть PNG+манифест
//   await E.export("mage_64.png")              — сохранить сетку + манифест
//   E.shiftFrame() E.copySel() E.pasteSel() E.clearSel() — кадр/выделение
// Лассо: обводка мышью задаёт контур, рисование действует только внутри
// него; клик без обводки снимает выделение; Ctrl+C / Ctrl+V / Del —
// копировать / вставить / стереть фрагмент.
const SIZE = 64; // переопределяется ниже через let — это поле документа
let size = 64;
let zoom = 8;

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const emptyFrame = () => new Array(size * size).fill(null);

// Приводит холст и масштаб к текущему размеру документа
function applyBoardSize() {
    zoom = Math.max(1, Math.min(16, Math.round(512 / size)));
    canvas.width = size * zoom;
    canvas.height = size * zoom;
}

applyBoardSize();

// ===== СОСТОЯНИЕ: ЛИСТ АНИМАЦИЙ =====
let sheet = { rows: [{ name: "wait", frames: [emptyFrame()] }] };
let rowIndex = 0;             // текущая строка-анимация
let current = 0;              // текущий кадр внутри строки
let color = "#9aa7b5";
let bgColor = "#15171b";      // фон, на котором проигрывается анимация (только превью)
let tool = "pixel";           // pixel | fill | eraser | pick
let playing = false;
let playTimer = null;
let fps = 8;                  // скорость проигрывания анимации → пишется в манифест
let selection = null;         // выделение «лассо»: { mask: Uint8Array(size*size) }
let lassoPts = null;          // контур, который обводят мышью прямо сейчас
let clipboard = null;         // буфер обмена: { size, data, mask } фрагмент кадра

const curRow = () => sheet.rows[rowIndex];
const curFrames = () => curRow().frames;

// ===== ОТРИСОВКА ДОСКИ =====
function render() {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const frame = curFrames()[current] || curFrames()[0];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const c = frame[y * size + x];
            if (c) {
                ctx.fillStyle = c;
                ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
            }
        }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let i = 8; i < size; i += 8) {
        if (i % 16 === 0) continue;
        line(i * zoom, 0, i * zoom, canvas.height);
        line(0, i * zoom, canvas.width, i * zoom);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    for (let i = 16; i < size; i += 16) {
        line(i * zoom, 0, i * zoom, canvas.height);
        line(0, i * zoom, canvas.width, i * zoom);
    }
    if (selection) drawSelection();
    if (lassoPts) drawLasso();
    renderFramesStrip();
    scheduleSheetPreview();
}

function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1 + 0.5, y1 + 0.5);
    ctx.lineTo(x2 + 0.5, y2 + 0.5);
    ctx.stroke();
}

// ===== РИСОВАНИЕ =====
function setPixel(x, y, c) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    curFrames()[current][y * size + x] = c;
}

function getPixel(x, y) {
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    return curFrames()[current][y * size + x];
}

function lineTo(x0, y0, x1, y1, c) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
        setPixelUI(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}

function floodFill(x, y, c) {
    if (!inSelection(x, y)) return;
    const target = getPixel(x, y);
    if (target === c) return;
    const stack = [[x, y]];
    while (stack.length) {
        const [cx, cy] = stack.pop();
        if (!inSelection(cx, cy)) continue;
        if (getPixel(cx, cy) !== target) continue;
        setPixel(cx, cy, c);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
}

function canvasPos(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.floor((event.clientX - rect.left) / zoom),
        y: Math.floor((event.clientY - rect.top) / zoom),
    };
}

let painting = false;
let lastPixel = null;
// Батч-режим: подавляет перерисовку доски на каждый примитив (рисование
// больших спрайтов кодом в разы быстрее); render() вызывается один раз в конце
let silentMode = false;
function maybeRender() { if (!silentMode) render(); }
canvas.addEventListener("pointerdown", (event) => {
    const { x, y } = canvasPos(event);
    if (tool === "pick") { pickColor(x, y); return; }
    if (tool === "lasso") {
        lassoPts = [[x, y]];
        try {
            canvas.setPointerCapture(event.pointerId); // контур можно вести за пределы доски
        } catch { /* синтетический указатель — не критично */ }
        return;
    }
    painting = true;
    lastPixel = { x, y };
    if (tool === "fill") floodFill(x, y, color);
    else setPixelUI(x, y, event.button === 2 ? null : color);
    render();
});
canvas.addEventListener("pointermove", (event) => {
    if (lassoPts) {
        const { x, y } = canvasPos(event);
        const cx = Math.max(0, Math.min(size - 1, x));
        const cy = Math.max(0, Math.min(size - 1, y));
        const last = lassoPts[lassoPts.length - 1];
        if (cx !== last[0] || cy !== last[1]) { lassoPts.push([cx, cy]); render(); }
        return;
    }
    if (!painting) return;
    const { x, y } = canvasPos(event);
    if (tool === "pixel" || tool === "eraser") {
        const c = tool === "eraser" ? null : color;
        lineTo(lastPixel.x, lastPixel.y, x, y, c);
        lastPixel = { x, y };
    }
    render();
});
window.addEventListener("pointerup", () => {
    if (lassoPts) { finishLasso(); return; }
    painting = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function pickColor(x, y) {
    const c = getPixel(x, y);
    if (c) { color = c; colorInput.value = c; syncSwatches(); }
}

// ===== ЛАССО: ВЫДЕЛЕНИЕ КОНТУРОМ =====
function setStatus(text) {
    document.getElementById("status").textContent = text;
}

// Активно ли выделение в точке: без контура разрешено всё
function inSelection(x, y) {
    return !selection || selection.mask[y * size + x] === 1;
}

// Рисование мышью с учётом контура (кисть/ластик/заливка молчат снаружи).
// Программный API (E.px/E.rect) использует setPixel напрямую и контур не учитывает.
function setPixelUI(x, y, c) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    if (!inSelection(x, y)) return;
    curFrames()[current][y * size + x] = c;
}

function finishLasso() {
    const pts = lassoPts;
    lassoPts = null;
    if (!pts) return;
    if (pts.length === 1) { // клик без обводки — снять выделение
        selection = null;
        render();
        return;
    }
    const mask = polygonMask(pts);
    let count = 0;
    for (let i = 0; i < mask.length; i++) count += mask[i];
    if (!count) { render(); return; }
    selection = { mask };
    setStatus(`выделено пикселей: ${count} (Ctrl+C копия, Ctrl+V вставка, Del стереть)`);
    render();
}

// Чётно-нечётное заполнение полигона сканлайнами (сэмпл в центре пикселя)
function polygonMask(pts) {
    const mask = new Uint8Array(size * size);
    const n = pts.length;
    const ys = pts.map(p => p[1]);
    const y0 = Math.max(0, Math.min(...ys));
    const y1 = Math.min(size - 1, Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
        const xs = [];
        const mid = y + 0.5;
        for (let i = 0; i < n; i++) {
            const [xa, ya] = pts[i];
            const [xb, yb] = pts[(i + 1) % n];
            if (ya === yb) continue;
            if (mid >= Math.min(ya, yb) && mid < Math.max(ya, yb)) {
                xs.push(xa + (mid - ya) * (xb - xa) / (yb - ya));
            }
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const from = Math.max(0, Math.ceil(xs[k] - 0.5));
            const to = Math.min(size - 1, Math.floor(xs[k + 1] - 0.5));
            for (let x = from; x <= to; x++) mask[y * size + x] = 1;
        }
    }
    return mask;
}

function drawSelection() {
    const m = selection.mask;
    ctx.fillStyle = "rgba(13,14,17,0.45)";    // затемнение снаружи контура
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!m[y * size + x]) ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        }
    }
    ctx.fillStyle = "rgba(136,255,204,0.85)"; // рамка по границе контура
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            if (!m[i]) continue;
            const edge = x === 0 || x === size - 1 || y === 0 || y === size - 1
                || !m[i - 1] || !m[i + 1] || !m[i - size] || !m[i + size];
            if (edge) ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        }
    }
}

function drawLasso() {
    ctx.strokeStyle = "#88ffcc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    lassoPts.forEach(([x, y], i) => {
        const px = x * zoom + zoom / 2, py = y * zoom + zoom / 2;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.lineWidth = 1;
}

function copySelection() {
    if (!selection) return;
    const f = curFrames()[current];
    const data = new Array(f.length).fill(null);
    let count = 0;
    for (let i = 0; i < f.length; i++) {
        if (selection.mask[i] && f[i]) { data[i] = f[i]; count++; }
    }
    clipboard = { size, data, mask: selection.mask.slice() };
    setStatus(`скопировано пикселей: ${count}`);
}

function pasteClipboard() {
    if (!clipboard) return;
    if (clipboard.size !== size) {
        setStatus(`в буфере фрагмент ${clipboard.size}×${clipboard.size}, а холст ${size}×${size}`);
        return;
    }
    const f = curFrames()[current];
    let count = 0;
    for (let i = 0; i < clipboard.data.length; i++) {
        if (clipboard.mask[i] && clipboard.data[i]) { f[i] = clipboard.data[i]; count++; }
    }
    render();
    setStatus(`вставлено пикселей: ${count}`);
}

function deleteInSelection() {
    if (!selection) return;
    const f = curFrames()[current];
    for (let i = 0; i < f.length; i++) if (selection.mask[i]) f[i] = null;
    render();
    setStatus("пиксели внутри контура стёрты");
}

// Горячие клавиши выделения (по event.code — работает и на русской раскладке)
window.addEventListener("keydown", (event) => {
    const tag = (event.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (event.code === "Delete" && selection) { deleteInSelection(); event.preventDefault(); }
    else if (event.code === "Escape" && selection) { selection = null; render(); }
    else if (event.ctrlKey && event.code === "KeyC" && selection) { copySelection(); event.preventDefault(); }
    else if (event.ctrlKey && event.code === "KeyV" && clipboard) { pasteClipboard(); event.preventDefault(); }
});

// ===== РАЗМЕР ХОЛСТА =====
// Новые пиксели — прозрачные; старое изображение переносится с центровкой
function resize(newSize) {
    newSize = Math.max(8, Math.min(256, Math.round(newSize / 8) * 8));
    if (newSize === size) return size;
    const offset = Math.floor((newSize - size) / 2);
    for (const row of sheet.rows) {
        row.frames = row.frames.map((old) => {
            const f = new Array(newSize * newSize).fill(null);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const c = old[y * size + x];
                    if (!c) continue;
                    const nx = x + offset, ny = y + offset;
                    if (nx >= 0 && ny >= 0 && nx < newSize && ny < newSize) {
                        f[ny * newSize + nx] = c;
                    }
                }
            }
            return f;
        });
    }
    size = newSize;
    document.getElementById("sizeInput").value = size;
    applyBoardSize();
    selection = null; lassoPts = null; clipboard = null; // маски старого размера недействительны
    render();
    return size;
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
const bgInput = document.getElementById("bgInput");
bgInput.addEventListener("input", () => { bgColor = bgInput.value; render(); });

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
        thumb.width = size; thumb.height = size;
        thumb.className = "thumb" + (i === current ? " active" : "");
        const tctx = thumb.getContext("2d");
        tctx.fillStyle = bgColor;
        tctx.fillRect(0, 0, size, size);
        for (let p = 0; p < frame.length; p++) {
            if (!frame[p]) continue;
            tctx.fillStyle = frame[p];
            tctx.fillRect(p % size, Math.floor(p / size), 1, 1);
        }
        thumb.onclick = () => { current = i; render(); };
        framesEl.appendChild(thumb);
    });
    renderRowsStrip();
}

// ===== ПРЕДПРОСМОТР ПОЛНОГО СПРАЙТШИТА (внизу страницы) =====
// Вся сетка целиком: строка = анимация, колонка = кадр. Перестраивается с
// debounce (перерисовка на каждый пиксель при рисовании слишком дорога).
// Клик по ячейке → перейти к этой строке и кадру.
const previewEl = document.getElementById("sheetPreview");
const PV_CELL = 64, PV_HEAD = 16;
let pvTimer = null;
function scheduleSheetPreview() {
    if (pvTimer) return;
    pvTimer = setTimeout(() => { pvTimer = null; renderSheetPreview(); }, 150);
}
function renderSheetPreview() {
    const cols = Math.max(...sheet.rows.map(r => r.frames.length));
    previewEl.width = cols * PV_CELL;
    previewEl.height = sheet.rows.length * (PV_CELL + PV_HEAD);
    const p = previewEl.getContext("2d");
    p.imageSmoothingEnabled = false;
    p.fillStyle = "#101216";
    p.fillRect(0, 0, previewEl.width, previewEl.height);
    p.font = "11px monospace";
    const scratch = document.createElement("canvas");
    scratch.width = size; scratch.height = size;
    const sctx = scratch.getContext("2d");
    sheet.rows.forEach((row, ri) => {
        const y0 = ri * (PV_CELL + PV_HEAD);
        p.fillStyle = "#88ffcc";
        p.fillText(row.name, 3, y0 + 12);
        row.frames.forEach((frame, ci) => {
            sctx.fillStyle = bgColor;
            sctx.fillRect(0, 0, size, size);
            for (let q = 0; q < frame.length; q++) {
                if (!frame[q]) continue;
                sctx.fillStyle = frame[q];
                sctx.fillRect(q % size, Math.floor(q / size), 1, 1);
            }
            p.drawImage(scratch, 0, 0, size, size, ci * PV_CELL, y0 + PV_HEAD, PV_CELL, PV_CELL);
        });
    });
    p.strokeStyle = "rgba(255,255,255,0.10)";
    for (let c = 0; c <= cols; c++) { p.beginPath(); p.moveTo(c * PV_CELL + 0.5, 0); p.lineTo(c * PV_CELL + 0.5, previewEl.height); p.stroke(); }
    for (let r = 0; r <= sheet.rows.length; r++) { const y0 = r * (PV_CELL + PV_HEAD) + 0.5; p.beginPath(); p.moveTo(0, y0); p.lineTo(previewEl.width, y0); p.stroke(); }
    // подсветка текущей строки и кадра
    p.strokeStyle = "#88ffcc";
    p.strokeRect(current * PV_CELL + 0.5, rowIndex * (PV_CELL + PV_HEAD) + PV_HEAD + 0.5, PV_CELL - 1, PV_CELL - 1);
}
previewEl.addEventListener("click", (e) => {
    const rect = previewEl.getBoundingClientRect();
    const scale = previewEl.width / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;
    const ri = Math.floor(py / (PV_CELL + PV_HEAD));
    const ci = Math.floor(px / PV_CELL);
    if (ri < 0 || ri >= sheet.rows.length) return;
    const row = sheet.rows[ri];
    if (ci < 0 || ci >= row.frames.length) return;
    rowIndex = ri; current = ci;
    render();
});

function newFrame(copyCurrent = true) {    const data = copyCurrent ? [...curFrames()[current]] : emptyFrame();
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

// «Подвинуть»: обменять текущий кадр со следующим (по кругу); выделение
// следует за кадром, поэтому повторные нажатия двигают его дальше по ряду
function shiftFrame() {
    const frames = curFrames();
    if (frames.length < 2) return current;
    const next = (current + 1) % frames.length;
    [frames[current], frames[next]] = [frames[next], frames[current]];
    current = next;
    render();
    return current;
}

document.getElementById("addFrame").onclick = () => newFrame(true);
document.getElementById("emptyFrame").onclick = () => newFrame(false);
document.getElementById("delFrame").onclick = deleteFrame;
document.getElementById("shiftFrame").onclick = () => shiftFrame();
// «Отразить»: зеркальное отражение текущего кадра по горизонтали
document.getElementById("mirrorFrame").onclick = () => __EDITOR.flipX();
document.getElementById("clearFrame").onclick = () => {
    curFrames()[current] = emptyFrame();
    render();
};

// ===== ПРОИГРЫВАНИЕ ТЕКУЩЕЙ СТРОКИ =====
const playBtn = document.getElementById("play");
const fpsInput = document.getElementById("fpsInput");

function applyFps(v) {
    fps = Math.max(1, Math.min(60, Math.round(v) || 8));
    fpsInput.value = fps;
    if (playing) { // перезапуск таймера с новым интервалом
        clearInterval(playTimer);
        startPlayback();
    }
}
function startPlayback() {
    let idx = 0;
    playTimer = setInterval(() => {
        idx = (idx + 1) % curFrames().length;
        current = idx;
        render();
    }, Math.round(1000 / fps));
}
fpsInput.onchange = () => applyFps(parseInt(fpsInput.value, 10));

playBtn.onclick = () => {
    playing = !playing;
    playBtn.classList.toggle("active", playing);
    if (playing) startPlayback();
    else clearInterval(playTimer);
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

// Скачивание файла браузером — сохранение без сервера (работает и на file://)
function triggerDownload(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

async function exportSheet(name, { download = false } = {}) {
    // Выравниваем строки по максимальному числу колонок: недостающие кадры
    // заполняются повтором последнего (анимация зацикливается без дыр)
    const columns = Math.max(...sheet.rows.map(r => r.frames.length));
    const sheetCanvas = document.createElement("canvas");
    sheetCanvas.width = size * columns;
    sheetCanvas.height = size * sheet.rows.length;
    const sctx = sheetCanvas.getContext("2d");

    const drawFrame = (frame, col, row) => {
        const img = sctx.createImageData(size, size);
        for (let p = 0; p < frame.length; p++) {
            const c = frame[p];
            if (!c) continue;
            img.data[p * 4] = parseInt(c.slice(1, 3), 16);
            img.data[p * 4 + 1] = parseInt(c.slice(3, 5), 16);
            img.data[p * 4 + 2] = parseInt(c.slice(5, 7), 16);
            img.data[p * 4 + 3] = 255;
        }
        sctx.putImageData(img, col * size, row * size);
    };

    sheet.rows.forEach((row, r) => {
        row.frames.forEach((frame, c) => drawFrame(frame, c, r));
        for (let c = row.frames.length; c < columns; c++) {
            drawFrame(row.frames[row.frames.length - 1], c, r);
        }
    });

    const base = name.replace(/\.png$/, "");
    const manifest = {
        size,
        columns,
        fps, // скорость анимации: редактор проигрывает с ней, игра берёт fps/60 как animationSpeed
        animations: sheet.rows.map((row, i) => ({ name: row.name, row: i, frames: row.frames.length })),
    };
    const jsonText = JSON.stringify(manifest, null, 2);
    const jsonDataUrl = "data:application/json;base64," + btoa(unescape(encodeURIComponent(jsonText)));

    if (download) {
        triggerDownload(sheetCanvas.toDataURL("image/png"), name);
        triggerDownload(jsonDataUrl, `${base}.json`);
        return { ok: true, downloaded: [name, `${base}.json`], columns, rows: sheet.rows.length };
    }

    const pngResult = await saveFile(name, sheetCanvas.toDataURL("image/png"));
    if (!pngResult.saved) return { ok: false, error: pngResult.error || "save failed" };
    await saveFile(`${base}.json`, jsonDataUrl);
    return { ok: true, saved: pngResult.saved, files: [name, `${base}.json`], columns, rows: sheet.rows.length };
}

// ===== ОТКРЫТИЕ СОХРАНЁННОГО СПРАЙТА (PNG + манифест) =====
const loadImage = (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`PNG не найден: ${url}`));
    // Кэш-бастер только для http(s): blob:-URL query-строку не допускают
    image.src = url.startsWith("blob:") ? url : url + "?t=" + Date.now();
});

// Общий разбор: изображение спрайтшита + манифест → строки-анимации редактора
function applySheet(image, manifest) {
    if (image.width !== manifest.size * manifest.columns ||
        image.height !== manifest.size * manifest.animations.length) {
        throw new Error(`Размер PNG ${image.width}×${image.height} не совпадает с манифестом`);
    }
    const reader = document.createElement("canvas");
    reader.width = image.width;
    reader.height = image.height;
    const rctx = reader.getContext("2d");
    rctx.drawImage(image, 0, 0);
    const pixels = rctx.getImageData(0, 0, image.width, image.height).data;
    const hexAt = (px, py) => {
        const o = (py * image.width + px) * 4;
        if (pixels[o + 3] < 128) return null; // прозрачный
        return "#" + [pixels[o], pixels[o + 1], pixels[o + 2]]
            .map(v => v.toString(16).padStart(2, "0")).join("");
    };
    size = manifest.size;
    document.getElementById("sizeInput").value = size;
    applyBoardSize();
    if (manifest.fps) applyFps(manifest.fps); // скорость из манифеста
    sheet = {
        rows: manifest.animations.map((a) => {
            const frames = [];
            for (let c = 0; c < a.frames; c++) {
                const frame = new Array(size * size).fill(null);
                const ox = c * size, oy = a.row * size;
                for (let y = 0; y < size; y++) {
                    for (let x = 0; x < size; x++) {
                        frame[y * size + x] = hexAt(ox + x, oy + y);
                    }
                }
                frames.push(frame);
            }
            return { name: a.name, frames };
        }),
    };
    rowIndex = 0;
    current = 0;
    render();
    return { rows: sheet.rows.map(r => ({ name: r.name, frames: r.frames.length })), size };
}

async function openSheet(name) {
    const base = name.replace(/\.png$/, "");
    const response = await fetch(`images/sprites/${base}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Манифест ${base}.json не найден`);
    const manifest = await response.json();
    const image = await loadImage(`images/sprites/${name}`);
    return applySheet(image, manifest);
}

// ОТКРЫТИЕ ЧЕРЕЗ СИСТЕМНЫЙ ДИАЛОГ: пользователь выбирает .png (и рядом .json).
// Файлы читаются локально — сервер не нужен. Без .json пробуем взять манифест
// с сервера (если файл лежит в images/sprites).
async function openFromFiles(files) {
    const list = [...files];
    const pngFile = list.find(f => /\.png$/i.test(f.name));
    if (!pngFile) throw new Error("Выберите файл .png");
    const base = pngFile.name.replace(/\.png$/i, "");
    const jsonFile = list.find(f => new RegExp("^" + base + "\.json$", "i").test(f.name))
        || list.find(f => /\.json$/i.test(f.name));
    let manifest;
    if (jsonFile) {
        manifest = JSON.parse(await jsonFile.text());
    } else {
        const response = await fetch(`images/sprites/${base}.json`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Рядом с ${pngFile.name} выберите также ${base}.json`);
        manifest = await response.json();
    }
    const url = URL.createObjectURL(pngFile);
    try {
        const image = await loadImage(url);
        return applySheet(image, manifest);
    } finally {
        URL.revokeObjectURL(url);
    }
}

// «Открыть» → системный диалог выбора файла (.png + рядом .json)
const fileInput = document.getElementById("fileInput");
document.getElementById("open").onclick = () => fileInput.click();
fileInput.addEventListener("change", () => {
    if (!fileInput.files.length) return;
    __EDITOR.openFiles([...fileInput.files]).then(r => {
        document.getElementById("status").textContent = r
            ? `Открыто: ${r.rows.map(x => `${x.name}(${x.frames})`).join(", ")}, ${r.size}×${r.size}`
            : "Не открыто";
    }).catch(e => {
        document.getElementById("status").textContent = `Ошибка: ${e.message}`;
    });
    fileInput.value = ""; // чтобы повторный выбор того же файла тоже срабатывал
});

// Скачивание: файлы сохраняются браузером, сервер не нужен
document.getElementById("download").onclick = () => {
    const name = document.getElementById("name").value.trim() || "sprite.png";
    __EDITOR.export(name, { download: true }).then(r => {
        document.getElementById("status").textContent = r.ok
            ? `Скачано: ${r.downloaded.join(", ")} (${r.columns} колонок × ${r.rows} строк)`
            : `Ошибка: ${r.error}`;
    });
};

// ===== РАЗМЕР: UI =====
document.getElementById("applySize").onclick = () => {
    const before = size;
    const after = __EDITOR.resize(parseInt(document.getElementById("sizeInput").value, 10));
    document.getElementById("status").textContent =
        after === before ? `Размер не изменился: ${size}×${size}` : `Размер: ${before} → ${after} (содержимое отцентрировано)`;
};

// ===== API ДЛЯ АВТОМАТИЗАЦИИ (агент/консоль) =====
const __EDITOR = {
    px: (x, y, c) => { setPixel(x, y, c); maybeRender(); return true; },
    get: (x, y) => getPixel(x, y),
    rect: (x, y, w, h, c) => {
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) setPixel(x + dx, y + dy, c);
        maybeRender(); return true;
    },
    mirror: () => {
        const f = curFrames()[current];
        for (let y = 0; y < size; y++) for (let x = 0; x < size / 2; x++) {
            f[y * size + (size - 1 - x)] = f[y * size + x];
        }
        maybeRender(); return true;
    },
    // Полное зеркалирование кадра (вид слева ↔ вид справа)
    flipX: () => {
        const f = curFrames()[current];
        const half = Math.floor(size / 2);
        for (let y = 0; y < size; y++) for (let x = 0; x < half; x++) {
            const a = f[y * size + x];
            const b = size - 1 - x;
            f[y * size + x] = f[y * size + b];
            f[y * size + b] = a;
        }
        maybeRender(); return true;
    },
    resize: (n) => resize(n),
    size: () => size,
    setBg: (c) => { bgColor = c; bgInput.value = c; render(); return bgColor; },
    bg: () => bgColor,
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
    renameRow: (oldName, newName) => {
        const row = sheet.rows.find(r => r.name === oldName);
        if (!row || sheet.rows.some(r => r.name === newName)) return false;
        row.name = newName;
        render(); return true;
    },
    // Прямой доступ к массиву пикселей кадра (чтение/замена) — для копирования
    // кадров между строками и программных трансформаций
    frameData: (row, i) => {
        const r = typeof row === "number" ? sheet.rows[row] : sheet.rows.find(x => x.name === row);
        return r && r.frames[i] ? r.frames[i] : null;
    },
    setFrameData: (row, i, data) => {
        const r = typeof row === "number" ? sheet.rows[row] : sheet.rows.find(x => x.name === row);
        if (!r || !r.frames[i]) return false;
        r.frames[i] = data;
        render(); return true;
    },
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
    shiftFrame,
    clear: () => { curFrames()[current] = emptyFrame(); maybeRender(); return true; },
    // ---- выделение лассо ----
    hasSel: () => !!selection,
    selInfo: () => {
        if (!selection) return null;
        const m = selection.mask;
        let count = 0, minX = size, minY = size, maxX = -1, maxY = -1;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            if (!m[y * size + x]) continue;
            count++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        return { count, minX, minY, maxX, maxY };
    },
    copySel: () => { copySelection(); return !!clipboard; },
    pasteSel: () => { pasteClipboard(); return true; },
    clearSel: () => { selection = null; render(); return true; },
    // Батч-рисование: примитивы внутри fn не перерисовывают доску
    silent: (fn) => { silentMode = true; try { fn(); } finally { silentMode = false; render(); } },
    // ---- экспорт / открытие ----
    export: (name, opts) => exportSheet(name, opts),
    open: (name) => openSheet(name.replace(/\.png$/, "") + ".png"),
    openFiles: (files) => openFromFiles(files),
    // ---- скорость анимации (кадров/с, попадает в манифест) ----
    fps: (v) => { if (v !== undefined) applyFps(v); return fps; },
    // Кадры строками: символ → цвет палитры, '.' или ' ' → прозрачный.
    // spec.animations = { wait: [строки кадра...], death: [...] }; spec.size — размер холста.
    saveSpec: (spec) => {
        if (spec.size && spec.size !== size) resize(spec.size);
        const parse = (rows) => rows.flatMap((row) => [...row].map((ch) => {
            if (ch === "." || ch === " ") return null;
            return spec.palette[ch] ?? null;
        }));
        if (spec.animations) {
            for (const [name, rows] of Object.entries(spec.animations)) {
                const existing = sheet.rows.findIndex(r => r.name === name);
                const frames = [];
                for (let i = 0; i < rows.length; i += size) {
                    frames.push(parse(rows.slice(i, i + size)));
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
