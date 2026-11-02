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
    lowFps:0, lastFrame:0, started:false
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
  G.onXP = v => { G.log('+'+v+' XP','#8fd08a'); };
  G.onGold = v => { G.log('+'+v+' Серебра','#f0d27a'); };
  G.onLoot = it => G.log('✦ '+A2.RPG.itemName(it), A2.RARITY(it.rarity).color);
  G.onMaterial = m => G.log('Материал: '+m,'#9db0bd');
  G.onLevel = lv => { G.toast('УРОВЕНЬ '+lv+' · +1 очко таланта',3); G.log('★ Уровень '+lv+'! Новое очко таланта.','#ffe27a'); };
  G.onKill = (m,dmg) => { G.kills++; G.log('† '+(m.nameOverride||m.ru)+' повержен','#9db0bd'); };
  G.onQuest = (q,act,cur,need) => { if(act==='start') G.toast('Квест: '+q.ru,2.5); if(act==='complete') G.toast('Квест завершён: '+q.ru,3); };
  G.onReaction = name => G.log('✺ Реакция: '+name,'#4fd6d0');
  G.onHurt = () => {};
  G.onHit = () => {};
  G.onChat = c => G.log('['+c.ch+'] '+c.name+': '+c.text,c.color);
  G.onNet = (kind,v) => { if(kind==='event') G.toast(v,3); };

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
    G.target=null; G.pets=[]; G.particles=[]; G.numbers=[];
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
    buildSkillButtons(); bindInput(); loadCanon();
    G.net.startGhosts();
    const u=(typeof location!=='undefined'&&location.search&&/[?&]server=/.test(location.search));
    // Явный адрес из URL имеет приоритет; иначе на своём сервере подключаемся
    // автоматически, а на Pages/CDN остаёмся в честном офлайн-мире.
    if(u) G.net.connect();
    else if(G.net.autoConnect()) G.log('Обнаружен сервер того же origin: подключаюсь к онлайну','#4fd6d0');
    const e=$('startScreen'); if(e && !saved) e.classList.remove('hidden');
    else { G.mode='playing'; const s=$('startScreen'); if(s) s.classList.add('hidden'); const h=$('hud'); if(h) h.classList.remove('hidden'); }
    G.log('АРКЕОН · Мир Завета · G2.0','#f0d27a');
    G.log('Сервер не указан — активен офлайн-мир с союзниками-призраками','#9db0bd');
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
    on('btnQuests',()=>openModal('quests')); on('btnChat',()=>openModal('chat'));
    on('btnParty',()=>openModal('party')); on('btnCodex',()=>openModal('codex'));
    on('btnSettings',()=>openModal('settings')); on('btnPause',()=>openModal('settings'));
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
    if(best){ G.target=best; G.toast('Цель: '+(best.nameOverride||best.ru),1.2); }
  }
  function startGame() {
    const pick=(typeof document!=='undefined'&&document.querySelector)?document.querySelector('.class-card.selected'):null;
    const id=pick&&pick.dataset?pick.dataset.class:'warrior';
    const nameEl=$('charName');
    G.char=A2.RPG.createCharacter(id,nameEl&&nameEl.value?nameEl.value.trim().slice(0,16):undefined);
    G.player=makePlayer(G.char,12,16);
    G.entities=[G.player]; G.world=A2.World.create('grove',1337);
    G.net.startGhosts(); buildSkillButtons();
    G.mode='playing';
    const s=$('startScreen'); if(s) s.classList.add('hidden');
    const h=$('hud'); if(h) h.classList.remove('hidden');
    G.toast('Добро пожаловать в Рощу Завета',3);
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
    const d=G.world.drops.find(dd=>A2.dist(dd.x,dd.y,G.player.x,G.player.y)<3.2);
    if(d){ A2.RPG.pickup(G,d); return; }
    G.toast('Рядом нет НПС, портала или добычи',1.5);
  }

  /* ------------------------------- панели ------------------------------- */
  function openModal(mode,data) {
    G.modalMode=mode; G.modalData=data||null;
    const box=$('modal'); if(!box) return;
    const title=$('modalTitle'), body=$('modalBody');
    if(!title||!body) return;
    const ch=G.char, html=[];
    const h=t=>{title.textContent=t;};
    const row=(a,b)=>'<div class="mrow"><b>'+a+'</b><span>'+b+'</span></div>';
    if(mode==='char'){
      h('Возжённый · '+ch.name);
      const st=ch.stats;
      html.push('<div class="charhead"><span class="bigicon">'+A2.CLASS(ch.classId).icon+'</span><div><b>'+A2.CLASS(ch.classId).ru+'</b><small>Уровень '+ch.level+' · '+ch.xp+'/'+A2.xpNext(ch.level)+' XP</small></div></div>');
      html.push(row('Здоровье',Math.round(ch.hp)+' / '+st.maxHp),row('Ресурс',A2.CLASS(ch.classId).res),
        row('Урон',A2.fmt(st.dmg)),row('Броня',st.armor),row('Крит',st.critPct.toFixed(1)+'% / +'+Math.round(st.critDmg*100)+'%'),
        row('Скорость атаки','+'+(st.haste*100).toFixed(1)+'%'),row('Снижение КД','+'+(st.cdr*100).toFixed(1)+'%'),
        row('Серебро',A2.fmt(ch.gold)),row('Убийств',ch.kills),row('DPS',A2.fmt(G.dps)),row('Реакций',G.reactions));
      html.push('<h4>Экипировка · '+A2.SLOTS.length+' слотов</h4>');
      A2.SLOTS.forEach(s=>{ const it=ch.equip[s.id]; html.push('<div class="item '+A2.RARITY(it?it.rarity:'common').id+'"><b>'+s.icon+' '+(it?A2.RPG.itemName(it):'пусто')+'</b><span>'+(it?'Сила '+A2.RPG.itemPower(it)+' · ур. '+it.ilvl:'—')+'</span></div>'); });
      const sets=A2.RPG.setBonus(ch); if(sets.length) html.push('<h4>Сеты</h4>'+sets.map(s=>row(s.ru+' '+s.pieces+'/'+A2.SETS.find(x=>x.ru===s.ru).pieces,s.bonus)).join(''));
      html.push('<div class="btnrow"><button data-act="talents">Таланты ('+ch.talentPoints+')</button><button data-act="forge">Кузница</button></div>');
    } else if(mode==='bag'){
      h('Сумка · '+ch.inventory.length+' / 40');
      if(!ch.inventory.length) html.push('<p class="empty">Пока пусто. Гринд мобов — и появится.</p>');
      ch.inventory.forEach((it,i)=>{
        const r=A2.RARITY(it.rarity);
        html.push('<div class="item '+r.id+'" data-i="'+i+'"><b>'+r.abbr+' '+A2.RPG.itemName(it)+'</b><span>'+it.ilvl+' ур · сила '+A2.RPG.itemPower(it)+' · '+it.affixes.length+' свойств</span><div class="acts"><button data-act="equip" data-i="'+i+'">Надеть</button><button data-act="salvage" data-i="'+i+'">Разобрать</button></div></div>');
      });
    } else if(mode==='quests'){
      h('Кодекс Завета · квесты');
      const active=A2.RPG.activeQuests(G);
      html.push('<h4>Активные ('+active.length+')</h4>');
      active.forEach(q=>{ const st=ch.quests[q.id]; html.push('<div class="quest"><b>'+q.ru+'</b><span>'+q.text+'</span><div class="qbar"><i style="width:'+Math.min(100,st.progress/q.need*100)+'%"></i></div><small>'+st.progress+' / '+q.need+' · +'+q.xp+' XP · +'+q.gold+' S</small></div>'); });
      html.push('<h4>Цепочка · 12 глав</h4>');
      A2.QUESTS.forEach((q,i)=>{ const st=ch.quests[q.id];
        html.push(row((i+1)+'. '+q.ru,st&&st.done?'✓ сдан':st&&st.active?'в работе':'не открыт')); });
      html.push('<h4>Репутация</h4>');
      A2.ZONES.forEach(z=>html.push(row(z.ru,ch.rep[z.id]||0)));
    } else if(mode==='chat'){
      h('Чат · '+(G.net.state==='online'?'ОНЛАЙН':'офлайн-мир'));
      html.push('<div class="chatbox" id="modalChat"></div>');
      G.logLines.slice(-24).forEach(l=>html.push('<div class="chat-line" style="color:'+l.color+'">'+l.text+'</div>'));
      html.push('<div class="btnrow"><input id="modalChatInput" placeholder="Сообщение…"><button data-act="say">Отправить</button></div>');
      html.push('<p class="note">Каналы: локальный / глобальный / торговый / группа. В офлайне отвечают союзники-призраки.</p>');
    } else if(mode==='party'){
      h('Группа · '+(G.net.state==='online'?'онлайн':'призраки'));
      const list=G.net.ghosts.length?G.net.ghosts:Array.from(G.net.players.values());
      html.push('<div class="party">');
      html.push('<div class="item"><b>'+ch.name+' · '+A2.CLASS(ch.classId).ru+'</b><span>ур. '+ch.level+' · лидер · DPS '+A2.fmt(G.dps)+'</span></div>');
      list.forEach(e=>html.push('<div class="item"><b>'+e.name+' · '+A2.CLASS(e.classId).ru+'</b><span>ур. '+e.level+' · '+(e.ghost?'союзник-призрак':'игрок')+'</span></div>'));
      html.push('</div><p class="note">При подключении к серверу призраки заменяются реальными игроками. Группа до 5, рейд до 8 — канон docs/03.</p>');
      html.push('<h4>Подключение к серверу</h4><div class="btnrow"><input id="serverInput" placeholder="wss://your-server.example/ws"><button data-act="connect">Подключиться</button></div>');
    } else if(mode==='codex'){
      h('Кодекс Возжённого');
      html.push('<h4>6 классов канона</h4>');
      A2.CLASSES.forEach(c=>html.push(row(c.icon+' '+c.ru+' / '+c.en,c.role+' · '+c.res+' · дальность '+c.range)));
      html.push('<h4>Зоны</h4>');
      A2.ZONES.forEach(z=>html.push(row(z.ru,'ур. '+z.lv[0]+'–'+z.lv[1]+' · '+z.desc)));
      html.push('<h4>Редкости</h4>');
      A2.RARITIES.forEach(r=>html.push(row(r.ru,'×'+r.mult.toFixed(2)+' · '+r.aff+' свойств · шанс '+(r.weight*100).toFixed(1)+'%')));
      html.push('<h4>Реакции канона</h4>');
      Object.keys(A2.REACTIONS).forEach(k=>html.push(row(k,A2.REACTIONS[k].ru+' ×'+A2.REACTIONS[k].coeff.toFixed(2))));
      html.push('<p class="note">P3: 0 силовых SKU. P1: вес каждого удара. P2: мир помнит каждый след.</p>');
    } else if(mode==='settings'){
      h('Настройки');
      html.push('<label class="check"><input type="checkbox" data-set="motion" '+(G.settings.motion?'checked':'')+'> Тряска и частицы</label>');
      html.push('<label class="check"><input type="checkbox" data-set="sound" '+(G.settings.sound?'checked':'')+'> Звук</label>');
      html.push('<label class="check"><input type="checkbox" data-set="vibration" '+(G.settings.vibration?'checked':'')+'> Вибрация</label>');
      html.push('<h4>Камера</h4>'+row('Зум',G.cam.zoom.toFixed(2))+row('Поворот',[0,90,180,270][G.cam.orient]+'°'));
      html.push('<div class="btnrow"><button data-act="reset">Новый персонаж</button><button data-act="save">Сохранить</button></div>');
      html.push('<p class="note">G2.0 · '+CANON_SOURCE+' · '+(G.net?G.net.status().state:'offline')+' · 30 Гц тик / 60 Гц рендер</p>');
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
      html.push('<p class="note">Шанс заточки из data/canon.json, потолок +12. Перековка тратит Осколок Разлома или 400 S.</p>');
    } else if(mode==='shop'){
      h('Торговля · '+A2.fmt(ch.gold)+' S');
      if(!G.shopStock) G.shopStock=[A2.RPG.rollItem(ch.level,G.world.id,{rarity:'rare'}),A2.RPG.rollItem(ch.level,G.world.id,{rarity:'epic'}),A2.RPG.rollItem(ch.level,G.world.id,{})];
      G.shopStock.forEach((it,i)=>html.push('<div class="item '+A2.RARITY(it.rarity).id+'"><b>'+A2.RPG.itemName(it)+'</b><span>'+it.price+' S · сила '+A2.RPG.itemPower(it)+'</span><button data-act="buy" data-i="'+i+'">Купить</button></div>'));
    }
    body.innerHTML=html.join('');
    box.classList.remove('hidden');
    body.onclick = modalClick;   // перезаписываем, чтобы обработчик не копился при каждом открытии
  }
  function closeModal(){ const b=$('modal'); if(b) b.classList.add('hidden'); G.modalMode=null; }
  function modalClick(ev) {
    const el=ev.target; if(!el||!el.getAttribute) return;
    const act=el.getAttribute('data-act'); if(!act) return;
    const i=parseInt(el.getAttribute('data-i')||'0',10), s=el.getAttribute('data-s'), b=el.getAttribute('data-b');
    const ch=G.char;
    switch(act){
      case 'equip': A2.RPG.equip(G,ch.inventory[i]); openModal('bag'); break;
      case 'salvage': A2.RPG.salvage(G,ch.inventory[i]); openModal('bag'); break;
      case 'buy': { const it=G.shopStock&&G.shopStock[i]; if(it&&A2.RPG.buy(G,it)){ G.shopStock.splice(i,1); G.toast('Куплено',1.5); openModal('shop'); } else G.toast('Не хватает Серебра',1.5); break; }
      case 'enchant': if(A2.RPG.enchant(G,s)) openModal('forge'); else G.toast('Не хватает Серебра или +12 достигнут',2); break;
      case 'reroll': if(A2.RPG.reroll(G,s)) openModal('forge'); else G.toast('Нужен Осколок Разлома или 400 S',2); break;
      case 'talent': if(A2.RPG.talentUp(G,b)) openModal('talents'); else G.toast('Нет очков или ветка заполнена',1.5); break;
      case 'respec': if(A2.RPG.respec(G)){G.toast('Таланты сброшены',2);openModal('talents');} else G.toast('Нужно 500 S',1.5); break;
      case 'talents': openModal('talents'); break;
      case 'forge': openModal('forge'); break;
      case 'shop': openModal('shop'); break;
      case 'say': { const inp=$('modalChatInput'); if(inp&&inp.value){G.net.chat(inp.value.trim());inp.value='';openModal('chat');} break; }
      case 'connect': { const inp=$('serverInput'); if(inp&&inp.value){G.net.connect(inp.value.trim());G.toast('Подключение…',2);closeModal();} break; }
      case 'save': A2.RPG.save(G); G.toast('Сохранено',1.5); break;
      case 'reset': if(typeof localStorage!=='undefined'){try{localStorage.removeItem(C.SAVE_KEY);}catch(e){}} G.toast('Перезапустите страницу для нового героя',3); break;
      case 'dlg': {
        const o=G.modalOptions&&G.modalOptions[i]; if(!o) break;
        switch(o.action){
          case 'accept': A2.RPG.startQuest(G,o.payload); openModal('dialogue',G.modalData); break;
          case 'complete': A2.RPG.completeQuest(G,o.payload); openModal('dialogue',G.modalData); break;
          case 'heal': ch.hp=ch.stats.maxHp; G.toast('Исцеление Светоча',2); break;
          case 'forge': openModal('forge'); break;
          case 'shop': openModal('shop'); break;
          case 'salvage': { const it=ch.inventory[0]; if(it)A2.RPG.salvage(G,it); G.toast(it?'Разобрано: '+A2.RPG.itemName(it):'Сумка пуста',2); break; }
          case 'talents': openModal('talents'); break;
          case 'respec': G.toast(A2.RPG.respec(G)?'Таланты сброшены':'Нужно 500 S',2); break;
          case 'portal': { const p=G.world.portals[0]; if(p){setZone(p.to);closeModal();} break; }
          case 'map': G.toast('Лагеря отмечены на мини-карте',2); break;
          case 'gamble': { if(ch.gold>=800){ch.gold-=800;const it=A2.RPG.rollItem(ch.level,G.world.id,{rarity:'legendary'});ch.inventory.push(it);G.toast('Реликвия: '+A2.RPG.itemName(it),3);} else G.toast('Нужно 800 S',2); break; }
          case 'info': G.toast('Квест в работе',1.5); break;
        }
        break;
      }
    }
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
    // подбор лута
    for(const d of G.world.drops) if(d.t>0 && A2.dist(d.x,d.y,p.x,p.y)<ch.stats.pickup) A2.RPG.pickup(G,d);
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
    G.accum+=dt;
    let n=0; while(G.accum>=C.TICK && n<4){ step(C.TICK); G.accum-=C.TICK; n++; }
    if(G.world && G.char) A2.Render.frame(G.world,G,dt);
    G.uiT+=dt; if(G.uiT>0.12){G.uiT=0;updateUI();}
    if(typeof requestAnimationFrame==='function') requestAnimationFrame(frame);
  }

  function updateUI(force) {
    if(!G.char) return;
    const ch=G.char, cls=A2.CLASS(ch.classId), net=G.net?G.net.status():{state:'offline',count:0};
    const set=(id,v)=>{const e=$(id);if(e&&e.textContent!==undefined)e.textContent=v;};
    set('pName',ch.name); set('pLevel','ур. '+ch.level);
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
    const ult=$('btnUlt'); if(ult&&ult.classList) ult.classList.toggle('ready',ch.ult>=100);
    G.skillButtons.forEach((b,i)=>{
      if(!b||!b.querySelector) return;
      const name=cls.skills[i], left=(G.cooldowns[name]||0)-G.time, m=meta(name);
      const cd=b.querySelector('.cdlabel')||{textContent:''};
      if(left>0){ b.classList.add('cooling'); b.style&&b.style.setProperty('--cd',String(Math.min(100,left/m.cd*100))); }
      else b.classList.remove('cooling');
    });
    const mini=$('minimap'); if(mini&&G.world) A2.Render.minimap(G.world,G,mini);
    const ev=$('eventBanner'); if(ev){ const on=G.world&&G.world.eventActive; ev.classList&&ev.classList.toggle('show',!!on);
      if(on) ev.textContent='⚠ '+G.world.eventActive.ru+' · '+G.world.eventActive.killed+'/'+G.world.eventActive.need; }
    const toast=$('toast'); if(toast&&toast.classList){ toast.classList.toggle('show',G.time<G.toastUntil); }
    const hint=$('hint'); if(hint){ const npc=G.world?A2.World.npcAt(G.world,G.player.x,G.player.y,3.2):null;
      const p=G.world?A2.World.portalAt(G.world,G.player.x,G.player.y):null;
      const d=G.world?G.world.drops.find(dd=>A2.dist(dd.x,dd.y,G.player.x,G.player.y)<3.2):null;
      hint.textContent=npc?'✦ '+npc.ru+' · нажмите «Взаимодействие»':p?'◈ '+p.label+' · нажмите «Взаимодействие»':d?'✦ Добыча рядом · нажмите «Взаимодействие»':'';
      hint.classList.toggle('show',!!(npc||p||d)); }
  }

  /* ------------------------------ тестовый API ------------------------------ */
  window.ARKEON_G2 = {
    version:'G2.0', state:G,
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
