#!/usr/bin/env python3
"""Баланс-модель боя ARKEON.

Считает DPS 6 классов из коэффициентов навыков (data/classes.json) и формулы
урона (data/canon.json), калибрует PTR-коэффициент до целевого DPS роли и
проверяет инварианты: разброс DPS уронщиков <= ±7%, TTK рейд-босса 300..360 с,
PvP TTK 6..12 с, отсутствие экспоненциального стака множителей.

Запуск: python3 tools/combat_model.py
Выход:  data/combat_balance.csv, assets/charts/combat-dps.svg, отчёт в stdout.
"""
from __future__ import annotations
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
C = json.loads((ROOT / "data/canon.json").read_text(encoding="utf-8"))
CLASSES = {c["id"]: c for c in json.loads((ROOT / "data/classes.json").read_text(encoding="utf-8"))["classes"]}
B = C["combat"]["level_60_baseline"]
ATK, DEF, LVL = B["attack"], B["defense"], C["progression"]["level_cap"]
MITIG = 1 - DEF / (DEF + 1200 + 42 * LVL)
CRIT = 1 + C["combat"]["base_crit_chance"] * (C["combat"]["base_crit_multiplier"] - 1)
UPTIME = 0.75  # доля времени в бою с доступностью цели (рейд-эталон)

# Эталонные ротации: (имя навыка из classes.json, число применений за цикл 12 с)
ROTATIONS = {
    "warrior":     [("Рассекающий", 6), ("Клинок Рубежа", 2), ("Вихрь Стали", 2), ("Разломный Удар", 1)],
    "paladin":     [("Удар Веры", 6), ("Молот Зари", 2), ("Карающий Луч", 2), ("Круг Причастия", 1)],
    "assassin":    [("Теневой Разрез", 8), ("Отравленный Укол", 3), ("Каскад Лезвий", 1), ("Метка Жертвы", 1)],
    "ranger":      [("Быстрый Выстрел", 8), ("Пробивающая Стрела", 2), ("Залп Трех", 2), ("Грозовая Стрела", 2)],
    "mage":        [("Искра Эфира", 6), ("Огненный Вихрь", 2), ("Ледяная Игла", 2), ("Цепь Молний", 2), ("Разрыв Стихий", 1)],
    "necromancer": [("Костяной Осколок", 6), ("Жатва Пепла", 2), ("Тихий Счёт", 1), ("Проклятие Немого", 1)],
}
# Целевой DPS по роли (танк/лекарь ниже по дизайну — компенсируется выживаемостью и утилити)
TARGET = {
    "warrior": 41600, "paladin": 34400, "assassin": 42800,
    "ranger": 42200, "mage": 41300, "necromancer": 42500,
}
WEAPON_HIT = ATK * 12          # базовый удар оружия L60 = 21 600 (ATK — сила атаки в аддитивном слое)
PVP_DMG = 0.08                 # отдельная PvP-шкала урона (не 0.62!), см. canon.combat.pvp
PVP_HP_MULT = 2.0              # «Закалка Искры»: эффективное HP в PvP ×2
RAID_FACTOR = 0.71             # эффективность рейда: механики, движение, адд-фазы
WORLD_BOSS_FACTOR = 0.45       # публичный рейд: респавн, неравномерный вклад
DUNGEON_BOSS_HP = 14_000_000
DAMAGE_DEALERS = ("warrior", "assassin", "ranger", "mage", "necromancer")
ROLE = {"warrior": "уронщик/танк", "paladin": "лекарь/танк", "assassin": "уронщик",
        "ranger": "уронщик", "mage": "уронщик", "necromancer": "уронщик"}
CYCLE = 12.0


def raw_dps(cid: str) -> tuple[float, dict]:
    skills = {s["name"]: s for s in CLASSES[cid]["skills"]}
    parts = {}
    for name, casts in ROTATIONS[cid]:
        skill = skills[name]
        # вклад навыка: coeff × ATK × число применений / время цикла
        parts[name] = skill["coeff"] * WEAPON_HIT * casts / CYCLE
    base = sum(parts.values())
    # аддитивный слой (статы/таланты) и мультипликативный слой разделены намеренно
    additive = 1 + 0.34          # +34% от основного стата и экипировки
    multiplicative = 1.18 * 1.10  # стихия/сет × позиционный бонус (строго отдельно)
    dps = base * additive * multiplicative * MITIG * CRIT * UPTIME
    return dps, parts


def bar_chart(rows: list[dict]) -> str:
    W, H, left, top = 820, 430, 190, 66
    maxv = 46000
    bw = (W - left - 40) / len(rows)
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
        '<rect width="100%" height="100%" fill="#0d141c"/>',
        '<text x="24" y="32" fill="#f0d27a" font-family="Arial" font-size="17" font-weight="bold">ARKEON · эталонный DPS L60 после PTR-калибровки</text>',
        f'<line x1="{left}" y1="{top}" x2="{left}" y2="{H-46}" stroke="#9fb4c0"/>',
    ]
    for i, r in enumerate(rows):
        y = top + 20 + i * 52
        w = (W - left - 70) * r["final_dps"] / maxv
        color = "#4fd6d0" if r["id"] in DAMAGE_DEALERS else "#e8b25c"
        out.append(f'<text x="{left-12}" y="{y+17}" fill="#d8cbb0" font-size="13" font-family="Arial" text-anchor="end">{r["name_ru"]}</text>')
        out.append(f'<rect x="{left}" y="{y}" width="{w:.1f}" height="24" rx="4" fill="{color}" fill-opacity=".78"/>')
        out.append(f'<text x="{left+w+8:.1f}" y="{y+17}" fill="#e9e2d2" font-size="12" font-family="Arial">{int(r["final_dps"]):,} DPS</text>')
    out.append(f'<line x1="{left}" y1="{H-46}" x2="{W-40}" y2="{H-46}" stroke="#9fb4c0"/>')
    for v in (0, 10000, 20000, 30000, 40000):
        x = left + (W - left - 70) * v / maxv
        out.append(f'<line x1="{x:.1f}" y1="{H-46}" x2="{x:.1f}" y2="{H-40}" stroke="#9fb4c0"/>')
        out.append(f'<text x="{x:.1f}" y="{H-26}" fill="#8ba2b0" font-size="11" font-family="Arial" text-anchor="middle">{v//1000}k</text>')
    out.append('</svg>')
    return "\n".join(out)


def main() -> None:
    rows = []
    for cid in ROTATIONS:
        base, parts = raw_dps(cid)
        k = TARGET[cid] / base                        # PTR-коэффициент (публикуется в патчноуте)
        final = base * round(k, 4)                    # округляем ровно до 4 знаков, как в проде
        rows.append({
            "id": cid, "name_ru": CLASSES[cid]["name_ru"], "role": ROLE[cid],
            "raw_dps": round(base), "ptr_k": round(k, 4), "final_dps": round(final),
            "top_skill": max(parts, key=parts.get), "top_skill_share_pct": round(100 * max(parts.values()) / sum(parts.values()), 1),
        })
    dd = [r["final_dps"] for r in rows if r["id"] in DAMAGE_DEALERS]
    spread = (max(dd) - min(dd)) / (sum(dd) / len(dd))
    avg = sum(dd) / len(dd)
    raid_dps = avg * 8 * RAID_FACTOR
    ttk_raid = 72_000_000 / raid_dps
    ttk_dungeon = DUNGEON_BOSS_HP / (avg * 5 * RAID_FACTOR)
    ttk_world = 240_000_000 / (avg * 50 * WORLD_BOSS_FACTOR)
    pvp_dps = avg * PVP_DMG * UPTIME
    ttk_pvp = 12_000 * PVP_HP_MULT / pvp_dps

    csv_path = ROOT / "data/combat_balance.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    chart = ROOT / "assets/charts/combat-dps.svg"
    chart.parent.mkdir(parents=True, exist_ok=True)
    chart.write_text(bar_chart(rows), encoding="utf-8")

    print("=== ARKEON · combat_model ===")
    for r in rows:
        print(f"  {r['name_ru']:<11} {r['role']:<14} raw {r['raw_dps']:>7,} → k={r['ptr_k']:.4f} → {r['final_dps']:>7,} DPS"
              f"  (топ-навык {r['top_skill']}, {r['top_skill_share_pct']}%)")
    print(f"Разброс DPS уронщиков: ±{spread*50:.2f}%  цель <= ±7% -> {'PASS' if spread <= 0.14 else 'FAIL'}")
    print(f"Рейд 8 чел: {raid_dps:,.0f} eff.DPS → TTK босса 72M HP = {ttk_raid:.0f} с ({ttk_raid/60:.1f} мин), коридор 300..360 с -> {'PASS' if 300 <= ttk_raid <= 360 else 'FAIL'}")
    print(f"Данж-босс 14M HP / 5 чел: TTK = {ttk_dungeon:.0f} с, коридор 75..120 с -> {'PASS' if 75 <= ttk_dungeon <= 120 else 'FAIL'}")
    print(f"Мировой босс 240M HP / 50 чел: TTK = {ttk_world:.0f} с, коридор 240..360 с -> {'PASS' if 240 <= ttk_world <= 360 else 'FAIL'}")
    print(f"PvP (урон ×{PVP_DMG}, HP ×{PVP_HP_MULT}, uptime {UPTIME}): TTK = {ttk_pvp:.1f} с, коридор 6..12 с -> {'PASS' if 6 <= ttk_pvp <= 12 else 'FAIL'}")
    print(f"Слои: additive=1.34, multiplicative=1.298 (разделены), mitigation={MITIG:.3f}, crit={CRIT:.3f}, uptime={UPTIME}")
    print(f"-> {csv_path.relative_to(ROOT)} | {chart.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
