# -*- coding: utf-8 -*-
"""Вшивает игровой шрифт в engine/scripts/game_font.js (base64 data-URL).

Зачем: на file:// внешний .ttf — чужой origin, браузер блокирует загрузку
шрифта через @font-face. Вшитый data-URL работает и по http, и с file://.
Источник: forWork/MixSerifCondenseRUSbyDumpyCats-Condense.ttf (игровой шрифт,
все надписи игры должны использовать его — слова пользователя).

Запуск: python engine/scripts/make_game_font.py
"""
import base64
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]  # корень проекта
SRC = ROOT / "forWork" / "MixSerifCondenseRUSbyDumpyCats-Condense.ttf"
DST = ROOT / "engine" / "scripts" / "game_font.js"
FAMILY = "MixSerifCondenseRUS"

def main() -> None:
    data = base64.b64encode(SRC.read_bytes()).decode("ascii")
    js = f"""// ИГРОВОЙ ШРИФТ — «{SRC.name}» вшит base64: на file:// внешний ttf — чужой
// origin, и браузер блокирует @font-face; data-URL работает при любом origin.
// Генерируется scripts/make_game_font.py (источник — forWork/*.ttf).
// Использование: в game.js ДО создания надписей — `await loadGameFont();`,
// дальше в стилях PIXI.Text — fontFamily: GAME_FONT.
const GAME_FONT_DATA = "data:font/ttf;base64,{data}";
globalThis.GAME_FONT = "{FAMILY}";
globalThis.loadGameFont = async () => {{
    const face = new FontFace(globalThis.GAME_FONT, `url(${{GAME_FONT_DATA}})`);
    await face.load();
    document.fonts.add(face);
    return globalThis.GAME_FONT;
}};

// Подключение двумя способами (файл без import/export валиден и как ES-модуль):
//   1) обычный <script src="..."> — глобали (работает и на file://);
//   2) import "./файл.js" — глобали ставятся как побочный эффект.
"""
    DST.write_text(js, encoding="utf-8")
    print(f"{SRC.name} ({SRC.stat().st_size} bytes) -> {DST.name} ({DST.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
