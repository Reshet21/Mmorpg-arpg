#!/usr/bin/env node
/* =====================================================================
 * Smoke-тест мобильного среза ARKEON без браузера (Node + vm).
 *
 * Запуск: node tools/smoke_mobile.js
 * Что проверяет:
 *   · game.js инициализируется без DOM/сети (fallback-данные);
 *   · 30 Гц симуляция Воина побеждает босса и не роняет процесс;
 *   · Маг создаёт стихийные реакции;
 *   · додж даёт i-frames и тратит заряд, ультимейт требует 100% заряда;
 *   · при успешной загрузке data/classes.json коэффициенты берутся из канона;
 *   · рендер не падает на заглушке Canvas 2D; нет NaN в состоянии.
 * ===================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'mobile/js/game.js'), 'utf8');
const CANON = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/classes.json'), 'utf8'));

let checks = 0, fails = [];
function ok(cond, msg) { checks++; if (!cond) fails.push(msg); }

function makeEnv(useCanon) {
  const gradient = { addColorStop() {} };
  const ctxProxy = new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradient;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'canvas') return canvas;
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  class FakeEl {
    constructor(id) {
      this.id = id || ''; this.dataset = {}; this.children = []; this.checked = false;
      this._text = ''; this._html = ''; this._ev = {};
      this.style = { setProperty() {}, removeProperty() {} };
      const set = new Set();
      this.classList = {
        add: (...c) => c.forEach(x => set.add(x)),
        remove: (...c) => c.forEach(x => set.delete(x)),
        toggle: (c, force) => { const on = force === undefined ? !set.has(c) : !!force; on ? set.add(c) : set.delete(c); return on; },
        contains: c => set.has(c)
      };
    }
    addEventListener(t, fn) { this._ev[t] = fn; }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute(k, v) { this[k] = v; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 132, height: 132 }; }
    getContext() { return ctxProxy; }
    querySelector(sel) {
      const cls = sel.replace('.', '');
      return this.children.find(c => c.className && c.className.split(' ').includes(cls)) || new FakeEl('q');
    }
    get textContent() { return this._text; } set textContent(v) { this._text = String(v); }
    get innerHTML() { return this._html; } set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; }
  }
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, new FakeEl(id)); return els.get(id); };
  const classCards = ['warrior', 'mage'].map(id => { const e = new FakeEl('card'); e.dataset.class = id; e.className = 'class-card' + (id === 'warrior' ? ' selected' : ''); return e; });
  const canvas = el('game');
  let t = 0;
  const win = {
    innerWidth: 844, innerHeight: 390, devicePixelRatio: 2,
    addEventListener() {}, ARKEON: null
  };
  const doc = {
    readyState: 'complete', hidden: false,
    getElementById: el,
    createElement: () => new FakeEl('new'),
    querySelectorAll: sel => sel === '.class-card' ? classCards : [],
    querySelector: sel => sel === '.class-card.selected' ? classCards[0] : null,
    addEventListener() {}
  };
  const nav = { vibrate() {} };
  const env = {
    window: win, document: doc, navigator: nav,
    performance: { now: () => (t += 16.7) },
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    location: { protocol: 'http:' },
    console,
    Math, JSON, Set, Map, Promise, Date, Object, Array, String, Number, parseInt, isNaN,
    fetch: useCanon
      ? () => Promise.resolve({ ok: true, json: () => Promise.resolve(CANON) })
      : () => Promise.reject(new Error('offline'))
  };
  env.globalThis = env;
  return env;
}


// Бот держит дистанцию: переводит мировой вектор к боссу в экранный ввод джойстика.
function approach(A, minDist) {
  const s = A.state, p = s.player, b = s.boss;
  if (!p || !b || !b.alive) return;
  const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1;
  if (d > minDist) {
    const v = A.worldToScreenDelta(dx / d, dy / d);
    const m = Math.max(Math.abs(v.sx), Math.abs(v.sy), 1e-6);
    s.joy.dx = Math.max(-1, Math.min(1, v.sx / m));
    s.joy.dy = Math.max(-1, Math.min(1, v.sy / m));
  } else { s.joy.dx = 0; s.joy.dy = 0; }
}
function towardBoss(A) {
  const s = A.state, p = s.player, b = s.boss;
  const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d];
}

async function run(useCanon) {
  const env = makeEnv(useCanon);
  const ctx = vm.createContext(env);
  vm.runInContext(SRC, ctx, { filename: 'mobile/js/game.js' });
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const A = env.window.ARKEON;
  ok(!!A, 'window.ARKEON определён');
  if (!A) return null;
  ok(A.version === 'G1.0', 'версия среза G1.0');
  ok(A.config.TICK === 1 / 30, 'тик симуляции 30 Гц');
  ok(A.source() === (useCanon ? 'canon' : 'fallback'), 'источник данных: ' + (useCanon ? 'canon' : 'fallback'));
  if (useCanon) {
    const coeff = A.meta.call(null, 'Клинок Рубежа');
    ok(Math.abs(coeff.coeff - 2.45) < 1e-6, 'коэффициент навыка из канона (2.45)');
  }

  // ---- Воин: полный бой ----
  A.start('warrior');
  ok(A.state.mode === 'playing', 'старт: режим playing');
  ok(A.state.boss.hp === A.config.BOSS_HP, 'HP босса инициализирован');
  ok(A.state.player.dodgeCharges === 2, '2 заряда доджа');
  ok(A.dodge(1, 0) === true, 'додж выполнен');
  ok(A.state.player.iframe > 0.29 && A.state.player.dodgeCharges === 1, 'додж: 0.30 с i-frames и трата заряда');
  ok(A.ultimate() === false, 'ультимейт недоступен при заряде 0');
  A.state.player.ult = 100;
  ok(A.ultimate() === true, 'ультимейт доступен при заряде 100');

  let ticks = 0, casts = 0, broken = null;
  try {
    while (A.state.mode === 'playing' && ticks < 30 * 150) {
      const s = A.state;
      approach(A, 2.4);
      if (s.tick % 12 === 0) { A.cast(0); casts++; }
      [1, 2, 4, 5].forEach(i => { if (s.tick % 30 === i * 3) A.cast(i); });
      if (s.tick % 18 === 0) A.cast(3);
      // додж за 0.25 с до разбора телеграфа — в сторону босса, чтобы не терять дистанцию
      const imminent = s.telegraphs.find(t => !t.resolved && (s.time - t.created) > t.duration - 0.28);
      if (imminent && s.player.dodgeCharges > 0) { const v = towardBoss(A); A.dodge(v[0], v[1]); }
      if (s.player.ult >= 100) A.ultimate();
      A.step(A.config.TICK);
      ticks++;
    }
  } catch (e) { broken = e; }
  ok(!broken, 'симуляция Воина без исключений' + (broken ? ': ' + broken.message : ''));
  console.log('  [warrior] ticks=%d time=%s mode=%s win=%s bossHP=%s playerHP=%s dealt=%s taken=%s crits=%d dodge=%d',
    ticks, (ticks / 30).toFixed(1), A.state.mode,
    A.state.result ? A.state.result.win : '-',
    Math.round(A.state.boss.hp), Math.round(A.state.player.hp),
    Math.round(A.state.damageDealt), Math.round(A.state.damageTaken),
    A.state.critCount, A.state.dodgeCount);
  ok(ticks > 60, 'бой длился > 2 с (' + ticks + ' тиков)');
  ok(A.state.boss && A.state.boss.hp < A.config.BOSS_HP, 'босс получил урон');
  ok(A.state.mode === 'end' && A.state.result && A.state.result.win === true,
    'босс повержен: победа за ' + (ticks / 30).toFixed(1) + ' с');
  ok(Number.isFinite(A.state.player.x) && Number.isFinite(A.state.player.hp), 'нет NaN в состоянии игрока');
  ok(A.state.damageDealt > 0 && A.state.dps >= 0, 'DPS и урон посчитаны');

  // ---- Маг: реакции ----
  A.start('mage');
  let mt = 0;
  try {
    while (A.state.mode === 'playing' && mt < 30 * 40) {
      const s = A.state;
      approach(A, 6.0);
      if (s.tick % 14 === 0) A.cast(0);
      [1, 2, 3].forEach((i, k) => { if (s.tick % 24 === k * 6) A.cast(i); });
      if (s.tick % 40 === 0) A.cast(4);
      if (s.tick % 50 === 0) A.cast(5);
      A.step(A.config.TICK); mt++;
    }
  } catch (e) { broken = e; }
  ok(!broken, 'симуляция Мага без исключений' + (broken ? ': ' + broken.message : ''));
  ok(A.state.reactions >= 1, 'Маг вызвал стихийные реакции (' + A.state.reactions + ')');
  ok(A.state.boss.hp < A.config.BOSS_HP, 'Маг нанёс урон боссу');

  // ---- рендер на заглушке ----
  let renderErr = null;
  try { for (let i = 0; i < 5; i++) { A.render(1 / 60); A.updateUI(); } } catch (e) { renderErr = e; }
  ok(!renderErr, 'рендер на Canvas-заглушке без ошибок' + (renderErr ? ': ' + renderErr.message : ''));
  return A;
}

(async () => {
  console.log('=== ARKEON · smoke_mobile ===');
  await run(false);
  await run(true);
  console.log(`Проверок: ${checks} | PASS: ${checks - fails.length} | FAIL: ${fails.length}`);
  fails.forEach(f => console.log('  FAIL:', f));
  if (fails.length) process.exit(1);
  console.log('Итог: PASS — мобильный срез логически играбелен, данные канона подключаются.');
})();
