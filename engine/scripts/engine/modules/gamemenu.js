// ИГРОВОЕ МЕНЮ — полоса кнопок + панели вкладок (по образцу forWork/example:
// верхняя полоса кнопок открывает панели, игра на паузе). Вкладки:
//   Экипировка — кукла героя, очки характеристик (+), вторичные статы;
//   Умения     — ДЕРЕВО способностей класса: изучение за очки умений
//                (узлы-«подземелья» не изучаются в открытой зоне);
//   Журнал     — лог событий забега (убийства/уровни/награды);
//   Карта      — мини-карта мира (вода/лес/прочее) с меткой героя;
//   Библиотека — бестиарий: карточки врагов открываются за первые убийства
//                (зачёт в localStorage — живёт между сессиями, как в образце);
//   Настройки  — полный экран, возврат в главное меню.
// Панель открывается ТОЛЬКО из сцены game; открытие — scenes.go("panel")
// (game.js ставит мир на паузу), Escape или крестик — закрытие.
//
// Битовый бюджет: ноль компонентов — чистый экранный UI поверх мира.
// ЛОВУШКА v8: интерактивные элементы — Graphics/контейнеры с hitArea
// (NineSliceSprite в минифицированном билде не хит-тестится).

const GM_BTN_H = 30;      // высота кнопки полосы меню
const GM_BTN_GAP = 8;
const GM_TABS = [
    ["equip", "Экипировка"],
    ["skills", "Умения"],
    ["journal", "Журнал"],
    ["map", "Карта"],
    ["library", "Библиотека"],
    ["settings", "Настройки"],
];
const GM_CELL = 64, GM_GAP = 10;   // сетка дерева умений
const GM_COL = "#ffd98e", GM_TXT = "#cfc4a6", GM_DIM = "#8a8272";

function createGameMenu({ app, combat, quests, getHero, getIcon, getDoll,
                          getMapImage, enemyKinds, gameLog, library,
                          onToggleFullscreen, onToMenu }) {
    if (!combat || !getHero || !getIcon) {
        throw new Error("createGameMenu: нужны combat, getHero, getIcon");
    }

    // ── ПОЛОСА КНОПОК (top-left, видна в сцене game) ────────────────────────
    const bar = new PIXI.Container();
    bar.visible = false;
    app.stage.addChild(bar);
    const barButtons = [];
    let activeTab = null;
    for (const [tab, label] of GM_TABS) {
        const btn = new PIXI.Container();
        const bg = new PIXI.Graphics();
        const w = 26 + label.length * 13;
        const draw = (hot) => {
            bg.clear()
                .roundRect(0, 0, w, GM_BTN_H, 6).fill({ color: 0x140f08, alpha: 0.85 })
                .roundRect(0, 0, w, GM_BTN_H, 6).stroke({ width: 2, color: hot ? 0xffd98e : 0x6b4a2f });
        };
        draw(false);
        const txt = new PIXI.Text({
            text: label,
            style: { fontFamily: globalThis.GAME_FONT || "monospace", fontSize: 16, fill: GM_TXT },
        });
        txt.position.set(13, 5);
        btn.eventMode = "static";
        btn.cursor = "pointer";
        btn.hitArea = new PIXI.Rectangle(0, 0, w, GM_BTN_H);
        btn.on("pointerenter", () => draw(true));
        btn.on("pointerleave", () => draw(activeTab === tab));
        btn.on("pointertap", () => (activeTab === tab ? close() : open(tab)));
        btn.addChild(bg, txt);
        btn.labelText = txt;
        bar.addChild(btn);
        barButtons.push({ btn, tab, w, redraw: draw });
    }
    function placeBar() {
        const w = app.screen.width;
        // при узком экране — две строки
        let x = 16, y = 10;
        for (const b of barButtons) {
            if (x + b.w > w - 16) { x = 16; y += GM_BTN_H + 6; }
            b.btn.position.set(x, y);
            x += b.w + GM_BTN_GAP;
        }
    }
    placeBar();

    // ── ПАНЕЛЬ ──────────────────────────────────────────────────────────────
    const panel = new PIXI.Container();
    panel.visible = false;
    app.stage.addChild(panel);
    const panelBg = new PIXI.Graphics();
    const panelTitle = new PIXI.Text({
        text: "", style: { fontFamily: globalThis.GAME_FONT || "monospace",
                           fontSize: 30, fill: GM_COL, fontWeight: "bold" },
    });
    const closeBtn = new PIXI.Container();
    const closeBg = new PIXI.Graphics()
        .roundRect(0, 0, 30, 30, 6).fill({ color: 0x3a0d0d })
        .roundRect(0, 0, 30, 30, 6).stroke({ width: 2, color: 0x6b4a2f });
    const closeTxt = new PIXI.Text({
        text: "✕", style: { fontFamily: globalThis.GAME_FONT || "monospace",
                            fontSize: 20, fill: "#ff9d8e" },
    });
    closeTxt.anchor.set(0.5);
    closeTxt.position.set(15, 15);
    closeBtn.addChild(closeBg, closeTxt);
    closeBtn.eventMode = "static";
    closeBtn.cursor = "pointer";
    closeBtn.on("pointertap", () => close());
    const content = new PIXI.Container(); // контент вкладки (перестраивается)
    panel.addChild(panelBg, panelTitle, closeBtn, content);

    let PW = 780, PH = 540, CX = 0, CY = 0;
    function place() {
        PW = Math.min(app.screen.width * 0.94, 800);
        PH = Math.min(app.screen.height * 0.88, 560);
        CX = (app.screen.width - PW) / 2;
        CY = (app.screen.height - PH) / 2;
        panelBg.clear().roundRect(0, 0, PW, PH, 12)
            .fill({ color: 0x100c07, alpha: 0.96 })
            .roundRect(0, 0, PW, PH, 12).stroke({ width: 3, color: 0x6b4a2f });
        panel.position.set(CX, CY);
        panelTitle.position.set(22, 14);
        closeBtn.position.set(PW - 42, 14);
        if (activeTab) buildTab(activeTab); // пересобрать под новый размер
    }
    app.renderer.on("resize", () => { placeBar(); if (activeTab) place(); });

    // ── ОТКРЫТИЕ/ЗАКРЫТИЕ (сцену переключает game.js через onOpenTab) ───────
    let onOpenTab = null; // назначит game.js: (tab|null) → пауза мира/сцена
    function open(tab) {
        if (getHero().id === null) return;
        activeTab = tab;
        for (const b of barButtons) b.redraw(b.tab === activeTab);
        panel.visible = true;
        place();
        if (onOpenTab) onOpenTab(tab);
    }
    function close() {
        activeTab = null;
        for (const b of barButtons) b.redraw(false);
        panel.visible = false;
        if (onOpenTab) onOpenTab(null);
    }

    // ── хелперы контента ────────────────────────────────────────────────────
    function mkText(str, size, fill, opts = {}) {
        const t = new PIXI.Text({ text: str, style: {
            fontFamily: globalThis.GAME_FONT || "monospace",
            fontSize: size, fill, ...opts.style } });
        if (opts.wrap) { t.style.wordWrap = true; t.style.wordWrapWidth = opts.wrap; t.style.breakWords = true; }
        if (opts.lineHeight) t.style.lineHeight = opts.lineHeight;
        return t;
    }
    function mkButton(label, w, onTap, { color = 0x6b4a2f, fill = 0x1e1710, size = 18 } = {}) {
        const btn = new PIXI.Container();
        const bg = new PIXI.Graphics();
        const draw = (hot) => bg.clear().roundRect(0, 0, w, 34, 6)
            .fill({ color: fill, alpha: 0.95 })
            .roundRect(0, 0, w, 34, 6).stroke({ width: 2, color: hot ? 0xffd98e : color });
        draw(false);
        const txt = mkText(label, size, "#f0e6c8");
        txt.anchor.set(0.5);
        txt.position.set(w / 2, 17);
        btn.eventMode = "static";
        btn.cursor = "pointer";
        btn.hitArea = new PIXI.Rectangle(0, 0, w, 34);
        btn.on("pointerenter", () => draw(true));
        btn.on("pointerleave", () => draw(false));
        btn.on("pointertap", onTap);
        btn.addChild(bg, txt);
        return btn;
    }
    function scaleToFit(group, dw, dh) {
        const availW = PW - 44, availH = PH - 76;
        const s = Math.min(1, availW / dw, availH / dh);
        group.scale.set(s);
        group.position.set((PW - dw * s) / 2, 56 + (availH - dh * s) / 2);
    }

    // ── ВКЛАДКА: ЭКИПИРОВКА (кукла + очки характеристик + вторичные статы) ──
    const STAT_KEYS = ["str", "agi", "vit", "spd", "wis"];
    function buildEquip(g) {
        const hero = getHero();
        const s = combat.stat(hero.id);
        if (!s) return;
        let y = 0;
        // кукла + имя/уровень/опыт
        const doll = new PIXI.Sprite(getDoll(hero.cls.doll));
        doll.height = 200; doll.width = 133;
        doll.position.set(0, 0);
        g.addChild(doll);
        const name = mkText(`${hero.cls.name} · уровень ${s.lvl}`, 24, GM_COL, { style: { fontWeight: "bold" } });
        name.position.set(150, 6);
        g.addChild(name);
        const xpText = mkText(`Опыт: ${s.xp} / ${xpToNext(s.lvl)}   ·   ХП ${Math.ceil(COMPONENTS.hp[hero.id])}/${Math.round(COMPONENTS.maxHp[hero.id])}`, 17, GM_TXT);
        xpText.position.set(150, 38);
        g.addChild(xpText);
        // очки характеристик: строки статов с кнопкой «+»
        const pts = mkText(`Свободных очков характеристик: ${s.statPoints}`,
            19, s.statPoints > 0 ? "#ffd98e" : GM_DIM, { style: { fontWeight: "bold" } });
        pts.position.set(150, 68);
        g.addChild(pts);
        STAT_LABELS.forEach((lab, i) => {
            const key = STAT_KEYS[i];
            const row = mkText(`${lab.name}`, 19, GM_TXT);
            row.position.set(150, 100 + i * 32);
            const val = mkText(String(s.prim[key]), 21, "#f0e6c8", { style: { fontWeight: "bold" } });
            val.position.set(300, 97 + i * 32);
            g.addChild(row, val);
            if (s.statPoints > 0) {
                const plus = mkButton("+", 34, () => {
                    if (combat.allocateStat(hero.id, key)) buildTab("equip");
                }, { size: 22 });
                plus.position.set(330, 94 + i * 32);
                g.addChild(plus);
            }
        });
        // вторичные статы (dop) — две колонки
        const d = s.dop;
        const rows = [
            ["Атака (макс. урон)", d.attack], ["Блок", d.block + "%"],
            ["Контратака", d.counter + "%"], ["Крит", d.crit + "%"],
            ["Мощь крита", d.critPower + "%"], ["Уклонение", d.dodge + "%"],
            ["Запас ХП", d.hpMax], ["Сопротивление", d.resist + "%"],
            ["Выносливость", d.endurance + "%"], ["Подвижность", d.move + "%"],
            ["Рефлексы (кд атаки)", d.cdrAttack + "%"], ["Находчивость (кд умений)", d.cdrAbility + "%"],
            ["Сила воли", d.spellPower], ["Обучаемость (опыт ×2)", d.xpBoost + "%"],
        ];
        const colW = 330;
        rows.forEach(([label, v], i) => {
            const col = i % 2, row = (i / 2) | 0;
            const t = mkText(`${label}: `, 16, GM_DIM);
            t.position.set(col * colW, 316 + row * 26);
            const v2 = mkText(String(v), 16, GM_TXT);
            v2.position.set(col * colW + 250, 316 + row * 26);
            g.addChild(t, v2);
        });
        scaleToFit(g, 680, 500);
    }

    // ── ВКЛАДКА: УМЕНИЯ (дерево класса, изучение за очки умений) ────────────
    let treeHint = null;
    function buildSkills(g) {
        const hero = getHero();
        const s = combat.stat(hero.id);
        const tree = ABILITY_TREES[hero.cls.tree];
        const pool = HERO_ABILITIES[hero.cls.key];
        const passives = HERO_TREE_PASSIVES[hero.cls.key] || {};
        const learned = s.learned || {};
        const head = mkText(`Очки умений: ${s.abilityPoints}   ·   узлы с эффектом подземелий недоступны в открытой зоне`,
            16, GM_DIM);
        head.position.set(0, -6);
        g.addChild(head);
        // связи дерева
        const lines = new PIXI.Graphics();
        const cellCx = (i) => tree[i].x * (GM_CELL + GM_GAP) + GM_CELL / 2;
        const cellCy = (i) => tree[i].y * (GM_CELL + GM_GAP) + GM_CELL / 2;
        for (let i = 0; i < tree.length; i++) {
            for (const p of tree[i].prev) {
                const on = (learned[i] || 0) > 0 && (learned[p] || 0) > 0;
                lines.moveTo(cellCx(p), cellCy(p)).lineTo(cellCx(i), cellCy(i))
                    .stroke({ width: 3, color: on ? 0xffd98e : 0x4a4030 });
            }
        }
        g.addChild(lines);
        const info = (str, color = GM_TXT) => {
            if (treeHint) treeHint.destroy();
            treeHint = mkText(str, 16, color, { wrap: 430, lineHeight: 20 });
            treeHint.position.set(470, 60);
            g.addChild(treeHint);
        };
        tree.forEach((node, i) => {
            const lvl = learned[i] || 0;
            const active = pool.find((d) => d.node === i);
            const passiveName = passives[i];
            const effect = active || passiveName;
            const cell = new PIXI.Container();
            cell.position.set(node.x * (GM_CELL + GM_GAP), node.y * (GM_CELL + GM_GAP));
            const bg = new PIXI.Graphics();
            // состояние узла: предок достаточно ОДНОГО (OR)
            const prevOk = !node.prev.length || node.prev.some((p) => (learned[p] || 0) > 0);
            const canLearn = s.abilityPoints > 0 && prevOk && lvl < node.maxLvl;
            const border = lvl > 0 ? 0xffd98e : canLearn ? 0x7fe07f : 0x6b4a2f;
            bg.roundRect(0, 0, GM_CELL, GM_CELL, 8).fill({ color: 0x140f08, alpha: 0.95 })
                .roundRect(0, 0, GM_CELL, GM_CELL, 8).stroke({ width: 2, color: border });
            const tex = getIcon(hero.cls.key, node.icon);
            let icon;
            if (tex !== PIXI.Texture.EMPTY) {
                icon = new PIXI.Sprite(tex);
                icon.width = icon.height = GM_CELL - 8;
                icon.anchor.set(0.5);
                icon.position.set(GM_CELL / 2, GM_CELL / 2);
                if (!effect) icon.tint = 0x8a8272; // подземелья — приглушена
            } else {
                // нет вшитой иконки (узел без эффекта в этой зоне) — заглушка
                icon = new PIXI.Graphics()
                    .circle(GM_CELL / 2, GM_CELL / 2, 10).stroke({ width: 2, color: 0x4a4030 })
                    .circle(GM_CELL / 2, GM_CELL / 2 - 4, 4)
                    .rect(GM_CELL / 2 - 2, GM_CELL / 2 - 2, 4, 10).fill(0x4a4030);
            }
            const lvlTxt = lvl > 0 ? mkText(`${lvl}/${node.maxLvl}`, 14, "#9fd8ff", { style: { fontWeight: "bold" } })
                : mkText(node.maxLvl > 1 ? `0/${node.maxLvl}` : "—", 14, GM_DIM);
            lvlTxt.position.set(4, 2);
            cell.addChild(bg, icon, lvlTxt);
            g.addChild(cell);
            // клик: изучение (если можно) + подсказка по узлу
            cell.eventMode = "static";
            cell.cursor = canLearn ? "pointer" : "default";
            cell.hitArea = new PIXI.Rectangle(0, 0, GM_CELL, GM_CELL);
            cell.on("pointertap", () => {
                if (lvl >= node.maxLvl) { info(`«${node.title}» изучен до максимума (${node.maxLvl}).`); return; }
                if (!prevOk) { info(`«${node.title}»: сначала изучите один из предыдущих узлов (${node.prev.map((p) => tree[p].title).join(", ")}).`, "#ff9d8e"); return; }
                if (s.abilityPoints <= 0) { info("Нет очков умений — они даются за уровни.", "#ff9d8e"); return; }
                const newLvl = combat.learn(hero.id, i, node.maxLvl, node.prev);
                if (newLvl) {
                    // пересборка пассивок героя + слотов панели
                    getHero().onLearned();
                    info(effect ? `«${node.title}» — уровень ${newLvl}.` :
                        `«${node.title}» — уровень ${newLvl}. Эффект проявится в подземельях.`);
                    buildTab("skills");
                }
            });
            cell.on("pointerover", () => {
                const kind = active ? "активное — встанет в слот панели"
                    : passiveName ? "пассивное — работает постоянно"
                    : "эффект подземелий (здесь спит)";
                const nextDesc = node.desc[Math.min(lvl, node.maxLvl - 1)];
                info(`«${node.title}» [${kind}] ${lvl > 0 ? `· уровень ${lvl}/${node.maxLvl}` : ""}\n${nextDesc}`);
            });
        });
        scaleToFit(g, 900, 330);
    }

    // ── ВКЛАДКА: ЖУРНАЛ (лог событий забега + состояние цепочки заданий) ────
    function buildJournal(g) {
        const rows = gameLog().slice(-16);
        let y = 0;
        if (!rows.length) {
            const empty = mkText("Пока тихо. Убийства, уровни и награды появятся здесь.", 18, GM_DIM);
            g.addChild(empty);
            y = 30;
        }
        for (let i = rows.length - 1; i >= 0; i--) {
            const t = mkText(rows[i].text, 16, rows[i].color || GM_TXT);
            t.position.set(0, y);
            g.addChild(t);
            y += 26;
        }
        // состояние цепочки заданий — под логом
        if (quests) {
            const snap = quests.snapshot();
            const done = snap.states.filter((st) => st === 2).length;
            const cur = snap.chain[snap.current];
            const goal = cur ? (cur.need ? `${snap.progress}/${cur.need}` : `уровень ${cur.level}`)
                             : "все выполнены";
            const head = mkText(`Задания: выполнено ${done} / ${snap.chain.length}` +
                (cur ? `   ·   сейчас: «${cur.title}» — ${goal}` : ""), 17, GM_COL);
            head.position.set(0, y + 18);
            g.addChild(head);
        }
        scaleToFit(g, 700, 470);
    }

    // ── ВКЛАДКА: КАРТА (мини-карта мира + метка героя) ──────────────────────
    function buildMap(g) {
        const img = getMapImage(); // { texture, w, h, ts } — 1px карты = 1 тайл
        const size = Math.min(PW - 220, PH - 120);
        const map = new PIXI.Sprite(img.texture);
        const s = size / Math.max(img.w, img.h);
        map.scale.set(s);
        map.position.set(0, 0);
        g.addChild(map);
        const hero = getHero();
        const marker = new PIXI.Graphics();
        marker.circle(0, 0, 5).fill({ color: 0xff3b30 }).circle(0, 0, 5).stroke({ width: 2, color: 0xffffff });
        if (hero.id !== null) {
            marker.position.set(
                (COMPONENTS.positionX[hero.id] / (img.w * img.ts)) * img.w * s,
                (COMPONENTS.positionY[hero.id] / (img.h * img.ts)) * img.h * s);
        }
        g.addChild(marker);
        const legend = mkText(
            "● герой\n\nГолубое — вода, тёмно-зелёное —\nлеса, светлое — открытая местность.\nДеревни гоблинов, дворфов и орков\nразбросаны по миру.", 16, GM_TXT,
            { wrap: 190, lineHeight: 21 });
        legend.position.set(size + 30, 20);
        g.addChild(legend);
        scaleToFit(g, size + 230, size + 10);
    }

    // ── ВКЛАДКА: БИБЛИОТЕКА (бестиарий; открытие — за первые убийства) ──────
    function buildLibrary(g) {
        const CARD_W = 110, CARD_H = 148, GAP = 10;
        const cols = 6;
        ENEMY_BESTIARY.forEach((e, i) => {
            const col = i % cols, row = (i / cols) | 0;
            const card = new PIXI.Container();
            card.position.set(col * (CARD_W + GAP), row * (CARD_H + GAP));
            const unlocked = library.unlocked.has(e.key);
            const bg = new PIXI.Graphics()
                .roundRect(0, 0, CARD_W, CARD_H, 8).fill({ color: 0x140f08, alpha: 0.95 })
                .roundRect(0, 0, CARD_W, CARD_H, 8).stroke({ width: 2, color: unlocked ? 0x6b4a2f : 0x30291e });
            card.addChild(bg);
            const sheet = enemyKinds()[e.key];
            if (unlocked && sheet) {
                const icon = new PIXI.Sprite(sheet.animations.wait[0]);
                icon.anchor.set(0.5, 1);
                icon.width = 56; icon.height = 56;
                icon.position.set(CARD_W / 2, 70);
                card.addChild(icon);
            } else {
                const q = mkText("???", 26, "#3f392e", { style: { fontWeight: "bold" } });
                q.anchor.set(0.5);
                q.position.set(CARD_W / 2, 44);
                card.addChild(q);
            }
            const name = mkText(unlocked ? e.name : "???", 13, unlocked ? GM_TXT : "#4a4436",
                { wrap: CARD_W - 8, lineHeight: 14 });
            name.position.set(4, 76);
            card.addChild(name);
            if (unlocked) {
                const tier = e.tier === "boss" ? "БОСС" : e.tier === "elite" ? "элита" : "";
                const es = ENEMY_STATS[e.key];
                const sub = mkText((tier ? tier + " · " : "") + (es ? "опыт " + es.xp : ""), 12, GM_DIM);
                sub.position.set(4, CARD_H - 40);
                card.addChild(sub);
                const desc = mkText(e.desc || "", 11, GM_DIM, { wrap: CARD_W - 8, lineHeight: 13 });
                desc.position.set(4, CARD_H - 24);
                card.addChild(desc);
            }
            g.addChild(card);
        });
        scaleToFit(g, cols * (CARD_W + GAP) - GAP, 4 * (CARD_H + GAP) - GAP);
    }

    // ── ВКЛАДКА: НАСТРОЙКИ ──────────────────────────────────────────────────
    function buildSettings(g) {
        const fs = mkButton("Полный экран: вкл/выкл", 280, () => onToggleFullscreen());
        fs.position.set(60, 20);
        const toMenu = mkButton("В главное меню", 280, () => { close(); onToMenu(); });
        toMenu.position.set(60, 70);
        const note = mkText("Мир на паузе, пока открыта эта панель.\nEscape — закрыть.", 15, GM_DIM, { lineHeight: 20 });
        note.position.set(60, 130);
        g.addChild(fs, toMenu, note);
        scaleToFit(g, 400, 180);
    }

    const BUILDERS = { equip: buildEquip, skills: buildSkills, journal: buildJournal,
                       map: buildMap, library: buildLibrary, settings: buildSettings };
    function buildTab(tab) {
        content.removeChildren().forEach((c) => c.destroy({ children: true }));
        treeHint = null;
        const g = new PIXI.Container();
        content.addChild(g);
        panelTitle.text = GM_TABS.find(([t]) => t === tab)[1];
        BUILDERS[tab](g);
    }

    return { bar, open, close, place, set onOpenTab(fn) { onOpenTab = fn; },
             show(v) { bar.visible = v; }, get activeTab() { return activeTab; } };
}
globalThis.createGameMenu = createGameMenu;
