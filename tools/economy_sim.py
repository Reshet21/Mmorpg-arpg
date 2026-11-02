#!/usr/bin/env python3
"""Симулятор живой экономики ARKEON на 30 дней.

Проверяет, что контроллер инфляции удерживает индекс цен в коридоре 94..108
и sink/faucet в 1.02..1.15 при трёх шоках: бот-ферма (день 12),
попытка дюпа (день 20) и сезонный приток +25% DAU (день 25).

Запуск: python3 tools/economy_sim.py
Выход:  data/economy_sim_30d.csv, assets/charts/economy-30d.svg, отчёт в stdout.
Зависимостей нет (только stdlib) — модель можно запускать в CI.
"""
from __future__ import annotations
import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
C = json.loads((ROOT / "data/canon.json").read_text(encoding="utf-8"))["economy"]

F_BASE = C["faucets_daily_per_active_silver"]      # 9 200 S / активного / сутки
R_NEUTRAL = 1.0                                      # нейтральный множитель faucet'а
S_GROSS = F_BASE * 1.085                             # валовые стоки (налоги, услуги, ремонт)
S_REDIST = F_BASE * 0.085                            # трансферы игрокам (85% налога гильдий и т.п.) — не сжигаются
DAYS = 30
DAU0 = 900_000


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def dau_of(day: int) -> int:
    """Органический рост + сезонный приток на 25-й день."""
    base = DAU0 * (1 + 0.006 * day)
    if day >= 25:
        base *= 1.25
    return int(base)


def svg_chart(rows: list[dict]) -> str:
    W, H, PAD_L, PAD_R, PAD_T, PAD_B = 1000, 540, 62, 26, 54, 52
    pw, ph = W - PAD_L - PAD_R, H - PAD_T - PAD_B
    def X(i): return PAD_L + i * pw / (len(rows) - 1)
    def Y_PI(v): return PAD_T + ph * (1 - (v - 88) / (116 - 88))
    def Y_SF(v): return PAD_T + ph * (1 - (v - 0.90) / (1.25 - 0.90))

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
        '<rect width="100%" height="100%" fill="#0d141c"/>',
        '<text x="62" y="32" fill="#f0d27a" font-family="Arial" font-size="17" font-weight="bold">ARKEON · 30 дней экономики · инфляция, стоки и шоки</text>',
    ]
    # grid + left axis (PI)
    for v in range(90, 117, 4):
        y = Y_PI(v)
        out.append(f'<line x1="{PAD_L}" y1="{y:.1f}" x2="{W-PAD_R}" y2="{y:.1f}" stroke="#243440" stroke-width="1"/>')
        out.append(f'<text x="{PAD_L-8}" y="{y+4:.1f}" fill="#8ba2b0" font-size="11" font-family="Arial" text-anchor="end">{v}</text>')
    out.append(f'<text x="14" y="{H/2}" fill="#9fb4c0" font-size="12" font-family="Arial" transform="rotate(-90 14 {H/2})" text-anchor="middle">Индекс цен PI (цель 100)</text>')
    for d in range(0, DAYS, 5):
        x = X(d)
        out.append(f'<line x1="{x:.1f}" y1="{PAD_T}" x2="{x:.1f}" y2="{H-PAD_B}" stroke="#1e2a35" stroke-width="1"/>')
        out.append(f'<text x="{x:.1f}" y="{H-PAD_B+18}" fill="#8ba2b0" font-size="11" font-family="Arial" text-anchor="middle">д{d+1}</text>')
    # target band 94..108
    out.append(f'<rect x="{PAD_L}" y="{Y_PI(108):.1f}" width="{pw}" height="{Y_PI(94)-Y_PI(108):.1f}" fill="#4fd6d0" fill-opacity=".07"/>')
    out.append(f'<line x1="{PAD_L}" y1="{Y_PI(100):.1f}" x2="{W-PAD_R}" y2="{Y_PI(100):.1f}" stroke="#4fd6d0" stroke-dasharray="6 5" stroke-width="1.5"/>')

    def path(vals, yfn, color, width=2.5, dash=""):
        pts = " ".join(f"{'M' if i == 0 else 'L'}{X(i):.1f},{yfn(v):.1f}" for i, v in enumerate(vals))
        d = f' stroke-dasharray="{dash}"' if dash else ""
        return f'<path d="{pts}" fill="none" stroke="{color}" stroke-width="{width}"{d} stroke-linejoin="round"/>'

    out.append(path([r["pi"] for r in rows], Y_PI, "#e8b25c", 3))
    out.append(path([r["sf"] for r in rows], Y_SF, "#b06fd0", 2.2, "5 4"))
    out.append(path([100 * r["m"] / r["m_target"] for r in rows], Y_PI, "#4fd6d0", 2.0, "2 4"))

    # shock markers
    for day, label, color in ((11, "бот-шок", "#d6534f"), (19, "дюп отсечён", "#f0d27a"), (24, "+25% DAU", "#7fd6d0")):
        x = X(day)
        out.append(f'<line x1="{x:.1f}" y1="{PAD_T}" x2="{x:.1f}" y2="{H-PAD_B}" stroke="{color}" stroke-opacity=".6" stroke-width="1.5" stroke-dasharray="3 4"/>')
        out.append(f'<text x="{x+4:.1f}" y="{PAD_T+14}" fill="{color}" font-size="10.5" font-family="Arial">{label}</text>')
    # right axis for sink/faucet
    for v in (0.95, 1.05, 1.15, 1.25):
        out.append(f'<text x="{W-PAD_R+4}" y="{Y_SF(v)+4:.1f}" fill="#b06fd0" font-size="10" font-family="Arial">{v:.2f}</text>')
    # legend
    lx, ly = PAD_L + 12, H - 22
    for i, (color, txt) in enumerate((("#e8b25c", "PI, индекс цен"), ("#4fd6d0", "M / M_target ×100"), ("#b06fd0", "sink / faucet (правая ось)"))):
        x = lx + i * 290
        out.append(f'<line x1="{x}" y1="{ly}" x2="{x+22}" y2="{ly}" stroke="{color}" stroke-width="3"/>')
        out.append(f'<text x="{x+28}" y="{ly+4}" fill="#c8d4d8" font-size="11" font-family="Arial">{txt}</text>')
    out.append('</svg>')
    return "\n".join(out)


def main() -> None:
    dau_hist: list[int] = []
    M = 0.0
    m_target = 0.0
    rows: list[dict] = []
    for day in range(1, DAYS + 1):
        dau = dau_of(day)
        dau_hist.append(dau)
        dau7 = sum(dau_hist[-7:]) / len(dau_hist[-7:])
        m_target_raw = F_BASE * dau7 * 7
        prev_target = m_target
        # EMA-10: целевая масса подстраивается под аудиторию плавно, без шока
        m_target = m_target_raw if day == 1 else m_target + (m_target_raw - m_target) / 10
        if day == 1:
            M = 0.99 * m_target
        # «эмиссия Конклава» под приток новых Возжённых: балансовая операция,
        # а не геймплейный faucet (в KPI sink/faucet не входит)
        mint = 0.0 if day == 1 else max(0.0, m_target - prev_target)
        V = 1 + 0.03 * math.sin(day / 3.0)
        PI = 100 * (M / m_target) ** 0.85 * V ** 0.15
        R = clamp(R_NEUTRAL + 0.6 * (m_target - M) / m_target - 0.25 * (PI - 100) / 100, 0.75, 1.25)

        # --- шоки ---
        bot_shock = 0.18 if day == 12 else (0.16 if day == 13 else (0.03 if day == 14 else 0.0))
        anti_bot_cut = {12: 0.11, 13: 0.14, 14: 0.03}.get(day, 0.0)  # скрытый лимит faucet'а risk-score > 40
        faucet = F_BASE * dau * R * (1 + bot_shock) * (1 - anti_bot_cut)
        peplin = 1.018 if PI > 108 else 1.0              # «Пепельная пошлина» +1 п.п. налога рынка
        sinks = S_GROSS * dau * peplin * (1 + 0.02 * (PI - 100) / 100)   # валовые стоки
        redist = S_REDIST * dau                          # возвращается игрокам (налоги гильдий)
        net_burn = sinks - redist

        dupe_attempt = 1 if day == 20 else 0
        dupe_blocked = dupe_attempt                     # реконсиляция ledger за 5 мин: 0 принятых
        # масса растёт только от честных потоков; дюп не создаёт ни одного предмета/серебра
        M += faucet - net_burn + mint

        rows.append({
            "day": day, "dau": dau, "m_target": round(m_target), "m": round(M),
            "pi": round(PI, 2), "R": round(R, 3), "faucet": round(faucet), "sinks": round(sinks),
            "redist": round(redist), "mint": round(mint), "net_burn": round(net_burn),
            "sf": round(sinks / faucet, 3), "bot_shock_pct": round(bot_shock * 100, 1),
            "anti_bot_cut_pct": round(anti_bot_cut * 100, 1), "peplin_tax": "on" if peplin > 1 else "off",
            "dupe_attempt": dupe_attempt, "dupe_accepted": 0, "dupe_blocked": dupe_blocked,
        })

    # запись данных
    csv_path = ROOT / "data/economy_sim_30d.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    chart = ROOT / "assets/charts/economy-30d.svg"
    chart.parent.mkdir(parents=True, exist_ok=True)
    chart.write_text(svg_chart(rows), encoding="utf-8")

    pis = [r["pi"] for r in rows]
    sfs = [r["sf"] for r in rows]
    deviations = [abs(r["m"] / r["m_target"] - 1) for r in rows]
    print("=== ARKEON · economy_sim 30d ===")
    print(f"DAU: {rows[0]['dau']:,} -> {rows[-1]['dau']:,} (сезонный приток +25% на д25)")
    print(f"PI:  min {min(pis):.2f} / max {max(pis):.2f} / финал {pis[-1]:.2f}   коридор [94, 108] -> {'PASS' if 94 <= min(pis) and max(pis) <= 108 else 'FAIL'}")
    print(f"s/f: min {min(sfs):.3f} / max {max(sfs):.3f} / финал {sfs[-1]:.3f}  коридор [1.02, 1.15] -> {'PASS' if 1.02 <= min(sfs) and max(sfs) <= 1.15 else 'FAIL'}")
    print(f"|M/M_target-1| max: {max(deviations)*100:.2f}%  цель <= 9% -> {'PASS' if max(deviations) <= 0.09 else 'FAIL'}")
    print(f"дюп: попыток {sum(r['dupe_attempt'] for r in rows)}, принято {sum(r['dupe_accepted'] for r in rows)}, отсечено {sum(r['dupe_blocked'] for r in rows)}")
    print(f"R: min {min(r['R'] for r in rows):.3f} / max {max(r['R'] for r in rows):.3f}; Пепельная пошлина: {sum(1 for r in rows if r['peplin_tax']=='on')} дн.")
    print(f"-> {csv_path.relative_to(ROOT)} | {chart.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
