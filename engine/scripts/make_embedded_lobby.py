# Вшивание артов ЛОББИ для file:// (картинка с диска — чужой origin для GPU,
# см. dac9e44). Собирает портреты-куклы героев (images/heroes/doll/) в
# scripts/embedded_lobby.js — глобаль EMBED_LOBBY.dolls. По http не
# используются (живые файлы). Запуск: python scripts/make_embedded_lobby.py
import base64
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOLLS = ["rogue", "sorca", "knight", "valca"]  # ключи HERO_CLASSES
OUT = os.path.join(ROOT, "scripts", "embedded_lobby.js")

parts = []
for key in DOLLS:
    path = os.path.join(ROOT, "images", "heroes", "doll", key + ".png")
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    parts.append(f'        "{key}": "data:image/png;base64,{b64}",')

js = (
    "// ВШИТЫЕ ПОРТРЕТЫ ЛОББИ (file://) — генератор scripts/make_embedded_lobby.py,\n"
    "// не править руками. По http не используются (живые файлы images/heroes/doll).\n"
    "globalThis.EMBED_LOBBY = {\n"
    "    dolls: {\n" + "\n".join(parts) + "\n    },\n};\n"
)
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(js)
print(f"OK {OUT}: {len(DOLLS)} doll(s), {len(js)//1024} KB")
