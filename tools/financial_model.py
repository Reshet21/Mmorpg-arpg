#!/usr/bin/env python3
"""Финансовая модель ARKEON (5 лет, 54 месяца, точный итог $224 680 000).

Запуск: python3 tools/financial_model.py
Выход:  data/budget.csv, data/revenue_scenarios.csv,
         assets/charts/budget.svg, отчёт в stdout.

Правило: строка «Маркетинг Y5» вычисляется как остаток, чтобы итог бюджета
точно совпадал с data/canon.json → production.total_budget_usd.
"""
from __future__ import annotations
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
C = json.loads((ROOT / "data/canon.json").read_text(encoding="utf-8"))
TOTAL = C["production"]["total_budget_usd"]                 # 224 680 000
YEARS = ["2027 (Y1)", "2028 (Y2)", "2029 (Y3)", "2030 (Y4)", "2031 (Y5)"]

# Среднегодовой FTE по отделам (пиковый FTE = 252 в окне M38–M44, см. docs/13)
HEADCOUNT = {
    "Engineering (client/server/net)": [26, 45, 62, 70, 45],
    "Art (concept/3D/VFX/level)":     [14, 28, 40, 45, 26],
    "Design (systems/level/economy)": [10, 18, 25, 28, 20],
    "QA / Device farm":               [6, 12, 20, 26, 16],
    "Production / Leadership":        [3,  5,  7,  8,  6],
    "Publishing / Marketing":         [2,  5,  9, 18, 25],
    "DevOps / SRE / Security":        [4,  7, 12, 15, 12],
}
AVG_FTE = [sum(v[i] for v in HEADCOUNT.values()) for i in range(5)]   # 65/120/175/210/150
COST_PER_FTE = 142_500                                                  # blended fully-loaded
PAYROLL = [AVG_FTE[i] * COST_PER_FTE for i in range(5)]

ENGINE   = [1_600_000, 2_200_000, 2_800_000, 3_200_000, 2_800_000]
INFRA    = [  800_000, 1_600_000, 3_400_000, 8_200_000, 14_000_000]
OTHER    = [1_200_000, 2_000_000, 3_200_000, 5_000_000, 4_500_000]  # VO, локализация, юристы, QA-ферма
MARKETING_HEAD = [400_000, 800_000, 2_300_000, 21_000_000]           # Y5 — остаток ниже

# Точная подгонка под TOTAL с контингенси ~12%
partial = sum(PAYROLL) + sum(ENGINE) + sum(INFRA) + sum(OTHER) + sum(MARKETING_HEAD)
m5 = round(TOTAL / 1.12) - partial
MARKETING = MARKETING_HEAD + [m5]
subtotal = partial + m5
contingency = TOTAL - subtotal

CATEGORIES = {
    "Персонал (fully loaded)": PAYROLL,
    "Движок / лицензии / инструменты": ENGINE,
    "Инфраструктура / CDN / Live": INFRA,
    "VO / локализация / QA / юристы": OTHER,
    "Маркетинг / UA / комьюнити": MARKETING,
    "Контингенси (12%)": [0, 0, 0, 0, contingency],   # показываем в годе запуска целиком
}

# --- Сценарии выручки (помесячно на плато после глобального запуска) ---
PLATFORM_FEE = 0.27          # blended Google/Apple 30%, PC 20%, web 5%
MONTHLY_OPEX = 5_620_000     # infra 2.05M + live-ops payroll 1.78M + ongoing UA 1.42M + прочее 0.37M
SCENARIOS = [
    # name, MAU, DAU, ARPDAU, payer conversion
    ("Консервативный", 10_000_000, 2_000_000, 0.14, 0.032),
    ("Базовый (план)", 18_000_000, 3_600_000, 0.17, 0.042),
    ("Агрессивный",   30_000_000, 5_800_000, 0.22, 0.050),
]


def svg_budget() -> str:
    W, H, left, top, base = 940, 520, 70, 60, 430
    maxv = 80_000_000
    bw, gap = 118, 48
    colors = ["#e8b25c", "#4fd6d0", "#8b6cc0", "#7fd6d0", "#d6534f", "#f0d27a"]
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
        '<rect width="100%" height="100%" fill="#0d141c"/>',
        '<text x="24" y="32" fill="#f0d27a" font-family="Arial" font-size="17" font-weight="bold">ARKEON · бюджет по годам, $M (stacked)</text>',
        f'<line x1="{left}" y1="{base}" x2="{W-30}" y2="{base}" stroke="#9fb4c0"/>',
    ]
    for v in range(0, 81, 20):
        y = base - (base - top) * v / 80
        out.append(f'<line x1="{left}" y1="{y:.1f}" x2="{W-30}" y2="{y:.1f}" stroke="#243440"/>')
        out.append(f'<text x="{left-8}" y="{y+4:.1f}" fill="#8ba2b0" font-size="11" font-family="Arial" text-anchor="end">{v}</text>')
    for i, y in enumerate(YEARS):
        x = left + 30 + i * (bw + gap)
        acc = 0
        for j, (cat, vals) in enumerate(CATEGORIES.items()):
            val = vals[i]
            if not val:
                continue
            h = (base - top) * val / maxv
            out.append(f'<rect x="{x}" y="{base-acc-h:.1f}" width="{bw}" height="{h:.1f}" fill="{colors[j]}" fill-opacity=".85"/>')
            acc += h
        out.append(f'<text x="{x+bw/2:.0f}" y="{base+18}" fill="#c8d4d8" font-size="12" font-family="Arial" text-anchor="middle">{y[:4]}</text>')
        out.append(f'<text x="{x+bw/2:.0f}" y="{base-acc-8:.1f}" fill="#f0d27a" font-size="12" font-family="Arial" text-anchor="middle">${sum(v[i] for v in CATEGORIES.values())/1e6:.1f}M</text>')
    lx, ly = 74, 468
    for j, cat in enumerate(CATEGORIES):
        x = lx + (j % 3) * 300
        y = ly + (j // 3) * 20
        out.append(f'<rect x="{x}" y="{y-10}" width="12" height="12" fill="{colors[j]}"/>')
        out.append(f'<text x="{x+18}" y="{y}" fill="#c8d4d8" font-size="10.5" font-family="Arial">{cat}</text>')
    out.append('</svg>')
    return "\n".join(out)


def main() -> None:
    rows = []
    for i, y in enumerate(YEARS):
        for cat, vals in CATEGORIES.items():
            rows.append({"year": y, "avg_fte": AVG_FTE[i], "category": cat, "usd": vals[i]})
    with (ROOT / "data/budget.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["year", "avg_fte", "category", "usd"]); w.writeheader(); w.writerows(rows)

    rev = []
    for name, mau, dau, arpdau, conv in SCENARIOS:
        gross = dau * arpdau * 30
        payers = mau * conv
        arppu = gross / payers
        net = gross * (1 - PLATFORM_FEE)
        profit = net - MONTHLY_OPEX
        payback = TOTAL / profit if profit > 0 else float("inf")
        rev.append({
            "scenario": name, "mau": mau, "dau": dau, "arpdau_usd": arpdau,
            "payer_conversion": conv, "payers": round(payers), "arppu_monthly_usd": round(arppu, 2),
            "gross_monthly_usd": round(gross), "net_after_fees_usd": round(net),
            "monthly_operating_profit_usd": round(profit),
            "payback_months": round(payback, 1) if profit > 0 else "never",
            "gross_annual_usd": round(gross * 12),
        })
    with (ROOT / "data/revenue_scenarios.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rev[0].keys())); w.writeheader(); w.writerows(rev)
    chart = ROOT / "assets/charts/budget.svg"
    chart.parent.mkdir(parents=True, exist_ok=True)
    chart.write_text(svg_budget(), encoding="utf-8")

    print("=== ARKEON · financial_model ===")
    print(f"Средний FTE по годам: {AVG_FTE}  (пик 252 в M38–M44), fully loaded ${COST_PER_FTE:,}/FTE")
    for i, y in enumerate(YEARS):
        total = sum(v[i] for v in CATEGORIES.values())
        print(f"  {y}: FTE {AVG_FTE[i]:>3} | персонал ${PAYROLL[i]/1e6:>6.2f}M | маркетинг ${MARKETING[i]/1e6:>6.2f}M | итого ${total/1e6:>6.2f}M")
    print(f"  Subtotal ${subtotal:,} + контингенси ${contingency:,} ({100*contingency/subtotal:.2f}%) = ${subtotal+contingency:,}")
    assert subtotal + contingency == TOTAL, "Бюджет не совпадает с canon.json!"
    print(f"  ИТОГ: ${TOTAL:,} -> PASS (совпадает с canon.json)")
    print("--- Сценарии выручки на плато (ежемесячно) ---")
    for r in rev:
        print(f"  {r['scenario']:<20} MAU {r['mau']/1e6:>4.0f}M | gross ${r['gross_monthly_usd']/1e6:>6.2f}M/мес | "
              f"ARPPU ${r['arppu_monthly_usd']:>6.2f} | операционная прибыль ${r['monthly_operating_profit_usd']/1e6:>6.2f}M/мес | окупаемость {r['payback_months']} мес.")
    print(f"-> data/budget.csv | data/revenue_scenarios.csv | {chart.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
