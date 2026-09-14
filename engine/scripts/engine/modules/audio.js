// ЗВУК — обёртка над Web Audio API. PixiJS звука не имеет.
// Работает без аудиофайлов: синтезирует тоны и шум — для выстрелов, попаданий,
// взрывов на старте разработки этого достаточно. Файлы можно подключить позже.
//
// ВАЖНО: браузер разрешает звук только после жеста пользователя — вызовите
// audio.unlock() из обработчика клика/нажатия клавиши.
//
// Пример:
//   const audio = createAudio();
//   canvas.addEventListener('pointerdown', () => audio.unlock());
//   audio.tone({ freq: 880, dur: 0.08, type: "square" });            // «пиу»
//   audio.noise({ dur: 0.4, filterFreq: 400 });                      // «бум»
function createAudio() {
    let ctx = null;
    let masterVolume = 0.5;

    // Разблокировать AudioContext (обязательный первый вызов — из жеста юзера)
    function unlock() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (ctx.state === "suspended") ctx.resume();
        return ctx.state === "running";
    }

    function isReady() {
        return ctx !== null && ctx.state === "running";
    }

    // Тон: осциллятор с экспоненциальным затуханием. endFreq — скольжение частоты
    // (выстрел: 880 → 220). type: "square" | "sine" | "sawtooth" | "triangle"
    function tone({ freq = 440, endFreq = null, dur = 0.15, type = "square", volume = 0.2 } = {}) {
        if (!isReady()) return;
        const time = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), time + dur);
        gain.gain.setValueAtTime(volume * masterVolume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(time);
        osc.stop(time + dur);
    }

    // Шум: буфер случайных сэмплов через фильтр нижних частот (взрывы, попадания)
    function noise({ dur = 0.3, volume = 0.3, filterFreq = 800 } = {}) {
        if (!isReady()) return;
        const time = ctx.currentTime;
        const sampleCount = Math.floor(ctx.sampleRate * dur);
        const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < sampleCount; i++) {
            channel[i] = Math.random() * 2 - 1;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = filterFreq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume * masterVolume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(time);
    }

    // Именованные пресеты: audio.register("shoot", () => audio.tone({...}))
    const presets = new Map();
    function register(name, fn) { presets.set(name, fn); }
    function play(name) {
        const fn = presets.get(name);
        if (fn) fn();
    }

    function setVolume(v) { masterVolume = clamp01(v); }

    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    return { unlock, isReady, tone, noise, register, play, setVolume, get volume() { return masterVolume; } };
}

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
globalThis.createAudio = createAudio;
