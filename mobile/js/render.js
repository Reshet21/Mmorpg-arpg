/* =====================================================================
 * ARKEON · G2 · render.js
 * Детализированный изометрический рендер на чистом Canvas 2D:
 * процедурный тайлграунд с шумом и кромками, 14 видов объектов,
 * артикулированные спрайты 6 классов и 8 видов мобов, динамический свет,
 * погода, туман, bloom-эмуляция, виньетка, телеграфы, лучи лута,
 * частицы, цифры урона, мини-карта. Без единого внешнего ассета.
 * ===================================================================== */
(function () {
  'use strict';
  const A2 = window.A2, C = A2.C;
  const TW = C.TILE_W, TH = C.TILE_H, HU = C.H_UNIT, N = C.ZONE_N;
  const PAD = 90, GW = N * TW + PAD * 2, GH = N * TH + PAD * 2;
  const CX = N * TW / 2 + PAD, CY = PAD + 40;

  let ctx = null, canvas = null, VW = 960, VH = 540, DPR = 1;
  let groundCache = null, darkCanvas = null, darkCtx = null;
  let weather = [], waterCache = { key:'', tiles:[] }, miniCache = null;
  let QUALITY = 'high';
  function setQuality(q) { QUALITY = (q === 'low' ? 'low' : 'high'); }
  function lowQ() { return QUALITY === 'low'; }

  function init(cv) {
    canvas = cv; ctx = cv && cv.getContext ? cv.getContext('2d') : null;
    darkCanvas = typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null;
    darkCtx = darkCanvas && darkCanvas.getContext ? darkCanvas.getContext('2d') : null;
    resize();
  }
  function resize(w, h, dpr) {
    if (typeof window !== 'undefined') { VW = w || window.innerWidth || 960; VH = h || window.innerHeight || 540; DPR = dpr || Math.min(2, window.devicePixelRatio || 1); }
    if (canvas) { canvas.width = Math.round(VW * DPR); canvas.height = Math.round(VH * DPR); canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px'; }
    if (darkCanvas) { darkCanvas.width = Math.round(VW); darkCanvas.height = Math.round(VH); }
    if (ctx && ctx.setTransform) ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function rot(x, y, o) {
    switch (o) { case 1: return [N - y, x]; case 2: return [N - x, N - y]; case 3: return [y, N - x]; default: return [x, y]; }
  }
  function iso(x, y, z, o) {
    const r = rot(x, y, o);
    return [(r[0] - r[1]) * TW / 2 + CX, (r[0] + r[1]) * TH / 2 + CY - (z || 0) * HU];
  }
  function depth(x, y, o) { const r = rot(x, y, o); return r[0] + r[1]; }

  /* ----------------------- процедурный тайлграунд ----------------------- */
  function makeGround(W, o) {
    const key = W.id + ':' + o;
    if (groundCache && groundCache.key === key) return groundCache.cv;
    let cv;
    if (typeof document !== 'undefined' && document.createElement) cv = document.createElement('canvas');
    else return null;
    cv.width = GW; cv.height = GH;
    const g = cv.getContext('2d');
    const z = W.zone, pal = z.ground, T = A2.World.T;
    g.clearRect(0, 0, GW, GH);
    // дальний фон зоны
    const bg = g.createLinearGradient(0, 0, 0, GH);
    bg.addColorStop(0, z.sky); bg.addColorStop(1, z.fog);
    g.fillStyle = bg; g.fillRect(0, 0, GW, GH);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = W.tiles[y * N + x];
      const [sx, sy] = iso(x + 0.5, y + 0.5, 0, o);
      const h = A2.hash(x, y, W.seed);
      const n2 = A2.hash(x * 7, y * 11, W.seed + 5);
      let col = pal[Math.floor(h * pal.length) % pal.length];
      if (t === T.PATH) col = mix(pal[1], '#8f7a5f', 0.32 + n2 * 0.25);
      if (t === T.WATER) col = z.id === 'frost' ? '#3d6a86' : '#4a2b55';
      if (t === T.ROCK) col = mix(pal[2], '#6d6257', 0.35);
      if (t === T.WALL) col = mix(pal[2], '#0c1116', 0.55);
      if (t === T.BRIDGE) col = '#6b5540';
      diamond(g, sx, sy, TW / 2, TH / 2, col);
      // текстура поверхности: шум, трещины, травинки, блики
      const shade = 0.06 + n2 * 0.10;
      g.fillStyle = 'rgba(0,0,0,' + shade.toFixed(3) + ')';
      diamondPath(g, sx, sy, TW / 2, TH / 2); g.fill();
      if (t === T.GROUND || t === T.PATH) {
        const cnt = t === T.PATH ? 2 : 3;
        for (let k = 0; k < cnt; k++) {
          const dx = (A2.hash(x * 3 + k, y * 5, W.seed + 31) - 0.5) * TW * 0.72;
          const dy = (A2.hash(x * 9, y * 7 + k, W.seed + 47) - 0.5) * TH * 0.72;
          g.fillStyle = t === T.PATH ? 'rgba(210,190,150,.10)' : 'rgba(180,220,170,.09)';
          g.fillRect(sx + dx, sy + dy, 1.6, 0.9);
        }
        if (A2.hash(x, y, W.seed + 61) > 0.87) {
          g.strokeStyle = 'rgba(10,16,14,.30)'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(sx - 10, sy + 3); g.lineTo(sx - 3, sy + 1); g.lineTo(sx + 5, sy + 5); g.stroke();
        }
      }
      if (t === T.WATER) {
        g.strokeStyle = 'rgba(190,230,255,.22)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(sx - 14, sy + 2 + n2 * 5); g.quadraticCurveTo(sx, sy - 2 + n2 * 4, sx + 14, sy + 1 + n2 * 5); g.stroke();
      }
      // G2.1 · фаска изометрического тайла и микро-рельеф
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(sx - TW/2, sy); g.lineTo(sx, sy - TH/2); g.lineTo(sx + TW/2, sy); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,.14)';
      g.beginPath(); g.moveTo(sx - TW/2, sy); g.lineTo(sx, sy + TH/2); g.lineTo(sx + TW/2, sy); g.stroke();
      if (t === T.GROUND || t === T.PATH) {
        const q = A2.hash(x*13, y*17, W.seed+83);
        if (q > 0.79) {
          g.fillStyle = t === T.PATH ? 'rgba(205,190,160,.28)' : 'rgba(150,165,145,.22)';
          g.beginPath(); g.ellipse(sx + (q-0.9)*30, sy + (n2-0.5)*10, 2.6, 1.4, 0, 0, 6.283); g.fill();
          g.fillStyle = 'rgba(0,0,0,.18)';
          g.beginPath(); g.ellipse(sx + (q-0.9)*30, sy + (n2-0.5)*10 + 1, 2.6, 1, 0, 0, 6.283); g.fill();
        }
        const moss = A2.hash(x*5, y*23, W.seed+97);
        if (moss > 0.88 && t !== T.PATH) {
          g.strokeStyle = 'rgba(120,180,105,.22)'; g.lineWidth = 1.1;
          for (let k=0;k<3;k++){ g.beginPath(); g.moveTo(sx-8+k*3, sy+2); g.lineTo(sx-9+k*3, sy-3-n2*2); g.stroke(); }
        }
        if (t === T.PATH) {
          g.strokeStyle = 'rgba(30,24,18,.20)'; g.lineWidth = 0.8;
          g.beginPath(); g.moveTo(sx-13, sy-1); g.lineTo(sx-2, sy+5); g.moveTo(sx+2, sy-5); g.lineTo(sx+13, sy+1); g.stroke();
        }
      }
      // кромки высот
      if (t === T.WALL || t === T.ROCK) {
        g.fillStyle = 'rgba(0,0,0,.28)';
        g.beginPath(); g.moveTo(sx - TW/2, sy); g.lineTo(sx, sy + TH/2); g.lineTo(sx, sy + TH/2 + 7); g.lineTo(sx - TW/2, sy + 7); g.closePath(); g.fill();
      }
    }
    groundCache = { key, cv };
    return cv;
  }
  function diamondPath(g, x, y, hw, hh) {
    g.beginPath(); g.moveTo(x, y - hh); g.lineTo(x + hw, y); g.lineTo(x, y + hh); g.lineTo(x - hw, y); g.closePath();
  }
  function diamond(g, x, y, hw, hh, col) { g.fillStyle = col; diamondPath(g, x, y, hw, hh); g.fill(); }
  function mix(a, b, t) {
    const pa = hex(a), pb = hex(b);
    return 'rgb(' + Math.round(A2.lerp(pa[0],pb[0],t)) + ',' + Math.round(A2.lerp(pa[1],pb[1],t)) + ',' + Math.round(A2.lerp(pa[2],pb[2],t)) + ')';
  }
  function hex(c) { const n = parseInt(c.replace('#',''), 16); return [(n>>16)&255,(n>>8)&255,n&255]; }
  function rgba(c, a) { const p = hex(c); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }

  /* -------------------------- спрайты существ -------------------------- */
  function shadow(g, x, y, w, a) {
    g.save(); g.translate(x, y); g.scale(1, 0.42);
    const gr = g.createRadialGradient(0, 0, 1, 0, 0, w);
    gr.addColorStop(0, 'rgba(0,0,0,' + (a || .45) + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, w, 0, 6.283); g.fill(); g.restore();
  }
  function outline(g, col, w) { g.lineWidth = w || 2.2; g.strokeStyle = 'rgba(6,12,16,.82)'; g.stroke(); }

  function drawMob(g, m, x, y, t, sc) {
    const s = sc || 1, bob = Math.sin(t * 4 + m.uid) * 1.6, sw = Math.sin(t * 7 + m.uid) * 4;
    const col = m.color, big = m.boss ? 1.85 : m.elite ? 1.35 : 1;
    const S = s * big;
    shadow(g, x, y + 3, 17 * S, .5);
    g.save(); g.translate(x, y + bob * S); g.scale(S, S);
    if (m.hitFlash > 0) { g.shadowColor = '#fff'; g.shadowBlur = 16; }
    switch (m.kind) {
      case 'dummy': { // G2.3 · учебный манекен: не атакует, просто мишень
        g.fillStyle='#5a422c'; g.fillRect(-3,-4,6,6); outline(g);
        g.fillRect(-2,-34,4,32); outline(g);
        g.fillStyle='#c8a870'; g.beginPath(); g.ellipse(0,-24,11,15,0,0,6.283); g.fill(); outline(g);
        g.strokeStyle='rgba(90,60,30,.55)'; g.lineWidth=1.2;
        for(let i=0;i<3;i++){ g.beginPath(); g.moveTo(-8,-30+i*7); g.lineTo(8,-30+i*7); g.stroke(); }
        g.fillStyle='#e0574f'; g.beginPath(); g.arc(0,-24,4.5,0,6.283); g.fill();
        g.fillStyle='#ffe6a8'; g.beginPath(); g.arc(0,-24,1.8,0,6.283); g.fill();
        g.fillStyle='#6d5133'; g.fillRect(-13,-14,26,3); outline(g);
        break;
      }
      case 'wolf': case 'quadruped': {
        g.fillStyle = col; g.beginPath();
        g.ellipse(0, -11, 15, 8, 0, 0, 6.283); g.fill(); outline(g);
        g.beginPath(); g.moveTo(11, -14); g.lineTo(20, -22); g.lineTo(16, -8); g.closePath(); g.fill(); outline(g);
        g.fillStyle = '#241f1b';
        [-9, 9].forEach((dx,i) => { g.save(); g.translate(dx, -4); g.rotate(sw*0.03*(i?1:-1)); g.fillRect(-2.4, 0, 4.8, 10); g.restore(); });
        g.fillStyle = '#ffcf6a'; g.beginPath(); g.arc(15, -15, 1.8, 0, 6.283); g.fill();
        break;
      }
      case 'treant': {
        g.fillStyle = '#4a3827'; g.fillRect(-7, -34, 14, 34); outline(g);
        g.fillStyle = col;
        [[0,-42,17],[-12,-34,11],[12,-34,12],[0,-56,12]].forEach(c => {
          g.beginPath(); g.arc(c[0], c[1], c[2], 0, 6.283); g.fill(); outline(g);
        });
        for (let i=0;i<9;i++){ g.fillStyle='rgba(180,230,150,.35)'; g.beginPath(); g.arc(-18+i*4, -50+Math.sin(i)*7, 2.4, 0, 6.283); g.fill(); }
        g.fillStyle='#ffe08a'; g.fillRect(-4,-36,2.5,3); g.fillRect(2,-36,2.5,3);
        break;
      }
      case 'golem': case 'ice': {
        g.fillStyle = col;
        g.beginPath(); g.moveTo(-13,-6); g.lineTo(-11,-34); g.lineTo(11,-34); g.lineTo(14,-6); g.closePath(); g.fill(); outline(g);
        g.fillRect(-17,-32,9,13); g.fillRect(8,-32,9,13);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(-8,-30,5,20);
        g.fillStyle = m.kind === 'ice' ? '#dff6ff' : '#ffd27a';
        g.beginPath(); g.arc(-4,-25,2.2,0,6.283); g.arc(4,-25,2.2,0,6.283); g.fill();
        for (let i=0;i<3;i++){ g.strokeStyle='rgba(255,255,255,.20)'; g.lineWidth=1; g.beginPath(); g.moveTo(-10+i*9,-18); g.lineTo(-6+i*9,-10); g.stroke(); }
        break;
      }
      case 'ghost': {
        g.globalAlpha = .72;
        const gr = g.createLinearGradient(0,-40,0,4);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(120,150,200,0)');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(-11,-4); g.quadraticCurveTo(-15,-34,0,-40); g.quadraticCurveTo(15,-34,11,-4);
        g.quadraticCurveTo(5,2,0,-4); g.quadraticCurveTo(-5,2,-11,-4); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(-4,-27,2,0,6.283); g.arc(4,-27,2,0,6.283); g.fill();
        g.globalAlpha = 1; break;
      }
      case 'flyer': {
        const fl = Math.sin(t * 11) * 9;
        g.fillStyle = rgba(col,.85);
        g.beginPath(); g.moveTo(-3,-20); g.quadraticCurveTo(-24,-30-fl,-28,-14-fl/2); g.quadraticCurveTo(-14,-14,-3,-12); g.fill();
        g.beginPath(); g.moveTo(3,-20); g.quadraticCurveTo(24,-30-fl,28,-14-fl/2); g.quadraticCurveTo(14,-14,3,-12); g.fill();
        g.fillStyle = col; g.beginPath(); g.ellipse(0,-16,7,11,0,0,6.283); g.fill(); outline(g);
        g.fillStyle='#ffe08a'; g.beginPath(); g.moveTo(6,-20); g.lineTo(13,-18); g.lineTo(6,-15); g.fill();
        break;
      }
      case 'caster': case 'demon': {
        g.fillStyle = m.kind === 'demon' ? '#4a2a44' : col;
        g.beginPath(); g.moveTo(-12,0); g.lineTo(-8,-34); g.lineTo(8,-34); g.lineTo(12,0); g.closePath(); g.fill(); outline(g);
        g.fillStyle = col; g.beginPath(); g.arc(0,-38,8,0,6.283); g.fill(); outline(g);
        if (m.kind === 'demon') {
          g.fillStyle = col; g.beginPath(); g.moveTo(-8,-43); g.lineTo(-13,-54); g.lineTo(-3,-45); g.fill();
          g.beginPath(); g.moveTo(8,-43); g.lineTo(13,-54); g.lineTo(3,-45); g.fill();
        }
        g.strokeStyle = rgba(col,.9); g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(10,-26); g.lineTo(19+sw*0.15,-46); g.stroke();
        g.fillStyle = rgba(col,.9); g.beginPath(); g.arc(19+sw*0.15,-48,4,0,6.283); g.fill();
        break;
      }
      default: { // imp / человекоподобный
        g.fillStyle = col;
        g.beginPath(); g.moveTo(-9,0); g.lineTo(-7,-24); g.lineTo(7,-24); g.lineTo(9,0); g.closePath(); g.fill(); outline(g);
        g.fillStyle = rgba(col,.75); g.fillRect(-9,-20,4,14); g.fillRect(5,-20,4,14);
        g.fillStyle = col; g.beginPath(); g.arc(0,-29,7.5,0,6.283); g.fill(); outline(g);
        g.beginPath(); g.moveTo(-6,-34); g.lineTo(-9,-42); g.lineTo(-2,-35); g.fill();
        g.beginPath(); g.moveTo(6,-34); g.lineTo(9,-42); g.lineTo(2,-35); g.fill();
        g.fillStyle='#ffe08a'; g.fillRect(-3.5,-30,2.4,2.4); g.fillRect(1.5,-30,2.4,2.4);
      }
    }
    if (m.elite || m.boss) {
      g.strokeStyle = m.boss ? '#ff7a4d' : '#f0b45c'; g.lineWidth = 1.6;
      g.beginPath(); g.arc(0, -20, 24, 0, 6.283); g.stroke();
    }
    g.restore();
  }

  function drawHero(g, e, x, y, t, sc) {
    const cls = A2.CLASS(e.classId), s = sc || 1;
    const moving = e.moving || false, walk = moving ? Math.sin(t * 11) : Math.sin(t * 2) * 0.25;
    const bob = Math.sin(t * (moving ? 11 : 2)) * (moving ? 2.2 : 1.1);
    const rar = e.gearRarity ? A2.RARITY(e.gearRarity) : null;
    shadow(g, x, y + 3, 16 * s, .55);
    g.save(); g.translate(x, y + bob * s); g.scale(s, s);
    if (e.iframe > 0) g.globalAlpha = .55;
    // плащ
    g.fillStyle = rgba(cls.color, .55);
    g.beginPath(); g.moveTo(-9,-30); g.quadraticCurveTo(-14-walk*0.5,-12,-11,1); g.lineTo(11,1);
    g.quadraticCurveTo(14+walk*0.5,-12,9,-30); g.closePath(); g.fill(); outline(g);
    // ноги
    g.fillStyle = '#2b3540';
    [-5, 5].forEach((dx,i) => { g.save(); g.translate(dx, -7); g.rotate(walk * (i ? .30 : -.30)); g.fillRect(-2.8, 0, 5.6, 10); g.restore(); });
    // торс / броня
    g.fillStyle = rar ? mix('#3b4a56', rar.color, .30) : '#3b4a56';
    g.beginPath(); g.moveTo(-9,-30); g.lineTo(9,-30); g.lineTo(7,-10); g.lineTo(-7,-10); g.closePath(); g.fill(); outline(g);
    g.strokeStyle = rgba(cls.color,.85); g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(0,-29); g.lineTo(0,-11); g.stroke();
    // наплечники
    g.fillStyle = rgba(cls.color,.9); g.beginPath(); g.ellipse(-9,-28,5,3.4,0,0,6.283); g.ellipse(9,-28,5,3.4,0,0,6.283); g.fill();
    // голова + шлем
    g.fillStyle = '#e6c7a1'; g.beginPath(); g.arc(0,-36,6.4,0,6.283); g.fill(); outline(g);
    g.fillStyle = rar ? mix('#4a5866', rar.color, .45) : '#4a5866';
    g.beginPath(); g.arc(0,-38,6.8,Math.PI,0); g.lineTo(6.8,-36); g.lineTo(-6.8,-36); g.fill(); outline(g);
    // оружие
    g.save(); g.translate(11, -22); g.rotate(-0.35 + (e.attackAnim || 0) * 1.2);
    g.strokeStyle = '#cfd8dc'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(0,0); g.lineTo(0,-30); g.stroke();
    g.fillStyle = rar ? rar.color : cls.color;
    if (cls.range > 6) { g.strokeStyle = rgba(cls.color,.9); g.lineWidth=1.6; g.beginPath(); g.arc(0,-16,13,-1.2,1.2); g.stroke(); }
    else { g.beginPath(); g.moveTo(-3,-28); g.lineTo(3,-28); g.lineTo(2,-34); g.lineTo(-2,-34); g.fill(); }
    g.restore();
    // свечение редкости экипировки
    if (rar && rar.glow > 0) {
      g.shadowColor = rar.color; g.shadowBlur = 10 * rar.glow;
      g.strokeStyle = rgba(rar.color, .5 * rar.glow); g.lineWidth = 1.2;
      g.beginPath(); g.arc(0,-22,17,0,6.283); g.stroke(); g.shadowBlur = 0;
    }
    g.restore();
  }

  /* ------------------------------ объекты ------------------------------ */
  function drawProp(g, p, x, y, t, z) {
    const s = p.size || 1;
    g.save(); g.translate(x, y); g.scale(s, s);
    switch (p.kind) {
      case 'oak': case 'pine': case 'deadtree': {
        shadow(g, 0, 2, 20, .4);
        g.fillStyle = '#3b2b1e'; g.fillRect(-4, -42, 8, 44); outline(g);
        // G2.1 · текстура коры и корневые лапы
        g.strokeStyle = 'rgba(210,180,140,.16)'; g.lineWidth = 0.9;
        for (let k=0;k<5;k++){ g.beginPath(); g.moveTo(-3+k*1.5,-40); g.lineTo(-2+k*1.5,-6); g.stroke(); }
        g.fillStyle = '#33251a';
        g.beginPath(); g.moveTo(-4,-2); g.lineTo(-13,2); g.lineTo(-2,1); g.fill();
        g.beginPath(); g.moveTo(4,-2); g.lineTo(13,2); g.lineTo(2,1); g.fill();
        g.strokeStyle = '#3b2b1e'; g.lineWidth = 2.6;
        [-1,1].forEach(d => { g.beginPath(); g.moveTo(0,-30); g.lineTo(d*13,-44); g.stroke();
          g.lineWidth=1; g.beginPath(); g.moveTo(d*9,-40); g.lineTo(d*16,-50); g.stroke(); g.lineWidth=2.6; });
        if (p.kind !== 'deadtree') {
          const cols = p.kind === 'pine' ? ['#2f5a3d','#3a6b46','#478055'] : ['#3f6b3f','#4f8449','#66a05b'];
          if (p.kind === 'pine') {
            for (let i=0;i<3;i++){ g.fillStyle=cols[i]; g.beginPath(); g.moveTo(0,-72+i*14); g.lineTo(-16+i*3,-44+i*12); g.lineTo(16-i*3,-44+i*12); g.fill(); outline(g); }
          } else {
            [[0,-56,17],[-13,-48,12],[13,-48,12],[0,-70,12]].forEach((c,i)=>{ g.fillStyle=cols[i%3]; g.beginPath(); g.arc(c[0],c[1],c[2],0,6.283); g.fill(); outline(g); });
            for (let i=0;i<(lowQ()?5:14);i++){ g.fillStyle='rgba(190,230,150,'+(0.16+0.12*Math.sin(t*1.7+i+p.variant)).toFixed(2)+')';
              g.beginPath(); g.arc(-20+i*3.2,-62+Math.sin(i+p.variant+t*0.8)*8,1.8,0,6.283); g.fill(); }
            // солнечные зайчики в кроне
            g.fillStyle='rgba(255,240,180,.13)'; g.beginPath(); g.arc(-5,-66,7,0,6.283); g.fill();
          }
        }
        break;
      }
      case 'boulder': {
        shadow(g,0,1,15,.45); g.fillStyle='#5c666d';
        g.beginPath(); g.moveTo(-15,0); g.lineTo(-12,-13); g.lineTo(-2,-19); g.lineTo(11,-14); g.lineTo(15,0); g.closePath(); g.fill(); outline(g);
        g.fillStyle='rgba(255,255,255,.14)'; g.beginPath(); g.moveTo(-10,-12); g.lineTo(-2,-17); g.lineTo(1,-6); g.closePath(); g.fill();
        g.strokeStyle='rgba(20,26,28,.35)'; g.lineWidth=0.9;
        g.beginPath(); g.moveTo(-6,-13); g.lineTo(-2,-8); g.lineTo(2,-9); g.stroke();
        g.fillStyle='rgba(105,155,80,.35)'; g.beginPath(); g.ellipse(-9,-2,5,1.8,0,0,6.283); g.fill();
        break;
      }
      case 'ruin': case 'obelisk': {
        shadow(g,0,1,17,.5);
        g.fillStyle='#6a7078';
        [-11,5].forEach(dx=>{ g.fillRect(dx,-34,7,36); outline(g); g.fillRect(dx-2,-38,11,5); });
        g.fillRect(-14,-41,32,5); outline(g);
        g.strokeStyle='rgba(20,28,32,.35)'; g.lineWidth=1;
        for(let i=0;i<3;i++){ g.beginPath(); g.moveTo(-11,-28+i*9); g.lineTo(-4,-28+i*9); g.stroke(); }
        if(!lowQ()){
          g.fillStyle=rgba(z.accent,.28+0.18*Math.sin(t*2+p.seed));
          for(let i=0;i<3;i++) g.fillRect(6+i*3,-31+i*7,1.6,1.6);
        }
        g.fillStyle='rgba(0,0,0,.20)'; g.beginPath(); g.moveTo(5,0); g.lineTo(18,2); g.lineTo(12,-3); g.fill();
        break;
      }
      case 'campfire': {
        const f = Math.sin(t*9+p.seed)*3;
        g.fillStyle='#4a3320'; g.fillRect(-11,-3,22,4); g.fillRect(-9,-6,18,3);
        const gr=g.createRadialGradient(0,-10,1,0,-10,14);
        gr.addColorStop(0,'rgba(255,240,180,.95)'); gr.addColorStop(.5,'rgba(255,150,60,.65)'); gr.addColorStop(1,'rgba(255,90,30,0)');
        g.fillStyle=gr; g.beginPath(); g.arc(0,-10,14+f*0.4,0,6.283); g.fill();
        g.fillStyle='#ffd27a'; g.beginPath(); g.moveTo(-5,-2); g.quadraticCurveTo(-3,-14-f,0,-20-f); g.quadraticCurveTo(4,-12-f,5,-2); g.fill();
        // G2.1 · дым и разлетающиеся искры
        if(lowQ()) break;
        for(let i=0;i<5;i++){ const ph=(t*0.55+i*0.2+p.seed)%1;
          g.fillStyle='rgba(190,190,185,'+(0.20*(1-ph)).toFixed(2)+')';
          g.beginPath(); g.arc(Math.sin(i*2+ph*3)*7,-22-ph*38,2+ph*5,0,6.283); g.fill(); }
        for(let i=0;i<6;i++){ const ph=(t*2.2+i*0.17+p.seed)%1;
          g.fillStyle='rgba(255,'+(160+Math.floor(70*ph))+',90,'+(0.9*(1-ph)).toFixed(2)+')';
          g.fillRect(Math.sin(i*3.1)*9,-14-ph*26,1.5,1.5); }
        g.strokeStyle='rgba(255,160,70,.20)'; g.lineWidth=1;
        g.beginPath(); g.arc(0,-6,16+Math.sin(t*7+p.seed)*2,0,6.283); g.stroke();
        break;
      }
      case 'crystal': case 'ice': {
        shadow(g,0,1,12,.35);
        const col = p.kind==='ice' ? '#9fe8ff' : '#c07bff';
        [[0,-26,7],[ -8,-18,5],[9,-20,6]].forEach((c,i)=>{
          g.fillStyle=rgba(col,.75-i*.12); g.beginPath(); g.moveTo(c[0],c[1]-c[2]); g.lineTo(c[0]+c[2]*0.7,c[1]); g.lineTo(c[0],c[1]+c[2]); g.lineTo(c[0]-c[2]*0.7,c[1]); g.fill(); outline(g);
        });
        if(lowQ()) break;
        const gl=g.createRadialGradient(0,-20,1,0,-20,22);
        gl.addColorStop(0,rgba(col,.34+0.10*Math.sin(t*2.4+p.seed))); gl.addColorStop(1,rgba(col,0));
        g.fillStyle=gl; g.beginPath(); g.arc(0,-20,22,0,6.283); g.fill();
        g.fillStyle='rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(-1,-30); g.lineTo(1,-24); g.lineTo(-1,-19); g.fill();
        break;
      }
      case 'bone': { g.strokeStyle='#d8d2bd'; g.lineWidth=3; g.beginPath(); g.moveTo(-9,0); g.lineTo(9,-6); g.stroke(); g.fillStyle='#d8d2bd'; g.beginPath(); g.arc(-9,0,3,0,6.283); g.arc(9,-6,3,0,6.283); g.fill(); break; }
      case 'banner': {
        g.fillStyle='#4a3c28'; g.fillRect(-1.5,-42,3,44);
        const wv=Math.sin(t*3+p.seed)*2.4;
        g.fillStyle=rgba(z.accent,.85); g.beginPath(); g.moveTo(1,-40);
        g.quadraticCurveTo(8,-40+wv,15+wv,-38); g.lineTo(12+wv*0.5,-20); g.lineTo(1,-22); g.fill(); outline(g);
        g.fillStyle=rgba('#f0d27a',.8); g.beginPath(); g.arc(7,-31,3,0,6.283); g.fill();
        break;
      }
      case 'tent': {
        shadow(g,0,1,18,.4); g.fillStyle='#6b5a42';
        g.beginPath(); g.moveTo(-18,0); g.lineTo(0,-26); g.lineTo(18,0); g.fill(); outline(g);
        g.fillStyle='#2b211a'; g.beginPath(); g.moveTo(-5,0); g.lineTo(0,-14); g.lineTo(5,0); g.fill();
        g.strokeStyle='rgba(200,180,140,.35)'; g.lineWidth=0.8;
        g.beginPath(); g.moveTo(0,-26); g.lineTo(-22,-1); g.moveTo(0,-26); g.lineTo(22,-1); g.stroke();
        break;
      }
      case 'bridge': { g.fillStyle='#6b5540'; g.fillRect(-20,-4,40,7); outline(g); break; }
      case 'grass': case 'flower': {
        g.strokeStyle = p.kind==='flower' ? z.accent : '#5e8c52'; g.lineWidth=1.4;
        const sw=Math.sin(t*2.2+p.seed)*2.2;
        for(let i=0;i<5;i++){ g.beginPath(); g.moveTo((i-2)*2,0); g.quadraticCurveTo((i-2)*3,-7,(i-2)*4+sw,-10); g.stroke(); }
        if(p.kind==='flower'){ g.fillStyle='#ffe08a'; g.beginPath(); g.arc(0,-11,2.2,0,6.283); g.fill(); }
        break;
      }
      /* ------------- G2.3 · Пристань Завета ------------- */
      case 'house': {
        shadow(g,0,2,26,.5);
        g.fillStyle='#6b6250'; g.fillRect(-22,-38,44,38); outline(g);
        g.fillStyle='#8a7a5e'; g.fillRect(-22,-40,44,4);
        g.fillStyle='#4a3a2c'; g.beginPath(); g.moveTo(-27,-38); g.lineTo(0,-60); g.lineTo(27,-38); g.closePath(); g.fill(); outline(g);
        g.fillStyle='#3b3026'; g.fillRect(-6,-22,12,22); outline(g);
        [-14,14].forEach(dx=>{ g.fillStyle='#2b3033'; g.fillRect(dx-5,-30,10,11); outline(g);
          g.fillStyle=rgba('#ffcf8a',.55+0.2*Math.sin(t*1.4+p.seed)); g.fillRect(dx-4,-29,8,9);
          g.strokeStyle='#5a4632'; g.lineWidth=1; g.beginPath(); g.moveTo(dx,-29); g.lineTo(dx,-20); g.stroke(); });
        g.fillStyle='#7b6a50'; g.fillRect(-24,-41,48,3);
        break;
      }
      case 'stall': {
        shadow(g,0,1,18,.4);
        g.fillStyle='#5b4630'; g.fillRect(-16,-16,32,16); outline(g);
        g.fillStyle='#8a6a44'; g.fillRect(-18,-18,36,3);
        [-17,17].forEach(dx=>{ g.fillStyle='#4a3826'; g.fillRect(dx-1.5,-34,3,20); });
        g.fillStyle=rgba(p.variant?'#8fd08a':'#e08a4c',.9);
        g.beginPath(); g.moveTo(-20,-34); g.lineTo(20,-34); g.lineTo(16,-26); g.lineTo(-16,-26); g.closePath(); g.fill(); outline(g);
        g.fillStyle='#e8c98a'; g.beginPath(); g.arc(-8,-20,2.6,0,6.283); g.arc(3,-20,2.6,0,6.283); g.fill();
        break;
      }
      case 'well': {
        shadow(g,0,1,15,.45);
        g.fillStyle='#6a6a63'; g.beginPath(); g.ellipse(0,-6,15,7,0,0,6.283); g.fill(); outline(g);
        g.fillStyle='#2a3b40'; g.beginPath(); g.ellipse(0,-8,10,4.5,0,0,6.283); g.fill();
        [-12,12].forEach(dx=>{ g.fillStyle='#5b4a34'; g.fillRect(dx-2,-30,4,24); });
        g.fillStyle='#6b4a32'; g.beginPath(); g.moveTo(-17,-30); g.lineTo(0,-40); g.lineTo(17,-30); g.closePath(); g.fill(); outline(g);
        g.fillStyle='#9a7a4c'; g.fillRect(-3,-34,6,6);
        break;
      }
      case 'statue': {
        shadow(g,0,2,20,.55);
        g.fillStyle='#5d5a50'; g.fillRect(-13,-10,26,10); outline(g); g.fillRect(-9,-16,18,6); outline(g);
        g.fillStyle='#8b8570'; g.beginPath(); g.moveTo(-6,-16); g.lineTo(-5,-40); g.lineTo(5,-40); g.lineTo(6,-16); g.closePath(); g.fill(); outline(g);
        g.fillStyle='#a89c78'; g.beginPath(); g.arc(0,-45,7,0,6.283); g.fill(); outline(g);
        const glow=0.55+0.3*Math.sin(t*2.2);
        const gr=g.createRadialGradient(0,-52,1,0,-52,26);
        gr.addColorStop(0,rgba('#ffe6a8',glow)); gr.addColorStop(1,rgba('#ffe6a8',0));
        g.fillStyle=gr; g.beginPath(); g.arc(0,-52,26,0,6.283); g.fill();
        g.fillStyle='#fff2c0'; g.beginPath(); g.arc(0,-54,4.5,0,6.283); g.fill();
        break;
      }
      case 'lamp': {
        g.fillStyle='#3e3830'; g.fillRect(-2,-40,4,40); outline(g);
        g.fillStyle='#5a5040'; g.fillRect(-6,-42,12,4);
        const gr=g.createRadialGradient(0,-36,1,0,-36,18);
        gr.addColorStop(0,'rgba(255,220,150,.85)'); gr.addColorStop(1,'rgba(255,190,90,0)');
        g.fillStyle=gr; g.beginPath(); g.arc(0,-36,18,0,6.283); g.fill();
        g.fillStyle='#ffe0a0'; g.beginPath(); g.arc(0,-36,3.4,0,6.283); g.fill();
        break;
      }
      case 'wall': {
        g.fillStyle='#5c5b52'; g.fillRect(-16,-13,32,13); outline(g);
        g.strokeStyle='rgba(20,25,25,.3)'; g.lineWidth=1;
        for(let i=0;i<4;i++){ g.beginPath(); g.moveTo(-16+i*8,-13); g.lineTo(-16+i*8,0); g.stroke(); }
        g.fillStyle='#6d6c60'; g.fillRect(-17,-15,34,3);
        break;
      }
      case 'target': {
        g.fillStyle='#5a422c'; g.fillRect(-2,-26,4,26);
        g.fillStyle='#d8c49a'; g.beginPath(); g.arc(0,-28,11,0,6.283); g.fill(); outline(g);
        g.strokeStyle='#c05a4a'; g.lineWidth=2;
        [8,5,2].forEach(r=>{ g.beginPath(); g.arc(0,-28,r,0,6.283); g.stroke(); });
        break;
      }
      default: break;
    }
    g.restore();
  }

  /* --------------------------- телеграфы и лут --------------------------- */
  function drawTelegraph(g, W, e, o, t) {
    const [x,y] = iso(e.x, e.y, 0.02, o);
    const p = A2.clamp(e.t / e.dur, 0, 1);
    g.save(); g.translate(x, y);
    g.fillStyle = 'rgba(224,87,79,' + (0.12 + p * 0.22).toFixed(3) + ')';
    g.strokeStyle = 'rgba(255,120,100,' + (0.6 + p * 0.4).toFixed(2) + ')'; g.lineWidth = 2;
    if (e.shape === 'circle' || e.shape === 'ring') {
      g.beginPath(); g.ellipse(0,0,e.r*TW/2,e.r*TH/2,0,0,6.283); g.fill(); g.stroke();
      if (e.shape==='ring'){ g.strokeStyle='rgba(255,220,170,.7)'; g.beginPath(); g.ellipse(0,0,e.r*TW*0.28,e.r*TH*0.28,0,0,6.283); g.stroke(); }
    } else if (e.shape === 'cone') {
      g.beginPath(); g.moveTo(0,0);
      for(let i=-0.6;i<=0.6;i+=0.15){ const a=e.angle+i; g.lineTo(Math.cos(a)*e.r*TW/2,(Math.sin(a))*e.r*TH/2); }
      g.closePath(); g.fill(); g.stroke();
    } else {
      const a=e.angle, dx=Math.cos(a)*e.r*TW/2, dy=Math.sin(a)*e.r*TH/2;
      g.lineWidth=e.r*TH*0.7; g.strokeStyle='rgba(224,87,79,.30)';
      g.beginPath(); g.moveTo(0,0); g.lineTo(dx,dy); g.stroke();
      g.lineWidth=2; g.strokeStyle='rgba(255,140,110,.9)'; g.beginPath(); g.moveTo(0,0); g.lineTo(dx,dy); g.stroke();
    }
    g.restore();
  }

  function drawDrop(g, d, x, y, t) {
    if (lowQ()) { // дешёвый режим для слабых телефонов: без градиентов и рун
      const col = A2.RARITY(d.item ? d.item.rarity : 'rare').color;
      const bob = Math.sin(t*3+d.t)*1.5;
      g.save(); g.translate(x,y-9+bob); g.fillStyle=col;
      g.shadowColor=col; g.shadowBlur=6;
      g.beginPath(); g.moveTo(0,-6); g.lineTo(5,0); g.lineTo(0,6); g.lineTo(-5,0); g.closePath(); g.fill();
      g.restore();
      if(d.item && A2.RARITIES.indexOf(A2.RARITY(d.item.rarity))>=3)
        lootLabel(g,x,y-24,A2.RPG.itemName(d.item).slice(0,14),col);
      return;
    }
    const rar = A2.RARITY(d.item ? d.item.rarity : 'rare');
    const bob = Math.sin(t * 3 + d.t) * 2.4;
    const pulse = 0.75 + 0.25 * Math.sin(t * 4 + (d.spin || 0));
    if (!d.item) { // слиток Серебра · монетный столб
      const gr = g.createLinearGradient(x, y-30, x, y);
      gr.addColorStop(0,'rgba(240,210,122,0)'); gr.addColorStop(1,'rgba(240,210,122,.28)');
      g.fillStyle=gr; g.fillRect(x-4,y-30,8,30);
      g.save(); g.translate(x,y-8+bob); g.shadowColor='#f0d27a'; g.shadowBlur=10;
      g.fillStyle='#f0d27a'; g.beginPath(); g.ellipse(0,0,7,4,0,0,6.283); g.fill();
      g.fillStyle='#fff3c8'; g.beginPath(); g.ellipse(-2,-1,3,1.4,0,0,6.283); g.fill();
      g.shadowBlur=0; g.restore();
      lootLabel(g,x,y-26,'СЕРЕБРО','#f0d27a');
      return;
    }
    // G2.1 · вертикальный луч редкости + вращающаяся руна + подпись предмета
    const h = 62 + rar.glow * 34;
    const beam = g.createLinearGradient(x, y-h, x, y+4);
    beam.addColorStop(0, rgba(rar.color, 0));
    beam.addColorStop(0.45, rgba(rar.color, .13 * pulse));
    beam.addColorStop(1, rgba(rar.color, (.36 + rar.glow*.26) * pulse));
    g.fillStyle = beam;
    g.beginPath(); g.moveTo(x-3, y-h); g.lineTo(x+3, y-h); g.lineTo(x+11, y+2); g.lineTo(x-11, y+2); g.closePath(); g.fill();
    // основание: алмазный круг
    g.strokeStyle = rgba(rar.color, .55 * pulse); g.lineWidth = 1.2;
    g.beginPath(); g.ellipse(x,y,11,5.5,0,0,6.283); g.stroke();
    // вращающаяся руническая рамка
    g.save(); g.translate(x, y-13+bob); g.rotate(t*0.7+(d.spin||0));
    g.strokeStyle = rgba(rar.color, .7*pulse); g.lineWidth = 1.4;
    g.beginPath();
    for(let i=0;i<4;i++){ const a=i*Math.PI/2; g.moveTo(Math.cos(a)*10,Math.sin(a)*10); g.lineTo(Math.cos(a+Math.PI/4)*3,Math.sin(a+Math.PI/4)*3); }
    g.stroke(); g.restore();
    // сердечник предмета
    g.save(); g.translate(x, y-13+bob);
    g.shadowColor = rar.color; g.shadowBlur = 10 + 16*rar.glow;
    g.fillStyle = rar.color;
    g.beginPath();
    for(let i=0;i<4;i++){ const a=i*Math.PI/2-0.785; g.lineTo(Math.cos(a)*7,Math.sin(a)*7); }
    g.closePath(); g.fill(); g.shadowBlur=0;
    g.fillStyle='rgba(255,255,255,.55)'; g.beginPath(); g.arc(-2,-2,2,0,6.283); g.fill();
    g.restore();
    // искры для высоких редкостей
    if (A2.RARITIES.indexOf(rar) >= 3) {
      for(let i=0;i<4;i++){ const a=t*2+i*1.57+(d.spin||0), r=14+Math.sin(t*3+i)*4;
        g.fillStyle=rgba(rar.color,.75); g.beginPath(); g.arc(x+Math.cos(a)*r, y-13+Math.sin(a)*r*0.6,1.5,0,6.283); g.fill(); }
    }
    const icon = (typeof A2.Market !== 'undefined' && A2.Market.ICON) ? (A2.Market.ICON[d.item.slot] || '✦') : '✦';
    lootLabel(g,x,y-h-10,icon+' '+A2.RPG.itemName(d.item).slice(0,22),rar.color);
  }
  function lootLabel(g,x,y,text,col){
    g.save(); g.font='700 9px -apple-system,system-ui,sans-serif'; g.textAlign='center';
    const w=Math.min(180,Math.max(50,g.measureText(text).width+12));
    g.fillStyle='rgba(4,10,14,.78)'; g.fillRect(x-w/2,y-9,w,14);
    g.strokeStyle=rgba(col,.6); g.lineWidth=0.8; g.strokeRect(x-w/2,y-9,w,14);
    g.fillStyle=col; g.fillText(text,x,y+1); g.restore();
  }

  /* ------------- G2.1 · анимированная вода и останки врагов ------------- */
  function drawWater(g,W,o,t,ox,oy,zoom){
    if(lowQ()) return;
    const key=W.id+':'+o;
    if(waterCache.key!==key){
      const T=A2.World.T, tiles=[];
      for(let y=0;y<N;y++) for(let x=0;x<N;x++)
        if(W.tiles[y*N+x]===T.WATER) tiles.push({x:x+0.5,y:y+0.5});
      waterCache={key,tiles};
    }
    for(const q of waterCache.tiles){
      const x=q.x, y=q.y;
      const [sx,sy]=iso(x,y,0,o);
      const ssx=sx*zoom+ox, ssy=sy*zoom+oy;
      if(ssx<-70||ssx>VW+70||ssy<-70||ssy>VH+70) continue;
      const ph=t*1.6+x*0.71+y*0.93;
      g.strokeStyle='rgba(190,235,255,'+(0.10+0.09*Math.sin(ph)).toFixed(3)+')'; g.lineWidth=1;
      for(let k=0;k<2;k++){
        const w=7+k*7+Math.sin(ph+k)*3;
        g.beginPath(); g.moveTo(sx-w,sy+2+k*3); g.quadraticCurveTo(sx,sy-2+k*3,sx+w,sy+2+k*3); g.stroke();
      }
      if(A2.hash(x,y,W.seed+211)>0.82){
        g.fillStyle='rgba(220,250,255,'+(0.10+0.08*Math.sin(ph*1.7)).toFixed(3)+')';
        g.beginPath(); g.ellipse(sx,sy,9,2.4,0,0,6.283); g.fill();
      }
    }
  }
  function drawCorpses(g,G,o,t){
    if(!G.corpses || !G.corpses.length) return;
    for(const c of G.corpses){
      const [x,y]=iso(c.x,c.y,0,o), a=A2.clamp(c.life/c.max,0,1);
      g.save(); g.globalAlpha=a*0.62; g.translate(x,y+3); g.scale(1,0.44);
      g.fillStyle=c.color||'#7a4a3a'; g.beginPath(); g.arc(0,0,12*(c.scale||1),0,6.283); g.fill();
      g.strokeStyle='rgba(240,210,122,'+(a*0.45).toFixed(2)+')'; g.lineWidth=1.4; g.stroke();
      g.restore();
      g.globalAlpha=1;
      // поднимающаяся пепельная частица
      g.fillStyle='rgba(200,210,215,'+(a*0.35).toFixed(2)+')';
      g.beginPath(); g.arc(x+Math.sin(t*3+c.x)*7,y-6-(1-a)*20,1.6,0,6.283); g.fill();
    }
  }
  function drawGodRays(g,z,t,VW,VH){
    if(lowQ()) return;
    g.save(); g.globalCompositeOperation='lighter';
    const gr=g.createLinearGradient(0,0,VW*0.35,VH);
    gr.addColorStop(0,rgba(z.accent,.085)); gr.addColorStop(.5,rgba(z.accent,.02)); gr.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=gr;
    for(let i=0;i<3;i++){
      g.save(); g.translate(VW*(0.14+i*0.30),-60); g.rotate(0.33+Math.sin(t*0.09+i)*0.015);
      g.fillRect(0,0,34+10*Math.sin(t*0.35+i),VH*1.7); g.restore();
    }
    g.restore();
  }

  /* ------------------------------ погода ------------------------------ */
  function initWeather(z) {
    const n = VW < 600 ? 55 : 95;
    weather = [];
    for (let i=0;i<n;i++) weather.push({ x:Math.random()*VW, y:Math.random()*VH, s:0.5+Math.random()*2, v:18+Math.random()*38, a:Math.random()*6.28, kind:z.weather });
  }
  function drawWeather(g, dt, z) {
    if (!weather.length || weather[0].kind !== z.weather) initWeather(z);
    g.save();
    for (const p of weather) {
      p.y += p.v*dt; p.x += Math.sin(p.a + p.y*0.01)*12*dt; p.a += dt*0.6;
      if (p.y > VH+8) { p.y = -8; p.x = Math.random()*VW; }
      if (p.kind==='snow'){ g.fillStyle='rgba(220,240,255,.65)'; g.beginPath(); g.arc(p.x,p.y,p.s*0.8,0,6.283); g.fill(); }
      else if (p.kind==='ash'){ g.fillStyle='rgba(190,175,165,.35)'; g.fillRect(p.x,p.y,p.s,p.s); }
      else if (p.kind==='ember'){ g.fillStyle='rgba(255,150,80,.55)'; g.beginPath(); g.arc(p.x,p.y,p.s*0.7,0,6.283); g.fill(); }
      else { g.fillStyle='rgba(140,190,110,.40)'; g.save(); g.translate(p.x,p.y); g.rotate(p.a); g.fillRect(-2,-1,4,2); g.restore(); }
    }
    g.restore();
  }

  /* ------------------------------- кадр ------------------------------- */
  function frame(W, G, dt) {
    if (!ctx) return;
    const z = W.zone, cam = G.cam, t = G.time;
    const o = cam.orient | 0, zoom = cam.zoom;
    const ground = makeGround(W, o);
    const [px, py] = iso(G.player.x, G.player.y, 0, o);
    const ox = VW/2 - px*zoom + (cam.shakeX||0), oy = VH*0.56 - py*zoom + (cam.shakeY||0);
    G.camScreen = { ox, oy, zoom };

    ctx.setTransform(DPR,0,0,DPR,0,0);
    const sky = ctx.createLinearGradient(0,0,0,VH);
    sky.addColorStop(0, z.sky); sky.addColorStop(1, z.fog);
    ctx.fillStyle = sky; ctx.fillRect(0,0,VW,VH);
    // далёкие силуэты (параллакс)
    ctx.fillStyle = rgba(z.fog,.55);
    for (let i=0;i<9;i++) {
      const bx = i*VW/8 - (px*0.04)%120;
      ctx.beginPath(); ctx.moveTo(bx-70,VH*0.60); ctx.lineTo(bx,VH*(0.36+((i*37)%12)/100)); ctx.lineTo(bx+80,VH*0.60); ctx.fill();
    }

    drawGodRays(ctx,z,t,VW,VH);
    ctx.save(); ctx.translate(ox, oy); ctx.scale(zoom, zoom);
    if (ground) ctx.drawImage(ground, 0, 0);
    drawWater(ctx,W,o,t,ox,oy,zoom);
    drawCorpses(ctx,G,o,t);
    // телеграфы под существами
    for (const e of W.effects) if (e.kind==='telegraph') drawTelegraph(ctx, W, e, o, t);
    // порталы
    for (const p of W.portals) {
      const [x,y]=iso(p.x,p.y,0,o);
      const g2=ctx.createRadialGradient(x,y,2,x,y,52);
      g2.addColorStop(0,rgba(z.accent,.55)); g2.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g2; ctx.beginPath(); ctx.ellipse(x,y,48,26,0,0,6.283); ctx.fill();
      ctx.strokeStyle=rgba(z.accent,.8); ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(x,y,26,14,0,0,6.283); ctx.stroke();
    }
    // сбор drawables по глубине
    const items = [];
    for (const p of W.props) {
      const [x,y]=iso(p.x,p.y,0,o);
      if (x*zoom+ox < -120 || x*zoom+ox > VW+120 || y*zoom+oy < -160 || y*zoom+oy > VH+160) continue;
      items.push({ d: depth(p.x,p.y,o), fn: () => drawProp(ctx,p,x,y,t,z) });
    }
    for (const m of W.mobs) if (m.alive) {
      const [x,y]=iso(m.x,m.y,0,o);
      if (x*zoom+ox < -100 || x*zoom+ox > VW+100 || y*zoom+oy < -160 || y*zoom+oy > VH+160) continue;
      items.push({ d: depth(m.x,m.y,o)+0.1, fn: () => drawMob(ctx,m,x,y,t,1) });
    }
    for (const n of W.npcs) {
      const [x,y]=iso(n.x,n.y,0,o);
      items.push({ d: depth(n.x,n.y,o)+0.15, fn: () => { shadow(ctx,x,y+3,15,.5); drawHero(ctx,{classId:'paladin',gearRarity:'rare',moving:false,iframe:0},x,y,t,0.95); } });
    }
    // G2.2 · отсечение и лимит лута: без этого при долгом гринде на экране
    // рисовались сотни градиентных лучей и кадр проседал.
    const dropsVisible = [];
    for (const d of W.drops) {
      if (d.picked || d.t < 0) continue;
      const [x,y]=iso(d.x,d.y,0,o);
      const sx=x*zoom+ox, sy=y*zoom+oy;
      if (sx<-90 || sx>VW+90 || sy<-170 || sy>VH+170) continue;
      dropsVisible.push({ d, x, y, dist:A2.dist(d.x,d.y,G.player.x,G.player.y) });
    }
    dropsVisible.sort((a,b)=>a.dist-b.dist);
    const dropCap = lowQ() ? 14 : 30;
    for (const dr of dropsVisible.slice(0,dropCap))
      items.push({ d: depth(dr.d.x,dr.d.y,o)+0.05, fn: () => drawDrop(ctx,dr.d,dr.x,dr.y,t) });
    for (const e of G.entities) {
      const [x,y]=iso(e.x,e.y,0,o);
      items.push({ d: depth(e.x,e.y,o)+0.2, fn: () => {
        if (e === G.player || e.isRemote) {
          if (G.target && G.target === e) {
            ctx.strokeStyle=rgba('#f0d27a',.85); ctx.lineWidth=2;
            ctx.beginPath(); ctx.ellipse(x,y,20,10,0,0,6.283); ctx.stroke();
          }
          drawHero(ctx,e,x,y,t,1);
        }
      } });
    }
    items.sort((a,b)=>a.d-b.d);
    for (const it of items) it.fn();
    // частицы и цифры урона в мировом пространстве
    for (const p of G.particles) {
      const [x,y]=iso(p.x,p.y,p.z||0,o);
      ctx.globalAlpha = A2.clamp(p.life/p.max,0,1);
      ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(x,y,p.size,0,6.283); ctx.fill();
    }
    ctx.globalAlpha=1;
    for (const n of G.numbers) {
      const [x,y]=iso(n.x,n.y,n.z||1.2,o);
      ctx.font='700 13px -apple-system,system-ui,sans-serif'; ctx.textAlign='center';
      ctx.fillStyle='rgba(0,0,0,.75)'; ctx.fillText(n.text,x+1,y+1);
      ctx.fillStyle=n.color; ctx.fillText(n.text,x,y);
    }
    ctx.restore();

    // ---- динамический свет ----
    if (darkCtx) {
      const base = 0.18 + z.time * 0.42;
      darkCtx.setTransform(1,0,0,1,0,0);
      darkCtx.clearRect(0,0,VW,VH);
      darkCtx.fillStyle='rgba(6,10,18,'+base.toFixed(2)+')'; darkCtx.fillRect(0,0,VW,VH);
      darkCtx.globalCompositeOperation='destination-out';
      const lights = W.lights.slice();
      for (const p of G.particles) if (p.light) lights.push({x:p.x,y:p.y,color:p.color,r:2.5});
      if (G.player) lights.push({x:G.player.x,y:G.player.y,color:'#ffe0a8',r:5.5});
      for (const L of lights) {
        const [lx,ly]=iso(L.x,L.y,0,o);
        const sx=lx*zoom+ox, sy=ly*zoom+oy, r=L.r*TW*zoom*0.5;
        const pulse = 1 + Math.sin(t*6 + (L.pulse||0))*0.06;
        const gr=darkCtx.createRadialGradient(sx,sy,r*0.12,sx,sy,r*pulse);
        gr.addColorStop(0,'rgba(0,0,0,1)'); gr.addColorStop(.55,'rgba(0,0,0,.55)'); gr.addColorStop(1,'rgba(0,0,0,0)');
        darkCtx.fillStyle=gr; darkCtx.beginPath(); darkCtx.arc(sx,sy,r*pulse,0,6.283); darkCtx.fill();
      }
      darkCtx.globalCompositeOperation='source-over';
      ctx.drawImage(darkCanvas,0,0);
    }
    // bloom-эмуляция
    ctx.save(); ctx.globalCompositeOperation='lighter';
    for (const L of W.lights.slice(0,12)) {
      const [lx,ly]=iso(L.x,L.y,0,o); const sx=lx*zoom+ox, sy=ly*zoom+oy, r=L.r*TW*zoom*0.22;
      const gr=ctx.createRadialGradient(sx,sy,1,sx,sy,r);
      gr.addColorStop(0,rgba(L.color,.16)); gr.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(sx,sy,r,0,6.283); ctx.fill();
    }
    for (const dr of dropsVisible.slice(0, lowQ()?3:6)) {
      const d=dr.d;
      if(!d.item || d.picked || d.t<0) continue;
      const [lx,ly]=iso(d.x,d.y,0,o); const sx=lx*zoom+ox, sy=ly*zoom+oy-24*zoom;
      const col=A2.RARITY(d.item.rarity).color; const gr=ctx.createRadialGradient(sx,sy,1,sx,sy,34*zoom);
      gr.addColorStop(0,rgba(col,.22)); gr.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(sx,sy,34*zoom,0,6.283); ctx.fill();
    }
    ctx.restore();
    // туман у горизонта и виньетка
    const fog = ctx.createLinearGradient(0,VH*0.55,0,VH);
    fog.addColorStop(0,rgba(z.fog,0)); fog.addColorStop(1,rgba(z.fog,.42));
    ctx.fillStyle=fog; ctx.fillRect(0,VH*0.55,VW,VH*0.45);
    const vg = ctx.createRadialGradient(VW/2,VH/2,Math.min(VW,VH)*0.32,VW/2,VH/2,Math.max(VW,VH)*0.72);
    vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,.52)');
    ctx.fillStyle=vg; ctx.fillRect(0,0,VW,VH);
    // G2.1 · цветокоррекция биома
    const grade=ctx.createLinearGradient(0,0,VW,VH);
    grade.addColorStop(0,rgba(z.accent,.055)); grade.addColorStop(.55,'rgba(0,0,0,0)'); grade.addColorStop(1,rgba(z.fog,.045));
    ctx.fillStyle=grade; ctx.fillRect(0,0,VW,VH);
    drawWeather(ctx,dt,z);
    if (G.flash>0){ ctx.fillStyle='rgba(255,240,210,'+(G.flash*0.35).toFixed(2)+')'; ctx.fillRect(0,0,VW,VH); }

    // ---- надписи в экранном пространстве ----
    ctx.textAlign='center';
    const label = (e, x, y, name, hpFrac, col, tag, lv) => {
      const sx=x*zoom+ox, sy=y*zoom+oy-52*zoom;
      ctx.font='700 10px -apple-system,system-ui,sans-serif';
      ctx.fillStyle='rgba(4,10,14,.72)';
      const w=Math.max(54,ctx.measureText(name).width+16); ctx.fillRect(sx-w/2,sy-13,w,15);
      ctx.fillStyle=col; ctx.fillText(name,sx,sy-2);
      if (hpFrac !== undefined) {
        ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(sx-w/2,sy+2,w,4);
        ctx.fillStyle=hpFrac>0.5?'#6fbf72':hpFrac>0.25?'#e0a44f':'#e0574f';
        ctx.fillRect(sx-w/2,sy+2,w*A2.clamp(hpFrac,0,1),4);
      }
      if (tag) { ctx.font='700 9px system-ui'; ctx.fillStyle=rgba(z.accent,.95); ctx.fillText(tag,sx,sy-18); }
      if (lv) { ctx.font='600 9px system-ui'; ctx.fillStyle='rgba(220,235,240,.75)'; ctx.fillText('ур. '+lv,sx-w/2-14,sy-2); }
    };
    for (const n of W.npcs) {
      const [x,y]=iso(n.x,n.y,0,o);
      const isStory = G.storyTarget && G.storyTarget.npc===n.id;
      label(null,x,y,n.ru,undefined,isStory?'#4fd6d0':n.color,
        isStory?'✦ СЮЖЕТ':(n.questMark && n.quests && n.quests.length?'! КВЕСТ':n.role),null);
    }
    for (const m of W.mobs) if (m.alive) {
      const [x,y]=iso(m.x,m.y,0,o);
      const sx=x*zoom+ox, sy=y*zoom+oy;
      if (sx<-80||sx>VW+80||sy<-120||sy>VH+120) continue;
      label(null,x,y,m.nameOverride||m.ru,m.hp/m.maxHp,m.boss?'#ff7a4d':m.elite?'#f0b45c':'#e9efed',m.boss?'МИРОВОЙ БОСС':m.elite?'ЭЛИТА':null,m.lvl);
    }
    for (const e of G.entities) {
      const [x,y]=iso(e.x,e.y,0,o);
      const sx=x*zoom+ox, sy=y*zoom+oy;
      if (sx<-80||sx>VW+80||sy<-120||sy>VH+120) continue;
      label(null,x,y,e.name || 'Возжённый', e.isRemote?e.hp/e.maxHp:undefined, A2.CLASS(e.classId).color,
        e.isRemote?(e.ghost?'ПРИЗРАК':'ИГРОК'):'ВЫ', e.level||null);
    }
    for (const p of W.portals) {
      const [x,y]=iso(p.x,p.y,0,o);
      ctx.font='700 11px system-ui'; ctx.fillStyle=rgba(z.accent,.95);
      ctx.fillText(p.label,x*zoom+ox,y*zoom+oy-46*zoom);
    }
  }

  function minimap(W, G, cv) {
    if (!cv || !cv.getContext) return;
    const g=cv.getContext('2d'), S=cv.width, k=S/N, T=A2.World.T;
    g.clearRect(0,0,S,S);
    // G2.3 · подложка рельефа кэшируется один раз на зону: 1600 fillRect
    // на каждый кадр мини-карты грели телефон и вызывали просадки.
    if(!miniCache || miniCache.key!==W.id || miniCache.S!==S){
      let bgCv=null;
      if(typeof document!=='undefined' && document.createElement) bgCv=document.createElement('canvas');
      if(bgCv){ bgCv.width=S; bgCv.height=S; }
      const bg=bgCv?bgCv.getContext('2d'):g;
      const grad=bg.createLinearGradient(0,0,S,S);
      grad.addColorStop(0,W.zone.ground[0]);
      grad.addColorStop(1,W.zone.ground[W.zone.ground.length-1]||W.zone.ground[0]);
      bg.fillStyle=grad; bg.fillRect(0,0,S,S);
      bg.strokeStyle='rgba(255,255,255,.035)'; bg.lineWidth=.5;
      for(let i=0;i<=N;i+=8){ bg.beginPath(); bg.moveTo(i*k,0); bg.lineTo(i*k,S); bg.moveTo(0,i*k); bg.lineTo(S,i*k); bg.stroke(); }
      for(let y=0;y<N;y+=1) for(let x=0;x<N;x+=1){
        const t=W.tiles[y*N+x];
        if(t===T.PATH) bg.fillStyle='rgba(210,180,130,.35)';
        else if(t===T.WATER) bg.fillStyle='rgba(90,150,190,.55)';
        else if(t===T.ROCK||t===T.WALL) bg.fillStyle='rgba(20,26,30,.55)';
        else continue;
        bg.fillRect(x*k,y*k,k+0.6,k+0.6);
      }
      // безопасные круги (дозорная тропа у входа в Рощу)
      (W.safeCircles||[]).forEach(c=>{ bg.strokeStyle='rgba(120,220,190,.5)'; bg.lineWidth=1;
        bg.beginPath(); bg.arc(c.x*k,c.y*k,c.r*k,0,6.283); bg.stroke(); });
      miniCache={key:W.id,S,cv:bgCv};
    }
    if(miniCache.cv) g.drawImage(miniCache.cv,0,0);
    const dot=(x,y,c,r)=>{ g.fillStyle=c; g.beginPath(); g.arc(x*k,y*k,r||2.2,0,6.283); g.fill(); };
    W.camps.forEach(c=>dot(c.x,c.y,'rgba(224,87,79,.55)',2.6));
    W.npcs.forEach(n=>dot(n.x,n.y,'#f0d27a',3));
    W.portals.forEach(p=>dot(p.x,p.y,W.zone.accent,3.4));
    W.mobs.forEach(m=>{ if(m.alive) dot(m.x,m.y,m.boss?'#ff7a4d':m.elite?'#f0b45c':'rgba(224,87,79,.65)',m.boss?4:1.6); });
    W.drops.forEach(d=>dot(d.x,d.y,d.item?A2.RARITY(d.item.rarity).color:'#f0d27a',2.2));
    G.entities.forEach(e=>dot(e.x,e.y,e===G.player?'#ffffff':'#4fd6d0',e===G.player?3.4:2.4));
    // пульсирующие точки лута и стрелка направления игрока
    W.drops.forEach(d=>{ if(d.t>0&&!d.picked&&d.item){ g.strokeStyle=A2.RARITY(d.item.rarity).color; g.lineWidth=1;
      g.beginPath(); g.arc(d.x*k,d.y*k,3.2,0,6.283); g.stroke(); } });
    // G2.3 · путевая точка текущей главы сюжета
    const wp=G.storyTarget;
    if(wp && G.world && G.world.id===wp.zone){
      const wx=wp.x*k, wy=wp.y*k;
      g.strokeStyle='rgba(79,214,208,.55)'; g.lineWidth=1;
      g.beginPath(); g.moveTo(G.player.x*k,G.player.y*k); g.lineTo(wx,wy); g.stroke();
      g.fillStyle='#4fd6d0'; g.beginPath();
      g.moveTo(wx,wy-5); g.lineTo(wx+4,wy); g.lineTo(wx,wy+5); g.lineTo(wx-4,wy); g.closePath(); g.fill();
    }
    const ppx=G.player.x*k, ppy=G.player.y*k;
    g.fillStyle='#ffffff'; g.beginPath(); g.moveTo(ppx,ppy-6); g.lineTo(ppx-3.4,ppy+3); g.lineTo(ppx+3.4,ppy+3); g.closePath(); g.fill();
    // рамка обзора
    g.strokeStyle='rgba(255,255,255,.45)'; g.lineWidth=1;
    g.strokeRect((G.player.x-8)*k,(G.player.y-8)*k,16*k,16*k);
  }

  A2.Render = { init, resize, frame, minimap, iso, drawMob, drawHero, drawProp, makeGround,
    setQuality, get quality(){ return QUALITY; },
    get size(){ return {VW,VH,DPR}; } };
})();
