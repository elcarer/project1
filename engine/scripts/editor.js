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
let tool = "pixel";           // pixel | fill | eraser | pick
let playing = false;
let playTimer = null;

const curRow = () => sheet.rows[rowIndex];
const curFrames = () => curRow().frames;

// ===== ОТРИСОВКА ДОСКИ =====
function render() {
    ctx.fillStyle = "#15171b";
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
        tctx.fillStyle = "#15171b";
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

    const pngResult = await saveFile(name, sheetCanvas.toDataURL("image/png"));
    if (!pngResult.saved) return { ok: false, error: pngResult.error || "save failed" };

    const base = name.replace(/\.png$/, "");
    const manifest = {
        size,
        columns,
        animations: sheet.rows.map((row, i) => ({ name: row.name, row: i, frames: row.frames.length })),
    };
    await saveFile(`${base}.json`, "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 2)))));

    return { ok: true, saved: pngResult.saved, files: [name, `${base}.json`], columns, rows: sheet.rows.length };
}

// ===== ОТКРЫТИЕ СОХРАНЁННОГО СПРАЙТА (PNG + манифест) =====
const loadImage = (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`PNG не найден: ${url}`));
    image.src = url + "?t=" + Date.now();
});

async function openSheet(name) {
    const base = name.replace(/\.png$/, "");
    const response = await fetch(`images/sprites/${base}.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Манифест ${base}.json не найден`);
    const manifest = await response.json();

    const image = await loadImage(`images/sprites/${name}`);
    if (image.width !== manifest.size * manifest.columns ||
        image.height !== manifest.size * manifest.animations.length) {
        throw new Error(`Размер PNG ${image.width}×${image.height} не совпадает с манифестом`);
    }

    // Читаем весь спрайтшит в пиксели один раз
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
    return {
        rows: sheet.rows.map(r => ({ name: r.name, frames: r.frames.length })),
        size,
    };
}

document.getElementById("open").onclick = () => {
    const name = document.getElementById("openName").value.trim();
    __EDITOR.open(name).then(r => {
        document.getElementById("status").textContent = r
            ? `Открыто: ${name} — ${r.rows.map(x => `${x.name}(${x.frames})`).join(", ")}`
            : "Не открыто";
    }).catch(e => {
        document.getElementById("status").textContent = `Ошибка: ${e.message}`;
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
    clear: () => { curFrames()[current] = emptyFrame(); maybeRender(); return true; },
    // Батч-рисование: примитивы внутри fn не перерисовывают доску
    silent: (fn) => { silentMode = true; try { fn(); } finally { silentMode = false; render(); } },
    // ---- экспорт / открытие ----
    export: (name) => exportSheet(name),
    open: (name) => openSheet(name.replace(/\.png$/, "") + ".png"),
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
