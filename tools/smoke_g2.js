#!/usr/bin/env node
/* =====================================================================
 * ARKEON · G2 · headless smoke-тест без браузера (Node + vm).
 * Запуск: node tools/smoke_g2.js
 * Проверяет: загрузку 6 модулей, процедурный мир, детализированный рендер
 * на заглушке Canvas, 6 классов, гринд/лут/уровни/экипировку, 12 квестов,
 * НПС, смену зон, навыки/додж/ультимейт, офлайн-призраков и реальный
 * сетевой контур через поддельный WebSocket, источник канона, сохранение.
 * ===================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['data.js','world.js','rpg.js','render.js','net.js','audio.js','market.js','main.js']
  .map(f => path.join(ROOT,'mobile/js',f));
const CANON = JSON.parse(fs.readFileSync(path.join(ROOT,'data/classes.json'),'utf8'));

let checks=0, fails=[];
const ok=(c,m)=>{checks++; if(!c) fails.push(m);};

function makeEnv(useCanon) {
  const grad={addColorStop(){}};
  const ctxProxy=new Proxy({}, {
    get(t,k){
      if(k==='createLinearGradient'||k==='createRadialGradient') return ()=>grad;
      if(k==='measureText') return ()=>({width:12});
      if(k==='canvas') return canvas;
      if(k in t) return t[k];
      return ()=>{};
    },
    set(t,k,v){t[k]=v;return true;}
  });
  class FakeEl {
    constructor(id,tag){
      this.id=id||''; this.tagName=(tag||'div').toUpperCase(); this.dataset={}; this.children=[];
      this.checked=false; this.value=''; this._text=''; this._html=''; this._ev={};
      this.width=132; this.height=132;
      this.style={setProperty(){},removeProperty(){}};
      const set=new Set();
      this.classList={
        add:(...c)=>c.forEach(x=>set.add(x)), remove:(...c)=>c.forEach(x=>set.delete(x)),
        toggle:(c,f)=>{const on=f===undefined?!set.has(c):!!f; on?set.add(c):set.delete(c); return on;},
        contains:c=>set.has(c)
      };
    }
    addEventListener(t,fn){this._ev[t]=fn;}
    appendChild(c){this.children.push(c);return c;}
    removeChild(c){const i=this.children.indexOf(c); if(i>=0)this.children.splice(i,1); return c;}
    setAttribute(k,v){this[k]=v;}
    getAttribute(k){return this[k]===undefined?null:this[k];}
    getBoundingClientRect(){return {left:0,top:0,width:132,height:132};}
    getContext(){return ctxProxy;}
    querySelector(sel){
      const cls=String(sel).replace('.','');
      return this.children.find(c=>c.className&&String(c.className).split(' ').includes(cls))||new FakeEl('q');
    }
    closest(){return null;}
    get textContent(){return this._text;} set textContent(v){this._text=String(v);}
    get innerHTML(){return this._html;} set innerHTML(v){this._html=String(v); if(v==='')this.children=[];}
  }
  const els=new Map();
  const el=id=>{if(!els.has(id))els.set(id,new FakeEl(id));return els.get(id);};
  const canvas=el('game');
  const cards=A2_CLASSES.map(id=>{const e=new FakeEl('card','button');e.dataset.class=id;e.className='class-card'+(id==='warrior'?' selected':'');return e;});
  const store={};
  const win={innerWidth:844,innerHeight:390,devicePixelRatio:2,addEventListener(){}};
  const doc={
    readyState:'complete', hidden:false, getElementById:el,
    createElement:(tag)=>new FakeEl('new',tag),
    querySelectorAll:sel=>sel==='.class-card'?cards:[],
    querySelector:sel=>sel==='.class-card.selected'?(cards.find(c=>c.classList.contains('selected'))||cards[0]):null,
    addEventListener(){}
  };
  class FakeWS {
    constructor(url){this.url=url;this.readyState=0;env.lastWS=this;}
    send(d){try{env.sent.push(JSON.parse(d));}catch(e){}}
    close(){this.readyState=3;if(this.onclose)this.onclose();}
    open(){this.readyState=1;if(this.onopen)this.onopen();}
    push(obj){if(this.onmessage)this.onmessage({data:JSON.stringify(obj)});}
  }
  const env={
    window:win, document:doc, navigator:{vibrate(){}},
    location:{protocol:'https:',search:''},
    localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
    performance:{now:()=>Date.now()},
    requestAnimationFrame:()=>0, setTimeout:()=>0, setInterval:()=>0,
    console, WebSocket:FakeWS,
    fetch: useCanon ? ()=>Promise.resolve({ok:true,json:()=>Promise.resolve(CANON)})
                    : ()=>Promise.reject(new Error('offline')),
    sent:[], lastWS:null
  };
  env.globalThis=env;
  env.cards=cards;
  return env;
}
const A2_CLASSES=['warrior','paladin','assassin','ranger','mage','necromancer'];

async function run(useCanon) {
  const env=makeEnv(useCanon);
  const ctx=vm.createContext(env);
  for(const f of FILES) vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:path.basename(f)});
  await new Promise(r=>setImmediate(r)); await new Promise(r=>setImmediate(r));
  const API=env.window.ARKEON_G2, A2=env.window.A2;
  ok(!!API,'window.ARKEON_G2 определён');
  if(!API) return;
  ok(API.version==='G2.3','версия G2.3');
  ok(API.source===(useCanon?'canon':'fallback'),'источник навыков: '+(useCanon?'canon':'fallback'));
  if(useCanon) {
    const m=API.meta('Клинок Рубежа');
    ok(Math.abs(m.coeff-2.45)<1e-6,'коэффициент навыка из канона classes.json');
  }
  const G=API.state;
  API.startGame();
  ok(G.mode==='playing','старт: режим playing');
  ok(G.char.classId==='warrior','класс по умолчанию: Воин');
  const intro=env.document.getElementById('modalBody').innerHTML;
  ok(G.modalMode==='prologue','после старта открывается кинематографичный пролог');
  ok(intro.indexOf('НАЧАТЬ ПРОЛОГ')>=0 && intro.indexOf('Пристань Завета')>=0,
     'пролог содержит лор города и кнопку начала');

  // ---- G2.3 · ГОРОД, ПРОЛОГ И ПОСТЕПЕННАЯ ЭКИПИРОВКА ----
  const HW=G.world;
  ok(HW.id==='haven','стартовый мир — безопасный город Пристань Завета');
  ok(HW.safe===true,'город помечен как safe-зона');
  ok(HW.camps.length===0 && HW.bossAlive===false,'в городе нет лагерей спавна и мирового босса');
  ok(HW.mobs.length===4 && HW.mobs.every(m=>m.ai==='dummy'),'в городе только 4 учебных манекена');
  ok(HW.mobs.every(m=>m.dmg===0 && m.aggro===0),'манекены не атакуют и не агрятся');
  ok(HW.eventTimer===Infinity,'Волны Разлома в городе отключены');
  ok(HW.npcs.length>=7,'в городе >=7 НПС ('+HW.npcs.length+')');
  ok(HW.props.length>=25,'рукотворная застройка: '+HW.props.length+' объектов');
  ok(HW.lights.length>=6,'город освещён фонарями: '+HW.lights.length);
  ok(HW.props.some(p=>p.kind==='house') && HW.props.some(p=>p.kind==='stall') &&
     HW.props.some(p=>p.kind==='statue') && HW.props.some(p=>p.kind==='lamp'),
     'есть дома, прилавки, статуя Светоча и фонари');
  ok(A2.World.isSafe(HW,20,23)===true,'isSafe(): центр города безопасен');
  ok(HW.portals.length===1 && HW.portals[0].to==='grove','из города один выход — в Рощу Завета');
  ok(!!HW.portals[0].arrival && HW.portals[0].arrival.x===A2.ZONE('grove').spawn[0],
     'портал знает точку прибытия в Рощу');
  ok(A2.STORY.length===9,'пролог состоит из 9 глав');
  ok(new Set(A2.STORY.map(c=>c.reward.slot)).size===8,'за главы выдаются все 8 слотов экипировки');
  ok(G.story.chapter===0 && G.story.done===false,'сюжет стартует с главы 1');
  ok(A2.RPG.storyChapter(G).id==='c1','первая глава — «Пробуждение»');
  ok(Object.values(G.char.equip).filter(Boolean).length===1,'на старте только оружие — остальное выдаётся квестами');
  ok(A2.RPG.questAvailable(G,A2.QUEST('q1'))===false,'12 глав Завета заперты до конца пролога');
  for(let i=0;i<20;i++) API.step(A2.C.TICK);
  ok(A2.World.mobsNear(HW,G.player.x,G.player.y,40).length===0,
     'до главы 5 манекены не являются целью: игра не начинается с боя');
  ok(G.char.kills===0,'на старте пролога нет убийств');
  const earlyRars=[];
  for(let i=0;i<30;i++) earlyRars.push(A2.RPG.dropItem(G,{x:20,y:23,lvl:1},1).item.rarity);
  ok(earlyRars.every(r=>r==='common'||r==='rare'),'в прологе редкость дропа ограничена обычной/редкой');
  HW.drops.length=0;
  let cityErr=null;
  try { for(let i=0;i<4;i++) API.render(1/60);
        A2.Render.minimap(HW,G,env.document.getElementById('minimap')); } catch(e){ cityErr=e; }
  ok(!cityErr,'рендер города и мини-карта без исключений'+(cityErr?': '+cityErr.message:''));
  // проходим 9 глав: разговор → площадь → двор → надевание → манекены → лут → кузница → продажа → ворота
  API.story({type:'talk',target:'eldara'});
  ok(G.story.chapter===1,'глава 1 завершается разговором с Эльдарой');
  ok(G.char.inventory.some(it=>it.questReward),'за главу выдана вещь экипировки');
  API.story({type:'talk',target:'borin'});
  API.story({type:'talk',target:'irina'});
  API.story({type:'talk',target:'irina'});
  ok(G.story.chapter===1 && G.story.progress===2,'знакомство считает только уникальных НПС');
  API.story({type:'talk',target:'veya'});
  ok(G.story.chapter===2,'глава 2 завершена после трёх жителей');
  G.player.x=28.5; G.player.y=28; API.step(A2.C.TICK);
  ok(G.story.chapter===3,'глава 3 завершается достижением учебного двора');
  const reward=G.char.inventory.find(it=>it.questReward);
  ok(A2.RPG.equip(G,reward)===true,'награда надевается через панель экипировки');
  ok(G.story.chapter===4,'глава 4 завершается надеванием предмета');
  ok(A2.RPG.storyChapter(G).objective.type==='kill','глава 5 — пробный удар по манекенам');
  API.step(A2.C.TICK);
  ok(HW.dummiesActive===true && A2.World.mobsNear(HW,28.5,28,3).length>0,
     'манекены становятся целью только в главе «Пробный удар»');
  HW.mobs.filter(m=>m.ai==='dummy').slice(0,3).forEach(m=>{
    m.alive=true; m.hp=m.maxHp;
    while(m.alive) A2.RPG.hit(G,m,50,'Физический');
  });
  ok(G.story.chapter===5,'глава 5 завершается тремя учебными манекенами');
  for(let i=0;i<3;i++){
    const it=A2.RPG.rollItem(5,'haven',{rarity:'common'});
    A2.RPG.pickup(G,{uid:'story'+i,x:20,y:23,t:HW.time+1,item:it,gold:0,owner:null,picked:false,magnet:0,rar:'common',spin:0});
  }
  ok(G.story.chapter===6,'глава 6 завершается подбором трёх предметов');
  ok(A2.RPG.enchant(G,'weapon')===true,'заточка доступна на награде главы');
  ok(G.story.chapter===7,'глава 7 завершается заточкой');
  let junk=G.char.inventory.find(it=>!it.questReward);
  if(!junk){ junk=A2.RPG.rollItem(5,'haven',{rarity:'common'}); G.char.inventory.push(junk); }
  ok(A2.RPG.sell(G,junk)===true,'продажа лишней вещи работает');
  ok(G.story.chapter===8,'глава 8 завершается продажей/выставлением');
  API.story({type:'gate',target:'grove'});
  ok(G.story.done===true && G.story.chapter===9,'глава 9 завершает АКТ I');
  ok(A2.RPG.questAvailable(G,A2.QUEST('q1'))===true,'после пролога открыта цепочка из 12 квестов');
  ok(G.char.inventory.filter(it=>it.questReward).length>=8,'за пролог выдано >=8 вещей экипировки');
  const enterWild=()=>{ API.setZone('grove',12,16); API.skipStory(); };
  enterWild();
  ok(A2.World.isSafe(G.world,5.5,5.5)===true,'у входа в Рощу есть безопасная дозорная тропа');
  ok(A2.World.isSafe(G.world,20,20)===false,'в глубине Рощи мобы уже агрессивны');

  // ---- данные канона ----
  ok(A2.CLASSES.length===6,'6 классов канона');
  ok(A2.ZONES.length===5,'5 зон: безопасный город + 4 боевые');
  ok(A2.QUESTS.length===12,'12 квестов');
  ok(A2.NPCS.length>=8,'НПС: '+A2.NPCS.length);
  ok(A2.MOBS.length>=10,'типов мобов: '+A2.MOBS.length);
  ok(A2.RARITIES.length===6,'6 редкостей');
  ok(A2.SLOTS.length===8,'8 слотов экипировки');
  ok(A2.TALENTS.reduce((a,b)=>a+b.nodes.length,0)===18,'18 узлов талантов');
  ok(A2.REACTIONS['Огонь+Лёд'].ru==='Пар','реакции названы по канону');

  // ---- мир ----
  const W=G.world;
  ok(W.mobs.length>=25,'в зоне >=25 мобов ('+W.mobs.length+')');
  ok(W.props.length>=100,'процедурных объектов >=100 ('+W.props.length+')');
  ok(W.npcs.length>=2,'НПС в зоне: '+W.npcs.length);
  ok(W.portals.length>=1,'порталы: '+W.portals.length);
  ok(W.lights.length>=1,'источники динамического света: '+W.lights.length);
  ok(W.bossAlive===true,'мировой босс жив');
  ok(W.camps.length>=6,'лагерей спавна: '+W.camps.length);

  // ---- рендер ----
  let rerr=null;
  try { for(let i=0;i<6;i++) API.render(1/60); } catch(e){rerr=e;}
  ok(!rerr,'детализированный рендер без исключений'+(rerr?': '+rerr.message:''));
  const iso=A2.Render.iso(10,10,0,1);
  ok(Number.isFinite(iso[0])&&Number.isFinite(iso[1]),'изометрическая проекция конечна');
  ok(!!A2.Render.makeGround(W,1),'тайлграунд процедурно отрисован и закэширован');

  // ---- симуляция ----
  let serr=null;
  try { for(let i=0;i<120;i++) API.step(A2.C.TICK); } catch(e){serr=e;}
  ok(!serr,'120 тиков симуляции без исключений'+(serr?': '+serr.message:''));
  ok(G.time>=3.9,'время симуляции >=3.9 с');
  ok(Number.isFinite(G.player.x)&&Number.isFinite(G.player.y)&&Number.isFinite(G.char.hp),'нет NaN в состоянии');
  ok(Number.isFinite(G.dps),'DPS конечен');

  // ---- гринд ----
  const before={kills:G.char.kills,xp:G.char.xp,gold:G.char.gold};
  API.spawnMobs(16);
  const mobs=A2.World.mobsNear(W,G.player.x,G.player.y,40).filter(m=>m.alive);
  for(const m of mobs.slice(0,16)) A2.RPG.hit(G,m,50,'Физический');
  ok(G.char.kills>before.kills,'убийства засчитаны: '+G.char.kills);
  ok(G.char.xp+G.char.level*1000>before.xp,'опыт начислен');
  G.settings.lootFilter='all';
  A2.RPG.dropItem(G,{x:G.player.x+0.4,y:G.player.y+0.4,lvl:5},3);
  ok(W.drops.length>=3,'дроп появился в мире: '+W.drops.length);
  for(let i=0;i<10;i++) API.step(A2.C.TICK);
  ok(G.char.inventory.length>0,'лут автоматически подобран: '+G.char.inventory.length+' предметов');

  // ---- G2.1 · ВЫБОР ВСЕХ 6 КЛАССОВ (главный баг прошлого билда) ----
  for(const cid of A2_CLASSES){
    env.cards.forEach(c=>c.classList.toggle('selected', c.dataset.class===cid));
    API.startGame();
    ok(G.char.classId===cid,'выбор класса доступен: '+cid);
  }
  env.cards.forEach(c=>c.classList.toggle('selected', c.dataset.class==='warrior'));
  API.startGame();
  ok(G.char.classId==='warrior','возврат к Воину после выбора других классов');
  enterWild();   // каждый startGame() создаёт новый прolog в городе

  // ---- G2.1 · ЗВУК ----
  ok(!!A2.Audio && typeof A2.Audio.play==='function','модуль A2.Audio подключён');
  ok(Object.keys(A2.Audio.BANK).length>=24,'процедурная библиотека SFX: '+Object.keys(A2.Audio.BANK).length);
  ok(typeof A2.Audio.loot==='function' && typeof A2.Audio.ambient==='function',
     'лутовые арпеджио по редкости и амбиент 5 биомов');
  ok(A2.Audio.state().ctx===false,'в Node без WebAudio модуль безопасно молчит (нет исключений)');
  ok(typeof G.onHit==='function' && typeof G.onKill==='function' && typeof G.onLevel==='function',
     'звуковые хуки боя/уровня привязаны к симуляции');
  ok(G.settings.sound===true && G.settings.lootFilter==='all','настройки звука и фильтра лута на месте');

  // ---- G2.1 · ИНВЕНТАРЬ / ЛУТ ----
  ok(typeof A2.RPG.sell==='function','продажа предмета торговцу реализована');
  G.settings.lootFilter='legendary';
  ok(A2.RPG.autoPickupAllowed(G,{rarity:'common'})===false,'фильтр лута оставляет обычное на земле');
  ok(A2.RPG.autoPickupAllowed(G,{rarity:'legendary'})===true,'фильтр лута подбирает легендарное');
  G.settings.lootFilter='all';
  const ground={uid:'dg1',x:G.player.x,y:G.player.y,t:G.world.time,item:null,gold:25,owner:null};
  const g0=G.char.gold; G.world.drops.push(ground); A2.RPG.pickup(G,ground);
  ok(G.char.gold>g0,'Серебро с земли подбирается');
  const dItem=A2.RPG.dropItem(G,{x:G.player.x,y:G.player.y,lvl:20},1,{x:G.player.x,y:G.player.y});
  ok(dItem && dItem.item && !!dItem.rar,'у каждого моба падает видимый предмет с редкостью');
  ok(G.market.newItems>=0,'счётчик новых предметов рынка');

  // ---- G2.1 · РЫНОК ----
  const M=G.market;
  ok(M.orders.length>=14,'офлайн-рынок: '+M.orders.length+' лотов от союзников');
  ok(M.fee(1000)===50,'комиссия рынка 5% (sink, без P2W)');
  const lit=A2.RPG.rollItem(20,'grove',{rarity:'epic'});
  G.char.inventory.push(lit);
  const nLots=M.orders.length, nBag=G.char.inventory.length;
  ok(M.list(lit,1200)===true,'выставление предмета на рынок');
  ok(M.orders.length===nLots+1 && G.char.inventory.length===nBag-1,'лот создан, предмет списан из сумки');
  G.char.gold=999999;
  const ghostLot=M.orders.find(o=>o.ghost && !o.mine);
  ok(M.buy(ghostLot.id)===true,'покупка лота у союзника-призрака');
  ok(M.orders.indexOf(ghostLot)<0,'купленный лот удалён из order book');
  const own=M.orders[M.orders.length-1];
  ok(M.cancel(own.id)===true,'снятие собственного лота возвращает предмет');
  ok(M.filtered().length>0,'фильтры рынка возвращают список лотов');
  M.filter.rarity='mythic'; ok(Array.isArray(M.filtered()),'фильтр по редкости не ломает рынок'); M.filter.rarity='all';

  // ---- G2.1 · ТОРГОВЛЯ 1:1 ----
  ok(M.tradeInvite('ghost_7','Лиана')===true,'торговля 1:1: приглашение');
  ok(M.trade.their.items.length===1,'призрак делает встречное предложение');
  M.tradeSetOffer([],10);
  ok(M.tradeConfirm()===true,'обмен с призраком завершён без исключений');
  ok(M.trade.active===false,'сессия торговли закрыта после обмена');

  // ---- G2.1 · МОДАЛЬНЫЕ ПАНЕЛИ ----
  let merr=null;
  try { ['bag','item','filters','market','trade','players','player','char','quests','chat','party','codex','settings','talents','forge','shop','equip','slot']
    .forEach(md=>API.openModal(md,md==='item'?0:md==='slot'?'weapon':null)); } catch(e){ merr=e; }
  ok(!merr,'все 18 панелей открываются без исключений'+(merr?': '+merr.message:''));
  API.closeModal();

  // ---- G2.2 · ИНВЕНТАРЬ, СНАРЯЖЕНИЕ, МАГНИТ ЛУТА, ПЕРФОРМАНС ----
  ok(G.settings.lootFilter==='all','G2.2: по умолчанию подбирается ВСЬ лут, а не только редкий');
  ok(G.settings.autoSalvage===true,'G2.2: авторазбор обычного при полной сумке');
  ok(typeof A2.RPG.magnetLoot==='function' && typeof A2.RPG.collectNearby==='function',
     'G2.2: магнит лута и «забрать всё» реализованы');
  ok(typeof A2.RPG.unequip==='function' && typeof A2.RPG.equipBest==='function',
     'G2.2: снять предмет и надеть лучшее реализованы');
  ok(typeof G.net.flushItems==='function','G2.2: реестр предметов досылается троттлингом, без спама в WS');
  ok(A2.Render.setQuality!==undefined,'G2.2: адаптивное качество рендера доступно');

  const body=env.document.getElementById('modalBody');
  API.openModal('equip');
  ok(body.innerHTML.indexOf('data-act="slot"')>=0,'G2.2: панель снаряжения показывает 8 кликабельных слотов');
  ok(body.innerHTML.indexOf('equipBest')>=0,'G2.2: кнопка «Надеть лучшее» на месте');
  API.openModal('bag');
  ok(body.innerHTML.indexOf('data-act="pickAll"')>=0 && body.innerHTML.indexOf('goequip')>=0,
     'G2.2: из сумки есть доступ к снаряжению и сбору лута');
  API.openModal('slot','weapon');
  ok(body.innerHTML.indexOf('data-act="unequip"')>=0 || body.innerHTML.indexOf('В сумке')>=0,
     'G2.2: слот показывает надетое и подходящие предметы');
  API.closeModal();

  // дроп никогда не оказывается в стене
  const edge=A2.RPG.dropItem(G,{x:1,y:1,lvl:20},1,{x:1,y:1});
  ok(A2.World.canMove(G.world,edge.x,edge.y),'G2.2: дроп создаётся в проходимой точке');
  edge.picked=true; edge.t=-999;

  // вещь, упавшая далеко, притягивается и подбирается
  G.char.inventory.length=0;
  const farItem=A2.RPG.rollItem(20,'grove',{rarity:'rare'});
  const far={uid:'far1',x:G.player.x+7.6,y:G.player.y,t:G.world.time+1,item:farItem,gold:0,owner:null,picked:false,magnet:0,rar:'rare',spin:0};
  G.world.drops.push(far);
  const d0=A2.dist(far.x,far.y,G.player.x,G.player.y);
  for(let i=0;i<150;i++) A2.RPG.magnetLoot(G,1/30);
  ok(d0>6,'G2.2: тестовый дроп действительно далеко ('+d0.toFixed(1)+')');
  ok(far.picked===true && G.char.inventory.indexOf(farItem)>=0,
     'G2.2: далёкий лут притягивается магнитом и подбирается');

  // «Забрать всё» собирает несколько вещей за один тап
  const many=[];
  for(let i=0;i<4;i++){
    const it=A2.RPG.rollItem(20,'grove',{rarity:'common'});
    G.world.drops.push({uid:'many'+i,x:G.player.x+3+i*0.3,y:G.player.y+1,t:G.world.time+1,item:it,gold:0,owner:null,picked:false,magnet:0,rar:'common',spin:0});
    many.push(it);
  }
  const gotN=A2.RPG.collectNearby(G,7.5);
  ok(gotN>=4 && many.every(it=>G.char.inventory.indexOf(it)>=0),'G2.2: «Забрать всё» поднимает все вещи рядом ('+gotN+')');

  // полная сумка больше не блокирует лут
  G.char.inventory.length=0;
  for(let i=0;i<40;i++) G.char.inventory.push(A2.RPG.rollItem(5,'grove',{rarity:'common'}));
  const overflow=A2.RPG.rollItem(20,'grove',{rarity:'epic'});
  const od={uid:'ov1',x:G.player.x,y:G.player.y,t:G.world.time+1,item:overflow,gold:0,owner:null,picked:false,magnet:0,rar:'epic',spin:0};
  ok(A2.RPG.pickup(G,od)===true,'G2.2: полная сумка не теряет лут (авторазбор)');
  ok(G.char.inventory.indexOf(overflow)>=0 && G.char.inventory.length<=40,
     'G2.2: новый предмет в сумке, лимит 40 соблюдён');

  // снять / надеть лучшее
  G.char.inventory.length=0;
  const strong=A2.RPG.rollItem(40,'rift',{rarity:'legendary',slot:'weapon'});
  G.char.inventory.push(strong);
  const beforeW=G.char.equip.weapon?A2.RPG.itemPower(G.char.equip.weapon):0;
  const nBest=A2.RPG.equipBest(G);
  ok(nBest>=1 && A2.RPG.itemPower(G.char.equip.weapon)>beforeW,'G2.2: «Надеть лучшее» повышает силу оружия');
  ok(A2.RPG.unequip(G,'weapon')===true && G.char.equip.weapon===null,
     'G2.2: предмет снимается обратно в сумку');

  // экономный режим не ломает рендер и мини-карту
  let qerr=null;
  try { A2.Render.setQuality('low');
    for(let i=0;i<3;i++){ API.render(1/60); }
    A2.Render.minimap(G.world,G,env.document.getElementById('minimap'));
    A2.Render.setQuality('high'); API.render(1/60);
  } catch(e){ qerr=e; }
  ok(!qerr,'G2.2: экономный режим и кэш мини-карты работают без исключений'+(qerr?': '+qerr.message:''));
  ok(A2.Render.quality==='high','G2.2: качество возвращается в полный режим');

  // ---- G2.2 · РЕАЛЬНЫЕ КЛИКИ ПО КНОПКАМ ПАНЕЛЕЙ ----
  const fakeEl=(act,attrs)=>({ getAttribute:k=>k==='data-act'?act:(attrs&&Object.prototype.hasOwnProperty.call(attrs,k)?attrs[k]:null) });
  const clickAct=(act,attrs)=>env.document.getElementById('modalBody').onclick({target:fakeEl(act,attrs||{})});
  let cerr2=null;
  try {
    API.openModal('bag');       clickAct('goequip');
    ok(G.modalMode==='equip','G2.2: клик «Снаряжение» из сумки открывает панель');
    clickAct('slot',{'data-s':'weapon'});
    ok(G.modalMode==='slot','G2.2: клик по слоту открывает список предметов');
    clickAct('equipBest');      clickAct('pickAll');
    API.openModal('settings');  clickAct('quality',{'data-v':'low'});
    ok(G.settings.quality==='low' && A2.Render.quality==='low','G2.2: переключатель качества применяется');
    clickAct('quality',{'data-v':'high'});
    ok(A2.Render.quality==='high','G2.2: полный режим возвращается');
    clickAct('quality',{'data-v':'auto'});
    API.openModal('equip');     clickAct('enchantAll'); clickAct('salvageCommon');
    API.openModal('char');      clickAct('gochar');
  } catch(e){ cerr2=e; }
  ok(!cerr2,'G2.2: все действия панелей отрабатывают без исключений'+(cerr2?': '+cerr2.message:''));
  API.closeModal();

  // ---- G2.1 · ДЕТАЛИЗАЦИЯ РЕНДЕРА ----
  let derr=null;
  try { for(let i=0;i<4;i++){ G.world.drops.push({uid:'dr'+i,x:12+i,y:16,t:G.world.time,
      item:A2.RPG.rollItem(20,'grove',{rarity:'legendary'}),gold:0,owner:null,rar:'legendary',spin:i});
      G.corpses.push({x:12+i,y:16,kind:'wraith',color:'#7a4a3a',life:1,max:1,scale:1});
      API.render(1/60); } } catch(e){ derr=e; }
  ok(!derr,'рендер лучей лута, трупов, воды и объёмных лучей без исключений'+(derr?': '+derr.message:''));

  // ---- уровни, экипировка, кузница ----
  const lv=G.char.level;
  API.giveXP(30000);
  ok(G.char.level>lv,'уровень вырос: '+lv+' → '+G.char.level);
  ok(G.char.talentPoints>0,'очки талантов начислены');
  ok(A2.RPG.talentUp(G,'steel'),'вложение очка таланта');
  // Фиксируем чистое состояние: предыдущие тесты уже примеряли предметы,
  // поэтому сравнивать «стало больше» с произвольным надетым нельзя.
  for(const k of Object.keys(G.char.equip)) G.char.equip[k]=null;
  A2.RPG.recompute(G.char);
  const it=A2.RPG.rollItem(30,'rift',{rarity:'legendary',slot:'weapon'});
  const p0=G.char.stats.power;
  G.char.inventory.push(it);
  ok(A2.RPG.equip(G,it),'экипировка предмета');
  ok(G.char.stats.power>p0,'сила пересчитана после надевания');
  ok(A2.RPG.enchant(G,'weapon'),'заточка +1');
  ok(G.char.equip.weapon.plus===1,'предмет получил +1');
  ok(A2.RPG.reroll(G,'weapon'),'перековка аффиксов');
  const bag=G.char.inventory.length;
  ok(A2.RPG.salvage(G,G.char.inventory[0])===true||bag===0,'разбор предмета');

  // ---- редкости и аффиксы ----
  const seen=new Set(); let affOK=true;
  for(let i=0;i<1600;i++){ const x=A2.RPG.rollItem(40,'rift'); seen.add(x.rarity);
    if(x.affixes.length!==A2.RARITY(x.rarity).aff) affOK=false; }
  ok(seen.size>=5,'выпало >=5 из 6 редкостей ('+seen.size+')');
  ok(affOK,'число аффиксов соответствует редкости');

  // ---- квесты и НПС ----
  ok(A2.RPG.startQuest(G,'q1'),'квест q1 принят');
  A2.RPG.questProgress(G,'kill','pepelnik',8);
  ok(G.char.quests.q1.progress>=8,'прогресс квеста 8/8');
  const gold0=G.char.gold, xp0=G.char.xp;
  ok(A2.RPG.completeQuest(G,'q1'),'квест сдан');
  ok(G.char.gold>gold0||G.char.xp!==xp0,'награда квеста начислена');
  ok(G.char.quests.q1.done===true,'квест помечен завершённым');
  ok(A2.RPG.questAvailable(G,A2.QUEST('q2')),'открыта следующая глава цепочки');
  const dlg=A2.RPG.dialogue(G,W.npcs[0]);
  ok(dlg.options.length>0,'диалог НПС содержит варианты: '+dlg.options.length);

  // ---- навыки ----
  let cerr=null;
  try { for(let i=0;i<6;i++){G.char.res=100; API.cast(i);} } catch(e){cerr=e;}
  ok(!cerr,'все 6 навыков кастуются без ошибок'+(cerr?': '+cerr.message:''));
  G.char.dodgeCharges=2;
  ok(API.dodge(1,0)===true,'додж выполнен');
  ok(G.player.iframe>0.29,'додж даёт 0.30 с i-frames');
  G.char.ult=100;
  ok(API.useUlt()===true,'ультимейт при 100% Заряда Искры');
  ok(G.char.ult===0,'заряд Искры сброшен');

  // ---- смена зоны ----
  API.setZone('ash',10,10);
  ok(G.world.id==='ash','переход в Пепельную пустошь');
  ok(G.world.mobs.length>=25,'новая зона заселена мобами');
  ok(!!A2.Render.makeGround(G.world,1),'граунд новой зоны перегенерирован');
  let zerr=null; try{API.render(1/60);}catch(e){zerr=e;}
  ok(!zerr,'рендер после смены зоны без ошибок'+(zerr?': '+zerr.message:''));

  // ---- офлайн-онлайн ----
  const net=G.net;
  ok(net.status().state==='offline','по умолчанию офлайн-мир');
  ok(net.status().count>=4,'союзники-призраки: '+net.status().count);
  net.chat('проверка чата');
  ok(net.chatLog.length>0,'чат работает в офлайне');
  net.connect('wss://test.local/ws');
  ok(!!env.lastWS,'WebSocket-соединение создано');
  env.lastWS.open();
  ok(env.sent.some(m=>m.t==='hello'),'клиент отправил hello');
  env.lastWS.push({t:'welcome',uid:'me_local',zone:'ash',players:[{uid:'me_local',name:'Я',level:10}]});
  ok(net.status().state==='online','статус: онлайн');
  ok(net.ghosts.length===0,'призраки заменены реальными игроками');
  env.lastWS.push({t:'snap',tick:1,players:[
    {uid:'me_local',name:'Я',classId:'warrior',level:10,x:10,y:10,hp:12000,maxHp:12000,zone:'ash',gearRarity:'rare'},
    {uid:'p_server',name:'Серверный',classId:'mage',level:10,x:12,y:12,hp:9000,maxHp:12000,zone:'ash',gearRarity:'epic'},
    {uid:'p_other',name:'Лиана',classId:'ranger',level:14,x:14,y:12,hp:11000,maxHp:12000,zone:'ash',gearRarity:'rare'}
  ],mobs:[],events:[]});
  ok(net.players.size===2,'два удалённых игрока в снапшоте');
  net.update(0.05);
  const remote=Array.from(net.players.values()).find(p=>p.uid==='p_other');
  ok(!!remote && Number.isFinite(remote.x) && Number.isFinite(remote.y),'интерполяция удалённых игроков');
  env.lastWS.push({t:'chat',ch:'global',name:'Лиана',text:'держу фланг',color:'#4fd6d0'});
  ok(net.chatLog.some(c=>c.text==='держу фланг'),'сетевой чат доставлен');
  net.disconnect();
  ok(net.status().state==='offline','после дисконнекта офлайн-мир восстановлен');

  // ---- сохранение ----
  A2.RPG.save(G);
  const saved=A2.RPG.load();
  ok(!!saved && saved.level===G.char.level && saved.zone===G.world.id,'сохранение/загрузка профиля');

  // ---- авто-подключение к своему серверу / отказ на Pages ----
  env.localStorage.removeItem('arkeon_server');
  env.location.host='myserver.example'; env.location.protocol='https:';
  const auto=G.net.autoConnect();
  ok(auto===true && env.lastWS && env.lastWS.url==='wss://myserver.example/ws',
     'авто-подключение к серверу того же origin');
  G.net.disconnect();
  env.localStorage.removeItem('arkeon_server');
  env.location.host='reshet21.github.io';
  ok(G.net.autoConnect()===false,'на GitHub Pages остаётся честный офлайн-мир');

  // ---- финальная устойчивость ----
  let ferr=null;
  try{ for(let i=0;i<150;i++){API.step(A2.C.TICK); if(i%10===0)API.render(1/60);} }catch(e){ferr=e;}
  ok(!ferr,'150 тиков + рендер после всех операций'+(ferr?': '+ferr.message:''));
  ok(Number.isFinite(G.player.x)&&Number.isFinite(G.char.hp)&&Number.isFinite(G.dps),'финальное состояние без NaN');
}

(async()=>{
  console.log('=== ARKEON · G2 · smoke_g2 ===');
  await run(false);
  await run(true);
  console.log(`Проверок: ${checks} | PASS: ${checks-fails.length} | FAIL: ${fails.length}`);
  fails.forEach(f=>console.log('  FAIL:',f));
  if(fails.length) process.exit(1);
  console.log('Итог: PASS — мир, графика, гринд, квесты, НПС, сеть и канон работают.');
})();
