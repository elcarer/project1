# Вшивание иконок способностей для file:// (картинка с диска — чужой origin
# для GPU, см. dac9e44). Собирает иконки боевых наборов героев
# (HERO_ABILITIES в data/abilities.js) в scripts/embedded_abilities.js —
# глобаль EMBED_ABILITIES. Новое умение — добавить его icon сюда и
# перезапустить: python scripts/make_embedded_abilities.py
import base64
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = [
    # Плут
    "rogue/14",   # Веерный бросок
    "rogue/12",   # Крюк-кошка
    "rogue/4",    # Теневое скольжение
    # Волшебница
    "sorca/13",   # Огненный шар
    "sorca/7",    # Мороз
    "sorca/2",    # Метеорит
    # Рыцарь
    "knight/4",   # Заряженная атака
    "knight/2",   # Восстановление
    "knight/14",  # Казнь
    # Валькирия
    "valca/13",   # Пронзающий рывок
    "valca/7",    # Разгон
    "valca/3",    # Аура восстановления
]
OUT = os.path.join(ROOT, "scripts", "embedded_abilities.js")

parts = []
for key in ICONS:
    path = os.path.join(ROOT, "images", "abilities", *key.split("/")) + ".png"
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    parts.append(f'    "{key}": "data:image/png;base64,{b64}",')

js = (
    "// ВШИТЫЕ ИКОНКИ СПОСОБНОСТЕЙ (file://) — генератор scripts/make_embedded_abilities.py,\n"
    "// не править руками. По http не используются (живые файлы images/abilities).\n"
    "globalThis.EMBED_ABILITIES = {\n" + "\n".join(parts) + "\n};\n"
)
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(js)
print(f"OK {OUT}: {len(ICONS)} icon(s), {len(js)//1024} KB")
