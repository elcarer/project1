// ЭФФЕКТЫ — частицы и всплывающий текст, всё через дженерик-пул (pool.js):
// ни один спрайт/текст не создаётся в бою после прогрева.
//
// Пример:
//   const fx = createFX({ app, layer: engine.worldContainer, addSystem });
//   fx.burst(x, y, { count: 20, color: 0xff8833, speed: 200 });   // взрыв
//   fx.text(x, y, "-15", { color: "#ff5555" });                    // цифра урона

function createFX({ app, layer, addSystem }) {
    // Одна текстура на все частицы: белый круг, цвет задаётся tint (без перегенерации)
    const circle = new PIXI.Graphics().circle(0, 0, 4).fill(0xffffff);
    const particleTexture = app.renderer.generateTexture(circle);

    // Активные частицы (спрайты + их параметры полёта)
    const activeParticles = [];
    const particlePool = createPool(() => {
        const sprite = new PIXI.Sprite(particleTexture);
        sprite.anchor.set(0.5);
        sprite.visible = false;
        layer.addChild(sprite);
        return sprite;
    }, (sprite) => { sprite.visible = false; });

    // Активные всплывающие тексты
    const activeTexts = [];
    const textPool = createPool(() => {
        const label = new PIXI.Text({
            text: "",
            style: { fontFamily: globalThis.GAME_FONT || "monospace", fontSize: 14, fill: 0xffffff },
        });
        label.anchor.set(0.5);
        label.visible = false;
        layer.addChild(label);
        return label;
    }, (label) => { label.visible = false; });

    // Взрыв/брызги частиц
    // opts: { count, color, speedMin, speedMax, lifeMin, lifeMax, size, gravity }
    function burst(x, y, opts = {}) {
        const count = opts.count ?? 12;
        const speedMin = opts.speedMin ?? 40;
        const speedMax = opts.speedMax ?? 160;
        const lifeMin = opts.lifeMin ?? 0.3;
        const lifeMax = opts.lifeMax ?? 0.7;
        for (let i = 0; i < count; i++) {
            const sprite = particlePool.acquire();
            const angle = rand(0, TAU);
            const speed = rand(speedMin, speedMax);
            const life = rand(lifeMin, lifeMax);
            sprite.visible = true;
            sprite.tint = opts.color ?? 0xffffff;
            sprite.x = x; sprite.y = y;
            sprite.width = sprite.height = (opts.size ?? 1) * 8;
            sprite.alpha = 1;
            activeParticles.push({
                sprite,
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: opts.gravity ?? 0,
                life, maxLife: life,
            });
        }
    }

    // Всплывающий текст (цифры урона, "+10 HP" и т.п.)
    // opts: { color, size, life, rise } — rise: сколько пикселей вверх всплывает
    function text(x, y, str, opts = {}) {
        const label = textPool.acquire();
        label.visible = true;
        label.text = str;
        if (opts.color !== undefined) label.style.fill = opts.color;
        if (opts.size !== undefined) label.style.fontSize = opts.size;
        label.x = x; label.y = y;
        label.alpha = 1;
        const life = opts.life ?? 0.8;
        activeTexts.push({ label, life, maxLife: life, rise: opts.rise ?? 30 });
    }

    function updateParticles(dt) {
        for (let i = activeParticles.length - 1; i >= 0; i--) {
            const p = activeParticles[i];
            p.life -= dt;
            if (p.life <= 0) {
                particlePool.release(p.sprite);
                activeParticles[i] = activeParticles[activeParticles.length - 1];
                activeParticles.pop();
                continue;
            }
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.sprite.x = p.x;
            p.sprite.y = p.y;
            // Затухание прозрачности и сжатие к концу жизни
            const t = p.life / p.maxLife;
            p.sprite.alpha = t;
        }
    }

    function updateTexts(dt) {
        for (let i = activeTexts.length - 1; i >= 0; i--) {
            const t = activeTexts[i];
            t.life -= dt;
            if (t.life <= 0) {
                textPool.release(t.label);
                activeTexts[i] = activeTexts[activeTexts.length - 1];
                activeTexts.pop();
                continue;
            }
            t.label.y -= t.rise * dt;
            t.label.alpha = t.life / t.maxLife;
        }
    }

    function update(ticker) {
        const dt = ticker.deltaMS / 1000;
        updateParticles(dt);
        updateTexts(dt);
    }
    if (addSystem) addSystem(update);

    return { burst, text, update, get activeCount() { return activeParticles.length + activeTexts.length; }, pools: { particlePool, textPool } };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
// createPool/TAU/rand приходят глобалями (script-порядок: math, pool до fx)
globalThis.createFX = createFX;
