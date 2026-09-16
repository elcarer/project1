// ГЕНЕРАТОР ПОДЗЕМЕЛЬЯ — классическая схема рогалика: случайные непересекающиеся
// комнаты (4..8 × 4..6 клеток), соединённые Г-образными коридорами шириной 2,
// кайма стен по краю. Детерминизм от сида (mulberry32, как в dualgrid).
// Возвращает:
//   walls — Uint8Array(w*h), 1 = стена (непроходимо), 0 = пол;
//   rooms — [{x, y, w, h}], rooms[0] — комната входа (spawn),
//   exit  — индекс самой дальней комнаты (портал вниз / босс).
function generateDungeonLayout(w, h, seed) {
    let a = seed >>> 0;
    const rand = () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ 0;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const walls = new Uint8Array(w * h).fill(1);
    const rooms = [];
    for (let attempt = 0; attempt < 90 && rooms.length < 9; attempt++) {
        const rw = 4 + ((rand() * 5) | 0);   // 4..8
        const rh = 4 + ((rand() * 3) | 0);   // 4..6
        const rx = 2 + ((rand() * (w - rw - 4)) | 0);
        const ry = 2 + ((rand() * (h - rh - 4)) | 0);
        let ok = true;
        for (const r of rooms) {
            if (!(rx + rw + 1 < r.x || r.x + r.w + 1 < rx ||
                  ry + rh + 1 < r.y || r.y + r.h + 1 < ry)) { ok = false; break; }
        }
        if (!ok) continue;
        rooms.push({ x: rx, y: ry, w: rw, h: rh });
    }
    for (const r of rooms) {
        for (let y = r.y; y < r.y + r.h; y++) {
            for (let x = r.x; x < r.x + r.w; x++) walls[y * w + x] = 0;
        }
    }
    // коридоры: каждя комната соединяется с предыдущей (ширина 2)
    const cx = (r) => r.x + (r.w >> 1), cy = (r) => r.y + (r.h >> 1);
    for (let i = 1; i < rooms.length; i++) {
        const ax = cx(rooms[i - 1]), ay = cy(rooms[i - 1]);
        const bx = cx(rooms[i]), by = cy(rooms[i]);
        if (rand() < 0.5) {
            for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) { walls[ay * w + x] = 0; walls[(ay + 1) * w + x] = 0; }
            for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) { walls[y * w + bx] = 0; walls[y * w + bx + 1] = 0; }
        } else {
            for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) { walls[y * w + ax] = 0; walls[y * w + ax + 1] = 0; }
            for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) { walls[by * w + x] = 0; walls[(by + 1) * w + x] = 0; }
        }
    }
    // самая дальняя от входа комната — выход/босс
    let exit = rooms.length > 1 ? 1 : 0, best = -1;
    for (let i = 1; i < rooms.length; i++) {
        const dx = cx(rooms[i]) - cx(rooms[0]), dy = cy(rooms[i]) - cy(rooms[0]);
        if (dx * dx + dy * dy > best) { best = dx * dx + dy * dy; exit = i; }
    }
    return { w, h, walls, rooms, spawn: 0, exit };
}

globalThis.generateDungeonLayout = generateDungeonLayout;
