/* =====================================================================
 * ARKEON · G2 · audio.js
 * Полностью процедурный WebAudio: 24 боевых/интерфейсных звука,
 * фоновый амбиент 4 биомов, музыкальный слой, панорама, пул голосов,
 * троттлинг, master/sfx/music-шины, разблокировка по первому тапу,
 * настройки громкости и mute. Ноль файлов, ноль CDN, ноль зависимостей.
 * ===================================================================== */
(function () {
  'use strict';
  const A2 = window.A2;

  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let ambientNodes = [], ambientZone = '', lastPlay = {}, voiceTimes = [];
  const cfg = { enabled:true, volume:0.8, sfx:0.9, music:0.45, muted:false };

  function init() {
    if (ctx) return ctx;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = cfg.volume; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = cfg.sfx; sfxBus.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = cfg.music; musicBus.connect(master);
      const len = Math.floor(ctx.sampleRate * 1.2);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len * 0.35);
    } catch (e) { ctx = null; }
    return ctx;
  }
  function unlock() {
    init();
    if (ctx && ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
    return !!ctx;
  }
  const now = () => (ctx ? ctx.currentTime : 0);
  function ready(name, gap) {
    if (!cfg.enabled || cfg.muted || !ctx || !sfxBus) return false;
    const t = now(), g = gap === undefined ? 0.045 : gap;
    if (lastPlay[name] && t - lastPlay[name] < g) return false;
    voiceTimes = voiceTimes.filter(v => t - v < 0.9);
    if (voiceTimes.length > 28) return false;
    lastPlay[name] = t; return true;
  }
  function voice() { voiceTimes.push(now()); }
  function env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function tone(o) {
    const t = now() + (o.delay || 0), ac = ctx;
    const osc = ac.createOscillator(), g = ac.createGain();
    let node = osc;
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f || 220, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.dur || 0.2));
    if (o.detune) osc.detune.value = o.detune;
    if (o.filter) {
      const bq = ac.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.value = o.filter;
      node.connect(bq); node = bq;
    }
    let out = g;
    if (o.pan !== undefined && ac.createStereoPanner) {
      const p = ac.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p;
    }
    node.connect(g);
    env(g, t, o.attack || 0.006, o.dur || 0.2, (o.gain || 0.2) * (o.music ? 1 : 1));
    out.connect(o.music ? musicBus : sfxBus);
    osc.start(t); osc.stop(t + (o.attack || 0.006) + (o.dur || 0.2) + 0.02);
    voice();
  }
  function noise(o) {
    if (!noiseBuf) return;
    const t = now() + (o.delay || 0), ac = ctx;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const bq = ac.createBiquadFilter();
    bq.type = o.type || 'bandpass'; bq.Q.value = o.q || 1.0;
    bq.frequency.setValueAtTime(o.f || 900, t);
    if (o.f2) bq.frequency.exponentialRampToValueAtTime(Math.max(60, o.f2), t + (o.dur || 0.15));
    const g = ac.createGain();
    src.connect(bq); bq.connect(g);
    env(g, t, o.attack || 0.004, o.dur || 0.15, o.gain || 0.16);
    if (o.pan !== undefined && ac.createStereoPanner) {
      const p = ac.createStereoPanner(); p.pan.value = o.pan; g.connect(p); p.connect(o.music ? musicBus : sfxBus);
    } else g.connect(o.music ? musicBus : sfxBus);
    src.start(t); src.stop(t + (o.dur || 0.15) + 0.05);
    voice();
  }

  /* ------------------------- библиотека звуков ------------------------- */
  const BANK = {
    ui:        () => tone({ f:520, f2:660, dur:0.05, type:'triangle', gain:0.09 }),
    click:     () => { noise({ f:1800, dur:0.035, gain:0.07, type:'highpass' }); tone({ f:300, dur:0.04, gain:0.05 }); },
    hit:       () => { noise({ f:1200, f2:260, dur:0.11, gain:0.20 }); tone({ f:150, f2:62, dur:0.13, type:'triangle', gain:0.22 }); },
    crit:      () => { noise({ f:2600, f2:420, dur:0.16, gain:0.26 }); tone({ f:420, f2:110, dur:0.20, type:'sawtooth', gain:0.16, filter:2200 }); tone({ f:880, f2:1320, dur:0.18, gain:0.09, delay:0.03 }); },
    cast:      () => { tone({ f:280, f2:900, dur:0.20, type:'triangle', gain:0.13 }); noise({ f:600, f2:2400, dur:0.18, gain:0.08 }); },
    dodge:     () => noise({ f:400, f2:2600, dur:0.19, gain:0.14, type:'bandpass', q:0.7 }),
    ultimate:  () => { [110,165,220,330].forEach((f,i)=>tone({f,f2:f*2.2,dur:0.75,type:'sawtooth',gain:0.11,delay:i*0.07,filter:1400})); noise({f:180,f2:3200,dur:0.8,gain:0.20}); tone({f:60,f2:34,dur:0.9,gain:0.24,delay:0.28}); },
    hurt:      () => { tone({ f:180, f2:70, dur:0.22, type:'square', gain:0.14, filter:700 }); noise({ f:500, f2:120, dur:0.18, gain:0.14 }); },
    death:     () => { [330,260,190,120].forEach((f,i)=>tone({f,dur:0.32,type:'triangle',gain:0.11,delay:i*0.10})); },
    kill:      () => { noise({f:900,f2:180,dur:0.13,gain:0.12}); tone({f:220,f2:330,dur:0.12,type:'triangle',gain:0.10}); },
    break:     () => { noise({f:3200,dur:0.22,gain:0.22,type:'bandpass',q:2.2}); tone({f:640,f2:190,dur:0.28,type:'square',gain:0.12,filter:1800}); },
    reaction:  () => [660,880,1100].forEach((f,i)=>tone({f,dur:0.24,type:'sine',gain:0.09,delay:i*0.045})),
    telegraph: () => { tone({f:440,dur:0.10,type:'square',gain:0.08}); tone({f:440,dur:0.10,type:'square',gain:0.08,delay:0.14}); },
    level:     () => [523,659,784,1046].forEach((f,i)=>tone({f,dur:0.34,type:'triangle',gain:0.13,delay:i*0.09})),
    quest:     () => { tone({f:784,dur:0.30,type:'sine',gain:0.12}); tone({f:1175,dur:0.34,type:'sine',gain:0.09,delay:0.10}); },
    portal:    () => { noise({f:300,f2:2800,dur:0.5,gain:0.14}); [392,523,659].forEach((f,i)=>tone({f,dur:0.5,type:'sine',gain:0.10,delay:i*0.08})); },
    npc:       () => tone({f:600,f2:760,dur:0.09,type:'triangle',gain:0.07}),
    chat:      () => tone({f:900,f2:1100,dur:0.05,type:'sine',gain:0.045}),
    coin:      () => { tone({f:1318,dur:0.07,type:'square',gain:0.05}); tone({f:1760,dur:0.11,type:'square',gain:0.05,delay:0.06}); },
    equip:     () => { noise({f:2200,dur:0.09,gain:0.10,type:'bandpass',q:1.6}); tone({f:330,f2:520,dur:0.12,type:'triangle',gain:0.09}); },
    enchant:   () => { [523,659,784].forEach((f,i)=>tone({f,dur:0.18,type:'triangle',gain:0.09,delay:i*0.05})); noise({f:3400,dur:0.20,gain:0.09,type:'highpass'}); },
    step:      () => noise({f:260,f2:120,dur:0.045,gain:0.045,type:'lowpass'}),
    market:    () => { tone({f:698,dur:0.12,type:'sine',gain:0.08}); tone({f:880,dur:0.16,type:'sine',gain:0.07,delay:0.08}); },
    trade:     () => { tone({f:494,dur:0.16,type:'triangle',gain:0.09}); tone({f:740,dur:0.22,type:'triangle',gain:0.08,delay:0.09}); },
    whisper:   () => tone({f:1200,f2:900,dur:0.09,type:'sine',gain:0.05}),
    event:     () => { [220,277,330].forEach((f,i)=>tone({f,dur:0.4,type:'sawtooth',gain:0.08,delay:i*0.12,filter:900})); },
    boss:      () => { tone({f:70,f2:46,dur:1.1,type:'sawtooth',gain:0.16,filter:500}); noise({f:180,f2:60,dur:1.0,gain:0.12,type:'lowpass'}); }
  };
  function loot(rarity) {
    const r = A2.RARITY(rarity), idx = A2.RARITIES.indexOf(r);
    const base = 523 * Math.pow(1.16, idx);
    const notes = Math.min(5, 1 + idx);
    for (let i = 0; i < notes; i++) tone({ f:base * Math.pow(1.26, i), dur:0.20, type:'triangle', gain:0.085, delay:i*0.065 });
    if (idx >= 3) { noise({f:3200,dur:0.35,gain:0.10,type:'highpass'}); tone({f:base*2,dur:0.5,type:'sine',gain:0.07,delay:0.16}); }
  }

  function play(name, arg) {
    if (!cfg.enabled || cfg.muted) return false;
    if (!ctx) init();
    if (!ctx) return false;
    if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
    if (name === 'loot') { if (!ready('loot',0.08)) return false; loot(arg); return true; }
    const fn = BANK[name]; if (!fn) return false;
    const gap = name === 'step' ? 0.16 : name === 'hit' || name === 'kill' ? 0.035 : 0.05;
    if (!ready(name, gap)) return false;
    try { fn(arg); } catch (e) { return false; }
    return true;
  }

  /* --------------------------- фоновый амбиент --------------------------- */
  const ZONE_TONES = {
    haven:  { root:131, notes:[262,330], type:'sine',     wind:700,  q:0.8 },
    grove:  { root:110, notes:[220,277], type:'sine',     wind:520,  q:0.7 },
    ash:    { root:82,  notes:[164,196], type:'triangle', wind:340,  q:0.5 },
    frost:  { root:98,  notes:[196,247], type:'sine',     wind:1100, q:1.4 },
    rift:   { root:73,  notes:[146,175], type:'sawtooth', wind:240,  q:0.6 }
  };
  function ambient(zoneId) {
    if (!cfg.enabled || cfg.muted || ambientZone === zoneId) return;
    init(); if (!ctx) return;
    stopAmbient();
    const z = ZONE_TONES[zoneId] || ZONE_TONES.grove;
    ambientZone = zoneId;
    try {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.connect(musicBus);
      const drone = ctx.createGain(); drone.gain.value = 0.055; drone.connect(lp);
      [0, 1].forEach(i => {
        const o = ctx.createOscillator(); o.type = z.type; o.frequency.value = z.root * (i ? 1.005 : 1);
        const g = ctx.createGain(); g.gain.value = i ? 0.4 : 0.7;
        o.connect(g); g.connect(drone); o.start(); ambientNodes.push(o);
      });
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 0.09; lg.gain.value = 180;
      lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); ambientNodes.push(lfo);
      ambientNodes.push({ disconnect(){ lp.disconnect(); drone.disconnect(); } });
      // редкие далёкие звуки биома
      ambientTimer = setInterval(() => {
        if (!cfg.enabled || cfg.muted || !musicBus || (typeof document !== 'undefined' && document.hidden)) return;
        const f = z.notes[Math.floor(Math.random()*z.notes.length)] * (Math.random()<0.4?2:1);
        tone({ f, f2:f*0.92, dur:1.4, type:'sine', gain:0.035, music:true, filter:1100 });
        noise({ f:z.wind, f2:z.wind*0.6, dur:1.1, gain:0.022, q:z.q, music:true });
      }, 4200);
    } catch (e) {}
  }
  let ambientTimer = null;
  function stopAmbient() {
    if (ambientTimer) { clearInterval(ambientTimer); ambientTimer = null; }
    ambientNodes.forEach(n => { try { n.stop && n.stop(); n.disconnect && n.disconnect(); } catch (e) {} });
    ambientNodes = []; ambientZone = '';
  }
  function setEnabled(v) { cfg.enabled = !!v; if (!v) stopAmbient(); }
  function setVolume(v) { cfg.volume = A2.clamp(Number(v)||0,0,1); if (master) master.gain.value = cfg.volume; }
  function setSfx(v) { cfg.sfx = A2.clamp(Number(v)||0,0,1); if (sfxBus) sfxBus.gain.value = cfg.sfx; }
  function setMusic(v) { cfg.music = A2.clamp(Number(v)||0,0,1); if (musicBus) musicBus.gain.value = cfg.music; }
  function mute(v) { cfg.muted = !!v; if (v) stopAmbient(); }
  function state() { return { enabled:cfg.enabled, muted:cfg.muted, volume:cfg.volume, sfx:cfg.sfx,
    music:cfg.music, ctx:!!ctx, running:!!(ctx && ctx.state==='running'), zone:ambientZone, voices:voiceTimes.length }; }

  A2.Audio = { init, unlock, play, loot, ambient, stopAmbient, setEnabled, setVolume, setSfx, setMusic,
    mute, state, get cfg(){ return cfg; }, BANK };
})();
