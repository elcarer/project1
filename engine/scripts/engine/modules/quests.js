// КВЕСТЫ — ведение цепочки заданий и интерфейс: трекер, журнал, объявления.
// Данные — data/quests.js (QUEST_CHAIN, KIND_RU). Состояние на сессию:
// закрыт → активен → выполнен; активным всегда ровно одно задание цепочки.
// События убийств приходят от боя (combat зовёт колбэк onKill → notifyKill
// с видом жертвы), задания «достичь уровня» модуль опрашивает сам каждый кадр
// (combat.stat(heroId).lvl). Награды — опыт через combat.giveXp; всплывающие
// подписи над героем — fx. ECS-методология: модуль только читает события и
// компоненты, никакой игровой логики внутри боя/ввода.
//
// Интерфейс — свой контейнер в app.stage (поверх мира и HUD):
//   трекер активного задания — правый верхний угол под полосками ХП/опыта;
//   журнал (toggleLog, клавиша L) — вся цепочка с состояниями и наградами;
//   объявления «новое задание / выполнено» — очередь плашек сверху экрана.
// В сцене меню интерфейс прячется (show(false), как hintLabel).
//
// Пример:
//   const quests = createQuests({ app, combat, fx, heroId: wolfId, heroPos });
//   combat = createCombat({ ..., onKill: (k, v) => quests.notifyKill(kindOf(v)) });
//   // в кадре игровой сцены: quests.update(ticker); L → quests.toggleLog()

function createQuests({ app, combat, fx, heroId = null, heroPos = null, addSystem = null }) {
    if (!combat || !fx) throw new Error("createQuests: нужны combat и fx");
    const chain = QUEST_CHAIN;
    const FONT = globalThis.GAME_FONT || "monospace";
    const LOCKED = 0, ACTIVE = 1, DONE = 2;
    const state = chain.map(() => LOCKED);
    let current = 0;      // индекс активного задания
    let progress = 0;     // убито (для «уровня» — текущий уровень героя)
    let allDone = false;
    let logOpen = false;
    state[0] = ACTIVE;

    function heroLevel() {
        const s = combat.stat(heroId);
        return s ? s.lvl : 1;
    }

    // Цель активного задания одной строкой («Убить крыс: 3/5»)
    function goalText(q, p) {
        if (q.level) return `Достичь ${q.level} уровня: ${p}/${q.level}`;
        const gen = q.kind === "any" ? "врагов" : KIND_RU[q.kind].gen;
        return `Убить ${gen}: ${p}/${q.need}`;
    }

    // ===== Корневой контейнер: прячется целиком в сцене меню ==================
    const root = new PIXI.Container();
    root.visible = false; // откроется при входе в игровую сцену
    app.stage.addChild(root);

    // ===== Трекер активного задания (правый верхний угол, под полосками) ======
    const TRACK_W = 300;
    const tracker = new PIXI.Container();
    const trackerBg = new PIXI.Graphics()
        .roundRect(0, 0, TRACK_W, 58, 8)
        .fill({ color: 0x140f08, alpha: 0.82 })
        .stroke({ width: 2, color: 0x6b4a2f });
    const trTitle = new PIXI.Text({ text: "", style: { fontFamily: FONT, fontSize: 22, fill: "#ffd98e" } });
    trTitle.position.set(12, 6);
    const trGoal = new PIXI.Text({ text: "", style: { fontFamily: FONT, fontSize: 20, fill: "#e8dfc8" } });
    trGoal.position.set(12, 32);
    tracker.addChild(trackerBg, trTitle, trGoal);
    root.addChild(tracker);
    let trTitleStr = "", trGoalStr = "";
    function refreshTracker() {
        let t, g;
        if (allDone) {
            t = "Задания";
            g = "Все задания выполнены";
        } else {
            const q = chain[current];
            t = `Задание: ${q.title}`;
            g = goalText(q, q.level ? heroLevel() : progress);
        }
        if (t !== trTitleStr) { trTitleStr = t; trTitle.text = t; }
        if (g !== trGoalStr) { trGoalStr = g; trGoal.text = g; }
        const gc = allDone ? "#a8e05f" : "#e8dfc8";
        if (trGoal.style.fill !== gc) trGoal.style.fill = gc;
    }

    // ===== Журнал (L): вся цепочка с маркерами состояния и наградами ==========
    const LOG_W = 640, LOG_H = 540, ROW_H = 40, ROW_Y0 = 64;
    const log = new PIXI.Container();
    const logBg = new PIXI.Graphics()
        .roundRect(0, 0, LOG_W, LOG_H, 10)
        .fill({ color: 0x140f08, alpha: 0.95 })
        .stroke({ width: 3, color: 0x6b4a2f });
    const logTitle = new PIXI.Text({ text: "ЖУРНАЛ ЗАДАНИЙ", style: { fontFamily: FONT, fontSize: 30, fill: "#ffd98e" } });
    logTitle.anchor.set(0.5, 0);
    logTitle.position.set(LOG_W / 2, 16);
    log.addChild(logBg, logTitle);
    const rows = chain.map((q, i) => {
        const y = ROW_Y0 + i * ROW_H;
        const mark = new PIXI.Graphics(); // маркер состояния (квадрат 12×12)
        mark.position.set(22, y + 7);
        const name = new PIXI.Text({
            text: `${i + 1}. ${q.title}`,
            style: { fontFamily: FONT, fontSize: 22, fill: "#ffffff" },
        });
        name.position.set(44, y);
        const status = new PIXI.Text({
            text: "", style: { fontFamily: FONT, fontSize: 20, fill: "#ffffff" },
        });
        status.anchor.set(1, 0); // цель/награда — по правому краю панели
        status.position.set(LOG_W - 20, y + 1);
        log.addChild(mark, name, status);
        return { mark, name, status };
    });
    // Описание активного задания — подвал журнала (перенос длинных строк)
    const logDesc = new PIXI.Text({
        text: "",
        style: { fontFamily: FONT, fontSize: 19, fill: "#b9ae90", wordWrap: true, wordWrapWidth: LOG_W - 48, lineHeight: 24 },
    });
    logDesc.position.set(24, LOG_H - 62);
    log.addChild(logDesc);
    log.visible = false;
    root.addChild(log);
    function refreshLog() {
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i], q = chain[i], st = state[i];
            r.mark.clear();
            if (st === DONE) r.mark.rect(0, 0, 12, 12).fill(0x7fe07f);
            else if (st === ACTIVE) r.mark.rect(0, 0, 12, 12).fill(0xffd98e);
            else r.mark.rect(1, 1, 10, 10).stroke({ width: 2, color: 0x6f6a5c });
            r.name.style.fill = st === LOCKED ? "#6f6a5c" : (st === ACTIVE ? "#ffe9b8" : "#a8e05f");
            if (st === ACTIVE) {
                r.status.text = goalText(q, q.level ? heroLevel() : progress);
                r.status.style.fill = "#e8dfc8";
            } else {
                r.status.text = `+${q.reward} опыта`;
                r.status.style.fill = st === LOCKED ? "#6f6a5c" : "#7fe07f";
            }
        }
        logDesc.text = allDone
            ? "Все задания выполнены. Ты — легенда этого леса."
            : `«${chain[current].title}»: ${chain[current].desc}`;
    }
    function toggleLog() {
        logOpen = !logOpen;
        if (logOpen) refreshLog();
        log.visible = logOpen;
    }

    // ===== Объявления: очередь плашек сверху экрана ============================
    const notif = new PIXI.Container();
    const notifBg = new PIXI.Graphics();
    const notifLabel = new PIXI.Text({ text: "", style: { fontFamily: FONT, fontSize: 24, fill: "#ffd98e" } });
    notifLabel.anchor.set(0.5);
    notif.addChild(notifBg, notifLabel);
    notif.visible = false;
    root.addChild(notif);
    const notifQueue = [];
    let notifLife = 0;
    function announce(str, color = "#ffd98e") { notifQueue.push({ str, color }); }
    function startNotif(item) {
        notifLabel.text = item.str;
        notifLabel.style.fill = item.color;
        notifBg.clear()
            .roundRect(-notifLabel.width / 2 - 14, -18, notifLabel.width + 28, 36, 8)
            .fill({ color: 0x140f08, alpha: 0.85 })
            .stroke({ width: 2, color: 0x6b4a2f });
        notif.visible = true;
        notif.alpha = 1;
        notifLife = 2.8;
    }

    // ===== Событие «герой убил врага вида kind» (от combat.onKill) =============
    function notifyKill(kind) {
        if (allDone) return;
        const q = chain[current];
        if (!q || q.level) return; // активное задание не про убийства
        if (q.kind !== "any" && q.kind !== kind) return;
        progress += 1;
        if (progress >= q.need) { complete(); return; }
        refreshTracker();
        const pos = heroPos ? heroPos() : null;
        if (pos) fx.text(pos.x + (Math.random() * 18 - 9), pos.y - 46,
            `${progress}/${q.need}`, { color: "#a8e05f", size: 20, life: 0.9, rise: 30 });
        if (logOpen) refreshLog();
    }

    // ===== Выполнение: награда опытом, объявление, следующее задание ===========
    function complete() {
        const q = chain[current];
        state[current] = DONE;
        if (q.reward && heroId != null) combat.giveXp(heroId, q.reward);
        const pos = heroPos ? heroPos() : null;
        if (pos) fx.text(pos.x, pos.y - 56, `+${q.reward} опыта`,
            { color: "#ffd98e", size: 24, life: 1.4, rise: 26 });
        announce(`Задание выполнено: «${q.title}» (+${q.reward} опыта)`, "#a8e05f");
        current += 1;
        if (current >= chain.length) {
            allDone = true;
            announce("Цепочка заданий завершена. Лес запомнит тебя!", "#ffd98e");
        } else {
            state[current] = ACTIVE;
            progress = 0;
            announce(`Новое задание: «${chain[current].title}»`);
        }
        refreshTracker();
        if (logOpen) refreshLog();
    }

    // ===== Кадр: объявления + опрос заданий «достичь уровня» ===================
    function update(ticker) {
        const dt = Math.min((ticker && ticker.deltaMS) || 1000 / 60, 50) / 1000;
        if (notif.visible) {
            notifLife -= dt;
            notif.alpha = Math.min(1, notifLife / 0.5); // затухание в конце
            if (notifLife <= 0) { notif.visible = false; notif.alpha = 1; }
        }
        if (!notif.visible && notifQueue.length) startNotif(notifQueue.shift());
        if (allDone) return;
        const q = chain[current];
        if (q.level) {
            const lvl = heroLevel();
            if (lvl !== progress) {
                progress = lvl;
                refreshTracker();
                if (logOpen) refreshLog();
            }
            if (progress >= q.level) complete();
        }
    }
    if (addSystem) addSystem(update); // если сцены не управляют вызовом сами

    // ===== Раскладка при resize: трекер к правому краю, журнал по центру ======
    function place() {
        tracker.position.set(app.screen.width - TRACK_W - 24, 76);
        log.position.set(
            Math.round((app.screen.width - LOG_W) / 2),
            Math.round((app.screen.height - LOG_H) / 2),
        );
        notif.position.set(Math.round(app.screen.width / 2), 96);
    }

    refreshTracker();
    refreshLog();
    place();
    // Первое задание объявляется при входе в игру: очередь плашек drain'ится
    // только в игровом кадре, поэтому banner покажется после «Продолжить»
    announce(`Новое задание: «${chain[0].title}»`);

    return {
        notifyKill, update, toggleLog, isLogOpen: () => logOpen,
        show: (v) => { root.visible = v; }, place, refreshTracker,
        snapshot: () => ({ current, progress, allDone, logOpen, states: state.slice(), chain }),
    };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createQuests = createQuests;
