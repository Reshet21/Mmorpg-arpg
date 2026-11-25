/* =====================================================================
 * ARKEON: Пепел Завета · G1 MOBILE VERTICAL SLICE
 * Изометрический ARPG-бой для сенсорного экрана. Чистый Canvas 2D + WebAudio,
 * без внешних зависимостей и без сетевых запросов к другим хостам.
 *
 * Канон (data/canon.json, docs/03-gdd.md, docs/07-mechanics.md):
 *   · тик симуляции 30 Гц, рендер 60 Гц (requestAnimationFrame)
 *   · додж: 0.30 с i-frames, 0.15 с recovery, 6.2 м, 2 заряда / 5.5 с
 *   · урон: Base × (1+add) × mult × (1−DEF/(DEF+K)) × crit × (1−DR) × vuln
 *   · телеграфы 0.8–1.5 с; CC/стойкость; 7 стихийных реакций
 *   · кэп видимых акторов, LOD, «одна цель за сессию», экран «Мир помнит»
 *
 * ВАЖНО: локальная симуляция здесь авторитетна только для вертикального
 * среза. В проде урон/лут/предметы решает сервер (docs/08-server.md).
 * ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------ константы ------------------------------ */
  const A = 36;                    // размер арены в тайлах (1 тайл = 2 м)
  const TILE_W = 64, TILE_H = 32, H_UNIT = 26;
  const TICK = 1 / 30;            // 30 Гц авторитетный тик
  const WEAPON_HIT = 21600;       // базовый удар оружия L60 (tools/combat_model.py)
  const ADD = 1.34, MULT = 1.298; // разделённые слои аддитивов и множителей
  const K_DEF = 1200 + 42 * 60;   // 3720
  const BASE_CRIT = 0.05, CRIT_MULT = 1.5;
  const PLAYER_HP = 12000, PLAYER_DEF = 2400, MOVE_SPEED = 2.8; // тайл/с = 5.6 м/с
  // G1: 1/4 канонического HP данж-босса (14 000 000), чтобы бой длился 30–90 с на телефоне.
  const BOSS_HP = 3600000, BOSS_DEF = 4200, STAGGER_MAX = 150000;
  const ENRAGE_AT = 90;

  const ELEMENTS = ['Физический', 'Огонь', 'Лёд', 'Молния', 'Скверна', 'Свет', 'Тьма'];
  const REACTIONS = {
    'Огонь+Лёд': { name: 'ПАР', coeff: 2.80, color: '#9fe8ff' },
    'Огонь+Молния': { name: 'ПЕРЕГРУЗКА', coeff: 3.40, color: '#ffe27a' },
    'Физический+Лёд': { name: 'СТЕКЛОВАНИЕ', coeff: 1.20, color: '#bfe9ff' },
    'Огонь+Скверна': { name: 'ВЗРЫВ', coeff: 3.00, color: '#c07bff' },
    'Скверна+Свет': { name: 'ОЧИЩЕНИЕ', coeff: 1.00, color: '#f0d27a' },
    'Свет+Тьма': { name: 'ЗАТЕМНЕНИЕ', coeff: 1.00, color: '#8b6cc0' }
  };
  function pairKey(a, b) {
    const ia = ELEMENTS.indexOf(a), ib = ELEMENTS.indexOf(b);
    return (ia <= ib ? a + '+' + b : b + '+' + a);
  }

  /* ---------------------- данные классов (fallback) ---------------------- */
  // Полные данные подтягиваются из ../data/classes.json; fallback обеспечивает
  // офлайн-запуск (PWA) и тестирование в Node без DOM/сети.
  const FALLBACK = {
    warrior: {
      'Рассекающий': { coeff: 1.10, cd: 0, cost: '+8 Ярости', effect: 'Цепь из 3 ударов, 3-й — 165% и «Рана»' },
      'Клинок Рубежа': { coeff: 2.45, cd: 5, cost: '30 Ярости', effect: 'Конус 6 м, оглушение 0.8 с' },
      'Рывок Щита': { coeff: 1.35, cd: 9, cost: '15 Ярости', effect: 'Рывок 8 м, 12% DR на 3 с' },
      'Стойка Бастиона': { coeff: 0, cd: 14, cost: '—', effect: '6 с: −35% урона, фронтальный блок' },
      'Вихрь Стали': { coeff: 1.85, cd: 8, cost: '35 Ярости', effect: '4 удара по радиусу 5 м' },
      'Разломный Удар': { coeff: 2.90, cd: 16, cost: '25 Ярости', effect: 'BREAK: −20% брони, ломает стойкость' },
      'Последний Рубеж': { coeff: 6.20, cd: 90, cost: 'Заряд Искры', effect: '8 с: щит 45% HP, отражает урон' }
    },
    mage: {
      'Искра Эфира': { coeff: 1.00, cd: 0, cost: '+1 Астральный Заряд', effect: 'Снаряд, чередует элемент' },
      'Огненный Вихрь': { coeff: 2.40, cd: 6, cost: '22 Маны / 1 Заряд', effect: 'Круг 7 м: 240% + горение' },
      'Ледяная Игла': { coeff: 2.05, cd: 5, cost: '18 Маны / 1 Заряд', effect: '2 стака → заморозка' },
      'Цепь Молний': { coeff: 1.95, cd: 7, cost: '26 Маны / 1 Заряд', effect: 'Цепь до 5 целей' },
      'Астральный Барьер': { coeff: 0, cd: 18, cost: '30 Маны', effect: 'Щит 25% макс. HP 6 с' },
      'Разрыв Стихий': { coeff: 3.20, cd: 10, cost: '2 Заряда', effect: 'Принудительная реакция, +50%' },
      'Седьмое Солнце': { coeff: 7.80, cd: 90, cost: 'Заряд Искры', effect: 'Метеор 12 м: 780% + горение' }
    }
  };

  const PANEL = {
    warrior: [
      { name: 'Рассекающий', behavior: 'basic', glyph: '⚔', short: 'УДАР', element: 'Физический' },
      { name: 'Клинок Рубежа', behavior: 'strike', glyph: '✦', short: 'КЛИНОК', element: 'Физический' },
      { name: 'Рывок Щита', behavior: 'dash', glyph: '➤', short: 'РЫВОК', element: 'Физический' },
      { name: 'Стойка Бастиона', behavior: 'guard', glyph: '⛨', short: 'СТОЙКА' },
      { name: 'Вихрь Стали', behavior: 'aoe', glyph: '◎', short: 'ВИХРЬ', element: 'Физический' },
      { name: 'Разломный Удар', behavior: 'break', glyph: '✕', short: 'BREAK', element: 'Физический' }
    ],
    mage: [
      { name: 'Искра Эфира', behavior: 'basic', glyph: '✧', short: 'ИСКРА', element: 'Эфир' },
      { name: 'Огненный Вихрь', behavior: 'element', glyph: '♨', short: 'ОГОНЬ', element: 'Огонь' },
      { name: 'Ледяная Игла', behavior: 'element', glyph: '❄', short: 'ЛЁД', element: 'Лёд' },
      { name: 'Цепь Молний', behavior: 'element', glyph: 'ϟ', short: 'МОЛНИЯ', element: 'Молния' },
      { name: 'Астральный Барьер', behavior: 'shield', glyph: '◈', short: 'ЩИТ' },
      { name: 'Разрыв Стихий', behavior: 'reaction', glyph: '✺', short: 'РЕАКЦИЯ', element: 'Эфир' }
    ]
  };
  const ULTIMATE = {
    warrior: { name: 'Последний Рубеж', glyph: '✦' },
    mage: { name: 'Седьмое Солнце', glyph: '☀' }
  };
  const CLASS_META = {
    warrior: { ru: 'ВОИН', letter: 'В', resName: 'ЯРОСТЬ', resMax: 100, resStart: 45, regen: 5, color: '#e8b25c', range: 3.2 },
    mage: { ru: 'МАГ', letter: 'М', resName: 'МАНА', resMax: 100, resStart: 100, regen: 18, color: '#4fd6d0', range: 8.5 }
  };

  let DATA = JSON.parse(JSON.stringify(FALLBACK));   // имя → {coeff, cd, cost, effect}
  let DATA_SOURCE = 'fallback';

  /* ------------------------------- состояние ------------------------------ */
  const S = {
    mode: 'menu',            // menu | playing | paused | end
    time: 0, menuTime: 0, tick: 0,
    classId: 'warrior', orient: 1, zoom: 1, targetZoom: 1,
    camX: 0, camY: 0, shake: 0, flash: 0,
    player: null, boss: null, enemies: [], telegraphs: [], particles: [], numbers: [],
    aim: null, tutorialStep: 0, tutorialUntil: 0,
    combo: 0, comboTimer: 0, critCount: 0, dodgeCount: 0, reactions: 0,
    damageDealt: 0, damageTaken: 0, dmgWindow: [], dps: 0, kills: 0,
    toastText: '', toastUntil: 0, reactionText: '', reactionUntil: 0,
    settings: { motion: true, vibration: true, sound: true, numbers: true, slow: false, quality: 'auto' },
    result: null, joy: { id: null, x: 0, y: 0, dx: 0, dy: 0, startX: 0, startY: 0, startT: 0 },
    key: {}, pointers: new Map(), pinch: null, skillButtons: [], lowFps: 0
  };

  /* --------------------------- DOM / утилиты ----------------------------- */
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const now = () => S.time;
  const canvas = $('game');
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  let VW = 960, VH = 540, DPR = 1;

  function resize() {
    VW = (typeof window !== 'undefined' && window.innerWidth) || 960;
    VH = (typeof window !== 'undefined' && window.innerHeight) || 540;
    DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (canvas) {
      canvas.width = Math.round(VW * DPR);
      canvas.height = Math.round(VH * DPR);
      canvas.style.width = VW + 'px';
      canvas.style.height = VH + 'px';
    }
    if (ctx && ctx.setTransform) ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function toast(text) {
    S.toastText = text; S.toastUntil = now() + 1.25;
    const e = $('toast'); if (e) { e.textContent = text; e.classList.add('show'); }
  }
  function showReaction(text, color) {
    S.reactionText = text; S.reactionUntil = now() + 1.0;
    const e = $('reaction');
    if (e) { e.textContent = text; e.style.color = color || '#4fd6d0'; e.classList.add('show'); }
  }
  function hint(text, sec) {
    const e = $('hint');
    if (e) { e.textContent = text; e.classList.add('show'); }
    S.tutorialUntil = now() + (sec || 3.2);
  }
  function tutorial() {
    const steps = [
      'Джойстик слева — движение. Свайп по нему — уклонение.',
      'Тап по навыкам справа — комбо. Третий удар усилен.',
      'Красная зона — телеграф босса: уйди за 1 секунду.',
      'Ультимейт заряжается от урона. Сломай стойкость босса!'
    ];
    if (S.tutorialStep < steps.length) hint(steps[S.tutorialStep], 4.0);
    S.tutorialStep++;
  }

  /* ------------------------------- звук ---------------------------------- */
  const audio = { ctx: null, master: null };
  function initAudio() {
    if (audio.ctx || typeof AudioContext === 'undefined') return;
    try {
      audio.ctx = new AudioContext();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.16;
      audio.master.connect(audio.ctx.destination);
    } catch (e) { audio.ctx = null; }
  }
  function sfx(kind) {
    if (!S.settings.sound || !audio.ctx || !audio.master) return;
    const ac = audio.ctx, t = ac.currentTime;
    const spec = {
      hit: [190, 90, 0.09, 'square'], crit: [420, 130, 0.16, 'sawtooth'],
      cast: [310, 520, 0.10, 'sine'], dodge: [520, 240, 0.12, 'triangle'],
      telegraph: [130, 130, 0.28, 'sawtooth'], hurt: [110, 60, 0.20, 'square'],
      reaction: [660, 990, 0.24, 'sine'], ultimate: [90, 880, 0.55, 'sawtooth'],
      win: [440, 880, 0.65, 'sine'], lose: [220, 70, 0.6, 'triangle'],
      break: [160, 70, 0.28, 'square']
    }[kind] || [300, 300, 0.1, 'sine'];
    try {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = spec[3];
      o.frequency.setValueAtTime(spec[0], t);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, spec[1]), t + spec[2]);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + spec[2]);
      o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + spec[2] + 0.02);
    } catch (e) { /* без звука — игра не ломается */ }
  }
  function buzz(ms) {
    if (!S.settings.vibration || typeof navigator === 'undefined' || !navigator.vibrate) return;
    try { navigator.vibrate(ms); } catch (e) { /* noop */ }
  }

  /* -------------------------- проекция / камера -------------------------- */
  function rot(x, y) {
    switch (S.orient) {
      case 1: return [A - y, x];
      case 2: return [A - x, A - y];
      case 3: return [y, A - x];
      default: return [x, y];
    }
  }
  function unrot(X, Y) {
    switch (S.orient) {
      case 1: return [Y, A - X];
      case 2: return [A - X, A - Y];
      case 3: return [A - Y, X];
      default: return [X, Y];
    }
  }
  function project(x, y, h) {
    const r = rot(x, y), z = S.zoom;
    return {
      x: (r[0] - r[1]) * TILE_W / 2 * z + S.camX,
      y: (r[0] + r[1]) * TILE_H / 2 * z - (h || 0) * H_UNIT * z + S.camY
    };
  }
  // Обратный поворот для ВЕКТОРОВ (без переноса A), в отличие от unrot() для координат.
  function unrotDelta(X, Y) {
    switch (S.orient) {
      case 1: return [Y, -X];   // rot(dx,dy) = (−dy, dx)
      case 2: return [-X, -Y];
      case 3: return [-Y, X];
      default: return [X, Y];
    }
  }
  function screenToWorldDelta(sx, sy) {
    // обратная изометрия + обратный поворот: экранный ввод → мировой вектор
    const wx = (sx / (TILE_W / 2) + sy / (TILE_H / 2)) / 2;
    const wy = (sy / (TILE_H / 2) - sx / (TILE_W / 2)) / 2;
    const w = unrotDelta(wx, wy);
    return { x: w[0], y: w[1] };
  }
  function worldToScreenDelta(dx, dy) {
    // прямой поворот для векторов: используется ботами/тестами и подсказками
    let X = dx, Y = dy;
    switch (S.orient) {
      case 1: X = -dy; Y = dx; break;
      case 2: X = -dx; Y = -dy; break;
      case 3: X = dy; Y = -dx; break;
    }
    return { sx: (X - Y) * TILE_W / 2, sy: (X + Y) * TILE_H / 2 };
  }
  function centerCamera(dt) {
    const p = S.player;
    if (!p) return;
    const r = rot(p.x, p.y), z = S.zoom;
    const tx = VW / 2 - (r[0] - r[1]) * TILE_W / 2 * z;
    const ty = VH / 2 - (r[0] + r[1]) * TILE_H / 2 * z + 10;
    const k = Math.min(1, dt * 4.5);
    S.camX += (tx - S.camX) * k;
    S.camY += (ty - S.camY) * k;
  }

  /* ----------------------------- сущности -------------------------------- */
  function makePlayer() {
    const m = CLASS_META[S.classId];
    return {
      x: A / 2, y: A / 2 + 6, hp: PLAYER_HP, maxHp: PLAYER_HP,
      res: m.resStart, maxRes: m.resMax, charges: 6, chargeTimer: 0,
      cd: {}, ult: 0, ultReady: false, crit: BASE_CRIT,
      dodgeCharges: 2, dodgeTimer: 0, iframe: 0, recovery: 0,
      dr: 0, drUntil: 0, shield: 0, physUntil: 0,
      comboIndex: 0, comboTimer: 0, facing: { x: 0, y: -1 },
      alive: true, flash: 0
    };
  }
  function makeBoss() {
    return {
      x: A / 2, y: A / 2 - 4, hp: BOSS_HP, maxHp: BOSS_HP, def: BOSS_DEF,
      stagger: 0, stunUntil: 0, vulnUntil: 0, physUntil: 0, dmgDownUntil: 0,
      phase: 1, nextCast: 2.2, enrage: false, adsSpawned: false,
      statuses: [], alive: true, facing: 0, flash: 0,
      name: 'СТРАЖ РУБЕЖА'
    };
  }
  function makeAdd(i) {
    const b = S.boss;
    return {
      x: clamp(b.x + (i ? 3.4 : -3.4), 2, A - 2), y: clamp(b.y + 2.4, 2, A - 2),
      hp: 90000, maxHp: 90000, def: 1500, nextAttack: 1.4 + i * 0.5,
      alive: true, flash: 0, statuses: [], add: true
    };
  }

  /* ------------------------------ эффекты -------------------------------- */
  function particles(x, y, n, color, power, kind) {
    if (!S.settings.motion) n = Math.min(n, 6);
    if (S.particles.length > 220) return;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(0.6, 2.4) * (power || 1);
      S.particles.push({
        x, y, z: rnd(0.2, 1.3), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        vz: rnd(1.2, 4.2), life: rnd(0.35, 0.85), max: 0.85,
        color: color || '#f0d27a', size: rnd(1.5, 4.2), kind: kind || 'spark'
      });
    }
  }
  function number(x, y, text, color, crit) {
    if (!S.settings.numbers) return;
    if (S.numbers.length > 40) S.numbers.shift();
    S.numbers.push({ x, y, z: 1.7, text, color, crit: !!crit, life: 0.9, vy: 1.8 });
  }
  function shake(v) { if (S.settings.motion) S.shake = Math.max(S.shake, v); }
  function flash(v) { if (S.settings.motion) S.flash = Math.max(S.flash, v); }

  /* ------------------------------- урон ---------------------------------- */
  function bossMitigation(target) { const d = target.def || BOSS_DEF; return 1 - d / (d + K_DEF); }
  function dealTo(target, coeff, opts) {
    if (!target || !target.alive) return 0;
    opts = opts || {};
    const crit = Math.random() < S.player.crit;
    let dmg = WEAPON_HIT * coeff * ADD * MULT * bossMitigation(target);
    if (crit) dmg *= CRIT_MULT;
    if (target.vulnUntil > now()) dmg *= 1.25;
    if (target.physUntil > now() && opts.physical) dmg *= 1.35;
    dmg = Math.round(dmg);
    target.hp -= dmg;
    target.flash = 0.14;
    S.damageDealt += dmg; S.dmgWindow.push({ t: now(), d: dmg });
    S.player.ult = clamp(S.player.ult + dmg / 12000, 0, 100);
    if (crit) S.critCount++;
    number(target.x, target.y, crit ? '✦ ' + dmg.toLocaleString('ru-RU') : dmg.toLocaleString('ru-RU'),
      crit ? '#ffe27a' : '#e9efed', crit);
    particles(target.x, target.y, crit ? 14 : 7, crit ? '#ffe27a' : '#e8b25c', crit ? 1.5 : 1);
    if (crit) { shake(4.5); buzz(18); sfx('crit'); } else sfx('hit');
    if (!target.add) {
      target.stagger += opts.break ? 62000 : 7000;
      if (target.stagger >= STAGGER_MAX) breakStagger(target);
    }
    if (target.hp <= 0) kill(target);
    return dmg;
  }
  function breakStagger(b) {
    b.stagger = 0; b.stunUntil = now() + 2.2; b.vulnUntil = now() + 6.0;
    showReaction('СТОЙКОСТЬ СЛОМАНА', '#f0d27a');
    particles(b.x, b.y, 34, '#4fd6d0', 2.0, 'ring');
    shake(9); flash(0.25); sfx('break'); buzz(45);
  }
  function kill(e) {
    e.alive = false; e.hp = 0; S.kills++;
    particles(e.x, e.y, 26, e.add ? '#d6534f' : '#f0d27a', 1.8);
    if (!e.add) { sfx('win'); endGame(true); }
  }
  function hurtPlayer(raw, label) {
    const p = S.player;
    if (!p.alive) return;
    if (p.iframe > 0) {
      number(p.x, p.y, 'УКЛОНЕНИЕ', '#4fd6d0');
      particles(p.x, p.y, 10, '#4fd6d0', 1.2);
      return;
    }
    let dmg = raw * (1 - PLAYER_DEF / (PLAYER_DEF + K_DEF)) * (1 - (p.dr || 0));
    if (S.boss && S.boss.enrage) dmg *= 2;
    if (S.boss && S.boss.dmgDownUntil > now()) dmg *= 0.75;
    dmg = Math.round(dmg);
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed; dmg -= absorbed;
      number(p.x, p.y, 'ЩИТ −' + Math.round(absorbed), '#4fd6d0');
    }
    p.hp -= dmg; S.damageTaken += dmg; p.flash = 0.2;
    if (dmg > 0) {
      number(p.x, p.y, '−' + dmg, '#ff9a8a');
      shake(6); buzz(30); sfx('hurt'); flash(0.18);
      particles(p.x, p.y, 10, '#d6534f', 1.3);
    }
    if (p.res !== undefined && S.classId === 'warrior') p.res = clamp(p.res + 7, 0, p.maxRes);
    if (label) toast(label);
    if (p.hp <= 0) { p.hp = 0; p.alive = false; sfx('lose'); endGame(false); }
  }

  /* -------------------------- стихии и реакции --------------------------- */
  function applyElement(target, el) {
    if (!el || !target || !target.alive) return;
    const t = now();
    target.statuses = (target.statuses || []).filter(s => s.until > t);
    const prev = target.statuses.find(s => s.el !== el);
    if (prev) {
      const r = REACTIONS[pairKey(prev.el, el)] || { name: 'ГАРМОНИЯ', coeff: 2.2, color: '#a878e0' };
      triggerReaction(r, target);
      target.statuses = target.statuses.filter(s => s !== prev);
    }
    target.statuses.push({ el, until: t + 6 });
    if (new Set(target.statuses.map(s => s.el)).size >= 3) {
      triggerReaction({ name: 'ГАРМОНИЯ', coeff: 2.2, color: '#a878e0' }, target);
      target.statuses.length = 0;
    }
  }
  function triggerReaction(r, target) {
    S.reactions++;
    showReaction(r.name, r.color);
    sfx('reaction'); buzz(24); flash(0.12);
    particles(target.x, target.y, 22, r.color, 1.7, 'ring');
    const bonus = Math.round(WEAPON_HIT * r.coeff * ADD * MULT * bossMitigation(target));
    target.hp -= bonus; S.damageDealt += bonus; S.dmgWindow.push({ t: now(), d: bonus });
    S.player.ult = clamp(S.player.ult + bonus / 12000, 0, 100);
    number(target.x, target.y, r.name + ' ' + bonus.toLocaleString('ru-RU'), r.color);
    if (r.name === 'СТЕКЛОВАНИЕ') target.physUntil = now() + 6;
    if (r.name === 'ОЧИЩЕНИЕ') S.player.shield += PLAYER_HP * 0.08;
    if (r.name === 'ЗАТЕМНЕНИЕ' && S.boss) S.boss.dmgDownUntil = now() + 6;
    if (target.hp <= 0) kill(target);
  }

  /* ------------------------------ навыки --------------------------------- */
  function meta(name) {
    return DATA[S.classId] && DATA[S.classId][name] ? DATA[S.classId][name] : FALLBACK[S.classId][name] || { coeff: 1, cd: 0, cost: '0', effect: '' };
  }
  function parseCost(str) {
    const s = String(str || '');
    const m = s.match(/(\d+)/);
    return { gain: /^\+/.test(s), n: m ? parseInt(m[1], 10) : 0 };
  }
  function rangeToBoss() { return S.boss ? dist(S.player.x, S.player.y, S.boss.x, S.boss.y) : 99; }
  function faceBoss() {
    if (!S.boss) return;
    const dx = S.boss.x - S.player.x, dy = S.boss.y - S.player.y, d = Math.hypot(dx, dy) || 1;
    S.player.facing.x = dx / d; S.player.facing.y = dy / d;
  }
  function activeTargets(radius, fromPlayer) {
    const out = [];
    const ox = fromPlayer ? S.player.x : S.boss.x, oy = fromPlayer ? S.player.y : S.boss.y;
    if (S.boss && S.boss.alive && dist(ox, oy, S.boss.x, S.boss.y) <= radius) out.push(S.boss);
    S.enemies.forEach(e => { if (e.alive && dist(ox, oy, e.x, e.y) <= radius) out.push(e); });
    return out;
  }
  function comboHit(coeff, element) {
    const p = S.player;
    p.comboIndex = (p.comboIndex + 1) % 3;
    const third = p.comboIndex === 2;
    const c = coeff * (third ? 1.65 : 1);
    p.comboTimer = 2.0;
    S.combo++; S.comboTimer = 2.0;
    const targets = activeTargets(CLASS_META[S.classId].range + 0.6, true);
    if (!targets.length) { toast('Цель вне досягаемости'); particles(p.x + p.facing.x, p.y + p.facing.y, 5, '#8ba2b0', 0.6); return 0; }
    targets.forEach(t => {
      dealTo(t, c, { physical: element === 'Физический' });
      applyElement(t, element === 'Эфир' ? null : element);
    });
    if (S.classId === 'warrior') p.res = clamp(p.res + 8, 0, p.maxRes);
    else { p.charges = clamp(p.charges + 1, 0, 6); }
    if (third) { shake(3); particles(p.x, p.y, 8, '#f0d27a', 0.9); }
    return c;
  }

  function castSkill(i) {
    if (S.mode !== 'playing' || !S.player || !S.player.alive) return false;
    const slot = PANEL[S.classId][i];
    if (!slot) return false;
    const p = S.player, m = meta(slot.name);
    if ((p.cd[slot.name] || 0) > 0) { toast('КД ' + Math.ceil(p.cd[slot.name]) + ' с'); return false; }
    const cost = parseCost(m.cost);
    if (!cost.gain && cost.n > 0) {
      if (S.classId === 'warrior' && p.res < cost.n) { toast('Мало Ярости'); return false; }
      if (S.classId === 'mage' && p.res < cost.n) { toast('Мало Маны'); return false; }
      if (S.classId === 'mage' && (slot.behavior === 'element' || slot.behavior === 'reaction') && p.charges < (slot.behavior === 'reaction' ? 2 : 1)) {
        toast('Нет Астральных зарядов'); return false;
      }
    }
    faceBoss();
    p.cd[slot.name] = m.cd;
    if (!cost.gain && cost.n > 0) {
      if (S.classId === 'warrior') p.res -= cost.n;
      else p.res -= cost.n;
      if (S.classId === 'mage') p.charges -= (slot.behavior === 'reaction' ? 2 : (slot.behavior === 'element' ? 1 : 0));
    }
    sfx('cast');
    let used = true;
    switch (slot.behavior) {
      case 'basic':
        comboHit(m.coeff, slot.element); break;
      case 'strike':
        activeTargets(CLASS_META[S.classId].range, true).forEach(t => { dealTo(t, m.coeff, { physical: true }); applyElement(t, 'Физический'); });
        particles(p.x + p.facing.x * 1.2, p.y + p.facing.y * 1.2, 12, '#e8b25c', 1.2); break;
      case 'dash': {
        const d = rangeToBoss();
        if (d > 0.3) {
          const step = Math.min(3.1, d - 1.6);
          p.x += (S.boss.x - p.x) / d * step; p.y += (S.boss.y - p.y) / d * step;
        }
        p.dr = 0.12; p.drUntil = now() + 3;
        particles(p.x, p.y, 16, '#f0d27a', 1.4);
        activeTargets(2.4, true).forEach(t => dealTo(t, m.coeff, { physical: true }));
        shake(3); break;
      }
      case 'guard':
        p.dr = 0.35; p.drUntil = now() + 6;
        showReaction('СТОЙКА БАСТИОНА', '#e8b25c');
        particles(p.x, p.y, 14, '#e8b25c', 0.8, 'ring'); break;
      case 'aoe':
        activeTargets(3.4, true).forEach((t, idx) => { for (let k = 0; k < 4; k++) dealTo(t, m.coeff * 0.55, { physical: true }); });
        particles(p.x, p.y, 26, '#e8b25c', 1.7, 'ring'); shake(4); break;
      case 'break':
        activeTargets(CLASS_META[S.classId].range + 1, true).forEach(t => {
          dealTo(t, m.coeff, { physical: true, break: true });
          t.vulnUntil = now() + 8;
        });
        showReaction('ПРОБИТИЕ БРОНИ', '#f0d27a'); particles(p.x, p.y, 18, '#f0d27a', 1.5); break;
      case 'element': {
        const targets = activeTargets(CLASS_META[S.classId].range + 1.5, true);
        if (!targets.length) { toast('Цель вне досягаемости'); used = false; break; }
        targets.forEach(t => { dealTo(t, m.coeff); applyElement(t, slot.element); });
        particles(p.x, p.y, 16, slot.element === 'Лёд' ? '#bfe9ff' : slot.element === 'Молния' ? '#ffe27a' : '#ff9a5c', 1.3, 'ring');
        break;
      }
      case 'shield':
        p.shield += PLAYER_HP * 0.25;
        showReaction('АСТРАЛЬНЫЙ БАРЬЕР', '#4fd6d0'); particles(p.x, p.y, 16, '#4fd6d0', 0.9, 'ring'); break;
      case 'reaction': {
        const targets = activeTargets(6, true);
        targets.forEach(t => {
          dealTo(t, m.coeff);
          const st = (t.statuses || []).filter(s => s.until > now());
          if (st.length) triggerReaction({ name: 'ГАРМОНИЯ', coeff: 2.2, color: '#a878e0' }, t);
          else applyElement(t, 'Огонь');
        });
        particles(p.x, p.y, 24, '#a878e0', 1.7, 'ring'); flash(0.2); break;
      }
      default: used = false;
    }
    if (used && S.tutorialStep === 1) tutorial();
    return used;
  }

  function dodge(dx, dy) {
    if (S.mode !== 'playing' || !S.player || !S.player.alive) return false;
    const p = S.player;
    if (p.dodgeCharges <= 0) { toast('Нет зарядов доджа'); return false; }
    if (p.recovery > 0) return false;
    let vx = dx, vy = dy;
    if (Math.hypot(vx, vy) < 0.1) { vx = -p.facing.x; vy = -p.facing.y; }
    const len = Math.hypot(vx, vy) || 1;
    p.x = clamp(p.x + vx / len * 3.1, 1.5, A - 1.5);
    p.y = clamp(p.y + vy / len * 3.1, 1.5, A - 1.5);
    p.iframe = 0.30; p.recovery = 0.15;
    p.dodgeCharges--;
    if (p.dodgeCharges === 1) p.dodgeTimer = 5.5;
    S.dodgeCount++;
    particles(p.x - vx / len * 1.2, p.y - vy / len * 1.2, 18, '#4fd6d0', 1.3);
    sfx('dodge'); buzz(15);
    if (S.tutorialStep === 2) tutorial();
    return true;
  }

  function useUltimate() {
    if (S.mode !== 'playing' || !S.player || !S.player.alive) return false;
    const p = S.player;
    if (p.ult < 100) { toast('Искра заряжена на ' + Math.floor(p.ult) + '%'); return false; }
    p.ult = 0;
    const u = ULTIMATE[S.classId], m = meta(u.name);
    showReaction(u.name.toUpperCase(), '#4fd6d0');
    sfx('ultimate'); buzz(60); shake(14); flash(0.45);
    particles(p.x, p.y, 46, '#4fd6d0', 2.4, 'ring');
    activeTargets(6.5, true).forEach(t => {
      dealTo(t, m.coeff);
      if (S.classId === 'mage') applyElement(t, 'Огонь');
    });
    if (S.classId === 'warrior') { p.dr = 0.45; p.drUntil = now() + 8; p.hp = clamp(p.hp + PLAYER_HP * 0.2, 0, PLAYER_HP); }
    else { p.shield += PLAYER_HP * 0.2; }
    return true;
  }

  /* ------------------------------- босс ---------------------------------- */
  function createTelegraph() {
    const b = S.boss, p = S.player;
    if (!b || !b.alive || b.stunUntil > now()) return;
    const kinds = b.phase >= 3 ? ['cone', 'circle', 'line', 'ring', 'cone'] : ['cone', 'circle', 'line', 'ring'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const ang = Math.atan2(p.y - b.y, p.x - b.x);
    const t = {
      kind, x: b.x, y: b.y, angle: ang, created: now(), resolved: false, fade: 0,
      duration: (S.settings.slow ? 1.15 : 1.0) + (b.phase === 1 ? 0.4 : 0.15),
      damage: rnd(2600, 4200) + b.phase * 500,
      radius: 0, inner: 0, length: 0, width: 0, halfAngle: Math.PI / 3
    };
    if (kind === 'cone') t.radius = 3.6;                         // 7.2 м
    if (kind === 'circle') { t.x = p.x; t.y = p.y; t.radius = 3.9; } // 7.8 м
    if (kind === 'line') { t.length = 6.2; t.width = 1.5; }     // 12.4 м
    if (kind === 'ring') { t.radius = 3.4; t.inner = 1.4; }
    S.telegraphs.push(t);
    sfx('telegraph'); toast('⚠ ' + ({ cone: 'КОНУС', circle: 'КРУГ', line: 'ЛИНИЯ', ring: 'КОЛЬЦО' })[kind]);
  }
  function inTelegraph(t, px, py) {
    if (t.kind === 'circle' || t.kind === 'ring') {
      const d = dist(px, py, t.x, t.y);
      return t.kind === 'circle' ? d <= t.radius : (d <= t.radius && d >= t.inner);
    }
    if (t.kind === 'cone') {
      const d = dist(px, py, t.x, t.y);
      if (d > t.radius) return false;
      let a = Math.atan2(py - t.y, px - t.x) - t.angle;
      while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
      return Math.abs(a) <= t.halfAngle;
    }
    if (t.kind === 'line') {
      const dx = Math.cos(t.angle), dy = Math.sin(t.angle);
      const rx = px - t.x, ry = py - t.y;
      const along = rx * dx + ry * dy, perp = Math.abs(-rx * dy + ry * dx);
      return along >= -0.2 && along <= t.length && perp <= t.width;
    }
    return false;
  }
  function resolveTelegraph(t) {
    t.resolved = true; t.fade = 0.3;
    particles(t.kind === 'circle' ? t.x : t.x + Math.cos(t.angle) * 2,
      t.kind === 'circle' ? t.y : t.y + Math.sin(t.angle) * 2, 22, '#e0574f', 1.8, 'ring');
    shake(7);
    if (inTelegraph(t, S.player.x, S.player.y)) hurtPlayer(t.damage);
    else number(S.player.x, S.player.y, 'МИМО', '#4fd6d0');
  }
  function updateBoss(dt) {
    const b = S.boss;
    if (!b || !b.alive) return;
    const p = S.player;
    const frac = b.hp / b.maxHp;
    const newPhase = frac > 0.75 ? 1 : frac > 0.5 ? 2 : frac > 0.25 ? 3 : 4;
    if (newPhase > b.phase) {
      b.phase = newPhase;
      showReaction('ФАЗА ' + ['I', 'II', 'III', 'IV'][newPhase - 1], '#e0574f');
      particles(b.x, b.y, 30, '#e0574f', 2.0, 'ring'); shake(8); sfx('break');
      if (newPhase >= 3 && !b.adsSpawned) {
        b.adsSpawned = true;
        S.enemies.push(makeAdd(0), makeAdd(1));
        toast('Призыв: стражи Рубежа');
      }
    }
    if (!b.enrage && S.time >= ENRAGE_AT) {
      b.enrage = true; showReaction('ЯРОСТЬ БОССА', '#e0574f'); flash(0.3);
    }
    b.facing = Math.atan2(p.y - b.y, p.x - b.x);
    if (b.stunUntil > now()) return;
    b.nextCast -= dt;
    if (b.nextCast <= 0) {
      createTelegraph();
      const base = 3.9 - b.phase * 0.35;
      b.nextCast = Math.max(1.7, base * (b.enrage ? 0.72 : 1));
    }
  }
  function updateEnemies(dt) {
    const p = S.player;
    S.enemies.forEach(e => {
      if (!e.alive) return;
      const d = dist(e.x, e.y, p.x, p.y);
      if (d > 1.4) {
        e.x += (p.x - e.x) / d * dt * 1.9;
        e.y += (p.y - e.y) / d * dt * 1.9;
      } else {
        e.nextAttack -= dt;
        if (e.nextAttack <= 0) { hurtPlayer(950); e.nextAttack = 1.5; }
      }
    });
    S.enemies = S.enemies.filter(e => e.alive || e.fade > 0);
  }

  /* ------------------------------ симуляция ------------------------------ */
  function updatePlayer(dt) {
    const p = S.player;
    if (!p || !p.alive) return;
    const c = CLASS_META[S.classId];
    // движение (джойстик + клавиатура), в пространстве камеры
    let sx = S.joy.dx, sy = S.joy.dy;
    if (S.key['w'] || S.key['arrowup']) sy -= 1;
    if (S.key['s'] || S.key['arrowdown']) sy += 1;
    if (S.key['a'] || S.key['arrowleft']) sx -= 1;
    if (S.key['d'] || S.key['arrowright']) sx += 1;
    const mag = Math.hypot(sx, sy);
    if (mag > 0.08) {
      const w = screenToWorldDelta(sx / Math.max(1, mag), sy / Math.max(1, mag));
      const wl = Math.hypot(w.x, w.y) || 1;
      const sp = MOVE_SPEED * dt * (p.recovery > 0 ? 0.4 : 1);
      p.x = clamp(p.x + w.x / wl * sp, 1.2, A - 1.2);
      p.y = clamp(p.y + w.y / wl * sp, 1.2, A - 1.2);
      p.facing.x = w.x / wl; p.facing.y = w.y / wl;
      if (S.tutorialStep === 0) tutorial();
    }
    // ресурсы, КД, баффы
    p.res = clamp(p.res + c.regen * dt, 0, p.maxRes);
    if (S.classId === 'mage') {
      p.chargeTimer += dt;
      if (p.chargeTimer >= 2.5) { p.chargeTimer = 0; p.charges = clamp(p.charges + 1, 0, 6); }
    }
    Object.keys(p.cd).forEach(k => { if (p.cd[k] > 0) p.cd[k] = Math.max(0, p.cd[k] - dt); });
    if (p.dodgeCharges < 2) {
      p.dodgeTimer -= dt;
      if (p.dodgeTimer <= 0) { p.dodgeCharges++; p.dodgeTimer = p.dodgeCharges < 2 ? 5.5 : 0; }
    }
    p.iframe = Math.max(0, p.iframe - dt);
    p.recovery = Math.max(0, p.recovery - dt);
    if (p.drUntil <= now()) p.dr = 0;
    if (p.shield > 0 && S.boss && S.boss.statuses.length === 0) { /* щит не тает: честный 6-секундный буфер */ }
    p.comboTimer -= dt;
    p.flash = Math.max(0, p.flash - dt);
    if (S.comboTimer > 0) S.comboTimer -= dt; else S.combo = 0;
    // окно DPS за 3 с
    S.dmgWindow = S.dmgWindow.filter(x => now() - x.t <= 3);
    S.dps = Math.round(S.dmgWindow.reduce((a, x) => a + x.d, 0) / 3);
  }
  function updateEffects(dt) {
    S.particles.forEach(q => {
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
      q.z += q.vz * dt; q.vz -= 9 * dt;
      if (q.z < 0) { q.z = 0; q.vz *= -0.35; }
    });
    S.particles = S.particles.filter(q => q.life > 0);
    S.numbers.forEach(n => { n.life -= dt; n.z += n.vy * dt; n.vy *= 0.94; });
    S.numbers = S.numbers.filter(n => n.life > 0);
    S.telegraphs.forEach(t => {
      if (!t.resolved && now() - t.created >= t.duration) resolveTelegraph(t);
      if (t.resolved) t.fade -= dt;
    });
    S.telegraphs = S.telegraphs.filter(t => t.fade > 0 || !t.resolved);
    S.shake = Math.max(0, S.shake - dt * 22);
    S.flash = Math.max(0, S.flash - dt * 2.2);
    if (S.player) S.player.flash = Math.max(0, S.player.flash - dt);
    if (S.boss) S.boss.flash = Math.max(0, S.boss.flash - dt);
    S.enemies.forEach(e => { if (!e.alive) e.fade = (e.fade || 0.5) - dt; });
    if ($('toast') && now() > S.toastUntil) $('toast').classList.remove('show');
    if ($('reaction') && now() > S.reactionUntil) $('reaction').classList.remove('show');
    if ($('hint') && now() > S.tutorialUntil) $('hint').classList.remove('show');
  }
  function step(dt) {
    if (S.mode !== 'playing') return;
    S.time += dt; S.tick++;
    updatePlayer(dt);
    updateBoss(dt);
    updateEnemies(dt);
    updateEffects(dt);
    if (!S.boss || !S.boss.alive || !S.player || !S.player.alive) S.mode = 'end';
  }

  /* ------------------------------- рендер -------------------------------- */
  function poly(points, fill, stroke, alpha) {
    if (!ctx || !points.length) return;
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.4; ctx.stroke(); }
    ctx.restore();
  }
  function diamond(x, y, fill, stroke, alpha) {
    const a = project(x - 0.5, y - 0.5, 0), b = project(x + 0.5, y - 0.5, 0),
      c = project(x + 0.5, y + 0.5, 0), d = project(x - 0.5, y + 0.5, 0);
    poly([a, b, c, d], fill, stroke, alpha);
  }
  function drawGround() {
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, '#101f28'); grad.addColorStop(1, '#070d13');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, VW, VH);
    for (let x = 0; x <= A; x++) for (let y = 0; y <= A; y++) {
      const h = (x * 73 + y * 137) % 11;
      const even = (x + y) % 2 === 0;
      const r = 34 + h + (even ? 6 : 0), g = 52 + h + (even ? 8 : 0), b = 46 + h;
      diamond(x, y, `rgb(${r},${g},${b})`, 'rgba(120,170,150,.055)');
    }
    // граница арены: приподнятые блоки
    for (let i = 0; i <= A; i++) {
      const edge = 'rgba(232,178,92,.18)';
      poly([project(i - .5, -.5, 0), project(i + .5, -.5, 0), project(i + .5, -.5, .5), project(i - .5, -.5, .5)], '#1b2a2d', edge);
      poly([project(A + .5, i - .5, 0), project(A + .5, i + .5, 0), project(A + .5, i + .5, .5), project(A + .5, i - .5, .5)], '#17262a', edge);
    }
    // Светоч Зелени в центре
    const c = project(A / 2, A / 2, 0);
    const rg = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 110 * S.zoom);
    rg.addColorStop(0, 'rgba(240,210,122,.32)'); rg.addColorStop(1, 'rgba(240,210,122,0)');
    ctx.fillStyle = rg; ctx.fillRect(c.x - 120, c.y - 120, 240, 240);
    // колонны-ориентиры (правило трёх ориентиров)
    [[4, 4], [A - 4, 4], [4, A - 4], [A - 4, A - 4]].forEach(([x, y]) => {
      poly([project(x - .45, y - .45, 0), project(x + .45, y - .45, 0), project(x + .45, y + .45, 0), project(x - .45, y + .45, 0)], '#25383c', 'rgba(79,214,208,.25)');
      poly([project(x - .32, y - .32, 0), project(x + .32, y - .32, 0), project(x + .32, y - .32, 1.6), project(x - .32, y - .32, 1.6)], '#2d4348', 'rgba(79,214,208,.18)');
    });
  }
  function telegraphPoints(t) {
    const pts = [];
    if (t.kind === 'circle' || t.kind === 'ring') {
      for (let i = 0; i < 32; i++) {
        const a = i / 32 * Math.PI * 2;
        pts.push(project(t.x + Math.cos(a) * t.radius, t.y + Math.sin(a) * t.radius, 0));
      }
    } else if (t.kind === 'cone') {
      pts.push(project(t.x, t.y, 0));
      for (let i = 0; i <= 18; i++) {
        const a = t.angle - t.halfAngle + (2 * t.halfAngle) * i / 18;
        pts.push(project(t.x + Math.cos(a) * t.radius, t.y + Math.sin(a) * t.radius, 0));
      }
    } else if (t.kind === 'line') {
      const dx = Math.cos(t.angle), dy = Math.sin(t.angle), px = -dy, py = dx;
      pts.push(project(t.x + px * t.width, t.y + py * t.width, 0));
      pts.push(project(t.x + dx * t.length + px * t.width, t.y + dy * t.length + py * t.width, 0));
      pts.push(project(t.x + dx * t.length - px * t.width, t.y + dy * t.length - py * t.width, 0));
      pts.push(project(t.x - px * t.width, t.y - py * t.width, 0));
    }
    return pts;
  }
  function drawTelegraphs() {
    S.telegraphs.forEach(t => {
      const pts = telegraphPoints(t);
      const elapsed = clamp((now() - t.created) / t.duration, 0, 1);
      const alpha = t.resolved ? Math.max(0, t.fade / 0.3) * 0.55 : 0.18 + elapsed * 0.32;
      poly(pts, `rgba(224,87,79,${alpha.toFixed(3)})`, `rgba(255,170,120,${(0.55 + elapsed * 0.45).toFixed(2)})`);
      if (t.kind === 'ring') {
        const inner = [];
        for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; inner.push(project(t.x + Math.cos(a) * t.inner, t.y + Math.sin(a) * t.inner, 0)); }
        poly(inner, 'rgba(10,18,24,.75)', 'rgba(255,170,120,.4)');
      }
      // полоса готовности
      if (!t.resolved) {
        const head = project(t.x, t.y, 0);
        ctx.fillStyle = 'rgba(255,220,170,.9)';
        ctx.fillRect(head.x - 22, head.y - 34, 44 * elapsed, 3);
      }
    });
  }
  function drawShadow(e, scale) {
    const g = project(e.x, e.y, 0);
    ctx.save(); ctx.globalAlpha = .38; ctx.fillStyle = '#04090c';
    ctx.beginPath(); ctx.ellipse(g.x, g.y, 16 * scale * S.zoom, 7 * scale * S.zoom, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawEntity(e) {
    const isBoss = e === S.boss, isPlayer = e === S.player, add = !!e.add;
    const scale = isBoss ? 2.15 : add ? 0.72 : 1.0;
    const color = isPlayer ? CLASS_META[S.classId].color : isBoss ? '#d6534f' : '#b06fd0';
    drawShadow(e, scale);
    const base = project(e.x, e.y, 0), top = project(e.x, e.y, 1.15 * scale);
    const w = (isBoss ? 15 : add ? 6 : 9) * S.zoom;
    // тело
    ctx.save();
    const g = ctx.createLinearGradient(base.x - w, top.y, base.x + w, base.y);
    g.addColorStop(0, isPlayer ? '#4a5b63' : isBoss ? '#5a2730' : '#4a2f58');
    g.addColorStop(0.45, color); g.addColorStop(1, '#101a20');
    ctx.fillStyle = e.flash > 0 ? '#ffffff' : g;
    ctx.beginPath();
    ctx.moveTo(base.x - w, base.y);
    ctx.lineTo(top.x - w * 0.82, top.y);
    ctx.lineTo(top.x + w * 0.82, top.y);
    ctx.lineTo(base.x + w, base.y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = isPlayer ? 2 : 1; ctx.stroke();
    ctx.restore();
    // голова
    const head = project(e.x, e.y, 1.45 * scale);
    ctx.beginPath(); ctx.arc(head.x, head.y, (isBoss ? 10 : add ? 4.5 : 6.5) * S.zoom, 0, Math.PI * 2);
    ctx.fillStyle = e.flash > 0 ? '#fff' : (isBoss ? '#e8b25c' : isPlayer ? '#f0d27a' : '#d9b7e8');
    ctx.fill(); ctx.strokeStyle = '#0b1118'; ctx.lineWidth = 1.5; ctx.stroke();
    // рога/корона босса
    if (isBoss) {
      ctx.strokeStyle = '#f0d27a'; ctx.lineWidth = 3 * S.zoom;
      ctx.beginPath(); ctx.moveTo(head.x - 8 * S.zoom, head.y - 4 * S.zoom); ctx.lineTo(head.x - 14 * S.zoom, head.y - 18 * S.zoom);
      ctx.moveTo(head.x + 8 * S.zoom, head.y - 4 * S.zoom); ctx.lineTo(head.x + 14 * S.zoom, head.y - 18 * S.zoom); ctx.stroke();
      if (e.stunUntil > now()) {
        ctx.fillStyle = '#4fd6d0'; ctx.font = `${12 * S.zoom}px Arial`; ctx.textAlign = 'center';
        ctx.fillText('✦ ОГЛУШЁН ✦', head.x, head.y - 26 * S.zoom);
      }
    }
    // оружие / посох
    if (isPlayer) {
      const f = e.facing;
      const tip = project(e.x + f.x * 1.1, e.y + f.y * 1.1, 1.0);
      ctx.strokeStyle = S.classId === 'warrior' ? '#f0d27a' : '#4fd6d0';
      ctx.lineWidth = 3 * S.zoom;
      ctx.beginPath(); ctx.moveTo(base.x + w * 0.6, top.y + 6 * S.zoom); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    }
    // аура i-frames / щита
    if (isPlayer && (e.iframe > 0 || e.shield > 0)) {
      ctx.beginPath(); ctx.ellipse(base.x, base.y - 16 * S.zoom, 22 * S.zoom, 26 * S.zoom, 0, 0, Math.PI * 2);
      ctx.strokeStyle = e.iframe > 0 ? 'rgba(79,214,208,.85)' : 'rgba(240,210,122,.6)';
      ctx.lineWidth = 2; ctx.stroke();
    }
    // HP над аддами
    if (add && e.alive) {
      const hp = project(e.x, e.y, 2.0 * scale);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(hp.x - 16, hp.y, 32, 4);
      ctx.fillStyle = '#d6534f'; ctx.fillRect(hp.x - 16, hp.y, 32 * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
    if (isBoss && e.enrage) {
      const au = project(e.x, e.y, 0);
      ctx.beginPath(); ctx.ellipse(au.x, au.y, 40 * S.zoom, 18 * S.zoom, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(224,87,79,.45)'; ctx.lineWidth = 3; ctx.stroke();
    }
  }
  function drawParticles() {
    S.particles.forEach(q => {
      const p = project(q.x, q.y, q.z);
      ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, q.size * S.zoom, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    S.numbers.forEach(n => {
      const p = project(n.x, n.y, n.z);
      ctx.globalAlpha = clamp(n.life / 0.9, 0, 1);
      ctx.font = `700 ${n.crit ? 17 : 13}px Arial`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#0b1118'; ctx.strokeText(n.text, p.x, p.y);
      ctx.fillStyle = n.color; ctx.fillText(n.text, p.x, p.y);
    });
    ctx.globalAlpha = 1;
  }
  function render(dt) {
    if (!ctx) return;
    ctx.save();
    if (S.shake > 0) ctx.translate(rnd(-S.shake, S.shake), rnd(-S.shake, S.shake));
    if (S.mode === 'menu' || S.mode === 'end') S.menuTime += dt;
    centerCamera(dt);
    S.zoom += (S.targetZoom - S.zoom) * Math.min(1, dt * 8);
    drawGround();
    drawTelegraphs();
    const list = [];
    if (S.player && S.player.alive) list.push(S.player);
    if (S.boss && S.boss.alive) list.push(S.boss);
    S.enemies.forEach(e => { if (e.alive || e.fade > 0) list.push(e); });
    list.sort((a, b) => {
      const ra = rot(a.x, a.y), rb = rot(b.x, b.y);
      return (ra[0] + ra[1]) - (rb[0] + rb[1]);
    });
    list.forEach(drawEntity);
    drawParticles();
    ctx.restore();
    if (S.flash > 0) {
      ctx.fillStyle = `rgba(240,210,122,${(S.flash * 0.35).toFixed(3)})`;
      ctx.fillRect(0, 0, VW, VH);
    }
    // виньетка
    const vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * .35, VW / 2, VH / 2, Math.max(VW, VH) * .78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
  }

  /* -------------------------------- HUD ---------------------------------- */
  function updateUI() {
    if (S.mode !== 'playing' && S.mode !== 'paused') return;
    const p = S.player, b = S.boss;
    if (!p || !b) return;
    const set = (id, v) => { const e = $(id); if (e) e.style.width = clamp(v, 0, 100) + '%'; };
    set('pHp', p.hp / p.maxHp * 100);
    set('pRes', p.res / p.maxRes * 100);
    set('pUlt', p.ult);
    set('bossHp', b.hp / b.maxHp * 100);
    set('bossStagger', b.stagger / STAGGER_MAX * 100);
    const txt = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    txt('pHpText', Math.ceil(p.hp).toLocaleString('ru-RU') + ' / ' + p.maxHp.toLocaleString('ru-RU'));
    txt('bossPhase', 'ФАЗА ' + ['I', 'II', 'III', 'IV'][b.phase - 1]);
    const t = Math.floor(S.time);
    txt('bossTimer', String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
    txt('bossEnrage', b.enrage ? '⚠ ЯРОСТЬ' : (S.time > ENRAGE_AT - 20 ? 'ЯРОСТЬ ЧЕРЕЗ ' + Math.ceil(ENRAGE_AT - S.time) + ' с' : ''));
    txt('dpsText', S.dps.toLocaleString('ru-RU'));
    txt('comboText', S.combo);
    txt('dodgeCount', p.dodgeCharges);
    const ub = $('btnUlt'); if (ub) ub.classList.toggle('ready', p.ult >= 100);
    S.skillButtons.forEach((btn, i) => {
      const slot = PANEL[S.classId][i], m = meta(slot.name);
      const cd = p.cd[slot.name] || 0;
      const pct = m.cd > 0 ? cd / m.cd * 100 : 0;
      btn.style.setProperty('--cd', pct.toFixed(1));
      btn.classList.toggle('cooling', cd > 0);
      const tag = btn.querySelector ? btn.querySelector('.cdlabel') : null;
      if (tag) tag.textContent = cd > 0 ? Math.ceil(cd) + '' : '';
    });
  }

  /* --------------------------- экран финала ------------------------------ */
  function endGame(win) {
    S.mode = 'end';
    S.result = { win, time: S.time, dps: Math.round(S.damageDealt / Math.max(1, S.time)) };
    const title = $('endTitle'); if (title) { title.textContent = win ? 'СВЕТОЧ ЗАЖЖЁН' : 'ИСКРА ПОГАСЛА'; title.classList.toggle('lose', !win); }
    const sub = $('endSub'); if (sub) sub.textContent = win
      ? 'Страж Рубежа пал. Одна цель сессии закрыта.'
      : 'Возжённый пал, но Якорь Искры помнит тебя. Попробуй снова.';
    const stats = $('endStats');
    if (stats) stats.innerHTML = [
      ['ВРЕМЯ', Math.floor(S.time / 60) + ':' + String(Math.floor(S.time % 60)).padStart(2, '0')],
      ['DPS', S.result.dps.toLocaleString('ru-RU')],
      ['УРОН', (S.damageDealt / 1000000).toFixed(2) + 'M'],
      ['КРИТЫ', S.critCount], ['ДОДЖИ', S.dodgeCount], ['РЕАКЦИИ', S.reactions],
      ['ПОЛУЧЕНО', (S.damageTaken / 1000).toFixed(1) + 'K'], ['КОМБО', S.combo], ['ИСТОЧНИК', DATA_SOURCE === 'canon' ? 'CANON' : 'FALLBACK']
    ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
    const r1 = $('remember1'), r2 = $('remember2'), r3 = $('remember3');
    if (r1) r1.textContent = win ? '• Светоч Зелени в Зелёном Пределе перезажжён.' : '• Светоч Зелени всё ещё ждёт Возжённого.';
    if (r2) r2.textContent = '• Цена эфирита T3 на Бирже Причалов ' + (win ? '+' : '−') + '1.8% после вашего боя.';
    if (r3) r3.textContent = '• Гильдия «Седьмая Клятва» удержала территорию №17.';
    const hud = $('hud'); if (hud) hud.classList.add('hidden');
    const es = $('endScreen'); if (es) es.classList.remove('hidden');
  }

  /* --------------------------- старт / меню ------------------------------ */
  function buildSkillButtons() {
    const wrap = $('skills');
    if (!wrap || typeof document.createElement !== 'function') { S.skillButtons = []; return; }
    wrap.innerHTML = '';
    S.skillButtons = [];
    PANEL[S.classId].forEach((slot, i) => {
      const b = document.createElement('button');
      b.className = 'skill';
      b.setAttribute('aria-label', slot.name);
      const g = document.createElement('span'); g.className = 'glyph'; g.textContent = slot.glyph;
      const cd = document.createElement('span'); cd.className = 'cd';
      const lab = document.createElement('small'); lab.textContent = slot.short;
      const lab2 = document.createElement('span'); lab2.className = 'cdlabel';
      lab2.style.position = 'absolute'; lab2.style.top = '28%'; lab2.style.fontSize = '11px';
      lab2.style.color = '#ffd9a0'; lab2.style.zIndex = '4'; lab2.style.fontWeight = '700';
      b.appendChild(cd); b.appendChild(g); b.appendChild(lab); b.appendChild(lab2);
      b.addEventListener('pointerdown', ev => { ev.preventDefault(); castSkill(i); });
      wrap.appendChild(b);
      S.skillButtons.push(b);
    });
  }
  function buildCodex() {
    const c = $('codex'); if (!c) return;
    const rows = PANEL[S.classId].map(s => {
      const m = meta(s.name);
      return `<div class="row"><b>${s.glyph} ${s.name}</b><span>×${m.coeff.toFixed(2)} · КД ${m.cd} с · ${m.cost}<br>${m.effect}</span></div>`;
    });
    const u = ULTIMATE[S.classId], um = meta(u.name);
    rows.push(`<div class="row"><b>✦ ${u.name} (УЛЬТ)</b><span>×${um.coeff.toFixed(2)} · ${um.effect}</span></div>`);
    rows.push(`<div class="row"><b>↝ Уклонение</b><span>0.30 с i-frames · 2 заряда / 5.5 с · 6.2 м</span></div>`);
    c.innerHTML = rows.join('');
  }
  function startGame(classId) {
    S.classId = classId || S.classId;
    S.mode = 'playing'; S.time = 0; S.tick = 0; S.combo = 0; S.comboTimer = 0;
    S.critCount = 0; S.dodgeCount = 0; S.reactions = 0; S.damageDealt = 0;
    S.damageTaken = 0; S.dmgWindow = []; S.dps = 0; S.kills = 0; S.result = null;
    S.telegraphs = []; S.particles = []; S.numbers = []; S.enemies = [];
    S.player = makePlayer(); S.boss = makeBoss();
    S.orient = 1; S.zoom = 1; S.targetZoom = 1; S.shake = 0; S.flash = 0;
    S.tutorialStep = 0; S.joy.dx = 0; S.joy.dy = 0; S.joy.id = null;
    const av = $('pAvatar'); if (av) av.textContent = CLASS_META[S.classId].letter;
    const pn = $('pName'); if (pn) pn.textContent = CLASS_META[S.classId].ru;
    const bh = $('bossHint'); if (bh) bh.textContent = S.classId === 'warrior'
      ? 'Стойкость ломается «Разломным Ударом»' : 'Реакции: Огонь + Лёд = Пар, + Молния = Перегрузка';
    const bug = $('btnUlt'); if (bug) { const gl = bug.querySelector('.glyph'); if (gl) gl.textContent = ULTIMATE[S.classId].glyph; }
    buildSkillButtons(); buildCodex();
    ['startScreen', 'pauseScreen', 'endScreen'].forEach(id => { const e = $(id); if (e) e.classList.add('hidden'); });
    const hud = $('hud'); if (hud) hud.classList.remove('hidden');
    initAudio(); tutorial();
  }
  function toMenu() {
    S.mode = 'menu';
    const hud = $('hud'); if (hud) hud.classList.add('hidden');
    ['pauseScreen', 'endScreen'].forEach(id => { const e = $(id); if (e) e.classList.add('hidden'); });
    const ss = $('startScreen'); if (ss) ss.classList.remove('hidden');
  }
  function togglePause(force) {
    if (S.mode === 'playing') {
      S.mode = 'paused';
      const e = $('pauseScreen'); if (e) e.classList.remove('hidden');
      buildCodex();
    } else if (S.mode === 'paused' && force !== true) {
      S.mode = 'playing';
      const e = $('pauseScreen'); if (e) e.classList.add('hidden');
    }
  }

  /* ------------------------------- ввод ---------------------------------- */
  function bindInput() {
    // джойстик
    const joy = $('joy'), knob = $('joyKnob');
    if (joy && joy.addEventListener) {
      const rect = () => joy.getBoundingClientRect ? joy.getBoundingClientRect() : { left: 0, top: 0, width: 132, height: 132 };
      joy.addEventListener('pointerdown', ev => {
        ev.preventDefault(); initAudio();
        const r = rect();
        S.joy.id = ev.pointerId;
        S.joy.startX = ev.clientX; S.joy.startY = ev.clientY;
        S.joy.startT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        S.joy.x = r.left + r.width / 2; S.joy.y = r.top + r.height / 2;
        updateJoy(ev, knob);
      });
      joy.addEventListener('pointermove', ev => { if (S.joy.id === ev.pointerId) { ev.preventDefault(); updateJoy(ev, knob); } });
      const up = ev => {
        if (S.joy.id !== ev.pointerId) return;
        const dur = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - S.joy.startT;
        const d = Math.hypot(ev.clientX - S.joy.startX, ev.clientY - S.joy.startY);
        if (dur < 260 && d > 48) {
          const w = screenToWorldDelta((ev.clientX - S.joy.startX) / d, (ev.clientY - S.joy.startY) / d);
          dodge(w.x, w.y);
        }
        S.joy.id = null; S.joy.dx = 0; S.joy.dy = 0;
        if (knob) knob.style.transform = 'translate(0px,0px)';
      };
      joy.addEventListener('pointerup', up);
      joy.addEventListener('pointercancel', up);
    }
    // кнопки
    const on = (id, fn) => { const e = $(id); if (e && e.addEventListener) e.addEventListener('pointerdown', ev => { ev.preventDefault(); initAudio(); fn(); }); };
    on('btnDodge', () => dodge(S.joy.dx || -S.player.facing.x, S.joy.dy || -S.player.facing.y));
    on('btnUlt', useUltimate);
    on('btnPause', () => togglePause());
    on('btnStart', () => startGame(document.querySelector && document.querySelector('.class-card.selected') ? document.querySelector('.class-card.selected').dataset.class : S.classId));
    on('btnResume', () => togglePause());
    on('btnRestart', () => startGame(S.classId));
    on('btnMenu', toMenu);
    on('btnRetry', () => startGame(S.classId));
    on('btnEndMenu', toMenu);
    // выбор класса
    if (document.querySelectorAll) {
      document.querySelectorAll('.class-card').forEach(btn => {
        btn.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          document.querySelectorAll('.class-card').forEach(x => x.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
    }
    // настройки
    const bindCheck = (id, key) => {
      const e = $(id); if (!e || !e.addEventListener) return;
      e.addEventListener('change', () => {
        S.settings[key] = !!e.checked;
        if (key === 'slow') { const o = $('optSlow'); if (o) o.checked = e.checked; }
      });
    };
    bindCheck('optSlow', 'slow'); bindCheck('setSlow', 'slow');
    bindCheck('setMotion', 'motion'); bindCheck('setVib', 'vibration');
    bindCheck('setSound', 'sound'); bindCheck('setNumbers', 'numbers');
    const rh = $('btnHideRotate'); if (rh && rh.addEventListener) rh.addEventListener('pointerdown', () => { const e = $('rotateHint'); if (e) e.classList.add('hidden'); });
    // камера: зум и поворот двумя пальцами, тап — захват цели
    if (canvas && canvas.addEventListener) {
      canvas.addEventListener('pointerdown', ev => {
        S.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (S.pointers.size === 2) {
          const [a, b] = [...S.pointers.values()];
          S.pinch = { d: dist(a.x, a.y, b.x, b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), rot: 0 };
        }
      });
      canvas.addEventListener('pointermove', ev => {
        if (!S.pointers.has(ev.pointerId)) return;
        S.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (S.pointers.size === 2 && S.pinch) {
          const [a, b] = [...S.pointers.values()];
          const d = dist(a.x, a.y, b.x, b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
          const ratio = d / Math.max(1, S.pinch.d);
          if (Math.abs(ratio - 1) > 0.02) S.targetZoom = clamp(S.targetZoom * ratio, 0.65, 1.7);
          let da = ang - S.pinch.ang;
          while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
          S.pinch.rot += da; S.pinch.ang = ang; S.pinch.d = d;
          if (Math.abs(S.pinch.rot) > 0.55) {
            S.orient = (S.orient + (S.pinch.rot > 0 ? 3 : 1)) % 4;
            S.pinch.rot = 0;
            toast('Камера: ' + (S.orient * 90) + '°');
          }
        }
      });
      const clear = ev => { S.pointers.delete(ev.pointerId); if (S.pointers.size < 2) S.pinch = null; };
      canvas.addEventListener('pointerup', clear);
      canvas.addEventListener('pointercancel', clear);
      canvas.addEventListener('contextmenu', ev => ev.preventDefault());
    }
    // клавиатура (для ПК-превью и тестов)
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('keydown', ev => {
        const k = ev.key.toLowerCase(); S.key[k] = true;
        if (k >= '1' && k <= '6') castSkill(parseInt(k, 10) - 1);
        if (k === ' ') { ev.preventDefault(); dodge(0, 0); }
        if (k === 'r') useUltimate();
        if (k === 'q') S.orient = (S.orient + 3) % 4;
        if (k === 'e') S.orient = (S.orient + 1) % 4;
        if (k === '+' || k === '=') S.targetZoom = clamp(S.targetZoom + 0.1, 0.65, 1.7);
        if (k === '-') S.targetZoom = clamp(S.targetZoom - 0.1, 0.65, 1.7);
        if (k === 'escape') togglePause();
      });
      window.addEventListener('keyup', ev => { S.key[ev.key.toLowerCase()] = false; });
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 200));
      if (document.addEventListener) document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'playing') togglePause(true); });
    }
  }
  function updateJoy(ev, knob) {
    const dx = ev.clientX - S.joy.x, dy = ev.clientY - S.joy.y;
    const len = Math.hypot(dx, dy), max = 44;
    const k = len > max ? max / len : 1;
    S.joy.dx = clamp(dx / max, -1, 1); S.joy.dy = clamp(dy / max, -1, 1);
    if (knob) knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
  }

  /* ---------------------- загрузка канона и PWA -------------------------- */
  function loadCanon() {
    if (typeof fetch !== 'function') return;
    fetch('../data/classes.json').then(r => r.ok ? r.json() : Promise.reject()).then(j => {
      const byId = {}; (j.classes || []).forEach(c => { byId[c.id] = c; });
      ['warrior', 'mage'].forEach(id => {
        const c = byId[id]; if (!c) return;
        const map = {};
        c.skills.forEach(s => { map[s.name] = { coeff: s.coeff, cd: s.cd, cost: s.cost, effect: s.effect }; });
        c.specs.forEach(sp => { map[sp.ultimate.name] = { coeff: 6.2, cd: sp.ultimate.cd, cost: 'Заряд Искры', effect: sp.ultimate.effect }; });
        DATA[id] = Object.assign({}, FALLBACK[id], map);
      });
      DATA_SOURCE = 'canon';
      if (S.mode !== 'menu') buildCodex();
    }).catch(() => { DATA_SOURCE = 'fallback'; });
  }
  function initPWA() {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
    if ('serviceWorker' in navigator && typeof location !== 'undefined' && /^https:/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    window.addEventListener('beforeinstallprompt', ev => {
      ev.preventDefault();
      const btn = $('btnInstall');
      if (btn) {
        btn.classList.remove('hidden');
        btn.addEventListener('pointerdown', () => { ev.prompt(); btn.classList.add('hidden'); });
      }
    });
  }

  /* ------------------------------- цикл ---------------------------------- */
  let last = 0, acc = 0, uiTick = 0;
  function frame(ts) {
    const t = typeof performance !== 'undefined' && performance.now ? performance.now() : (ts || 0);
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
    last = t;
    if (S.mode === 'playing') {
      acc += dt;
      let guard = 0;
      while (acc >= TICK && guard++ < 8) { step(TICK); acc -= TICK; }
    } else acc = 0;
    render(dt);
    uiTick++;
    if (uiTick % 2 === 0) updateUI();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);
  }

  function boot() {
    resize(); bindInput(); loadCanon(); initPWA();
    S.player = makePlayer(); S.boss = makeBoss();   // для фона в меню
    // Ярлыки PWA: ./index.html?class=mage&autostart=1
    const qs = (typeof location !== 'undefined' && location.search) || '';
    const pick = /(?:^|[?&])class=([a-z]+)/.exec(qs);
    if (pick && DATA[pick[1]]) {
      S.classId = pick[1];
      if (document.querySelectorAll) {
        document.querySelectorAll('.class-card').forEach(b => b.classList.toggle('selected', b.dataset.class === S.classId));
      }
    }
    if (/[?&]autostart=1/.test(qs)) startGame(S.classId);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);
  }

  /* -------------------------- тестовый интерфейс ------------------------- */
  // Используется tools/smoke_mobile.js: логику можно прогонять в Node без DOM.
  if (typeof window !== 'undefined') {
    window.ARKEON = {
      version: 'G1.0', state: S, config: { TICK, WEAPON_HIT, BOSS_HP, A },
      start: startGame, step, cast: castSkill, dodge, ultimate: useUltimate,
      meta: meta, data: () => DATA, source: () => DATA_SOURCE, render, updateUI, worldToScreenDelta
    };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
