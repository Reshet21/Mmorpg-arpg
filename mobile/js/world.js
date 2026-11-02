/* =====================================================================
 * ARKEON · G2 · world.js
 * Авторитетная (в офлайне) модель мира: процедурные зоны 40×40, чанки,
 * лагеря спавна, ИИ мобов (агро/патруль/лейш/стая/кастер/элита/босс),
 * респавн, мировые события, порталы, НПС,light sources, мини-карта.
 * ===================================================================== */
(function () {
  'use strict';
  const A2 = window.A2;
  const C = A2.C, N = C.ZONE_N;

  const T = { GROUND:0, PATH:1, WATER:2, ROCK:3, WALL:4, BRIDGE:5 };
  // Фиксированные сиды по идентификатору зоны: добавление города не должно
  // менять рельеф и коллизии уже существующих боевых зон.
  const ZONE_SEEDS = { haven:4242, grove:1337, ash:9054, frost:16771, rift:24488 };

  function noise(x, y, s, seed) {
    const xi = Math.floor(x / s), yi = Math.floor(y / s);
    const fx = x / s - xi, fy = y / s - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = A2.hash(xi, yi, seed), b = A2.hash(xi + 1, yi, seed);
    const c = A2.hash(xi, yi + 1, seed), d = A2.hash(xi + 1, yi + 1, seed);
    return A2.lerp(A2.lerp(a, b, u), A2.lerp(c, d, u), v);
  }

  function buildTiles(z, seed) {
    const t = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const n = noise(x, y, 7, seed), n2 = noise(x, y, 2.3, seed + 91);
      let v = T.GROUND;
      // G2.3 · безопасный город: плаза, мощёная площадь и дорога к воротам
      if (z.safe) {
        if (x >= 14 && x <= 27 && y >= 16 && y <= 28) v = T.PATH;
        if (A2.dist(x, y, 28.5, 28) < 4.2) v = T.PATH;
        if (x >= 26 && y >= 26 && Math.abs((x - 26) - (y - 26)) < 2.2 && x < N - 2 && y < N - 2) v = T.PATH;
        if (x < 1 || y < 1 || x > N - 2 || y > N - 2) v = T.WALL;
        t[y * N + x] = v;
        continue;
      }
      // главная дорога: плавная диагональ через всю зону
      const road = Math.abs((x * 0.78 + Math.sin(y * 0.28) * 3.2) - y * 0.92 - 2);
      if (road < 1.7) v = T.PATH;
      else if (z.id === 'frost' && n > 0.74) v = T.WATER;      // лёд/полыньи
      else if (z.id === 'ash' && n > 0.79) v = T.ROCK;          // шлак
      else if (z.id === 'rift' && n2 > 0.81) v = T.WATER;       // трещины
      else if (n2 > 0.88) v = T.ROCK;
      // границы мира — обрывы
      if (x < 1 || y < 1 || x > N - 2 || y > N - 2) v = T.WALL;
      t[y * N + x] = v;
    }
    return t;
  }

  function buildProps(z, tiles, seed) {
    const props = [], lights = [];
    const rnd = A2.rng(seed + 777);
    const kinds = z.props;
    // G2.3 · Пристань Завета: рукотворная планировка вместо случайного леса.
    if (z.safe) return buildCity(z, props, lights);

    for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) {
      const tile = tiles[y * N + x];
      const h = A2.hash(x, y, seed + 13);
      if (tile !== T.GROUND && tile !== T.PATH) continue;
      const density = tile === T.PATH ? 0.018 : 0.135;
      if (h > density) continue;
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      props.push({ x: x + 0.5, y: y + 0.5, kind, variant: Math.floor(rnd() * 4),
        size: 0.8 + rnd() * 0.7, seed: Math.floor(rnd() * 1e6), block: kind === 'oak' || kind === 'pine' || kind === 'deadtree' || kind === 'boulder' || kind === 'ruin' || kind === 'obelisk' || kind === 'ice' });
      if (kind === 'campfire') lights.push({ x: x + 0.5, y: y + 0.5, color: '#ff9a4d', r: 5.2, pulse: rnd() * 6 });
    }
    // деревня/лагерь НПС: площадка вокруг первого НПС зоны
    const anchor = A2.NPCS.find(n => n.zone === z.id);
    if (anchor) {
      const cx = anchor.x, cy = anchor.y;
      for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 4; x <= cx + 4; x++)
        if (x > 1 && y > 1 && x < N - 2 && y < N - 2) tiles[y * N + x] = T.PATH;
      props.push({ x: cx - 2, y: cy + 1, kind: 'tent', variant: 0, size: 1.1, seed: 1, block: true });
      props.push({ x: cx + 2, y: cy + 1, kind: 'tent', variant: 1, size: 1.0, seed: 2, block: true });
      props.push({ x: cx, y: cy - 2, kind: 'campfire', variant: 0, size: 1.2, seed: 3, block: false });
      props.push({ x: cx - 3, y: cy - 1, kind: 'banner', variant: 0, size: 1.2, seed: 4, block: false });
      lights.push({ x: cx, y: cy - 2, color: '#ffb45c', r: 7, pulse: 0 });
    }
    return { props, lights };
  }

  function buildCity(z, props, lights) {
    const add=(x,y,kind,size,block,variant)=>props.push({x:x+0.5,y:y+0.5,kind,variant:variant||0,
      size:size||1,seed:Math.floor(A2.hash(x,y,77)*1e6),block:!!block});
    // дома по периметру площади (вне проходимой зоны)
    [[11,14,1.25],[28,14,1.15],[11,29,1.2],[30,22,1.1],[16,11,1.0],[24,11,1.0],[31,30,1.05]].forEach((h,i)=>add(h[0],h[1],'house',h[2],true,i%3));
    // прилавки, колодец, статуя Светоча
    [[15,23],[25,23],[15,18],[25,18]].forEach((q,i)=>add(q[0],q[1],'stall',0.9,false,i%2));
    add(20,15,'well',1.05,false); add(20,20,'statue',1.3,false);
    // фонари: тёплый свет города
    [[14,17],[26,17],[14,27],[26,27],[30,30],[33,33],[12,22],[28,22]].forEach(q=>{
      add(q[0],q[1],'lamp',0.9,false);
      lights.push({x:q[0]+0.5,y:q[1]+0.5,color:'#ffcf8a',r:6.4,pulse:A2.hash(q[0],q[1],5)*6});
    });
    // знамёна, палатки, цветы, низкие стены
    [[18,16],[22,16],[18,28],[22,28]].forEach(q=>add(q[0],q[1],'banner',1.05,false));
    [[17,27],[23,27]].forEach((q,i)=>add(q[0],q[1],'tent',1.0,false,i));
    [[19,17],[21,17],[19,24],[21,24],[13,20],[27,20]].forEach(q=>add(q[0],q[1],'flower',0.8,false));
    [[9,18],[9,19],[9,20],[9,21],[30,17],[30,18],[30,19]].forEach(q=>add(q[0],q[1],'wall',0.9,false));
    add(27,26,'target',0.95,false);   // мишень учебного двора
    lights.push({x:20.5,y:20.5,color:'#ffe6a8',r:9,pulse:0});
    return { props, lights };
  }

  function buildCamps(z, seed) {
    if (z.safe) return [];
    const camps = [], rnd = A2.rng(seed + 4242);
    const spots = z.campSpots || [[8, 8], [27, 9], [10, 27], [29, 28], [20, 32], [33, 17], [6, 19], [24, 5]];
    spots.forEach((s, i) => {
      const lvl = Math.round(A2.lerp(z.lv[0], z.lv[1], (i + 0.5) / spots.length));
      camps.push({ x: s[0] + 0.5, y: s[1] + 0.5, r: 4.2, lvl, count: 3 + Math.floor(rnd() * 3),
        ids: z.mobs, respawn: 22 + rnd() * 18, mobs: [], elite: i === 4 });
    });
    return camps;
  }

  function mobStats(id, lvl, elite, boss) {
    const m = A2.MOB(id);
    const k = 1 + lvl * 0.10;
    let hp = 90000 * m.hp * k, dmg = 1200 * m.dmg * k;
    let xp = 60 * m.xp * (1 + lvl * 0.12), gold = 18 * m.loot * (1 + lvl * 0.09);
    if (elite) { hp *= 6.5; dmg *= 1.8; xp *= 6; gold *= 7; }
    if (boss)  { hp *= boss.hp; dmg *= boss.dmg; xp *= 30; gold *= 40; }
    return { hp: Math.round(hp), dmg: Math.round(dmg), xp: Math.round(xp), gold: Math.round(gold), armor: 900 + lvl * 46 };
  }

  function makeMob(W, def, x, y, lvl, opts) {
    opts = opts || {};
    const elite = !!opts.elite, boss = !!opts.boss;
    const st = mobStats(typeof def === 'string' ? def : def.id, lvl, elite, boss ? A2.BOSSES[W.zone.boss] : null);
    const base = typeof def === 'string' ? A2.MOB(def) : def;
    return {
      uid: ++W.uid, id: base.id, ru: opts.ru || base.ru, kind: base.kind, color: opts.color || base.color,
      x, y, homeX: x, homeY: y, lvl, hp: st.hp, maxHp: st.hp, dmg: st.dmg, armor: st.armor,
      xp: st.xp, gold: st.gold, speed: base.speed, aggro: base.aggro, ai: base.ai, element: base.element,
      elite, boss, alive: true, respawnAt: 0, state: 'idle', target: null, atkCd: 0, castCd: 0,
      statuses: [], phase: 1, enrageAt: boss ? A2.BOSSES[W.zone.boss].enrage : 0,
      facing: 0, anim: 0, hitFlash: 0, loot: null, lootOwner: null, camp: opts.camp || null,
      telegraph: null, wanderT: 0, wx: x, wy: y, nameOverride: opts.ru || null, spawnAt: W.time, event: opts.event || null
    };
  }

  function create(zoneId, seed) {
    const z = A2.ZONE(zoneId), s = ZONE_SEEDS[z.id] || ((seed | 0) || 1337);
    const tiles = buildTiles(z, s);
    const built = buildProps(z, tiles, s);
    const camps = buildCamps(z, s);
    const W = {
      id: z.id, zone: z, N, tiles, props: built.props, lights: built.lights, camps,
      npcs: A2.NPCS.filter(n => n.zone === z.id).map(n => ({ ...n, questMark: true })),
      portals: [], mobs: [], projectiles: [], drops: [], effects: [], events: [], time: 0, uid: 0,
      eventTimer: 65, eventActive: null, bossAlive: false, bossRespawn: 0, kills: 0,
      seed: s, ground: null, groundKey: '', rnd: A2.rng(s + 9999)
    };
    // G2.3 · линейная цепочка зон с точкой прибытия (раньше был кольцевой
    // переход: из Разлома игрок попадал обратно в Рощу).
    const idx = A2.ZONES.indexOf(z);
    const nextId = z.next || (idx < A2.ZONES.length - 1 ? A2.ZONES[idx + 1].id : null);
    const prevId = z.prev || (idx > 0 ? A2.ZONES[idx - 1].id : null);
    if (nextId) {
      const dest = A2.ZONE(nextId);
      W.portals.push({ x: N - 4.5, y: N - 4.5, to: nextId, label: '→ ' + dest.ru, r: 2.2,
        arrival: { x: dest.spawn[0], y: dest.spawn[1] } });
    }
    if (prevId) {
      const dest = A2.ZONE(prevId);
      W.portals.push({ x: 3.5, y: 3.5, to: prevId, label: '← ' + dest.ru, r: 2.2,
        arrival: { x: dest.backSpawn[0], y: dest.backSpawn[1] } });
    }
    // безопасная зона: ни лагерей, ни элит, ни босса, ни Волн Разлома
    W.safe = !!z.safe;
    W.safeCircles = z.id === 'grove' ? [{ x: 5.5, y: 5.5, r: 9 }] : [];
    W.eventTimer = W.safe ? Infinity : 65;
    if (z.boss) {
      const bd = A2.BOSSES[z.boss];
      W.bossSpot = { x: N / 2, y: 8.5, def: A2.MOB(z.mobs[z.mobs.length - 1]), ru: bd.ru };
    } else W.bossSpot = null;
    if (!W.safe) {
      camps.forEach(c => {
        for (let i = 0; i < c.count; i++) {
          const id = c.ids[Math.floor(W.rnd() * c.ids.length)];
          const a = W.rnd() * Math.PI * 2, r = W.rnd() * c.r;
          const m = makeMob(W, id, A2.clamp(c.x + Math.cos(a) * r, 2, N - 3), A2.clamp(c.y + Math.sin(a) * r, 2, N - 3), c.lvl, { camp: c });
          W.mobs.push(m); c.mobs.push(m.uid);
        }
        if (c.elite) {
          const ed = A2.ELITES[z.elite], em = A2.MOB(ed.mob);
          const m = makeMob(W, em, c.x + 1.4, c.y - 1.2, c.lvl + 2, { elite: true, ru: ed.ru, color: ed.color, camp: c });
          m.hp = m.maxHp = Math.round(m.maxHp * (ed.hp / 6.5)); m.dmg = Math.round(m.dmg * (ed.dmg / 1.8));
          W.mobs.push(m); c.mobs.push(m.uid);
        }
      });
      spawnBoss(W);
    } else {
      // учебный двор: 4 неагрессивных манекена с быстрым респавном
      [[27.2,27.2],[29.6,27.2],[27.2,29.6],[29.6,29.6]].forEach((q,i)=>{
        const m = makeMob(W, 'maket', q[0], q[1], 1, { camp:{respawn:6}, ru:'Учебный манекен' });
        m.aggro=0; m.dmg=0; m.speed=0; W.mobs.push(m);
      });
      W.events.push({ t:0, text:'✦ Пристань Завета · безопасная зона · здесь не нападают' });
    }
    return W;
  }

  function spawnBoss(W) {
    const b = W.bossSpot, bd = A2.BOSSES[W.zone.boss];
    const m = makeMob(W, b.def, b.x, b.y, W.zone.lv[1], { boss: true, ru: b.ru, color: bd.color });
    m.aggro = 16; m.speed = 1.5; m.ai = 'boss';
    W.mobs.push(m); W.bossAlive = true; W.bossUid = m.uid;
    return m;
  }

  function blocked(W, x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= N || iy >= N) return true;
    const t = W.tiles[iy * N + ix];
    return t === T.WALL || t === T.WATER || t === T.ROCK;
  }
  function solidProps(W, x, y, r) {
    for (let i = 0; i < W.props.length; i++) {
      const p = W.props[i];
      if (!p.block) continue;
      if (Math.abs(p.x - x) < r && Math.abs(p.y - y) < r * 0.8) return p;
    }
    return null;
  }
  function canMove(W, x, y) { return !blocked(W, x, y) && !solidProps(W, x, y, 0.42); }

  function nearestPlayer(W, players, x, y, r) {
    let best = null, bd = r;
    for (let i = 0; i < players.length; i++) {
      const p = players[i]; if (!p || p.dead) continue;
      const d = A2.dist(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function telegraph(W, m, shape, radius, dur, dmgMul) {
    m.telegraph = { shape, radius, t: 0, dur, resolved: false, dmgMul: dmgMul || 1, x: m.x, y: m.y, angle: m.facing };
    W.effects.push({ kind:'telegraph', uid:m.uid, shape, x:m.x, y:m.y, r:radius, t:0, dur, angle:m.facing });
  }

  function updateMob(W, m, dt, players, hooks) {
    if (!m.alive) {
      if (W.time >= m.respawnAt && !m.boss) {
        m.alive = true; m.hp = m.maxHp; m.x = m.homeX; m.y = m.homeY; m.state = 'idle'; m.statuses = [];
        hooks.onRespawn && hooks.onRespawn(m);
      }
      return;
    }
    m.anim += dt; m.hitFlash = Math.max(0, m.hitFlash - dt * 3);
    // манекены никогда не двигаются и не атакуют
    if (m.ai === 'dummy') { m.state = 'idle'; m.target = null; return; }
    // дозорная тропа у входа в Рощу: мобы внутри не агрессируют
    if (W.safeCircles && W.safeCircles.some(c => A2.dist(m.x, m.y, c.x, c.y) < c.r)) {
      m.state = 'idle'; m.target = null; return;
    }
    m.atkCd -= dt; m.castCd -= dt;
    m.statuses = m.statuses.filter(s => s.until > W.time);
    const target = nearestPlayer(W, players, m.x, m.y, m.aggro * (m.boss ? 1.4 : 1));
    if (m.telegraph) {
      const tg = m.telegraph; tg.t += dt;
      if (!tg.resolved && tg.t >= tg.dur) {
        tg.resolved = true;
        hooks.onTelegraph && hooks.onTelegraph(m, tg);
        m.telegraph = null;
      }
      return;
    }
    if (target) {
      m.target = target.uid;
      m.state = 'chase';
      const d = A2.dist(m.x, m.y, target.x, target.y);
      m.facing = Math.atan2(target.y - m.y, target.x - m.x);
      const keep = m.ai === 'caster' ? 5.5 : (m.kind === 'treant' || m.kind === 'golem' ? 2.2 : 1.5);
      const tooFar = A2.dist(m.x, m.y, m.homeX, m.homeY) > 13;
      if (tooFar) {
        const a = Math.atan2(m.homeY - m.y, m.homeX - m.x);
        step(W, m, Math.cos(a), Math.sin(a), dt, m.speed * 1.3);
        m.state = 'leash'; return;
      }
      if (d > keep) step(W, m, Math.cos(m.facing), Math.sin(m.facing), dt, m.speed);
      else if (m.ai === 'caster' && d < keep - 1.5) step(W, m, -Math.cos(m.facing), -Math.sin(m.facing), dt, m.speed * 0.7);
      // атака
      if (d < (m.ai === 'caster' ? 9 : 2.4) && m.atkCd <= 0) {
        if (m.boss || m.elite || W.rnd() < 0.32) {
          const shape = m.boss ? ['circle','cone','line','ring'][Math.floor(W.rnd()*4)] : 'circle';
          telegraph(W, m, shape, m.boss ? 4.2 : 2.6, m.boss ? 1.15 : 0.95, m.boss ? 1.6 : 1.15);
          m.castCd = 2.4;
        } else {
          hooks.onMobHit && hooks.onMobHit(m, target, m.dmg);
        }
        m.atkCd = m.boss ? 1.9 : (m.elite ? 2.2 : 2.6);
      }
      // фазы босса
      if (m.boss) {
        const frac = m.hp / m.maxHp;
        const want = frac > 0.75 ? 1 : frac > 0.5 ? 2 : frac > 0.25 ? 3 : 4;
        if (want > m.phase) {
          m.phase = want;
          for (let i = 0; i < 3; i++) {
            const a = W.rnd() * 6.28;
            const add = makeMob(W, W.zone.mobs[Math.floor(W.rnd()*W.zone.mobs.length)],
              A2.clamp(m.x + Math.cos(a)*3, 2, N-3), A2.clamp(m.y + Math.sin(a)*3, 2, N-3), m.lvl, {});
            W.mobs.push(add);
          }
          hooks.onPhase && hooks.onPhase(m, want);
        }
        if (W.time - (m.spawnAt || 0) > m.enrageAt) m.enraged = true;
      }
    } else {
      m.state = 'idle'; m.target = null;
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        m.wanderT = 2 + W.rnd() * 4;
        m.wanderA = W.rnd() * 6.28;
      }
      step(W, m, Math.cos(m.wanderA || 0) * 0.45, Math.sin(m.wanderA || 0) * 0.45, dt, m.speed * 0.45);
    }
  }

  function step(W, m, dx, dy, dt, spd) {
    const nx = m.x + dx * dt * (spd || m.speed), ny = m.y + dy * dt * (spd || m.speed);
    if (canMove(W, nx, m.y)) m.x = nx;
    if (canMove(W, m.x, ny)) m.y = ny;
  }

  function startEvent(W, players) {
    const p = players[0]; if (!p) return;
    if (W.safe) return;                                      // в городе нет Волн Разлома
    const local = players.find(q => q.uid === 'local') || players[0];
    if (local && local.storyDone === false) return;          // пролог ещё идёт
    const id = 'wave_' + Math.floor(W.time);
    W.eventActive = { id, ru:'Волна Разлома', t:0, dur:75, need:14, killed:0, x:p.x, y:p.y };
    for (let i = 0; i < 12; i++) {
      const a = W.rnd() * 6.28, r = 6 + W.rnd() * 6;
      const m = makeMob(W, W.zone.mobs[Math.floor(W.rnd()*W.zone.mobs.length)],
        A2.clamp(p.x + Math.cos(a)*r, 2, N-3), A2.clamp(p.y + Math.sin(a)*r, 2, N-3), W.zone.lv[1], { event:id });
      m.aggro = 18; W.mobs.push(m);
      if (W.eventActive) W.eventActive.mobs = (W.eventActive.mobs || []).concat(m.uid);
    }
    W.events.push({ t:W.time, text:'⚠ ВОЛНА РАЗЛОМА · 14 мобов · бонус опыта и лута' });
  }

  function update(W, dt, players, hooks) {
    W.time += dt;
    for (let i = 0; i < W.mobs.length; i++) updateMob(W, W.mobs[i], dt, players, hooks);
    // респавн босса
    if (!W.safe && !W.bossAlive && W.time > W.bossRespawn) { spawnBoss(W); W.events.push({t:W.time,text:'Мировой босс вернулся на поляну'}); }
    // мировое событие (в безопасной зоне таймер = Infinity)
    W.eventTimer -= dt;
    if (W.eventTimer <= 0 && !W.eventActive) { startEvent(W, players); W.eventTimer = 150; }
    if (W.eventActive) {
      const e = W.eventActive; e.t += dt;
      if (e.killed >= e.need || e.t > e.dur) {
        W.events.push({ t:W.time, text: e.killed >= e.need ? '✓ Волна отражена · +25% опыта и золота' : 'Волна схлынула' });
        W.eventActive = null;
      }
    }
    // дропы: жизнь 90 с
    W.drops = W.drops.filter(d => W.time - d.t < 90);
    W.effects = W.effects.filter(e => (e.t += dt) < (e.dur || 1.2));
    if (W.events.length > 30) W.events.shift();
  }

  function mobsNear(W, x, y, r) {
    const out = [];
    for (let i = 0; i < W.mobs.length; i++) {
      const m = W.mobs[i];
      if (m.alive && A2.dist(m.x, m.y, x, y) <= r) out.push(m);
    }
    return out;
  }
  function kill(W, m) {
    m.alive = false; m.hp = 0;
    m.respawnAt = W.time + (m.ai === 'dummy' ? 6 : (m.boss ? 180 : (m.camp ? m.camp.respawn : 30)));
    if (m.boss) { W.bossAlive = false; W.bossRespawn = W.time + 180; }
    W.kills++;
    if (W.eventActive && m.event === W.eventActive.id) W.eventActive.killed++;
    return m;
  }
  function portalAt(W, x, y) {
    return W.portals.find(p => A2.dist(p.x, p.y, x, y) < p.r) || null;
  }
  function npcAt(W, x, y, r) {
    return W.npcs.find(n => A2.dist(n.x, n.y, x, y) < (r || 2.2)) || null;
  }

  function isSafe(W, x, y) {
    if (!W) return false;
    if (W.safe) return true;
    return !!(W.safeCircles && W.safeCircles.some(c => A2.dist(x, y, c.x, c.y) < c.r));
  }
  A2.World = { T, create, update, kill, mobsNear, canMove, blocked, portalAt, npcAt,
    makeMob, spawnBoss, startEvent, mobStats, noise, isSafe };
})();
