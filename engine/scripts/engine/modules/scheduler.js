// ПЛАНИРОВЩИК — отложенные и повторяющиеся действия (волны спавна, кулдауны,
// исчезающие эффекты). Работает в игровых секундах: update получает deltaMS тикера,
// поэтому таймеры стоят на паузе, если игра стоит на паузе.
//
// Пример:
//   const scheduler = createScheduler();
//   const cancelWave = scheduler.after(2, () => spawnWave());   // один раз через 2с
//   const stopPulse  = scheduler.every(0.5, () => flash());     // каждые 0.5с
//   cancelWave(); // отмена до срабатывания
function createScheduler() {
    // Отложенные: { time — сколько осталось, fn, every — период для повторяющихся или 0 }
    const timers = [];

    function add(delaySeconds, fn, everySeconds = 0) {
        const timer = { time: delaySeconds, every: everySeconds, fn, cancelled: false };
        timers.push(timer);
        // Функция отмены: таймер просто помечается и выпадет при ближайшем update
        return () => { timer.cancelled = true; };
    }

    // Один раз через delaySeconds
    function after(delaySeconds, fn) {
        return add(delaySeconds, fn, 0);
    }

    // Каждые intervalSeconds (первый сработает через intervalSeconds)
    function every(intervalSeconds, fn) {
        return add(intervalSeconds, fn, intervalSeconds);
    }

    // Вызывается из игрового цикла: engine.addSystem((ticker) => scheduler.update(ticker.deltaMS))
    function update(deltaMS) {
        const deltaSeconds = deltaMS / 1000;
        // Идём с конца: сработавший одноразовый таймер удаляем swap-and-pop,
        // и это не ломает индексы ещё не обработанных таймеров
        for (let i = timers.length - 1; i >= 0; i--) {
            const timer = timers[i];
            if (timer.cancelled) {
                timers[i] = timers[timers.length - 1];
                timers.pop();
                continue;
            }
            timer.time -= deltaSeconds;
            if (timer.time > 0) continue;
            try {
                timer.fn();
            } catch (error) {
                console.error('Ошибка в таймере планировщика:', error);
            }
            if (timer.every > 0 && !timer.cancelled) {
                // Повторяющийся: перезапускаем отсчёт. time может уйти в минус при
                // лаге кадра — прибавляем период, чтобы частота не «плыла»
                timer.time += timer.every;
            } else {
                timers[i] = timers[timers.length - 1];
                timers.pop();
            }
        }
    }

    // Полная очистка (например, при смене сцены)
    function clear() {
        timers.length = 0;
    }

    return { after, every, update, clear, get count() { return timers.length; } };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createScheduler = createScheduler;
