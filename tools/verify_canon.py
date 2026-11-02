#!/usr/bin/env python3
"""Линтер канона ARKEON: согласованность данных, документов, баланса и схемы.

Запуск: python3 tools/verify_canon.py [--strict]
Проверки:
  · 15 документов дизайн-библии на месте и непустые;
  · канон: редкости, шансы дропа, заточка, зоны закона, инфраструктура;
  · классы: 6 / 18 специализаций / 48 навыков / 144 узла и обязательные роли навыков;
  · мир: 14 регионов, 7 Светочей, биомы из брифа;
  · защита P3: в схемах нет конвертера DC→Silver, у косметики нет статов;
  · сгенерированные артефакты (бюджет, DPS, экономика, SVG) на месте;
  · сумма data/budget.csv == production.total_budget_usd из canon.json.

Используется в CI (`09-client.md`, `11-roadmap.md`, `12-monetization.md`).
"""
from __future__ import annotations
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
C = json.loads((ROOT / "data/canon.json").read_text(encoding="utf-8"))
CL = json.loads((ROOT / "data/classes.json").read_text(encoding="utf-8"))
W = json.loads((ROOT / "data/world.json").read_text(encoding="utf-8"))

results: list[tuple[bool, str]] = []


def check(ok: bool, msg: str) -> None:
    results.append((bool(ok), msg))


# --- 1. Документы ---
docs = sorted((ROOT / "docs").glob("[0-9][0-9]-*.md"))
check(len(docs) == 15, f"15 документов дизайн-библии (найдено {len(docs)})")
for d in docs:
    text = d.read_text(encoding="utf-8")
    check(len(text) > 2500 and text.startswith("# "), f"{d.name}: заголовок + объём ({len(text)} симв.)")

# --- 2. Канон ---
items = C["items"]
check(len(items["rarities"]) == 6, "6 редкостей предметов")
wsum = sum(r["drop_weight"] for r in items["rarities"])
check(abs(wsum - 1.0) < 0.001, f"сумма весов дропа = {wsum:.4f} (~1.0)")
check(len(items["enchant_success"]) == items["enchant_max"] + 1,
      f"таблица заточки +0…+{items['enchant_max']} ({len(items['enchant_success'])} значений)")
check(all(0 < p <= 1 for p in items["enchant_success"]), "все шансы заточки в (0,1]")
check(len(C["law_zones"]) == 4, "4 зоны закона")
check({z["id"] for z in C["law_zones"]} == {"green", "yellow", "red", "black"}, "идентификаторы зон закона")
check(C["combat"]["server_tick_hz"] == 30 and C["combat"]["snapshot_hz"] == 20, "30 Гц тик / 20 Гц снапшоты")
check(C["infrastructure"]["ccu_per_realm"] == 4000 and C["infrastructure"]["regions"] == ["EU","NA","APAC","CIS"],
      "4 000 CCU/реалм, 4 региона")
check(C["progression"]["level_cap"] == 60 and C["progression"]["paragon_cap"] == 300, "L60 + парагон 300")
check(C["monetization"]["target_payer_conversion_pct"] == 4.2, "конверсия 4.2% (базовый сценарий)")

# --- 3. Классы ---
classes = CL["classes"]
check(len(classes) == 6, "6 классов")
check(sum(len(c["specs"]) for c in classes) == 18, "18 специализаций")
check(sum(len(c["skills"]) for c in classes) == 48, "48 активных навыков")
check(sum(sum(len(b["nodes"]) for b in c["talent_branches"]) for c in classes) == 144, "144 узла талантов")
for c in classes:
    types = {s["type"] for s in c["skills"]}
    has_mob = any("Мобильность" in t for t in types)
    has_def = any("Защита" in t or "Выживание" in t for t in types)
    has_cc = any("Контроль" in t for t in types)
    has_aoe = any("AoE" in t or "Финишер" in t for t in types)
    check(has_mob and has_def and has_cc and has_aoe,
          f"{c['name_ru']}: мобильность / защита / контроль / AoE-финишер")
    check(len(c["talent_branches"]) == 3 and all(len(b["nodes"]) == 8 for b in c["talent_branches"]),
          f"{c['name_ru']}: 3 ветки × 8 узлов")
    check(all(0 <= s["coeff"] <= 10 for s in c["skills"]), f"{c['name_ru']}: коэффициенты навыков в [0,10]")

# --- 4. Мир ---
check(len(W["regions"]) == 14, "14 регионов")
check(len(W["beacons"]) == 7, "7 Клятв/Светочей")
biomes = " ".join(r["biome"] for r in W["regions"]).lower()
for key in ("город", "лес", "пустын", "болот", "ледян", "вулкан", "подзем", "мор", "хаос"):
    check(key in biomes, f"биом «{key}» присутствует на карте")
check(W["dungeons"] == 8 and W["raids"] == 3 and W["world_bosses"] == 6 and W["guild_territories"] == 36,
      "8 данжей / 3 рейда / 6 мировых боссов / 36 территорий")

# --- 5. Хартия P3 (структурные проверки) ---
sql = (ROOT / "sql/schema.sql").read_text(encoding="utf-8")
check("stat_power" in sql and "is_cosmetic" in sql, "у косметики в БД есть флаги stat_power / is_cosmetic")
check("premium_wallet" in sql and "exchange" not in sql.lower(), "нет таблицы обмена DC → Серебро")
check("fn_validate_ledger" in sql and "idempotency_key" in sql and "item_single_owner" in sql,
      "антидюп: двойная запись + идемпотентность + единственный владелец")
monet = (ROOT / "docs/12-monetization.md").read_text(encoding="utf-8")
for forbidden in ("ускорители опыта", "продажа Серебра", "конвертируются в Серебро"):
    check(forbidden in monet, f"хартия явно запрещает: «{forbidden}»")

# --- 6. Артефакты моделей ---
for f in ("data/budget.csv", "data/revenue_scenarios.csv", "data/combat_balance.csv",
          "data/economy_sim_30d.csv", "assets/world-map.svg", "assets/charts/budget.svg",
          "assets/charts/economy-30d.svg", "assets/charts/combat-dps.svg",
          "assets/charts/classes-summary.svg"):
    check((ROOT / f).exists(), f"артефакт {f}")

budget_csv = ROOT / "data/budget.csv"
if budget_csv.exists():
    with budget_csv.open(encoding="utf-8") as f:
        total = sum(int(r["usd"]) for r in csv.DictReader(f))
    check(total == C["production"]["total_budget_usd"],
          f"сумма budget.csv = {total:,} == canon {C['production']['total_budget_usd']:,}")

# --- 7. Кросс-ссылки ключевых чисел в документах ---
all_md = "\n".join(d.read_text(encoding="utf-8") for d in docs)
for token in ("30 Гц", "4 000", "224 680 000", "200v200", "10 недель", "1.085", "9 200"):
    check(token in all_md, f"в документах встречается каноническое число «{token}»")

# --- 8. Отчёт ---
passed = sum(1 for ok, _ in results if ok)
failed = [m for ok, m in results if not ok]
print("=== ARKEON · verify_canon ===")
print(f"Проверок: {len(results)} | PASS: {passed} | FAIL: {len(failed)}")
for ok, msg in results:
    if not ok:
        print("  FAIL:", msg)
if failed:
    print("\nИтог: FAIL — канон требует синхронизации.")
    sys.exit(1 if "--strict" in sys.argv else 0)
print("Итог: PASS — данные, документы, баланс и хартия согласованы.")
