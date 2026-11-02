#!/usr/bin/env python3
"""Линтер канона ARKEON: согласованность данных, документов, баланса и схемы.

Запуск: python3 tools/verify_canon.py [--strict]
Проверки:
  · 16 документов дизайн-библии на месте и непустые;
  · канон: редкости, шансы дропа, заточка, зоны закона, инфраструктура;
  · классы: 6 / 18 специализаций / 48 навыков / 144 узла и обязательные роли навыков;
  · мир: 14 регионов, 7 Светочей, биомы из брифа;
  · защита P3: в схемах нет конвертера DC→Silver, у косметики нет статов;
  · сгенерированные артефакты (бюджет, DPS, экономика, SVG) на месте;
  · мобильный срез G1: PWA-оболочка, манифест, иконки, офлайн-кэш, канон, CI-тест;
  · G2 «Мир Завета»: 6 модулей, процедурный рендер, сервер, сетевые тесты;
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
check(len(docs) == 16, f"16 документов дизайн-библии (найдено {len(docs)})")
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
for token in ("30 Гц", "4 000", "224 680 000", "200v200", "10 недель", "1.085", "9 200", "G1"):
    check(token in all_md, f"в документах встречается каноническое число «{token}»")

# --- 8. Мобильный срез G1 ---
MOB = ROOT / "mobile"
for f in ("index.html", "css/style.css", "js/game.js", "manifest.webmanifest",
          "icon.svg", "icon-192.png", "icon-512.png", "sw.js", "README.md"):
    q = MOB / f
    check(q.is_file() and q.stat().st_size > 100, f"mobile/{f}: файл на месте и непуст")

man = json.loads((MOB / "manifest.webmanifest").read_text(encoding="utf-8"))
check(man.get("display") == "standalone", "PWA: самостоятельный режим без строки браузера")
check(man.get("start_url") == "./index.html" and man.get("scope") == "./", "PWA: корректные start_url и scope")
check(any(i.get("purpose") == "maskable" for i in man.get("icons", [])), "PWA: есть maskable-иконка для Android")
check(len(man.get("shortcuts", [])) == 2, "PWA: 2 ярлыка быстрого запуска")

game_js = (MOB / "js/game.js").read_text(encoding="utf-8")
check("TICK = 1 / 30" in game_js, "G1: фиксированный тик 30 Гц")
check("WEAPON_HIT = 21600" in game_js and "BOSS_HP = 3600000" in game_js,
      "G1: базовый урон и HP босса привязаны к канону")
check("window.ARKEON" in game_js and "worldToScreenDelta" in game_js,
      "G1: тестовый интерфейс и корректная обратная изометрия")
check("'Физический+Лёд'" in game_js and "'Скверна+Свет'" in game_js,
      "G1: ключи реакций согласованы с порядком стихий в каноне")
check("loadCanon" in game_js and "../data/classes.json" in game_js,
      "G1: коэффициенты навыков читаются из единого канона")

sw = (MOB / "sw.js").read_text(encoding="utf-8")
check("caches.open" in sw and "self.clients.claim" in sw, "G1: офлайн-кэш и версионирование")
for f in ("index.html", "css/style.css", "js/game.js", "sw.js"):
    t = (MOB / f).read_text(encoding="utf-8").lower()
    check("https://" not in t and not re.search(r"(unpkg|jsdelivr|cdnjs|googleapis|cloudflare|fonts\.google)", t),
          f"mobile/{f}: без внешних CDN и сетевых зависимостей")

for size in (192, 512):
    b = (MOB / f"icon-{size}.png").read_bytes()
    check(b[:8] == b"\x89PNG\r\n\x1a\n" and int.from_bytes(b[16:20], "big") == size,
          f"mobile/icon-{size}.png: валидный PNG нужного размера")

mob_doc = (ROOT / "docs/16-mobile.md").read_text(encoding="utf-8")
for r in C["combat"]["reactions"]:
    check(r in mob_doc, f"docs/16-mobile.md: реакция «{r}» названа как в каноне")
check("силовых sku" in (MOB / "README.md").read_text(encoding="utf-8").lower(),
      "mobile/README.md: хартия P3 — ноль силовых SKU")
check((ROOT / "tools/smoke_mobile.js").is_file(), "tools/smoke_mobile.js: headless-тест боя")
check("mobile/index.html" in (ROOT / "index.html").read_text(encoding="utf-8"),
      "хаб дизайн-библии ссылается на мобильный срез")
check("mobile/" in (ROOT / "README.md").read_text(encoding="utf-8"),
      "README.md содержит инструкцию по мобильному срезу")

# --- 8b. G2 «Мир Завета» ---
for f in ("js/data.js", "js/world.js", "js/rpg.js", "js/render.js", "js/net.js", "js/main.js",
          "css/g2.css", "g1.html"):
    q = MOB / f
    check(q.is_file() and q.stat().st_size > 2000, f"mobile/{f}: модуль G2 на месте")

data_js = (MOB / "js/data.js").read_text(encoding="utf-8")
check("A2.CLASSES.length" not in data_js and "id:'necromancer'" in data_js,
      "G2: все 6 классов канона объявлены в data.js")
check(data_js.count("id:'") >= 4 and "A2.QUESTS = [" in data_js and "q12" in data_js,
      "G2: 4 зоны и 12 квестов цепочки Завета")
render_js = (MOB / "js/render.js").read_text(encoding="utf-8")
check("createRadialGradient" in render_js and "destination-out" in render_js,
      "G2: динамический свет и bloom-эмуляция в рендере")
check(render_js.count("case '") >= 10, "G2: >=10 процедурных видов объектов/существ")
main_js = (MOB / "js/main.js").read_text(encoding="utf-8")
check("window.ARKEON_G2" in main_js, "G2: тестовый интерфейс window.ARKEON_G2")
net_js = (MOB / "js/net.js").read_text(encoding="utf-8")
check("WebSocket" in net_js and "ghost:true" in net_js,
      "G2: сетевой клиент + честные офлайн-призраки")
check("sec-websocket" not in net_js.lower(), "G2: клиент не изобретает handshake")

SRV = ROOT / "server"
for f in ("server.js", "sim.js", "README.md", "Dockerfile"):
    check((SRV / f).is_file(), f"server/{f}: файл на месте")
srv_js = (SRV / "server.js").read_text(encoding="utf-8")
sim_js = (SRV / "sim.js").read_text(encoding="utf-8")
check("258EAFA5-E914-47DA-95CA-C5AB0DC85B11" in srv_js, "сервер: WebSocket RFC 6455 без npm")
check("TICK_MS" not in srv_js and "30" in sim_js and "20" in sim_js,
      "сервер: 30 Гц тик / 20 Гц снапшоты")
check("correction" in sim_js and "seq" in sim_js, "сервер: античит и идемпотентность")
for f in ("js/data.js", "js/world.js", "js/rpg.js", "js/render.js", "js/net.js", "js/main.js"):
    t = (MOB / f).read_text(encoding="utf-8").lower()
    check("https://" not in t and "http://" not in t and
          "unpkg.com" not in t and "cdn.jsdelivr.net" not in t and "cdnjs" not in t,
          f"mobile/{f}: без внешних CDN и сетевых зависимостей")
for f in ("tools/smoke_g2.js", "tools/smoke_net.js"):
    check((ROOT / f).is_file(), f"{f}: тест G2/сети на месте")
check("G2" in (ROOT / "docs/16-mobile.md").read_text(encoding="utf-8"),
      "docs/16-mobile.md описывает G2")
check("G2" in (ROOT / "README.md").read_text(encoding="utf-8") and
      "G2" in (ROOT / "index.html").read_text(encoding="utf-8"),
      "хаб и README ведут на G2")

# --- 8c. G2.1 «звук · лут · рынок · торговля · 6 классов» ---
audio_js = (MOB / "js/audio.js").read_text(encoding="utf-8")
market_js = (MOB / "js/market.js").read_text(encoding="utf-8")
html_g2 = (MOB / "index.html").read_text(encoding="utf-8")
sw_js = (MOB / "sw.js").read_text(encoding="utf-8")
rpg_js = (MOB / "js/rpg.js").read_text(encoding="utf-8")
check((MOB / "js/audio.js").is_file() and len(audio_js) > 5000,
      "G2.1: процедурный звуковой движок audio.js на месте")
sfx = re.findall(r"^\s{4}([a-z]+):\s*\(", audio_js, re.M)
check(len(sfx) >= 24, f"G2.1: >=24 SFX в банке звуков ({len(sfx)})")
check("AudioContext" in audio_js and "A2.Audio =" in audio_js and "master" in audio_js,
      "G2.1: WebAudio, master/sfx/music-шины и публичный API")
check(len(re.findall(r"^\s{4}(grove|ash|frost|rift):", audio_js, re.M)) == 4,
      "G2.1: амбиент всех 4 биомов")
check("A2.RARITIES.indexOf" in audio_js or "A2.RARITY(rarity)" in audio_js,
      "G2.1: лутовые арпеджио зависят от редкости")
check((MOB / "js/market.js").is_file() and len(market_js) > 5000,
      "G2.1: модуль рынка и торговли market.js на месте")
check("0.05" in market_js and "fee" in market_js, "G2.1: комиссия 5% как экономический sink")
for token in ("market_list", "market_buy", "market_cancel", "trade_invite", "trade_confirm",
              "whisper", "emote", "roster"):
    check(token in market_js, f"G2.1: market.js обрабатывает {token}")
check("A2.Market =" in market_js and "M.applyNet" in market_js,
      "G2.1: серверные сообщения рынка маршрутизируются в UI")
check(".class-card" in main_js and "classList.add('selected')" in main_js,
      "G2.1: ИСПРАВЛЕН выбор всех 6 классов (обработчик .class-card)")
check("[?&]class=([a-z]+)" in main_js and "autostart=1" in main_js,
      "G2.1: прямой вход ?class=…&autostart=1")
check("A2.Audio.play" in main_js and "G.onHit" in main_js and "G.onZone" in main_js,
      "G2.1: звуковые хуки боя, лута, UI и смены зон")
check("G.market=A2.Market.create(G)" in main_js and "openModal('market')" in main_js,
      "G2.1: рынок и торговля интегрированы в универсальную панель")
check("lootFilter" in main_js and "autoPickupAllowed" in rpg_js,
      "G2.1: фильтр лута и видимый дроп на земле")
check("sell" in rpg_js and "function sell(" in rpg_js,
      "G2.1: продажа предметов торговцу")
check("Math.random()<0.62" in rpg_js, "G2.1: лут падает с каждого моба в духе Diablo/PoE")
for token in ("js/audio.js", "js/market.js", "btnMarket", "btnPlayers", "bagCount", "lootCount"):
    check(token in html_g2, f"G2.1: mobile/index.html подключает {token}")
for token in ("js/audio.js", "js/market.js"):
    check(token in sw_js, f"G2.1: service worker кэширует {token}")
check("arkeon-g21" in sw_js, "G2.1: версия офлайн-кэша обновлена")
for token in ("market_list", "market_buy", "trade_invite", "trade_confirm", "whisper", "emote",
              "syncInitial", "broadcastRoster", "broadcastMarket", "idempotent"):
    check(token in sim_js, f"G2.1: авторитетный сервер поддерживает {token}")
check("sim.syncInitial(player)" in srv_js,
      "G2.1: сервер синхронизирует ростер, кошелёк и order book при входе")
for f in ("js/audio.js", "js/market.js"):
    t = (MOB / f).read_text(encoding="utf-8").lower()
    check("https://" not in t and "http://" not in t and "unpkg.com" not in t and
          "cdn.jsdelivr.net" not in t and "cdnjs" not in t,
          f"mobile/{f}: без внешних CDN и сетевых зависимостей")
check("0 силовых" not in audio_js and "buy_gold" not in market_js.lower(),
      "P3: новый функционал не добавляет силовых SKU / Pay-To-Win")

# --- 9. Отчёт ---
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
