/* =====================================================================
 * ARKEON · G2 · main.js
 * Оркестратор: фиксированный тик 30 Гц, рендер 60 Гц, сенсорный ввод,
 * 6 классов × 6 навыков, автобой, додж, ультимейт, призывы, квесты,
 * НПС-диалоги и сервисы, порталы между 4 зонами, чат, группа, панели,
 * сохранение, адаптивное качество. window.ARKEON_G2 — тестовый API.
 * ===================================================================== */
(function () {
  'use strict';
  const A2 = window.A2, C = A2.C;
  const $ = id => typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null;

  const DEFAULT_SKILLS = {};
  A2.CLASSES.forEach(c => c.skills.forEach((n,i) => {
    DEFAULT_SKILLS[c.id+':'+n] = {
      coeff: [1.10,2.45,1.35,0,1.85,2.90][i], cd:[0,5,9,14,8,16][i],
      cost:[0,30,15,0,35,25][i], effect:'', type:''
    };
  }));
  let SKILLS = DEFAULT_SKILLS, CANON_SOURCE='fallback';

  const G = {
    time:0, tick:0, accum:0, world:null, char:null, player:null, net:null,
    entities:[], particles:[], numbers:[], pets:[], cam:{x:0,y:0,zoom:1,orient:1,shake:0,shakeX:0,shakeY:0},
    target:null, mode:'menu', joy:{id:null,x:0,y:0,dx:0,dy:0,sx:0,sy:0,st:0},
    keys:{}, pointers:new Map(), pinch:null, skillButtons:[], logLines:[],
    damageDealt:0, damageTaken:0, dps:0, dmgWindow:[], reactions:0, kills:0,
    toastText:'', toastUntil:0, flash:0, eventBannerUntil:0, saveT:0, uiT:0,
    cooldowns:{}, autoCd:0, buffs:{}, settings:{motion:true,sound:true,vibration:true,quality:'auto'},
    hooks:{}, pendingZone:null, pendingPos:null, modalMode:null, modalData:null,
    market:null, corpses:[], selectedItem:null, selectedPlayer:null, lastStep:0,
    settings:{motion:true,sound:true,vibration:true,quality:'auto',lootFilter:'all',autoSalvage:true,volume:0.8,music:0.45},
    lowFps:0, lastFrame:0, started:false, perf:'high', fpsAvg:60, fpsLowT:0, fpsHighT:0, itemFlushT:0
  };

  /* ---------------------------журнал и уведомления --------------------------- */
  G.log = function(text,color) {
    G.logLines.push({text,color:color||'#e9efed',t:G.time});
    if(G.logLines.length>70) G.logLines.shift();
    const el=$('chatLog');
    if(el && el.appendChild && typeof document!=='undefined' && document.createElement) {
      const d=document.createElement('div'); d.className='chat-line'; d.textContent=text;
      if(d.style) d.style.color=color||'#e9efed'; el.appendChild(d);
      if(el.children && el.children.length>40 && el.removeChild) el.removeChild(el.children[0]);
    }
    G.onLog && G.onLog(text,color);
  };
  G.toast = function(text,ms) {
    G.toastText=text; G.toastUntil=G.time+(ms||2.2);
    const e=$('toast'); if(e){ e.textContent=text; e.classList&&e.classList.add('show'); }
  };
  const S = n => A2.Audio && A2.Audio.play(n);
  G.onXP = v => { G.log('+'+v+' XP','#8fd08a'); };
  G.onGold = v => { G.log('+'+v+' Серебра','#f0d27a'); S('coin'); };
  G.onLoot = (it,d) => { const r=A2.RARITY(it.rarity);
    if(A2.RARITIES.indexOf(r)>=2) G.log('✦ На земле: '+A2.RPG.itemName(it), r.color); };
  G.onDrop = d => { if(d.item) S('loot', d.item.rarity); };
  G.onPickup = () => {};
  G.onMaterial = m => { G.matCount=(G.matCount||0)+1;
    if(G.matCount%10===0) G.log('✧ Собрано материалов: 10 · последний: '+m,'#9db0bd'); };
  G.onLevel = lv => { G.toast('УРОВЕНЬ '+lv+' · +1 очко таланта',3); G.log('★ Уровень '+lv+'! Новое очко таланта.','#ffe27a'); S('level'); };
  G.onKill = (m,dmg) => { G.kills++;
    G.corpses.push({x:m.x,y:m.y,kind:m.kind,color:m.color,uid:m.uid,life:1.4,max:1.4,scale:m.boss?1.8:1});
    if(G.corpses.length>24) G.corpses.shift();
    G.log('† '+(m.nameOverride||m.ru)+' повержен','#9db0bd');
    S(m.boss?'boss':'kill'); };
  G.onQuest = (q,act,cur,need) => { if(act==='start'){G.toast('Квест: '+q.ru,2.5);S('quest');} if(act==='complete'){G.toast('Квест завершён: '+q.ru,3);S('level');} };
  G.onReaction = name => { G.log('✺ Реакция: '+name,'#4fd6d0'); S('reaction'); };
  G.onHurt = () => S('hurt');
  G.onHit = (mob,dmg,crit) => S(crit?'crit':'hit');
  G.onCast = () => S('cast');
  G.onDodge = () => S('dodge');
  G.onChat = c => { G.log('['+c.ch+'] '+c.name+': '+c.text,c.color); S('chat'); };
  G.onNet = (kind,v) => { if(kind==='event'){G.toast(v,3);S('event');} if(kind==='status'&&v==='online')S('portal'); };
  G.onZone = z => { if(A2.Audio) A2.Audio.ambient(z.id); S('portal'); };

  /* ------------------------------ инициализация ------------------------------ */
  function makePlayer(ch, x, y) {
    return { uid:'local', name:ch.name, classId:ch.classId, level:ch.level, x, y,
      hp:ch.hp, maxHp:ch.stats.maxHp, isRemote:false, moving:false, iframe:0,
      attackAnim:0, gearRarity:ch.gearRarity, facing:0 };
  }
  function setZone(id, x, y) {
    const z=A2.ZONE(id);
    G.world=A2.World.create(z.id, 1337 + A2.ZONES.indexOf(z)*7717);
    if(x===undefined) {
      const sp=z.id==='grove'?[12,16]:[6,6];
      x=sp[0]; y=sp[1];
      const pr=G.world.portals.find(p=>p.to===z.id);
    }
    G.player.x=A2.clamp(x,2,C.ZONE_N-3); G.player.y=A2.clamp(y,2,C.ZONE_N-3);
    G.target=null; G.pets=[]; G.particles=[]; G.numbers=[]; G.corpses=[];
    if(G.net) { G.net.ghosts.forEach((g,i)=>{ g.x=A2.clamp(G.player.x+Math.cos(i*1.7)*3,2,C.ZONE_N-3); g.y=A2.clamp(G.player.y+Math.sin(i*1.7)*3,2,C.ZONE_N-3); }); }
    G.toast(z.ru+' · ур. '+z.lv[0]+'–'+z.lv[1],3);
    G.log('— '+z.ru+' — '+z.desc,'#f0d27a');
    const e=$('zoneName'); if(e) e.textContent=z.ru;
    A2.Render.makeGround(G.world,G.cam.orient|0);
    G.onZone && G.onZone(z);
  }
  G.requestZone = setZone;
  G.setZone = setZone;

  function loadCanon() {
    if (typeof fetch !== 'function') return;
    fetch('../data/classes.json').then(r=>r.ok?r.json():Promise.reject()).then(d=>{
      const map={};
      (d.classes||[]).forEach(c=> (c.skills||[]).forEach((s,i)=>{
        map[c.id+':'+s.name]={coeff:s.coeff,cd:s.cd,cost:parseCost(s.cost),effect:s.effect||'',type:s.type||''};
      }));
      (d.classes||[]).forEach(c=>(c.specs||[]).forEach(sp=>{
        if(sp.ultimate) map[c.id+':'+sp.ultimate.name]={coeff:6.2,cd:sp.ultimate.cd||90,cost:0,effect:sp.ultimate.effect||'',type:'Ультимейт'};
      }));
      let n=0; for(const k in map) n++;
      if(n>30){ SKILLS=Object.assign({},DEFAULT_SKILLS,map); CANON_SOURCE='canon'; G.log('Канон навыков загружен: '+n+' записей','#4fd6d0'); }
    }).catch(()=>{});
  }
  function parseCost(s) {
    if(!s||s==='—') return 0;
    const m=/(\d+)/.exec(String(s)); return m?Math.min(45,parseInt(m[1],10)):0;
  }
  function meta(name) { return SKILLS[G.char.classId+':'+name] || {coeff:1.2,cd:3,cost:0,effect:'',type:''}; }

  function boot() {
    if(G.started) return; G.started=true;
    A2.Render.init($('game'));
    const saved=A2.RPG.load();
    G.char=A2.RPG.createCharacter((saved&&saved.classId)||'warrior',saved&&saved.name);
    if(saved) A2.RPG.restore(G,saved);
    G.player=makePlayer(G.char,12,16);
    G.world=A2.World.create(saved&&saved.zone||'grove',1337);
    if(saved){ G.player.x=A2.clamp(saved.x||12,2,C.ZONE_N-3); G.player.y=A2.clamp(saved.y||16,2,C.ZONE_N-3); }
    G.entities=[G.player];
    G.net=A2.Net.create(G);
    G.market=A2.Market.create(G);
    G.market.seed();
    if(A2.Audio){ A2.Audio.setVolume(G.settings.volume); A2.Audio.setMusic(G.settings.music); A2.Audio.setEnabled(G.settings.sound); }
    buildSkillButtons(); bindInput(); loadCanon();
    G.net.startGhosts();
    const q=(typeof location!=='undefined'&&location.search)||'';
    const cm=/[?&]class=([a-z]+)/.exec(q);
    if(cm && A2.CLASS(cm[1])) {
      const cards=document.querySelectorAll?document.querySelectorAll('.class-card'):[];
      cards.forEach(c=>{ if(c.classList) c.classList.toggle('selected', c.dataset && c.dataset.class===cm[1]); });
    }
    const u=(typeof location!=='undefined'&&location.search&&/[?&]server=/.test(location.search));
    // Явный адрес из URL имеет приоритет; иначе на своём сервере подключаемся
    // автоматически, а на Pages/CDN остаёмся в честном офлайн-мире.
    if(u) G.net.connect();
    else if(G.net.autoConnect()) G.log('Обнаружен сервер того же origin: подключаюсь к онлайну','#4fd6d0');
    const e=$('startScreen'); if(e && !saved) e.classList.remove('hidden');
    else { G.mode='playing'; const s=$('startScreen'); if(s) s.classList.add('hidden'); const h=$('hud'); if(h) h.classList.remove('hidden'); }
    G.log('АРКЕОН · Мир Завета · G2.1','#f0d27a');
    G.log('Сервер не указан — активен офлайн-мир с союзниками-призраками','#9db0bd');
    if(/[?&]autostart=1/.test(q)) startGame();
    updateUI(true);
    if(typeof requestAnimationFrame==='function') requestAnimationFrame(frame);
  }

  /* ------------------------------- навыки ------------------------------- */
  function buildSkillButtons() {
    const wrap=$('skills'); if(!wrap || !document.createElement) return;
    wrap.innerHTML=''; G.skillButtons=[];
    const cls=A2.CLASS(G.char.classId);
    cls.skills.forEach((name,i)=>{
      const b=document.createElement('button'); b.className='skill'; b.setAttribute('data-i',String(i));
      const m=meta(name);
      b.innerHTML='<span class="glyph">'+['✦','✧','➤','⛨','◎','✕'][i]+'</span><span class="cd"></span><small>'+name.split(' ')[0].slice(0,7)+'</small>';
      if(b.addEventListener) b.addEventListener('pointerdown',ev=>{ ev.preventDefault&&ev.preventDefault(); cast(i); });
      wrap.appendChild(b); G.skillButtons.push(b);
    });
  }
  function cast(i) {
    if(G.mode!=='playing'||G.char.dead) return false;
    const cls=A2.CLASS(G.char.classId), name=cls.skills[i]; if(!name) return false;
    const m=meta(name), ch=G.char;
    if((G.cooldowns[name]||0)>G.time) { G.toast('Перезарядка '+((G.cooldowns[name]-G.time)).toFixed(1)+' с',1); return false; }
    if(m.cost && ch.res<m.cost) { G.toast('Не хватает '+cls.res,1.2); return false; }
    ch.res=Math.max(0,ch.res-(m.cost||0));
    const cd=Math.max(0.35,m.cd*(1-ch.stats.cdr));
    G.cooldowns[name]=G.time+cd;
    G.player.attackAnim=1;
    const t=target();
    const special=specialKind(name);
    const coeff=m.coeff||1.2;
    const el=cls.element;
    switch(special) {
      case 'dash': {
        const a=t?Math.atan2(t.y-G.player.y,t.x-G.player.x):G.player.facing;
        const nx=G.player.x+Math.cos(a)*3.2, ny=G.player.y+Math.sin(a)*3.2;
        if(A2.World.canMove(G.world,nx,ny)){ G.player.x=nx; G.player.y=ny; }
        if(t) A2.RPG.hit(G,t,coeff,el);
        break;
      }
      case 'guard':
        ch.shield=(ch.shield||0)+ch.stats.maxHp*0.28; G.buffs.drUntil=G.time+6;
        G.toast('Стойка: −35% урона 6 с',1.8); break;
      case 'shield':
        ch.shield=(ch.shield||0)+ch.stats.maxHp*0.32; break;
      case 'summon':
        for(let k=0;k<2;k++) G.pets.push({uid:'pet'+G.time+k,x:G.player.x+(k?1:-1),y:G.player.y+1,life:16,dmg:ch.stats.dmg*0.35,cd:0,classId:ch.classId});
        G.toast('Призваны двое слуг',1.8); break;
      case 'aoe':
        A2.World.mobsNear(G.world,G.player.x,G.player.y,5.5).forEach(mb=>A2.RPG.hit(G,mb,coeff,el));
        A2.RPG.spawnParticles(G,G.player.x,G.player.y,26,A2.RPG.elementColor(el),2.2); break;
      case 'break':
        if(t){ A2.RPG.hit(G,t,coeff*1.4,el); t.statuses=t.statuses||[]; t.statuses.push({el:'Физический',until:G.world.time+8,break:true}); G.toast('BREAK · −20% брони',2); }
        break;
      case 'reaction':
        if(t) A2.RPG.applyElement(G,t,'Огонь',0);
        A2.World.mobsNear(G.world,G.player.x,G.player.y,6).forEach(mb=>A2.RPG.hit(G,mb,coeff,el)); break;
      case 'dot':
        if(t){ A2.RPG.hit(G,t,coeff,el); t.statuses=t.statuses||[]; t.statuses.push({el:'Скверна',until:G.world.time+8,dot:ch.stats.dmg*0.12}); }
        break;
      default:
        if(t) A2.RPG.hit(G,t,coeff,el);
        else { G.toast('Цель вне досягаемости',1.2); }
    }
    ch.res=Math.min(ch.maxRes,ch.res+7);
    ch.ult=A2.clamp(ch.ult+3.5,0,100);
    G.onCast && G.onCast(name,i);
    return true;
  }
  function specialKind(name) {
    if(/Рывок|Шаг|Стопа|Сдвиг|Шаг Сквозь|Контршаг|Прицел/.test(name)) return 'dash';
    if(/Стойка|Пелена|Костяная Стена|Круг Молчания|Ловушка/.test(name)) return 'guard';
    if(/Щит Светоча|Астральный Барьер|Обмен Плоти/.test(name)) return 'shield';
    if(/Поднять Скелета|Голем|Клич Стаи|Рука Конклава/.test(name)) return 'summon';
    if(/Вихрь|Залп|Каскад|Жатва|Молот|Взрыв|Круг|Печать/.test(name)) return 'aoe';
    if(/Разломный|Пробитие|Метка/.test(name)) return 'break';
    if(/Разрыв Стихий/.test(name)) return 'reaction';
    if(/Отравленный|Проклятие|Тихий Счёт|Грозовая/.test(name)) return 'dot';
    return 'hit';
  }
  function target() {
    if(G.target && G.target.alive) return G.target;
    const near=A2.World.mobsNear(G.world,G.player.x,G.player.y,A2.CLASS(G.char.classId).range);
    G.target=near.sort((a,b)=>A2.dist(a.x,a.y,G.player.x,G.player.y)-A2.dist(b.x,b.y,G.player.x,G.player.y))[0]||null;
    return G.target;
  }
  function useUlt() {
    if(G.char.ult<100) { G.toast('Заряд Искры '+Math.floor(G.char.ult)+'%',1.2); return false; }
    G.char.ult=0; G.player.attackAnim=1;
    const cls=A2.CLASS(G.char.classId), mult=1+G.char.stats.ult;
    A2.World.mobsNear(G.world,G.player.x,G.player.y,11).forEach(mb=>A2.RPG.hit(G,mb,6.2*mult,cls.element));
    G.char.shield=(G.char.shield||0)+G.char.stats.maxHp*0.45;
    A2.RPG.spawnParticles(G,G.player.x,G.player.y,70,cls.color,3.4);
    G.cam.shake=14; G.flash=0.8; G.toast('✦ '+cls.ult,3);
    return true;
  }
  function dodge(dx,dy) {
    const ch=G.char;
    if(ch.dodgeCharges<=0||G.mode!=='playing') return false;
    ch.dodgeCharges--;
    G.player.iframe=C.DODGE_IFRAME;
    const a=Math.atan2(dy||0,dx||0)||G.player.facing;
    const nx=G.player.x+Math.cos(a)*3.4, ny=G.player.y+Math.sin(a)*3.4;
    if(A2.World.canMove(G.world,nx,ny)){ G.player.x=nx; G.player.y=ny; }
    ch.res=Math.min(ch.maxRes,ch.res+6);
    ch.stats.dodgeDmg && (G.buffs.dodgeUntil=G.time+3);
    A2.RPG.spawnParticles(G,G.player.x,G.player.y,14,'#9fe8ff',1.6);
    G.onDodge&&G.onDodge();
    return true;
  }

  /* -------------------------------- ввод -------------------------------- */
  function bindInput() {
    if(typeof document==='undefined'||!document.addEventListener) return;
    // разблокировка WebAudio первым касанием (политика браузеров)
    const unlockAudio=()=>{ if(A2.Audio){A2.Audio.unlock(); if(G.world) A2.Audio.ambient(G.world.zone.id);} };
    document.addEventListener('pointerdown',unlockAudio,{once:true});
    document.addEventListener('keydown',unlockAudio,{once:true});
    // ВЫБОР КЛАССА: G2 не привязывал обработчик — из-за этого всегда был Воин
    if(document.querySelectorAll) {
      const cards=document.querySelectorAll('.class-card')||[];
      cards.forEach(card=>{
        if(!card.addEventListener) return;
        const sel=ev=>{
          cards.forEach(c=>c.classList&&c.classList.remove('selected'));
          card.classList&&card.classList.add('selected');
          if(A2.Audio) A2.Audio.play('ui');
          const b=card.querySelector&&card.querySelector('b');
          G.toast('Выбран: '+(b&&b.textContent?b.textContent.replace(/^\S+\s*/,''):card.dataset.class),1.4);
        };
        card.addEventListener('pointerdown',sel);
        card.addEventListener('click',sel);
      });
    }
    const joy=$('joy');
    if(joy&&joy.addEventListener){
      joy.addEventListener('pointerdown',ev=>{
        const r=joy.getBoundingClientRect?joy.getBoundingClientRect():{left:0,top:0,width:132,height:132};
        G.joy.id=ev.pointerId; G.joy.cx=r.left+r.width/2; G.joy.cy=r.top+r.height/2; G.joy.r=r.width/2;
        setJoy(ev.clientX,ev.clientY);
      });
      joy.addEventListener('pointermove',ev=>{ if(G.joy.id===ev.pointerId) setJoy(ev.clientX,ev.clientY); });
      const end=ev=>{ if(G.joy.id===ev.pointerId){ G.joy.id=null; G.joy.dx=0; G.joy.dy=0; const k=$('joyKnob'); if(k&&k.style) k.style.transform='translate(0,0)'; } };
      joy.addEventListener('pointerup',end); joy.addEventListener('pointercancel',end);
    }
    function setJoy(cx,cy){
      let dx=(cx-G.joy.cx)/(G.joy.r||66), dy=(cy-G.joy.cy)/(G.joy.r||66);
      const m=Math.hypot(dx,dy); if(m>1){dx/=m;dy/=m;}
      G.joy.dx=dx; G.joy.dy=dy;
      const k=$('joyKnob'); if(k&&k.style) k.style.transform='translate('+(dx*38)+'px,'+(dy*38)+'px)';
    }
    const app=$('app');
    if(app&&app.addEventListener){
      app.addEventListener('pointerdown',ev=>{
        if(ev.target&&ev.target.closest&&ev.target.closest('button')) return;
        G.pointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY,t:performance.now()});
        G.joy.sx=ev.clientX; G.joy.sy=ev.clientY; G.joy.st=performance.now();
        if(G.pointers.size===2){ const p=Array.from(G.pointers.values()); G.pinch={d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),zoom:G.cam.zoom}; }
        tapTarget(ev.clientX,ev.clientY);
      });
      app.addEventListener('pointermove',ev=>{
        if(!G.pointers.has(ev.pointerId)) return;
        G.pointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY,t:performance.now()});
        if(G.pointers.size===2&&G.pinch){ const p=Array.from(G.pointers.values()); const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y); G.cam.zoom=A2.clamp(G.pinch.zoom*d/G.pinch.d,0.6,2.2); }
      });
      app.addEventListener('pointerup',ev=>{
        const p=G.pointers.get(ev.pointerId); G.pointers.delete(ev.pointerId);
        if(G.pointers.size<2) G.pinch=null;
        if(p&&performance.now()-G.joy.st<260 && Math.hypot(ev.clientX-G.joy.sx,ev.clientY-G.joy.sy)>52){
          const w=screenToWorld((ev.clientX-G.joy.sx),(ev.clientY-G.joy.sy)); dodge(w.x,w.y);
        }
      });
    }
    const on=(id,fn)=>{ const e=$(id); if(e&&e.addEventListener) e.addEventListener('pointerdown',ev=>{ev.preventDefault&&ev.preventDefault();fn();}); };
    on('btnDodge',()=>dodge(-Math.cos(G.player.facing),-Math.sin(G.player.facing)));
    on('btnUlt',useUlt);
    on('btnCamera',()=>{ G.cam.orient=(G.cam.orient+1)%4; A2.Render.makeGround(G.world,G.cam.orient); G.toast('Камера: '+[0,90,180,270][G.cam.orient]+'°',1.2); });
    on('btnInteract',interact);
    on('btnChar',()=>openModal('char')); on('btnBag',()=>openModal('bag'));
    on('btnEquip',()=>openModal('equip')); on('pAvatar',()=>openModal('equip'));
    on('btnLoot',()=>{ A2.RPG.collectNearby(G,9.5); });
    on('btnQuests',()=>openModal('quests')); on('btnChat',()=>openModal('chat'));
    on('btnParty',()=>openModal('party')); on('btnCodex',()=>openModal('codex'));
    on('btnSettings',()=>openModal('settings')); on('btnPause',()=>openModal('settings'));
    on('btnMarket',()=>openModal('market')); on('btnPlayers',()=>openModal('players'));
    on('modalClose',closeModal);
    on('btnStart',startGame);
    on('btnConnect',()=>{ const e=$('serverInput'); if(e&&e.value) G.net.connect(e.value.trim()); });
    on('btnChatSend',()=>{ const e=$('chatInput'); if(e&&e.value){ G.net.chat(e.value.trim()); e.value=''; } });
    document.addEventListener('keydown',ev=>{
      G.keys[ev.key]=true;
      if(/^[1-6]$/.test(ev.key)) cast(parseInt(ev.key,10)-1);
      if(ev.key==='q'||ev.key==='Q') useUlt();
      if(ev.key===' ') dodge(G.joy.dx||1,G.joy.dy||0);
      if(ev.key==='e'||ev.key==='E') interact();
      if(ev.key==='m'||ev.key==='M') openModal('market');
      if(ev.key==='i'||ev.key==='I'||ev.key==='b'||ev.key==='B') openModal('bag');
      if(ev.key==='g'||ev.key==='G') openModal('equip');
      if(ev.key==='Escape') closeModal();
    });
    document.addEventListener('keyup',ev=>{ G.keys[ev.key]=false; });
    window.addEventListener && window.addEventListener('resize',()=>A2.Render.resize());
  }
  function screenToWorld(sx,sy){
    const TW=C.TILE_W,TH=C.TILE_H;
    const wx=(sx/(TW/2)+sy/(TH/2))/2, wy=(sy/(TH/2)-sx/(TW/2))/2;
    let X=wx,Y=wy;
    switch(G.cam.orient){case 1:X=wy;Y=-wx;break;case 2:X=-wx;Y=-wy;break;case 3:X=-wy;Y=wx;break;}
    const m=Math.hypot(X,Y)||1; return {x:X/m,y:Y/m};
  }
  function tapTarget(cx,cy) {
    if(!G.camScreen) return;
    const {ox,oy,zoom}=G.camScreen;
    let best=null,bd=44;
    for(const m of G.world.mobs) if(m.alive){
      const [x,y]=A2.Render.iso(m.x,m.y,0,G.cam.orient);
      const sx=x*zoom+ox,sy=y*zoom+oy-28*zoom;
      const d=Math.hypot(sx-cx,sy-cy);
      if(d<bd){bd=d;best=m;}
    }
    // G2.1 · тап по другому игроку открывает реальные социальные действия
    for(const e of G.entities) if(e.isRemote){
      const [x,y]=A2.Render.iso(e.x,e.y,0,G.cam.orient);
      const sx=x*zoom+ox,sy=y*zoom+oy-28*zoom;
      const d=Math.hypot(sx-cx,sy-cy);
      if(d<bd){bd=d;best={player:true,uid:e.uid,name:e.name||'Игрок',level:e.level||1,classId:e.classId||'warrior'};}
    }
    if(best&&best.player){ G.selectedPlayer=best; openModal('player',best); return; }
    if(best){ G.target=best; G.toast('Цель: '+(best.nameOverride||best.ru),1.2); }
  }
  function startGame() {
    const pick=(typeof document!=='undefined'&&document.querySelector)?document.querySelector('.class-card.selected'):null;
    const id=pick&&pick.dataset?pick.dataset.class:'warrior';
    const nameEl=$('charName');
    G.char=A2.RPG.createCharacter(id,nameEl&&nameEl.value?nameEl.value.trim().slice(0,16):undefined);
    G.player=makePlayer(G.char,12,16);
    G.entities=[G.player]; G.world=A2.World.create('grove',1337);
    G.net.startGhosts(); G.market.seed(); buildSkillButtons();
    if(A2.Audio){A2.Audio.unlock();A2.Audio.ambient('grove');A2.Audio.play('portal');}
    if(G.net.state==='online') G.net.send({t:'hello',name:G.char.name,classId:G.char.classId,
      level:G.char.level,zone:'grove',x:12,y:16,gold:Math.round(G.char.gold),
      itemUids:G.char.inventory.map(i=>i.uid)});
    G.mode='playing';
    const s=$('startScreen'); if(s) s.classList.add('hidden');
    const h=$('hud'); if(h) h.classList.remove('hidden');
    G.toast('Джойстик — движение · «Взаим.» забирает лут · Сумка и Снаряжение внизу',4.5);
    G.log('✦ Лут подбирается сам (магнит 9.5 м); «Взаим.» или «Забрать лут» соберут всё рядом','#8fd08a');
    G.log('Возжённый: '+G.char.name+' · '+A2.CLASS(id).ru,'#f0d27a');
    if($('serverInput')&&$('serverInput').value) G.net.connect($('serverInput').value.trim());
    updateUI(true);
  }
  G.startGame=startGame;

  /* ------------------------------ НПС и порталы ------------------------------ */
  function interact() {
    if(G.mode!=='playing') return;
    const npc=A2.World.npcAt(G.world,G.player.x,G.player.y,3.2);
    if(npc){ openModal('dialogue',npc); return; }
    const p=A2.World.portalAt(G.world,G.player.x,G.player.y);
    if(p){
      A2.RPG.questProgress(G,'explore',p.to+'_gate',1);
      A2.RPG.questProgress(G,'explore','rift_gate',1);
      setZone(p.to); A2.RPG.save(G); return;
    }
    const loot=G.world.drops.some(dd=>!dd.picked && dd.t>0 && A2.dist(dd.x,dd.y,G.player.x,G.player.y)<7.5);
    if(loot){ A2.RPG.collectNearby(G,7.5); return; }
    G.toast('Рядом нет НПС, портала или добычи',1.5);
  }

  /* ------------------------------- панели ------------------------------- */
  function itemCard(it, i, compact) {
    if(!it) return '<div class="cell empty"></div>';
    const r=A2.RARITY(it.rarity), icon=G.market? G.market.icon(it):'◇';
    const aff=(it.affixes||[]).slice(0,compact?0:6).map(f=>'<div class="aff">'+f.ru+' +'+f.value+(f.suffix||'')+'</div>').join('');
    return '<div class="cell '+r.id+'" data-act="item" data-i="'+i+'"><span class="cicon">'+icon+'</span>'+
      '<span class="cname">'+A2.RPG.itemName(it).slice(0,12)+'</span><span class="cprice">'+it.ilvl+' ур.</span></div>';
  }
  function itemDetail(it, idx) {
    if(!it) return '';
    const r=A2.RARITY(it.rarity), cur=G.char.equip[it.slot], curP=cur?A2.RPG.itemPower(cur):0;
    const d=A2.RPG.itemPower(it)-curP;
    const aff=(it.affixes||[]).map(f=>'<div class="aff"><b>'+f.ru+'</b><span>+'+f.value+(f.suffix||'')+'</span></div>').join('')||'<p class="note">Без дополнительных свойств</p>';
    return '<div class="detail '+r.id+'"><div class="dhead"><span class="dicon">'+(G.market?G.market.icon(it):'◇')+'</span>'+
      '<div><b>'+A2.RPG.itemName(it)+'</b><small>'+r.ru+' · ур. '+it.ilvl+' · сила '+A2.RPG.itemPower(it)+'</small></div></div>'+
      '<div class="dbadge" style="color:'+r.color+'">'+r.ru.toUpperCase()+'</div>'+ aff +
      (it.set?'<div class="aff"><b>Сет</b><span>'+(A2.SETS.find(x=>x.id===it.set)||{}).ru+'</span></div>':'')+
      (it.rune?'<div class="aff"><b>Руна</b><span>'+it.rune+'</span></div>':'')+
      (it.gem?'<div class="aff"><b>Самоцвет</b><span>'+it.gem+'</span></div>':'')+
      '<div class="aff"><b>В слоте сейчас</b><span>'+(cur?A2.RPG.itemName(cur)+' · '+curP:'пусто')+'</span></div>'+
      '<div class="aff"><b>Прирост силы</b><span style="color:'+(d>=0?'#8fd08a':'#e0574f')+'">'+(d>=0?'+':'')+d+'</span></div>'+
      '<div class="btnrow"><button data-act="equip" data-i="'+idx+'">Надеть</button>'+
      '<button data-act="salvage" data-i="'+idx+'">Разобрать</button>'+
      '<button data-act="sell" data-i="'+idx+'">Продать · '+Math.max(1,Math.round(it.price*0.42))+' S</button></div>'+
      '<div class="btnrow"><input id="listPrice" class="field" type="number" min="1" value="'+G.market.suggest(it)+'">'+
      '<button data-act="list" data-i="'+idx+'">На рынок · комиссия '+G.market.fee(G.market.suggest(it))+' S</button></div>'+
      '<div class="btnrow"><button data-act="backbag">← К сумке</button></div></div>';
  }
  function marketRows() {
    const list=G.market.filtered().slice(0,40);
    if(!list.length) return '<p class="empty">Лотов по фильтру нет. Сбросьте фильтр или выставьте свой предмет.</p>';
    return list.map(o=>{
      const r=A2.RARITY(o.item.rarity);
      return '<div class="lot '+r.id+'"><span class="cicon">'+(G.market?G.market.icon(o.item):'◇')+'</span>'+
        '<div class="lotinfo"><b>'+A2.RPG.itemName(o.item)+'</b><small>'+r.ru+' · ур. '+o.item.ilvl+' · сила '+A2.RPG.itemPower(o.item)+' · '+o.sellerName+(o.ghost?' · призрак':'')+'</small></div>'+
        '<div class="lotprice">'+A2.fmt(o.price)+' S</div>'+
        (o.mine?'<button data-act="cancelLot" data-id="'+o.id+'">Снять</button>':'<button data-act="buy" data-id="'+o.id+'">Купить</button>')+
      '</div>';
    }).join('');
  }
  function tradePeers() {
    if(!G.market.trade.active) {
      const online=G.net.state==='online';
      const list=online && G.market.roster.length ? G.market.roster.filter(p=>p.uid!==G.net.uid)
        : G.net.ghosts.map(g=>({uid:g.uid,name:g.name,level:g.level,classId:g.classId,ghost:true}));
      return '<p class="note">'+(online?'Выберите игрока для торговли 1:1. Сервер проверяет владение предметом и Серебро.':'Офлайн-торговля с союзниками-призраками: предметы и Серебро обмениваются локально.')+'</p>'+
        list.map(p=>'<div class="player"><b>'+p.name+'</b><span>ур. '+(p.level||G.char.level)+' · '+A2.CLASS(p.classId||'warrior').ru+(p.ghost?' · призрак':'')+'</span>'+
          '<button data-act="tradeInvite" data-uid="'+p.uid+'" data-name="'+p.name+'">Торговать</button></div>').join('');
    }
    const t=G.market.trade;
    if(t.pending==='waiting') return '<p class="note">Приглашение отправлено игроку <b>'+t.with.name+'</b>. Ждём подтверждения — сервер создаст защищённую сессию.</p>'+
      '<div class="btnrow"><button data-act="tradeCancel">Отменить приглашение</button></div>';
    if(t.pending) return '<p class="note">Входящее предложение торговли от <b>'+t.with.name+'</b>. Примите, чтобы сервер создал защищённую сессию.</p>'+
      '<div class="btnrow"><button data-act="tradeAccept" data-uid="'+t.with.uid+'">Принять приглашение</button>'+
      '<button data-act="tradeCancel">Отклонить</button></div>';
    const opts=G.char.inventory.map((it,i)=>'<label class="check"><input type="checkbox" class="offerItem" value="'+i+'"> '+A2.RARITY(it.rarity).abbr+' '+A2.RPG.itemName(it)+'</label>').join('')||'<p class="note">Сумка пуста</p>';
    const theirs=t.their.items.map(it=>'<div class="aff"><b>'+A2.RPG.itemName(it)+'</b><span>'+A2.RARITY(it.rarity).ru+'</span></div>').join('')||'<p class="note">Пока пусто</p>';
    return '<div class="tradebox"><div><h4>Вы предлагаете · '+t.with.name+'</h4>'+opts+
      '<input id="tradeGold" class="field" type="number" min="0" max="'+G.char.gold+'" value="0" placeholder="Серебро">'+
      '<div class="btnrow"><button data-act="tradeOffer">Передать</button><button data-act="tradeConfirm">Подтвердить</button>'+
      '<button data-act="tradeCancel">Отмена</button></div></div>'+
      '<div><h4>Вам предлагают</h4>'+theirs+'<div class="aff"><b>Серебро</b><span>'+t.their.gold+' S</span></div>'+
      '<p class="note">'+(t.peerConfirm?'Партнёр подтвердил':'Ожидание подтверждения')+'</p></div></div>';
  }
  function playerRows() {
    const online=G.net.state==='online';
    const list=online && G.market.roster.length ? G.market.roster
      : [{uid:'local',name:G.char.name,level:G.char.level,classId:G.char.classId,self:true}]
        .concat(G.net.ghosts.map(g=>({uid:g.uid,name:g.name,level:g.level,classId:g.classId,ghost:true})));
    return '<p class="note">'+(online?'ОНЛАЙН · '+G.market.roster.length+' игроков · пинг '+G.net.ping+' мс':'ОФЛАЙН-МИР · союзники-призраки, не реальные игроки')+'</p>'+
      list.map(p=>'<div class="player"><b>'+(p.self?'★ ':'')+p.name+'</b><span>ур. '+(p.level||1)+' · '+A2.CLASS(p.classId||'warrior').ru+(p.ghost?' · призрак':'')+'</span>'+
        (p.self?'':'<div class="acts"><button data-act="tradeInvite" data-uid="'+p.uid+'" data-name="'+p.name+'">Торговля</button>'+
        '<button data-act="partyInvite" data-uid="'+p.uid+'">В группу</button>'+
        '<button data-act="whisper" data-uid="'+p.uid+'" data-name="'+p.name+'">Шёпот</button>'+
        '<button data-act="emote" data-uid="'+p.uid+'">Эмоция</button></div>')+'</div>').join('');
  }

  function openModal(mode,data) {
    G.modalMode=mode; G.modalData=data||null;
    const box=$('modal'); if(!box) return;
    const title=$('modalTitle'), body=$('modalBody');
    if(!title||!body) return;
    const ch=G.char, html=[];
    const h=t=>{title.textContent=t;};
    const row=(a,b)=>'<div class="mrow"><b>'+a+'</b><span>'+b+'</span></div>';
    const back='<div class="btnrow"><button data-act="backbag">← К сумке</button></div>';

    if(mode==='char'){
      h('Возжённый · '+ch.name);
      const st=ch.stats;
      html.push('<div class="charhead"><span class="bigicon">'+A2.CLASS(ch.classId).icon+'</span><div><b>'+A2.CLASS(ch.classId).ru+' / '+A2.CLASS(ch.classId).en+'</b><small>Уровень '+ch.level+' · '+ch.xp+'/'+A2.xpNext(ch.level)+' XP · '+st.dmg.toFixed(0)+' урона</small></div></div>');
      html.push(row('Здоровье',Math.round(ch.hp)+' / '+st.maxHp),row('Ресурс',A2.CLASS(ch.classId).res),
        row('Урон',A2.fmt(st.dmg)),row('Броня',st.armor),row('Крит',st.critPct.toFixed(1)+'% / +'+Math.round(st.critDmg*100)+'%'),
        row('Скорость атаки','+'+(st.haste*100).toFixed(1)+'%'),row('Снижение КД','+'+(st.cdr*100).toFixed(1)+'%'),
        row('Серебро',A2.fmt(ch.gold)),row('Убийств',ch.kills),row('DPS',A2.fmt(G.dps)),row('Реакций',G.reactions));
      html.push('<h4>Экипировка · '+A2.SLOTS.length+' слотов</h4>');
      A2.SLOTS.forEach(s=>{ const it=ch.equip[s.id]; html.push('<div class="item '+A2.RARITY(it?it.rarity:'common').id+'"><b>'+s.icon+' '+(it?A2.RPG.itemName(it):'пусто')+'</b><span>'+(it?'Сила '+A2.RPG.itemPower(it)+' · ур. '+it.ilvl:'—')+'</span></div>'); });
      const sets=A2.RPG.setBonus(ch); if(sets.length) html.push('<h4>Сеты</h4>'+sets.map(s=>row(s.ru+' '+s.pieces,A2.SETS.find(x=>x.ru===s.ru).pieces+' · '+s.bonus)).join(''));
      html.push('<div class="btnrow"><button data-act="goequip">⚔ Снаряжение · 8 слотов</button><button data-act="equipBest">✦ Надеть лучшее</button></div>');
      html.push('<div class="btnrow"><button data-act="gototalents">Таланты ('+ch.talentPoints+')</button><button data-act="goforge">Кузница</button><button data-act="backbag">Сумка</button></div>');
    } else if(mode==='equip'){
      h('Снаряжение · 8 слотов · сила '+A2.fmt(ch.stats.power));
      const worn=Object.values(ch.equip).filter(Boolean).length;
      html.push('<div class="bagbar"><span>Надето: <b>'+worn+' / 8</b></span><span>В сумке: <b>'+ch.inventory.length+' / 40</b></span>'+
        '<span>Радиус подбора: <b>'+ch.stats.pickup.toFixed(1)+'</b></span></div>');
      html.push('<div class="equip-grid">');
      A2.SLOTS.forEach(sl=>{
        const it=ch.equip[sl.id], r=A2.RARITY(it?it.rarity:'common');
        html.push('<button class="slot-card '+(it?r.id:'empty')+'" data-act="slot" data-s="'+sl.id+'">'+
          '<span class="sicon">'+sl.icon+'</span><b>'+sl.ru+'</b>'+
          '<small>'+(it?A2.RPG.itemName(it):'пусто')+'</small>'+
          '<em>'+(it?'сила '+A2.RPG.itemPower(it):'—')+'</em></button>');
      });
      html.push('</div>');
      html.push('<p class="note">Тап по слоту — список подходящих предметов из сумки: надеть, снять, сравнить прирост силы.</p>');
      html.push('<div class="btnrow"><button data-act="equipBest">✦ Надеть лучшее</button><button data-act="backbag">Сумка</button>'+
        '<button data-act="gochar">Герой</button></div>');
      html.push('<div class="btnrow"><button data-act="enchantAll">Заточить всё</button>'+
        '<button data-act="salvageCommon">Разобрать обычное</button></div>');
    } else if(mode==='slot'){
      const sid=String(data||''), sl=A2.SLOTS.find(x=>x.id===sid)||A2.SLOTS[0];
      const cur=ch.equip[sl.id], curP=cur?A2.RPG.itemPower(cur):0;
      h(sl.icon+' '+sl.ru);
      html.push('<div class="detail '+(cur?A2.RARITY(cur.rarity).id:'empty')+'"><div class="dhead">'+
        '<span class="dicon">'+sl.icon+'</span><div><b>'+(cur?A2.RPG.itemName(cur):'Слот пуст')+'</b><small>'+
        (cur?A2.RARITY(cur.rarity).ru+' · ур. '+cur.ilvl+' · сила '+curP:'Наденьте предмет из сумки')+'</small></div></div>'+
        (cur?'<div class="btnrow"><button data-act="unequip" data-s="'+sl.id+'">Снять в сумку</button>'+
          '<button data-act="enchant" data-s="'+sl.id+'">Заточить · '+(120*(cur.plus+1))+' S</button>'+
          '<button data-act="reroll" data-s="'+sl.id+'">Перековать</button></div>':'')+'</div>');
      const candidates=ch.inventory.map((it,i)=>({it,i})).filter(x=>x.it.slot===sl.id)
        .sort((a,b)=>A2.RPG.itemPower(b.it)-A2.RPG.itemPower(a.it));
      html.push('<h4>В сумке · '+candidates.length+' подходящих</h4>');
      if(!candidates.length) html.push('<p class="empty">Предметов для этого слота пока нет. Убейте мобов или загляните на рынок.</p>');
      candidates.forEach(x=>{
        const r=A2.RARITY(x.it.rarity), dp=A2.RPG.itemPower(x.it)-curP;
        html.push('<div class="item '+r.id+'"><b>'+r.abbr+' '+A2.RPG.itemName(x.it)+'</b>'+
          '<span>ур. '+x.it.ilvl+' · сила '+A2.RPG.itemPower(x.it)+' · прирост <b style="color:'+(dp>=0?'#8fd08a':'#e0574f')+'">'+(dp>=0?'+':'')+dp+'</b></span>'+
          '<div class="acts"><button data-act="equipSlot" data-i="'+x.i+'" data-s="'+sl.id+'">Надеть</button>'+
          '<button data-act="list" data-i="'+x.i+'">На рынок</button></div></div>');
      });
      html.push('<div class="btnrow"><button data-act="goequip">← Все слоты</button><button data-act="backbag">Сумка</button></div>');
    } else if(mode==='bag'){
      h('Сумка · '+ch.inventory.length+' / 40 · новых: '+G.market.newItems);
      html.push('<div class="bagbar"><span>Автоподбор: <b>'+({all:'всё',rare:'редкое+',epic:'эпическое+',legendary:'легендарное+',none:'выключен'}[G.settings.lootFilter])+'</b></span>'+
        '<span>S: <b>'+A2.fmt(ch.gold)+'</b></span><span>На земле: <b>'+G.world.drops.filter(d=>d.t>0&&d.item).length+'</b></span></div>');
      html.push('<div class="grid40">');
      for(let i=0;i<40;i++) html.push(itemCard(ch.inventory[i],i,true));
      html.push('</div>');
      html.push('<div class="btnrow"><button data-act="goequip">⚔ Снаряжение</button><button data-act="equipBest">✦ Надеть лучшее</button>'+
        '<button data-act="pickAll">✦ Забрать лут рядом</button></div>');
      html.push('<div class="btnrow"><button data-act="salvageCommon">Разобрать обычное</button><button data-act="sellCommon">Продать обычное</button>'+
        '<button data-act="gomarket">Рынок</button><button data-act="filters">Фильтр лута</button></div>');
      html.push('<p class="note">Тап по ячейке — карточка предмета: сравнение со слотом, надевание, разбор, продажа и выставление на рынок.</p>');
    } else if(mode==='item'){
      const it=ch.inventory[typeof data==='number'?data:G.selectedItem];
      h('Предмет · '+A2.RARITY(it?it.rarity:'common').ru);
      html.push(itemDetail(it, typeof data==='number'?data:G.selectedItem));
    } else if(mode==='filters'){
      h('Фильтр лута и звук');
      html.push('<h4>Автоподбор предметов</h4>');
      [['all','Всё подряд (рекомендуется)'],['rare','Редкое и выше'],['epic','Эпическое и выше'],['legendary','Легендарное и выше'],['none','Только вручную']].forEach(f=>
        html.push('<button class="wide" data-act="setLoot" data-v="'+f[0]+'" '+(G.settings.lootFilter===f[0]?'style="border-color:#4fd6d0"':'')+'>'+(G.settings.lootFilter===f[0]?'✓ ':'')+f[1]+'</button>'));
      html.push('<h4>Звук · '+A2.Audio.state().running+' / '+A2.Audio.state().ctx+'</h4>');
      html.push('<label class="check"><input type="checkbox" data-set="sound" '+(G.settings.sound?'checked':'')+'> Звук и музыка биома</label>');
      html.push('<label class="range">Общая громкость <input type="range" data-range="volume" min="0" max="100" value="'+Math.round(G.settings.volume*100)+'"></label>');
      html.push('<label class="range">Музыка <input type="range" data-range="music" min="0" max="100" value="'+Math.round(G.settings.music*100)+'"></label>');
      html.push('<label class="range">Эффекты <input type="range" data-range="sfx" min="0" max="100" value="90"></label>');
      html.push('<label class="check"><input type="checkbox" data-set="autoSalvage" '+(G.settings.autoSalvage?'checked':'')+'> Авторазбор обычного при полной сумке</label>');
      html.push('<div class="btnrow"><button data-act="testSound">Проверить звук</button><button data-act="backbag">← К сумке</button></div>');
    } else if(mode==='market'){
      G.market.seed();
      h('Рынок Завета · '+(G.net.state==='online'?'общий серверный':'офлайн-призраки'));
      const f=G.market.filter;
      html.push('<div class="bagbar"><span>Серебро: <b>'+A2.fmt(ch.gold)+'</b></span><span>Лотов: <b>'+G.market.orders.length+'</b></span><span>Комиссия: <b>5%</b> (sink)</span></div>');
      html.push('<div class="btnrow"><select id="mSlot" class="field"><option value="all">Все слоты</option>'+
        A2.SLOTS.map(s=>'<option value="'+s.id+'" '+(f.slot===s.id?'selected':'')+'>'+s.ru+'</option>').join('')+'</select>'+
        '<select id="mRar" class="field"><option value="all">Любая редкость</option>'+
        A2.RARITIES.map(r=>'<option value="'+r.id+'" '+(f.rarity===r.id?'selected':'')+'>'+r.ru+'</option>').join('')+'</select>'+
        '<input id="mQ" class="field" placeholder="Поиск" value="'+f.q+'"><button data-act="mFilter">Найти</button></div>');
      html.push('<h4>Выставить предмет</h4><div class="btnrow"><select id="mItem" class="field">'+
        ch.inventory.map((it,i)=>'<option value="'+i+'">'+A2.RARITY(it.rarity).abbr+' '+A2.RPG.itemName(it)+' · '+A2.RPG.itemPower(it)+'</option>').join('')+'</select>'+
        '<input id="mPrice" class="field" type="number" min="1" placeholder="Цена"><button data-act="mList">Выставить</button></div>');
      html.push('<h4>Лоты</h4>'+marketRows());
      html.push('<h4>История сделок</h4>'+(G.market.history.slice(-5).reverse().map(x=>row(x.text,new Date(x.t).toLocaleTimeString('ru-RU'))).join('')||'<p class="empty">Сделок пока нет</p>'));
    } else if(mode==='trade'){
      h('Торговля 1:1');
      html.push(tradePeers());
    } else if(mode==='player'){
      const p=data||G.selectedPlayer||{name:'Игрок',uid:'',level:1,classId:'warrior'};
      h('Игрок · '+(p.name||'Игрок'));
      html.push('<div class="charhead"><span class="bigicon">'+A2.CLASS(p.classId).icon+'</span><div><b>'+
        (p.name||'Игрок')+'</b><small>ур. '+(p.level||1)+' · '+A2.CLASS(p.classId).ru+'</small></div></div>');
      html.push('<p class="note">Доступные действия '+(G.net.state==='online'?'обработает авторитетный сервер':'будут выполнены в офлайн-мире')+'.</p>');
      html.push('<div class="btnrow"><button data-act="tradeInvite" data-uid="'+(p.uid||'')+'" data-name="'+(p.name||'Игрок')+'">Торговля 1:1</button>'+
        '<button data-act="partyInvite" data-uid="'+(p.uid||'')+'">В группу</button></div>');
      html.push('<div class="btnrow"><button data-act="whisper" data-uid="'+(p.uid||'')+'" data-name="'+(p.name||'Игрок')+'">Шёпот</button>'+
        '<button data-act="emote" data-uid="'+(p.uid||'')+'" data-name="'+(p.name||'Игрок')+'">Эмоция</button>'+
        '<button data-act="pingMap">Отметить точку</button></div>');
      html.push('<div class="btnrow"><button data-act="goplayers">Все игроки</button></div>');
    } else if(mode==='players'){
      h('Игроки · '+(G.net.state==='online'?'ОНЛАЙН':'офлайн-мир'));
      html.push(playerRows());
      html.push('<div class="btnrow"><input id="whisperTo" class="field" placeholder="Имя или uid"><input id="whisperText" class="field" placeholder="Сообщение">'+
        '<button data-act="sendWhisper">Шёпот</button><button data-act="sendEmote">Эмоция</button></div>');
    } else if(mode==='quests'){
      h('Кодекс Завета · квесты');
      const active=A2.RPG.activeQuests(G);
      html.push('<h4>Активные ('+active.length+')</h4>');
      active.forEach(q=>{ const st=ch.quests[q.id]; html.push('<div class="quest"><b>'+q.ru+'</b><span>'+q.text+'</span><div class="qbar"><i style="width:'+Math.min(100,st.progress/q.need*100)+'%"></i></div><small>'+st.progress+' / '+q.need+' · +'+q.xp+' XP · +'+q.gold+' S</small></div>'); });
      html.push('<h4>Цепочка · 12 глав</h4>');
      A2.QUESTS.forEach((q,i)=>{ const st=ch.quests[q.id]; html.push(row((i+1)+'. '+q.ru,st&&st.done?'✓ сдан':st&&st.active?'в работе':'не открыт')); });
      html.push('<h4>Репутация</h4>'); A2.ZONES.forEach(z=>html.push(row(z.ru,ch.rep[z.id]||0)));
    } else if(mode==='chat'){
      h('Чат · '+(G.net.state==='online'?'ОНЛАЙН':'офлайн-мир'));
      G.logLines.slice(-24).forEach(l=>html.push('<div class="chat-line" style="color:'+l.color+'">'+l.text+'</div>'));
      html.push('<div class="btnrow"><input id="modalChatInput" class="field" placeholder="Сообщение…"><button data-act="say">Отправить</button></div>');
      html.push('<p class="note">Каналы: локальный / глобальный / торговый / группа / шёпот. В офлайне отвечают союзники-призраки.</p>');
    } else if(mode==='party'){
      h('Группа · '+(G.net.state==='online'?'онлайн':'призраки'));
      const list=G.net.ghosts.length?G.net.ghosts:Array.from(G.net.players.values());
      html.push('<div class="party"><div class="item"><b>'+ch.name+' · '+A2.CLASS(ch.classId).ru+'</b><span>ур. '+ch.level+' · лидер · DPS '+A2.fmt(G.dps)+'</span></div>');
      list.forEach(e=>html.push('<div class="item"><b>'+e.name+' · '+A2.CLASS(e.classId).ru+'</b><span>ур. '+e.level+' · '+(e.ghost?'союзник-призрак':'игрок')+'</span></div>'));
      html.push('</div><h4>Подключение к серверу</h4><div class="btnrow"><input id="modalServerInput" class="field" placeholder="wss://your-server.example/ws"><button data-act="connect">Подключиться</button></div>');
      html.push('<div class="btnrow"><button data-act="goplayers">Список игроков</button><button data-act="gotrade">Торговля</button></div>');
    } else if(mode==='codex'){
      h('Кодекс Возжённого');
      html.push('<h4>6 классов канона</h4>');
      A2.CLASSES.forEach(c=>html.push(row(c.icon+' '+c.ru+' / '+c.en,c.role+' · '+c.res+' · дальность '+c.range)));
      html.push('<h4>Зоны</h4>'); A2.ZONES.forEach(z=>html.push(row(z.ru,'ур. '+z.lv[0]+'–'+z.lv[1]+' · '+z.desc)));
      html.push('<h4>Редкости</h4>'); A2.RARITIES.forEach(r=>html.push(row(r.ru,'×'+r.mult.toFixed(2)+' · '+r.aff+' свойств · '+(r.weight*100).toFixed(1)+'%')));
      html.push('<h4>Реакции канона</h4>'); Object.keys(A2.REACTIONS).forEach(k=>html.push(row(k,A2.REACTIONS[k].ru+' ×'+A2.REACTIONS[k].coeff.toFixed(2))));
      html.push('<p class="note">P3: 0 силовых SKU. P1: вес каждого удара. P2: мир помнит каждый след.</p>');
    } else if(mode==='settings'){
      h('Настройки');
      html.push('<label class="check"><input type="checkbox" data-set="motion" '+(G.settings.motion?'checked':'')+'> Тряска и частицы</label>');
      html.push('<label class="check"><input type="checkbox" data-set="sound" '+(G.settings.sound?'checked':'')+'> Звук и музыка биома</label>');
      html.push('<label class="check"><input type="checkbox" data-set="vibration" '+(G.settings.vibration?'checked':'')+'> Вибрация</label>');
      html.push('<label class="check"><input type="checkbox" data-set="autoSalvage" '+(G.settings.autoSalvage?'checked':'')+'> Авторазбор обычного при полной сумке</label>');
      html.push('<h4>Графика · сейчас '+(G.perf==='low'?'экономный':'полный')+' режим · '+Math.round(G.fpsAvg)+' FPS</h4>');
      [['auto','Авто (по FPS)'],['high','Полная детализация'],['low','Экономная · без лагов']].forEach(q=>
        html.push('<button class="wide" data-act="quality" data-v="'+q[0]+'" '+(G.settings.quality===q[0]?'style="border-color:#4fd6d0"':'')+'>'+
          (G.settings.quality===q[0]?'✓ ':'')+q[1]+'</button>'));
      html.push('<div class="btnrow"><button data-act="pickAll">✦ Забрать весь лут рядом</button></div>');
      html.push('<h4>Камера</h4>'+row('Зум',G.cam.zoom.toFixed(2))+row('Поворот',[0,90,180,270][G.cam.orient]+'°'));
      html.push('<div class="btnrow"><button data-act="filters">Фильтр лута и звук</button><button data-act="goplayers">Игроки</button>'+
        '<button data-act="reset">Новый персонаж</button><button data-act="save">Сохранить</button></div>');
      html.push('<p class="note">G2.1 · '+CANON_SOURCE+' · '+(G.net?G.net.status().state:'offline')+' · 30 Гц тик / 60 Гц рендер · '+
        (A2.Audio.state().running?'звук активен':'звук ожидает касания')+'</p>');
    } else if(mode==='dialogue'){
      const npc=data, d=A2.RPG.dialogue(G,npc);
      h(npc.ru+' · '+npc.role);
      d.lines.forEach(l=>html.push('<p class="npc-line">«'+l+'»</p>'));
      d.options.forEach((o,i)=>html.push('<button class="wide" data-act="dlg" data-i="'+i+'">'+o.text+'</button>'));
      G.modalOptions=d.options;
    } else if(mode==='talents'){
      h('Таланты · '+ch.talentPoints+' очков');
      A2.TALENTS.forEach(br=>{
        html.push('<h4 style="color:'+br.color+'">'+br.ru+' · '+ch.talents[br.id]+'/'+br.nodes.length+'</h4>');
        br.nodes.forEach((n,i)=>html.push('<div class="talent '+(i<ch.talents[br.id]?'on':'')+'"><b>'+n.ru+'</b><span>'+n.desc+'</span></div>'));
        html.push('<button class="wide" data-act="talent" data-b="'+br.id+'">Вложить очко в «'+br.ru+'»</button>');
      });
      html.push('<button class="wide" data-act="respec">Перековать все · 500 S</button>');
    } else if(mode==='forge'){
      h('Кузница · заточка +12 / перековка');
      A2.SLOTS.forEach(s=>{ const it=ch.equip[s.id]; if(it) html.push('<div class="item"><b>'+A2.RPG.itemName(it)+'</b><span>+'+it.plus+' · '+it.affixes.length+' свойств</span><div class="acts"><button data-act="enchant" data-s="'+s.id+'">Заточить · '+(120*(it.plus+1))+' S</button><button data-act="reroll" data-s="'+s.id+'">Перековать</button></div></div>'); });
    } else if(mode==='shop'){
      h('Торговля · '+A2.fmt(ch.gold)+' S');
      if(!G.shopStock) G.shopStock=[A2.RPG.rollItem(ch.level,G.world.id,{rarity:'rare'}),A2.RPG.rollItem(ch.level,G.world.id,{rarity:'epic'}),A2.RPG.rollItem(ch.level,G.world.id,{})];
      G.shopStock.forEach((it,i)=>html.push('<div class="item '+A2.RARITY(it.rarity).id+'"><b>'+A2.RPG.itemName(it)+'</b><span>'+it.price+' S · сила '+A2.RPG.itemPower(it)+'</span><button data-act="buy" data-i="'+i+'">Купить</button></div>'));
    }
    body.innerHTML=html.join('');
    body.onclick=modalClick;           // перезапись: обработчик не копился при каждом открытии
    body.onchange=modalChange;
    box.classList.remove('hidden');
  }
  function closeModal(){ const b=$('modal'); if(b) b.classList.add('hidden'); G.modalMode=null; }
  function modalChange(ev){
    const el=ev.target; if(!el||!el.getAttribute) return;
    const r=el.getAttribute('data-range'), v=el.getAttribute('data-set');
    if(r && A2.Audio){
      const n=Number(el.value)/100;
      if(r==='volume'){G.settings.volume=n;A2.Audio.setVolume(n);}
      if(r==='music'){G.settings.music=n;A2.Audio.setMusic(n);}
      if(r==='sfx') A2.Audio.setSfx(n);
      A2.Audio.play('ui');
    }
    if(v){ G.settings[v]=!!el.checked; if(v==='sound') A2.Audio.setEnabled(!!el.checked); A2.Audio.play('ui'); }
  }
  function modalClick(ev) {
    const el=ev.target; if(!el||!el.getAttribute) return;
    const act=el.getAttribute('data-act'); if(!act) return;
    const i=parseInt(el.getAttribute('data-i')||'0',10);
    const s=el.getAttribute('data-s'), b=el.getAttribute('data-b'), v=el.getAttribute('data-v');
    const id=el.getAttribute('data-id'), uid=el.getAttribute('data-uid'), nm=el.getAttribute('data-name');
    const ch=G.char, M=G.market;
    const val=q=>{const e=$(q);return e?e.value:'';};
    switch(act){
      case 'item': G.selectedItem=i; openModal('item',i); break;
      case 'backbag': M.newItems=0; openModal('bag'); break;
      case 'goequip': openModal('equip'); break;
      case 'gochar': openModal('char'); break;
      case 'slot': openModal('slot',s); break;
      case 'equipSlot': {
        const it=ch.inventory[i];
        if(it && A2.RPG.equip(G,it)){ A2.Audio.play('equip'); openModal('slot',s); }
        else G.toast('Не удалось надеть предмет',1.5);
        break;
      }
      case 'unequip': if(A2.RPG.unequip(G,s)){ A2.Audio.play('equip'); openModal('slot',s); } break;
      case 'equipBest': {
        const n=A2.RPG.equipBest(G);
        G.toast(n?'Надето предметов: '+n:'Уже надето лучшее',2);
        if(n) A2.Audio.play('equip');
        openModal(G.modalMode==='char'?'char':G.modalMode==='bag'?'bag':'equip');
        break;
      }
      case 'enchantAll': {
        let n=0;
        for(const sl of A2.SLOTS) if(ch.equip[sl.id] && A2.RPG.enchant(G,sl.id)) n++;
        G.toast(n?'Заточено слотов: '+n:'Нет Серебра или все +12',2);
        if(n) A2.Audio.play('enchant');
        openModal('equip'); break;
      }
      case 'pickAll': {
        const n=A2.RPG.collectNearby(G,9.5);
        if(n) A2.Audio.play('coin');
        openModal(G.modalMode||'bag'); break;
      }
      case 'quality': {
        G.settings.quality=v; G.fpsLowT=0; G.fpsHighT=0;
        if(v!=='auto'){ G.perf=v; A2.Render.setQuality(v); }
        A2.Audio.play('ui'); openModal('settings'); break;
      }
      case 'equip': if(A2.RPG.equip(G,ch.inventory[i])){A2.Audio.play('equip');openModal('bag');} break;
      case 'salvage': if(A2.RPG.salvage(G,ch.inventory[i])){A2.Audio.play('break');openModal('bag');} break;
      case 'sell': if(A2.RPG.sell(G,ch.inventory[i])) openModal('bag'); break;
      case 'list': {
        const p=Number(val('listPrice'))||M.suggest(ch.inventory[i]);
        if(M.list(ch.inventory[i],p)) openModal('market');
        break;
      }
      case 'salvageCommon': case 'sellCommon': {
        let n=0;
        for(let k=ch.inventory.length-1;k>=0;k--) if(ch.inventory[k].rarity==='common') {
          if(act==='salvageCommon') A2.RPG.salvage(G,ch.inventory[k]); else A2.RPG.sell(G,ch.inventory[k]); n++;
        }
        G.toast(n?'Обработано предметов: '+n:'Обычных предметов нет',1.8); A2.Audio.play('coin'); openModal('bag'); break;
      }
      case 'filters': openModal('filters'); break;
      case 'setLoot': G.settings.lootFilter=v; A2.Audio.play('ui'); openModal('filters'); break;
      case 'testSound': A2.Audio.unlock(); ['hit','crit','loot','level','portal','ultimate'].forEach((n,k)=>setTimeout(()=>A2.Audio.play(n,k===2?'legendary':undefined),k*180)); G.toast('Звуковой тест: 6 эффектов',2); break;
      case 'gomarket': openModal('market'); break;
      case 'gotrade': openModal('trade'); break;
      case 'goplayers': openModal('players'); break;
      case 'gototalents': openModal('talents'); break;
      case 'goforge': openModal('forge'); break;
      case 'mFilter': {
        M.filter.slot=val('mSlot')||'all'; M.filter.rarity=val('mRar')||'all'; M.filter.q=val('mQ')||'';
        A2.Audio.play('ui'); openModal('market'); break;
      }
      case 'mList': {
        const idx=parseInt(val('mItem')||'0',10), it=ch.inventory[idx];
        if(it && M.list(it,Number(val('mPrice'))||M.suggest(it))) openModal('market');
        else G.toast('Не удалось выставить лот',2);
        break;
      }
      case 'buy': {
        if(G.modalMode==='shop'){ const it=G.shopStock&&G.shopStock[i]; if(it&&A2.RPG.buy(G,it)){G.shopStock.splice(i,1);A2.Audio.play('coin');G.toast('Куплено',1.5);openModal('shop');} else G.toast('Не хватает Серебра',1.5); }
        else if(M.buy(id)) { A2.Audio.play('coin'); if(G.net.state!=='online') openModal('market'); }
        break;
      }
      case 'cancelLot': if(M.cancel(id)) openModal('market'); break;
      case 'tradeInvite': M.tradeInvite(uid,nm); G.net.who&&G.net.who(); openModal('trade'); break;
      case 'tradeAccept': M.tradeAccept(uid); openModal('trade'); break;
      case 'tradeOffer': {
        const boxes=(typeof document!=='undefined'&&document.querySelectorAll)?document.querySelectorAll('.offerItem'):[];
        const items=[]; boxes.forEach(bx=>{ if(bx.checked) { const it=ch.inventory[parseInt(bx.value,10)]; if(it) items.push(it); } });
        M.tradeSetOffer(items,Number(val('tradeGold'))||0); G.toast('Предложение передано',1.5); openModal('trade'); break;
      }
      case 'tradeConfirm': if(M.tradeConfirm()) openModal('trade'); break;
      case 'tradeCancel': M.tradeCancel(); openModal('trade'); break;
      case 'partyInvite': G.net.send({t:'party',act:'invite',target:uid}); G.toast('Приглашение в группу отправлено',1.5); break;
      case 'whisper': {
        const text=promptText('Шёпот для '+nm); if(text) { if(G.net.state==='online') G.net.whisper(uid,text);
          else { G.log('[шёпот] '+ch.name+' → '+nm+': '+text,'#b07ae8'); A2.Audio.play('whisper'); } }
        break;
      }
      case 'emote': {
        const text=G.market? 'приветствует '+nm : 'машет рукой';
        if(G.net.state==='online') G.net.emote(text);
        else G.log('✧ '+ch.name+' '+text,'#8fd08a');
        break;
      }
      case 'sendWhisper': {
        const to=val('whisperTo'), text=val('whisperText');
        if(to&&text){ if(G.net.state==='online') G.net.whisper(to,text); else G.log('[шёпот] '+ch.name+' → '+to+': '+text,'#b07ae8'); A2.Audio.play('whisper'); }
        break;
      }
      case 'sendEmote': if(G.net.state==='online') G.net.emote('подаёт знак Завета'); else G.log('✧ '+ch.name+' подаёт знак Завета','#8fd08a'); break;
      case 'pingMap': {
        const p=G.selectedPlayer;
        if(G.net.state==='online') G.net.pingMap(G.player.x,G.player.y);
        G.toast('◈ Точка отмечена для союзников',1.8);
        if(p) G.log('◈ '+ch.name+' отметил точку рядом с '+p.name,'#4fd6d0');
        break;
      }
      case 'enchant': if(A2.RPG.enchant(G,s)){A2.Audio.play('enchant');openModal(G.modalMode==='slot'?'slot':'forge',G.modalMode==='slot'?s:null);} else G.toast('Не хватает Серебра или +12 достигнут',2); break;
      case 'reroll': if(A2.RPG.reroll(G,s)){A2.Audio.play('enchant');openModal(G.modalMode==='slot'?'slot':'forge',G.modalMode==='slot'?s:null);} else G.toast('Нужен Осколок Разлома или 400 S',2); break;
      case 'talent': if(A2.RPG.talentUp(G,b)){A2.Audio.play('level');openModal('talents');} else G.toast('Нет очков или ветка заполнена',1.5); break;
      case 'respec': if(A2.RPG.respec(G)){G.toast('Таланты сброшены',2);openModal('talents');} else G.toast('Нужно 500 S',1.5); break;
      case 'say': { const inp=$('modalChatInput'); if(inp&&inp.value){G.net.chat(inp.value.trim());inp.value='';openModal('chat');} break; }
      case 'connect': { const inp=$('modalServerInput'); if(inp&&inp.value){G.net.connect(inp.value.trim());G.toast('Подключение…',2);closeModal();} break; }
      case 'save': A2.RPG.save(G); G.toast('Сохранено',1.5); break;
      case 'reset': if(typeof localStorage!=='undefined'){try{localStorage.removeItem(C.SAVE_KEY);}catch(e){}} G.toast('Перезапустите страницу для нового героя',3); break;
      case 'dlg': {
        const o=G.modalOptions&&G.modalOptions[i]; if(!o) break;
        switch(o.action){
          case 'accept': A2.RPG.startQuest(G,o.payload); openModal('dialogue',G.modalData); break;
          case 'complete': A2.RPG.completeQuest(G,o.payload); openModal('dialogue',G.modalData); break;
          case 'heal': ch.hp=ch.stats.maxHp; A2.Audio.play('quest'); G.toast('Исцеление Светоча',2); break;
          case 'forge': openModal('forge'); break;
          case 'shop': openModal('shop'); break;
          case 'market': openModal('market'); break;
          case 'trade': openModal('trade'); break;
          case 'salvage': { const it=ch.inventory[0]; if(it)A2.RPG.salvage(G,it); G.toast(it?'Разобрано: '+A2.RPG.itemName(it):'Сумка пуста',2); break; }
          case 'talents': openModal('talents'); break;
          case 'respec': G.toast(A2.RPG.respec(G)?'Таланты сброшены':'Нужно 500 S',2); break;
          case 'portal': { const p=G.world.portals[0]; if(p){setZone(p.to);closeModal();} break; }
          case 'map': G.toast('Лагеря отмечены на мини-карте',2); break;
          case 'gamble': { if(ch.gold>=800){ch.gold-=800;const it=A2.RPG.rollItem(ch.level,G.world.id,{rarity:'legendary'});ch.inventory.push(it);G.toast('Реликвия: '+A2.RPG.itemName(it),3);A2.Audio.play('loot','legendary');} else G.toast('Нужно 800 S',2); break; }
          case 'info': G.toast('Квест в работе',1.5); break;
        }
        break;
      }
    }
  }
  function promptText(label) {
    if(typeof window!=='undefined' && typeof window.prompt==='function') return window.prompt(label,'');
    return '';
  }

  /* -------------------------------- симуляция -------------------------------- */
  function step(dt) {
    if(G.mode!=='playing') return;
    G.time+=dt; G.tick++;
    const ch=G.char, p=G.player, cls=A2.CLASS(ch.classId);
    ch.playtime+=dt;
    if(ch.dead){ ch.hp=ch.stats.maxHp*0.6; ch.dead=false; p.x=12; p.y=16; G.toast('Возрождение у Светоча',2.5); }
    // ресурс и додж
    ch.res=A2.clamp(ch.res+cls.regen*dt,0,ch.maxRes);
    if(ch.dodgeCharges<C.DODGE_CHARGES){ ch.dodgeCd+=dt; if(ch.dodgeCd>=C.DODGE_CD){ch.dodgeCharges++;ch.dodgeCd=0;} }
    p.iframe=Math.max(0,(p.iframe||0)-dt);
    p.attackAnim=Math.max(0,(p.attackAnim||0)-dt*3.4);
    // движение
    let dx=G.joy.dx,dy=G.joy.dy;
    if(G.keys){ if(G.keys.w||G.keys.W||G.keys.ArrowUp) dy-=1; if(G.keys.s||G.keys.S||G.keys.ArrowDown) dy+=1;
      if(G.keys.a||G.keys.A||G.keys.ArrowLeft) dx-=1; if(G.keys.d||G.keys.D||G.keys.ArrowRight) dx+=1; }
    const w=screenToWorld(dx,dy), m=Math.hypot(G.joy.dx,G.joy.dy)||(G.keys&&(G.keys.w||G.keys.a||G.keys.s||G.keys.d)?1:0);
    p.moving=m>0.08;
    if(p.moving){
      const spd=ch.stats.speed*(1+ch.stats.haste*0.2);
      const nx=p.x+w.x*dt*spd, ny=p.y+w.y*dt*spd;
      if(A2.World.canMove(G.world,nx,p.y)) p.x=nx;
      if(A2.World.canMove(G.world,p.x,ny)) p.y=ny;
      p.facing=Math.atan2(w.y,w.x);
    }
    ch.x=p.x; ch.y=p.y;
    // автоатака
    G.autoCd-=dt;
    if(G.autoCd<=0){
      const t=target();
      if(t && A2.dist(t.x,t.y,p.x,p.y)<=cls.range+0.8){
        A2.RPG.hit(G,t,1.05,cls.element);
        ch.res=A2.clamp(ch.res+8,0,ch.maxRes);
        ch.ult=A2.clamp(ch.ult+2,0,100);
        p.attackAnim=1;
      }
      G.autoCd=1/(1.15*(1+ch.stats.haste))*(1-ch.stats.cdr*0.2);
    }
    // питомцы
    for(const pet of G.pets){
      pet.life-=dt; pet.cd-=dt;
      const t=A2.World.mobsNear(G.world,pet.x,pet.y,7)[0];
      if(t){ const a=Math.atan2(t.y-pet.y,t.x-pet.x); const nx=pet.x+Math.cos(a)*dt*2.4,ny=pet.y+Math.sin(a)*dt*2.4;
        if(A2.World.canMove(G.world,nx,ny)){pet.x=nx;pet.y=ny;}
        if(pet.cd<=0&&A2.dist(pet.x,pet.y,t.x,t.y)<2.2){pet.cd=1.2;t.hp-=pet.dmg;t.hitFlash=1;
          if(t.hp<=0){A2.World.kill(G.world,t);G.char.kills++;A2.RPG.grantXP(G,Math.round(t.xp*0.5));A2.RPG.questProgress(G,'kill',t.id,1);} }
      } else { pet.x=A2.lerp(pet.x,p.x+1.5,dt); pet.y=A2.lerp(pet.y,p.y+1.5,dt); }
    }
    G.pets=G.pets.filter(x=>x.life>0);
    // G2.2 · магнит лута: вещи притягиваются к игроку и подбираются сами,
    // даже если моб умер за стеной или на дальней дистанции.
    A2.RPG.magnetLoot(G,dt);
    // отложенная досылка реестра предметов на сервер (не чаще раза в 700 мс)
    G.itemFlushT+=dt;
    if(G.itemFlushT>=1){ G.itemFlushT=0; if(G.net&&G.net.flushItems) G.net.flushItems(); }
    // звук шагов
    if(p.moving && A2.Audio) A2.Audio.play('step');
    // мир
    const hooks={
      onMobHit:(mob,tgt,dmg)=>{
        if(tgt && (tgt.uid==='local'||tgt.isRemote)) {
          if(tgt.uid==='local') A2.RPG.hurtPlayer(G,dmg,mob);
        }
      },
      onTelegraph:(mob,tg)=>{
        const inShape=(x,y)=>{
          const d=A2.dist(x,y,tg.x,tg.y);
          if(tg.shape==='circle'||tg.shape==='ring') return d<tg.radius;
          if(tg.shape==='line') return d<tg.radius*1.4;
          const a=Math.atan2(y-tg.y,x-tg.x), diff=Math.abs(((a-tg.angle+Math.PI*3)%(Math.PI*2))-Math.PI);
          return d<tg.radius && diff<0.65;
        };
        if(inShape(p.x,p.y)) A2.RPG.hurtPlayer(G,mob.dmg*tg.dmgMul,mob);
        A2.RPG.spawnParticles(G,tg.x,tg.y,18,'#e0574f',2);
        G.cam.shake=Math.min(10,G.cam.shake+2);
      },
      onPhase:(mob,ph)=>G.toast('ФАЗА '+ph+' · '+mob.nameOverride,2.5),
      onRespawn:()=>{}
    };
    A2.World.update(G.world,dt,G.entities,hooks);
    // DoT-статусы
    for(const mob of G.world.mobs) if(mob.alive && mob.statuses) {
      for(const s of mob.statuses) if(s.dot) { mob.hp-=s.dot*dt; if(mob.hp<=0){ A2.World.kill(G.world,mob); G.char.kills++; A2.RPG.grantXP(G,mob.xp); A2.RPG.questProgress(G,'kill',mob.id,1); break; } }
    }
    G.net.update(dt);
    // частицы / цифры
    for(const q of G.particles){ q.life-=dt; q.x+=q.vx*dt; q.y+=q.vy*dt; q.z+=q.vz*dt; q.vz-=6*dt; if(q.z<0){q.z=0;q.vz*=-0.35;} }
    G.particles=G.particles.filter(q=>q.life>0);
    for(const n of G.numbers){ n.life-=dt; n.z+=dt*1.6; }
    G.numbers=G.numbers.filter(n=>n.life>0);
    for(const c of G.corpses) c.life-=dt;
    G.corpses=G.corpses.filter(c=>c.life>0);
    // камера
    G.cam.shake*=Math.pow(0.06,dt);
    G.cam.shakeX=(Math.random()-0.5)*G.cam.shake*(G.settings.motion?1:0.2);
    G.cam.shakeY=(Math.random()-0.5)*G.cam.shake*(G.settings.motion?1:0.2);
    G.flash=Math.max(0,G.flash-dt*2.2);
    // DPS
    G.dmgWindow.push({t:G.time,d:G.damageDealt});
    while(G.dmgWindow.length && G.time-G.dmgWindow[0].t>3) G.dmgWindow.shift();
    const span=Math.max(0.2,G.time-(G.dmgWindow[0]?G.dmgWindow[0].t:G.time-3));
    G.dps=(G.damageDealt-(G.dmgWindow[0]?G.dmgWindow[0].d:0))/span;
    // баннер события
    if(G.world.eventActive) G.eventBannerUntil=G.time+1;
    // сохранение
    G.saveT+=dt; if(G.saveT>15){G.saveT=0;A2.RPG.save(G);}
    // синхронизация игрока
    p.level=ch.level; p.hp=ch.hp; p.maxHp=ch.stats.maxHp; p.gearRarity=ch.gearRarity;
    p.name=ch.name; p.classId=ch.classId;
  }

  function frame(ts) {
    const dt=Math.min(0.1,((ts||0)-G.lastFrame)/1000||1/60); G.lastFrame=ts||0;
    // G2.2 · адаптивное качество: на слабом телефоне отключаем дорогие
    // градиенты/лучи/воду, сохраняя геймплей и читаемость лута.
    if(dt>0.001 && dt<0.25){
      const fps=1/dt;
      G.fpsAvg=G.fpsAvg*0.92+fps*0.08;
      if(G.settings.quality==='auto'){
        if(G.fpsAvg<38){ G.fpsLowT+=dt; G.fpsHighT=0; } else if(G.fpsAvg>53){ G.fpsHighT+=dt; G.fpsLowT=0; }
        else { G.fpsLowT=Math.max(0,G.fpsLowT-dt*0.5); G.fpsHighT=Math.max(0,G.fpsHighT-dt*0.5); }
        if(G.fpsLowT>1.8 && G.perf!=='low'){ G.perf='low'; A2.Render.setQuality('low'); G.toast('Экономный режим графики · для плавности',2); }
        if(G.fpsHighT>5 && G.perf!=='high'){ G.perf='high'; A2.Render.setQuality('high'); }
      } else {
        const want=G.settings.quality==='low'?'low':'high';
        if(G.perf!==want){ G.perf=want; A2.Render.setQuality(want); }
      }
    }
    G.accum+=dt;
    let n=0; while(G.accum>=C.TICK && n<4){ step(C.TICK); G.accum-=C.TICK; n++; }
    if(G.world && G.char) A2.Render.frame(G.world,G,dt);
    G.uiT+=dt; if(G.uiT>0.2){G.uiT=0;updateUI();}
    if(typeof requestAnimationFrame==='function') requestAnimationFrame(frame);
  }

  function updateUI(force) {
    if(!G.char) return;
    const ch=G.char, cls=A2.CLASS(ch.classId), net=G.net?G.net.status():{state:'offline',count:0};
    const set=(id,v)=>{const e=$(id);if(e&&e.textContent!==undefined)e.textContent=v;};
    set('pName',ch.name); set('pLevel','ур. '+ch.level); set('pAvatar',cls.icon||'В');
    set('pHpText',Math.round(ch.hp)+' / '+ch.stats.maxHp);
    set('pResText',Math.round(ch.res)+' / '+ch.maxRes+' '+cls.res);
    set('pXpText',ch.xp+' / '+A2.xpNext(ch.level)+' XP');
    set('zoneName',G.world?G.world.zone.ru:'—');
    set('dpsText',A2.fmt(G.dps)); set('killsText',String(ch.kills)); set('goldText',A2.fmt(ch.gold));
    set('onlineBadge',net.state==='online'?'ОНЛАЙН · '+net.count+' игр. · '+net.ping+' мс':'ОФЛАЙН-МИР · '+net.count+' союзников');
    const q=A2.RPG.activeQuests(G)[0];
    set('questTracker',q?'▸ '+q.ru+' · '+ch.quests[q.id].progress+'/'+q.need:'▸ Квесты у НПС с меткой !');
    set('targetName',G.target&&G.target.alive?(G.target.nameOverride||G.target.ru)+' · '+Math.round(G.target.hp):'');
    const bar=(id,v)=>{const e=$(id);if(e&&e.style)e.style.width=A2.clamp(v*100,0,100)+'%';};
    bar('pHp',ch.hp/ch.stats.maxHp); bar('pRes',ch.res/ch.maxRes); bar('pXp',ch.xp/A2.xpNext(ch.level)); bar('pUlt',ch.ult/100);
    const dodge=$('dodgeCount'); if(dodge) dodge.textContent=String(ch.dodgeCharges);
    const setB=(id,v)=>{const e=$(id);if(e&&e.textContent!==undefined){e.textContent=v;e.classList&&e.classList.toggle('hot',Number(v)>0);}};
    setB('bagCount',String(ch.inventory.length));
    const lootN=G.world?G.world.drops.filter(d=>d.t>0&&!d.picked&&d.item).length:0;
    setB('lootCount',String(lootN));
    setB('equipCount',String(Object.values(ch.equip).filter(Boolean).length));
    const lootChip=$('btnLoot');
    if(lootChip&&lootChip.classList) lootChip.classList.toggle('show',lootN>0);
    setB('marketCount',String(G.market?G.market.orders.length:0));
    if(G.market) G.market.newItems=Math.min(99,G.market.newItems);
    const sndState=$('soundState'); if(sndState) sndState.textContent=G.settings.sound?'♪':'✕';
    const ult=$('btnUlt'); if(ult&&ult.classList) ult.classList.toggle('ready',ch.ult>=100);
    G.skillButtons.forEach((b,i)=>{
      if(!b||!b.querySelector) return;
      const name=cls.skills[i], left=(G.cooldowns[name]||0)-G.time, m=meta(name);
      const cd=b.querySelector('.cdlabel')||{textContent:''};
      if(left>0){ b.classList.add('cooling'); b.style&&b.style.setProperty('--cd',String(Math.min(100,left/m.cd*100))); }
      else b.classList.remove('cooling');
    });
    const mini=$('minimap'); if(mini&&G.world&&force!==false) A2.Render.minimap(G.world,G,mini);
    const ev=$('eventBanner'); if(ev){ const on=G.world&&G.world.eventActive; ev.classList&&ev.classList.toggle('show',!!on);
      if(on) ev.textContent='⚠ '+G.world.eventActive.ru+' · '+G.world.eventActive.killed+'/'+G.world.eventActive.need; }
    const toast=$('toast'); if(toast&&toast.classList){ toast.classList.toggle('show',G.time<G.toastUntil); }
    const hint=$('hint'); if(hint){ const npc=G.world?A2.World.npcAt(G.world,G.player.x,G.player.y,3.2):null;
      const p=G.world?A2.World.portalAt(G.world,G.player.x,G.player.y):null;
      const d=G.world?G.world.drops.find(dd=>!dd.picked&&dd.t>0&&A2.dist(dd.x,dd.y,G.player.x,G.player.y)<3.2):null;
      hint.textContent=npc?'✦ '+npc.ru+' · нажмите «Взаимодействие»':p?'◈ '+p.label+' · нажмите «Взаимодействие»':d?'✦ Добыча рядом · «Взаим.» заберёт всё':'';
      hint.classList.toggle('show',!!(npc||p||d)); }
  }

  /* ------------------------------ тестовый API ------------------------------ */
  window.ARKEON_G2 = {
    version:'G2.1', state:G,
    get source(){return CANON_SOURCE;},
    boot, startGame, step, cast, dodge, useUlt, setZone, interact, openModal, closeModal,
    target, meta, updateUI, render:(dt)=>A2.Render.frame(G.world,G,dt||1/60),
    char:()=>G.char, world:()=>G.world, net:()=>G.net?G.net.status():null,
    skills:()=>SKILLS,
    giveXP:n=>A2.RPG.grantXP(G,n),
    killNearest:()=>{ const t=target(); if(t){ while(t.alive) A2.RPG.hit(G,t,50,'Физический'); return t; } return null; },
    spawnMobs:n=>{ for(let i=0;i<n;i++) G.world.mobs.push(A2.World.makeMob(G.world,'pepelnik',G.player.x+2+i*0.4,G.player.y+1,1,{})); return G.world.mobs.length; },
    data:A2
  };

  if(typeof document!=='undefined'){
    if(document.readyState==='loading'&&document.addEventListener) document.addEventListener('DOMContentLoaded',boot);
    else boot();
  }
})();
