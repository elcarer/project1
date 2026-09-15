# Вшивание иконок способностей для file:// (картинка с диска — чужой origin
# для GPU, см. dac9e44). Собирает иконки боевых наборов героев
# (HERO_ABILITIES в data/abilities.js) в scripts/embedded_abilities.js —
# глобаль EMBED_ABILITIES. Новое умение — добавить его icon сюда и
# перезапустить: python scripts/make_embedded_abilities.py
import base64
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = [
    # Плут: активные (веер/крюк/скольжение) + пассивные узлы (яд/спина/мститель)
    "rogue/14", "rogue/12", "rogue/4", "rogue/13", "rogue/5", "rogue/8",
    # Волшебница: активные (шар/мороз/метеорит) + пассивные (отравлённый лёд/гримуар)
    "sorca/13", "sorca/7", "sorca/2", "sorca/11", "sorca/3",
    # Рыцарь: активные (заряженная/восстановление/казнь) + пассивные (защита/аура/противодействие)
    "knight/4", "knight/2", "knight/14", "knight/13", "knight/7", "knight/10",
    # Валькирия: активные (рывок/разгон/аура) + пассивный узел (ветряной щит)
    "valca/13", "valca/7", "valca/3", "valca/11",
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
