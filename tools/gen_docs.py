#!/usr/bin/env python3
"""Генератор таблиц дизайн-библии из machine-readable канона.

Запуск:  python3 tools/gen_docs.py
Вход:    data/classes.json, data/canon.json
Выход:   docs/05-classes.md (подстановка плейсхолдеров {{TABLE:id:kind}}),
         assets/charts/classes-summary.svg (сводная схема ролей)

Правило студии: числовые и именные данные правятся ТОЛЬКО в data/*.json,
Markdown пересобирается. Это исключает рассинхрон между GDD, клиентом и балансом.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLASSES = json.loads((ROOT / "data/classes.json").read_text(encoding="utf-8"))
CANON = json.loads((ROOT / "data/canon.json").read_text(encoding="utf-8"))


def esc(text: object) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def skills_table(c: dict) -> str:
    rows = ["| Навык | Тип | КД, с | Ресурс | Коэфф. ×ATK | Эффект |",
            "|---|---|---|---|---|---|"]
    for s in c["skills"]:
        rows.append(
            f"| **{esc(s['name'])}** | {esc(s['type'])} | {esc(s['cd'])} | "
            f"{esc(s['cost'])} | {s['coeff']:.2f} | {esc(s['effect'])} |"
        )
    return "\n".join(rows)


def specs_table(c: dict) -> str:
    rows = ["| Специализация | Фокус | Ключевой пассив | Ультимейт / КД | Эффект ультимейта |",
            "|---|---|---|---|---|"]
    for s in c["specs"]:
        rows.append(
            f"| **{esc(s['name'])}** (`{s['id']}`) | {esc(s['focus'])} | {esc(s['passive'])} | "
            f"**{esc(s['ultimate']['name'])}** / {s['ultimate']['cd']} с | {esc(s['ultimate']['effect'])} |"
        )
    return "\n".join(rows)


def talents_table(c: dict) -> str:
    branches = c["talent_branches"]
    head = "| Ярус (Ур./Парагон) | " + " | ".join(f"**{b['name']}**" for b in branches) + " |"
    sep = "|---|" + "---|" * len(branches)
    unlock = [8, 16, 24, 32, 40, 50, 60, "Парагон 50"]
    rows = [head, sep]
    for i in range(8):
        rows.append(f"| {unlock[i]} | " + " | ".join(esc(b["nodes"][i]) for b in branches) + " |")
    rows.append("")
    rows.append(
        f"*Каждый узел имеет 3 ранга. Всего на класс: {sum(len(b['nodes']) for b in branches)} узлов "
        f"× 3 ранга = {sum(len(b['nodes']) for b in branches) * 3} очков; "
        "ключевые узлы ярусов 3/6/8 открывают по одному дополнительному активному навыку.*"
    )
    return "\n".join(rows)


def role_chart() -> str:
    """Простая SVG-диаграмма: 6 классов по осям «риск позиционирования» / «устойчивый урон»."""
    pts = [
        ("Воин", 0.18, 0.62, "#e8b25c"), ("Паладин", 0.15, 0.48, "#f0d27a"),
        ("Ассасин", 0.92, 0.30, "#8b6cc0"), ("Лучник", 0.62, 0.82, "#7fd6d0"),
        ("Маг", 0.72, 0.58, "#4fd6d0"), ("Некромант", 0.48, 0.92, "#b06fd0"),
    ]
    w, h, pad = 760, 480, 70
    def X(v): return pad + v * (w - 2 * pad)
    def Y(v): return h - pad - v * (h - 2 * pad)
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">',
        '<rect width="100%" height="100%" fill="#0d141c"/>',
        '<g stroke="#2c3b48" stroke-width="1">',
    ]
    for i in range(1, 5):
        out.append(f'<line x1="{X(i/5):.0f}" y1="{pad}" x2="{X(i/5):.0f}" y2="{h-pad}"/>')
        out.append(f'<line x1="{pad}" y1="{Y(i/5):.0f}" x2="{w-pad}" y2="{Y(i/5):.0f}"/>')
    out.append('</g>')
    out.append(f'<line x1="{pad}" y1="{h-pad}" x2="{w-pad}" y2="{h-pad}" stroke="#9fb4c0" stroke-width="2"/>')
    out.append(f'<line x1="{pad}" y1="{pad}" x2="{pad}" y2="{h-pad}" stroke="#9fb4c0" stroke-width="2"/>')
    out.append(f'<text x="{w/2}" y="{h-22}" fill="#b9c9d2" font-family="Arial" font-size="13" text-anchor="middle">Риск позиционирования →</text>')
    out.append(f'<text x="18" y="{h/2}" fill="#b9c9d2" font-family="Arial" font-size="13" transform="rotate(-90 18 {h/2})" text-anchor="middle">Устойчивый урон →</text>')
    for name, x, y, color in pts:
        cx, cy = X(x), Y(y)
        out.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="16" fill="{color}" fill-opacity=".28" stroke="{color}" stroke-width="2.5"/>')
        out.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="4" fill="{color}"/>')
        out.append(f'<text x="{cx+22:.0f}" y="{cy+5:.0f}" fill="#e9e2d2" font-family="Arial" font-size="13">{name}</text>')
    out.append('<text x="70" y="34" fill="#f0d27a" font-family="Arial" font-size="16" font-weight="bold">Пространство ролей ARKEON · 6 классов</text>')
    out.append('</svg>')
    return "\n".join(out)


def main() -> None:
    target = ROOT / "docs/05-classes.md"
    text = target.read_text(encoding="utf-8")
    lookup = {c["id"]: c for c in CLASSES["classes"]}
    made = 0
    for cid, c in lookup.items():
        for kind, builder in (("skills", skills_table), ("specs", specs_table), ("talents", talents_table)):
            # основной путь: маркеры <!-- GEN:cid:kind --> … <!-- END GEN -->
            start = f"<!-- GEN:{cid}:{kind} -->"
            end = "<!-- END GEN -->"
            marker_re = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
            if marker_re.search(text):
                text = marker_re.sub(lambda _m, s=start, e=end, b=builder(c):
                                     f"{s}\n\n{b}\n\n{e}", text, count=1)
                made += 1
                continue
            # путь первого запуска: плейсхолдер {{TABLE:cid:kind}}
            ph = "{{TABLE:%s:%s}}" % (cid, kind)
            if ph in text:
                text = text.replace(ph, f"<!-- GEN:{cid}:{kind} -->\n\n{builder(c)}\n\n<!-- END GEN -->")
                made += 1
    target.write_text(text, encoding="utf-8")
    chart = ROOT / "assets/charts/classes-summary.svg"
    chart.parent.mkdir(parents=True, exist_ok=True)
    chart.write_text(role_chart(), encoding="utf-8")

    remaining = [w for w in text.split() if w.startswith("{{TABLE:")]
    print(f"gen_docs: подставлено таблиц: {made}; классов: {len(lookup)}; "
          f"навыков: {sum(len(c['skills']) for c in lookup.values())}; "
          f"узлов талантов: {sum(sum(len(b['nodes']) for b in c['talent_branches']) for c in lookup.values())}")
    print(f"gen_docs: chart -> {chart.relative_to(ROOT)}")
    if remaining:
        print("ВНИМАНИЕ: незаполненные плейсхолдеры:", remaining[:5])
    else:
        print("gen_docs: все плейсхолдеры заполнены OK")


if __name__ == "__main__":
    main()
