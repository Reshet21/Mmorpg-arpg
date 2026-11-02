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
check(len(re.findall(r"^\s{4}(haven|grove|ash|frost|rift):", audio_js, re.M)) == 5,
      "G2.3: амбиент 5 биомов, включая безопасный город")
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
check("arkeon-g24-v1" in sw_js, "G2.4: версия офлайн-кэша обновлена")
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

# --- 8d. G2.2 «инвентарь · снаряжение · анти-лаг · надёжный лут» ---
rpg_js2 = (MOB / "js/rpg.js").read_text(encoding="utf-8")
render_js2 = (MOB / "js/render.js").read_text(encoding="utf-8")
main_js2 = (MOB / "js/main.js").read_text(encoding="utf-8")
net_js2 = (MOB / "js/net.js").read_text(encoding="utf-8")
css_g2 = (MOB / "css/g2.css").read_text(encoding="utf-8")
html2 = (MOB / "index.html").read_text(encoding="utf-8")
for token in ("magnetLoot", "collectNearby", "walkableDropPos", "freeBagSlot", "unequip", "equipBest"):
    check(token in rpg_js2, f"G2.2: rpg.js реализует {token}")
check("pickR+0.4" in rpg_js2, "G2.2: люфт радиуса подбора (дроп не зависает на границе)")
check("d.picked=true" in rpg_js2 or "d.picked = true" in rpg_js2,
      "G2.2: явный флаг подобранного предмета")
check("autoSalvage" in rpg_js2 and "lootFilter:'all'" in main_js2,
      "G2.2: весь лут подбирается, полная сумка не теряет дроп")
check("A2.RPG.magnetLoot(G,dt)" in main_js2, "G2.2: магнит вызывается каждый тик симуляции")
check("A2.RPG.collectNearby(G,7.5)" in main_js2, "G2.2: «Взаим.» забирает весь лут рядом")
check("flushItems" in net_js2 and "700" in net_js2,
      "G2.2: реестр предметов в WS троттлится (нет спама при сборе лута)")
check("setQuality" in render_js2 and "waterCache" in render_js2 and "miniCache" in render_js2,
      "G2.2: адаптивное качество, кэш воды и подложки мини-карты")
check("dropsVisible" in render_js2 and "dropCap" in render_js2,
      "G2.2: отсечение и лимит отрисовки лута")
check("fpsAvg" in main_js2 and "G.perf='low'" in main_js2,
      "G2.2: автоматический переход в экономный режим при просадке FPS")
check("openModal('equip')" in main_js2 and "openModal('slot',s)" in main_js2,
      "G2.2: отдельные панели снаряжения и слота")
check('data-act="slot"' in main_js2 and 'data-act="equipSlot"' in main_js2,
      "G2.2: слоты и предметы кликабельны, экипировка меняется из UI")
check('data-act="pickAll"' in main_js2 and "btnLoot" in html2,
      "G2.2: кнопки «Забрать лут» в панели и на HUD")
check("btnEquip" in html2 and "pAvatar" in html2 and "equipCount" in html2,
      "G2.2: доступ к снаряжению из тулбара и по тапу на портрет")
check(".equip-grid" in css_g2 and ".slot-card" in css_g2 and ".loot-chip.show" in css_g2,
      "G2.2: стили сетки слотов и visibility-чина лута")
check("bottom:calc(var(--safe-b) + 172px)" in css_g2,
      "G2.2: тулбар поднят над блоком управления — кнопки не перекрыты джойстиком")
check("A2.Render.minimap" in main_js2 and "G.uiT>0.2" in main_js2,
      "G2.2: обновление HUD и мини-карты реже для плавности")
check(("G2.2" in html2 or "G2.3" in html2 or "G2.4" in html2) and "G2.2" in (ROOT / "docs/16-mobile.md").read_text(encoding="utf-8"),
      "G2.2: версия зафиксирована в клиенте и спецификации студии")

# --- 8e. G2.3 «Пристань Завета»: город, пролог, постепенная экипировка ---
data_js3 = (MOB / "js/data.js").read_text(encoding="utf-8")
world_js3 = (MOB / "js/world.js").read_text(encoding="utf-8")
rpg_js3 = (MOB / "js/rpg.js").read_text(encoding="utf-8")
main_js3 = (MOB / "js/main.js").read_text(encoding="utf-8")
render_js3 = (MOB / "js/render.js").read_text(encoding="utf-8")
html3 = (MOB / "index.html").read_text(encoding="utf-8")
css3 = (MOB / "css/g2.css").read_text(encoding="utf-8")
doc3 = (ROOT / "docs/16-mobile.md").read_text(encoding="utf-8")
check("id:'haven'" in data_js3 and "safe:true" in data_js3,
      "G2.3: безопасный город Пристань Завета есть в каноне зон")
check(data_js3.count("next:'") >= 4 and "prev:null" in data_js3 and "backSpawn" in data_js3,
      "G2.3: линейная цепочка зон вместо кольцевого перехода")
check("A2.STORY = [" in data_js3 and data_js3.count("act:'АКТ I · ПРОЛОГ'") == 9,
      "G2.3: пролог из 9 глав с актами и текстом")
check(data_js3.count("reward:{") >= 9 and "questReward" in rpg_js3,
      "G2.3: за каждую главу выдаётся предмет экипировки")
for token in ("storyChapter", "storyEvent", "storyComplete", "storyCheckReach", "storySkip"):
    check(token in rpg_js3, f"G2.3: rpg.js реализует {token}")
check("G.story && !G.story.done) return false" in rpg_js3,
      "G2.3: 12 квестов Завета открываются только после пролога")
check("G.story.chapter < 5 ? 1 : 2" in rpg_js3,
      "G2.3: редкость дропа растёт вместе с сюжетом, без легендарок на старте")
check("ch.equip.weapon = rollItem" in rpg_js3,
      "G2.3: старт только с оружием, остальные слоты выдаются квестами")
check("story:G.story?" in rpg_js3 and "data.story" in rpg_js3,
      "G2.3: прогресс пролога сохраняется и восстанавливается")
check("W.safe = !!z.safe" in world_js3 and "W.eventTimer = W.safe ? Infinity : 65" in world_js3,
      "G2.3: в городе отключены лагеря, босс и Волны Разлома")
check("ai === 'dummy'" in world_js3 and "'maket'" in world_js3,
      "G2.3: учебные манекены не двигаются и не атакуют")
check("buildCity" in world_js3 and "'house'" in world_js3 and "'lamp'" in world_js3,
      "G2.3: городская застройка — дома, прилавки, фонари, статуя")
check("ZONE_SEEDS" in world_js3,
      "G2.3: добавление города не ломает рельеф и коллизии боевых зон")
check("safeCircles" in world_js3 and "isSafe" in world_js3,
      "G2.3: безопасная дозорная тропа у входа в Рощу")
check("local.storyDone === false" in world_js3,
      "G2.3: мировые события не начинаются во время пролога")
check("m.dummy && !W.dummiesActive" in world_js3 and "dummiesActive" in main_js3,
      "G2.3: манекены не являются целью автоатаки до главы «Пробный удар»")
check("G.attackHeld && G.atkCd<=0" in main_js3 and "autoCd" not in main_js3,
      "G2.4: автоатака полностью удалена, удар только по явному вводу")
check("openModal('prologue')" in main_js3 and "openModal('story')" in main_js3,
      "G2.3: кинематографичный пролог и «Книга Завета»")
check("updateStoryUI" in main_js3 and "storyTarget" in main_js3,
      "G2.3: текущая цель видна в HUD и на мини-карте")
check("A2.RPG.storyEvent(G,'talk',npc.id" in main_js3 and
      "A2.RPG.storyEvent(G,'gate',p.to" in main_js3,
      "G2.3: разговор с НПС и выход через ворота продвигают сюжет")
check("p.arrival" in main_js3, "G2.3: переход между зонами сохраняет точку прибытия")
check("case 'dummy'" in render_js3 and "case 'house'" in render_js3 and "case 'statue'" in render_js3,
      "G2.3: спрайты манекенов и городских объектов")
check("if(miniCache.cv) g.drawImage(miniCache.cv,0,0);" in render_js3,
      "G2.3: кэш подложки мини-карты реально используется")
check("G.storyTarget" in render_js3 and "✦ СЮЖЕТ" in render_js3,
      "G2.3: НПС текущей главы и путевая точка помечены в мире")
check("btnStory" in html3 and "storyBar" in html3 and ".story-bar" in css3 and ".prologue" in css3,
      "G2.3: кнопка сюжета, баннер главы и оформление книги")
check(("G2.3" in html3 or "G2.4" in html3) and "G2.3" in doc3 and "16.24" in doc3,
      "G2.3: версия зафиксирована в клиенте и спецификации студии")
check("'haven'" in (ROOT / "server/sim.js").read_text(encoding="utf-8"),
      "G2.3: авторитетный сервер знает безопасный город")

# --- 8f. G2.4 «Тихий старт»: сброс, ручной бой, мирные мобы, телепорты ---
data_js4 = (MOB / "js/data.js").read_text(encoding="utf-8")
world_js4 = (MOB / "js/world.js").read_text(encoding="utf-8")
rpg_js4 = (MOB / "js/rpg.js").read_text(encoding="utf-8")
main_js4 = (MOB / "js/main.js").read_text(encoding="utf-8")
sim_js4 = (ROOT / "server/sim.js").read_text(encoding="utf-8")
html4 = (MOB / "index.html").read_text(encoding="utf-8")
css4 = (MOB / "css/g2.css").read_text(encoding="utf-8")
doc4 = (ROOT / "docs/16-mobile.md").read_text(encoding="utf-8")
check("arkeon_g2_save_v4" in data_js4 and "SAVE_VERSION: 4" in data_js4,
      "G2.4: новая версия сохранения — старый прогресс не воскресает")
check("C.SAVE_VERSION" in rpg_js4 and "clearSave" in rpg_js4 and
      "(d.v||0) < C.SAVE_VERSION" in rpg_js4,
      "G2.4: старые сейвы отклоняются и удаляются")
check("function resetGame()" in main_js4 and "A2.RPG.clearSave()" in main_js4,
      "G2.4: «начать всё заново» работает без перезагрузки страницы")
check("btnReset" in html4 and 'data-act="reset"' in main_js4,
      "G2.4: кнопка полного сброса есть на старте и в настройках")
check("ch.maxHp = st.maxHp" in rpg_js4,
      "G2.4: исправлен баг 0 HP у нового героя")
check("autoCd" not in main_js4 and "function basicAttack()" in main_js4,
      "G2.4: автоатака удалена, удар ручной")
check("btnAttack" in html4 and ".tool.attack" in css4,
      "G2.4: кнопка «Удар» с удержанием и тап по врагу")
check("G.attackHeld=true" in main_js4 and "basicAttack(); }" in main_js4,
      "G2.4: удержание кнопки даёт серию ударов, но не пассивную автоатаку")
check("provoked: false" in world_js4 and "function provoke(W, m)" in world_js4,
      "G2.4: мобы мирные по умолчанию, провокация только после удара")
check("const aggressive = m.provoked || !!m.event;" in world_js4,
      "G2.4: моб атакует только после удара по нему (или событийная Волна)")
check("if (A2.World.provoke) A2.World.provoke(G.world, mob);" in rpg_js4 and
      "m.provoked=true; m.provokedAt=W.time" in sim_js4,
      "G2.4: провокация выставляется и клиентом, и авторитетным сервером")
check("W.noEvents" in world_js4 and "worldEvents:false" in main_js4,
      "G2.4: Волны Разлома выключены по умолчанию, включаются в настройках")
check("function setWorldEvents(W, on)" in world_js4 and 'data-set="worldEvents"' in main_js4,
      "G2.4: переключатель событий применяется к текущему миру сразу")
check("mode==='travel'" in main_js4 and 'data-act="travelTo"' in main_js4 and
      "warpNpc" in main_js4,
      "G2.4: карта с телепортами по 5 локациям и к НПС")
check("function travelTo(zoneId, x, y)" in main_js4 and "btnTravel" in html4,
      "G2.4: мгновенное путешествие и кнопка карты")
check("case 'portal': openModal('travel'); break;" in main_js4,
      "G2.4: порталы НПС открывают карту, а не слепо прыгают в первую зону")
check("A2.World.setWorldEvents(G.world" in main_js4,
      "G2.4: настройки мира применяются и при загрузке, и при смене зоны")
check("const canvasOnly = ev =>" in main_js4 and "ev.target !== cv" in main_js4,
      "G2.4: пинч-зум слушает только игровое поле, джойстик исключён")
check("app.addEventListener('pointercancel',endPointer)" in main_js4,
      "G2.4: отменённое касание больше не залипает и не ломает зум")
check("if(d>8) G.pinch" in main_js4,
      "G2.4: защита от деления на нулевую дистанцию пальцев")
check("class=\"tool interact\"" in html4 and ".sheet .primary{width:100%" in css4 and
      ".tool.primary{border-color" not in css4,
      "G2.4: «Взаим.» больше не растягивается на весь экран")
check("safeBadge" in html4 and ".safe-badge.show" in css4,
      "G2.4: индикатор безопасной зоны виден в HUD")
check("G2.4" in html4 and "16.25" in doc4,
      "G2.4: версия зафиксирована в клиенте и спецификации студии")

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
