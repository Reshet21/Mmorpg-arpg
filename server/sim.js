/* =====================================================================
 * ARKEON · G2 · server/sim.js
 * Авторитетный мир: 30 Гц тик, 20 Гц дельта-снапшоты, AOI 120 м,
 * 4 зоны, общие мобы и боссы, валидация ввода (античит), кулдауны,
 * лут с владельцем, чат (локальный/глобальный/торговый/группа),
 * группа до 5, идемпотентность, реконсиляция HP, до 200 игроков.
 * Переиспользует mobile/js/data.js и world.js через vm — сервер и клиент
 * живут на одном каноне. Зависимостей нет, только stdlib Node.
 * ===================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function loadCanon() {
  const sandbox = { window:{}, Math, JSON, Set, Map, console, Date,
    performance:{ now:()=>Date.now() }, localStorage:undefined };
  vm.createContext(sandbox);
  for (const f of ['mobile/js/data.js','mobile/js/world.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, { filename:f });
  }
  return sandbox.window.A2;
}
const A2 = loadCanon();
const C = A2.C;

const TICK_MS = 1000/30, SNAP_MS = 1000/20;
const worlds = new Map();
const players = new Map();
const parties = new Map();      // leaderUid -> [uids]
const orders = new Map();       // общий order book рынка
const issued = new Set();       // uid предметов, уже выставленных (антидюп)
const trades = new Map();       // сессии торговли 1:1
const seenKeys = new Set();     // идемпотентность операций
const ledger = [];
const events = [];
let uidSeq = 0, lastTick = Date.now(), snapAcc = 0;

for (let i=0;i<A2.ZONES.length;i++) {
  const z=A2.ZONES[i];
  worlds.set(z.id, A2.World.create(z.id, 1337 + i*7717));
}

function log(text) { events.push({t:Date.now(),text}); if(events.length>60) events.shift(); }

function addPlayer(ws, hello) {
  const uid = 'p' + (++uidSeq).toString(36) + Date.now().toString(36).slice(-4);
  const zone = worlds.has(hello.zone) ? hello.zone : 'grove';
  const p = {
    uid, ws, name:String(hello.name||'Возжённый').slice(0,16),
    classId:A2.CLASS(hello.classId).id, level:A2.clamp(parseInt(hello.level,10)||1,1,60),
    zone, x:A2.clamp(Number(hello.x)||12,2,C.ZONE_N-3), y:A2.clamp(Number(hello.y)||16,2,C.ZONE_N-3),
    hp:12000, maxHp:12000, gearRarity:'rare', seq:0, lastAt:Date.now(),
    cds:{}, lastInput:null, party:null, muted:false, ping:0,
    gold:A2.clamp(parseInt(hello.gold,10)||500,0,1e12),
    items:new Set((Array.isArray(hello.itemUids)?hello.itemUids:[]).map(String))
  };
  players.set(uid,p);
  log(p.name+' вошёл в '+A2.ZONE(zone).ru);
  return p;
}
function removePlayer(uid) {
  const p=players.get(uid); if(!p) return;
  players.delete(uid);
  for(const k of Array.from(parties.keys())) {
    const arr=parties.get(k).filter(u=>u!==uid);
    if(arr.length<2 || k===uid) parties.delete(k); else parties.set(k,arr);
  }
  log(p.name+' покинул мир');
  broadcastRoster();
  broadcast({t:'chat',ch:'local',name:'СЕРВЕР',text:p.name+' покинул мир',color:'#9db0bd'});
}

function send(ws,obj) {
  if(!ws || ws.destroyed || !ws.write) return;
  let payload;
  try { payload=Buffer.from(JSON.stringify(obj)); } catch(e){ return; }
  let head;
  if(payload.length<126) { head=Buffer.from([0x81,payload.length]); }
  else if(payload.length<65536) { head=Buffer.alloc(4); head[0]=0x81; head[1]=126; head.writeUInt16BE(payload.length,2); }
  else { head=Buffer.alloc(10); head[0]=0x81; head[1]=127; head.writeBigUInt64BE(BigInt(payload.length),2); }
  try { ws.write(Buffer.concat([head,payload])); } catch(e){}
}
function broadcast(obj, except) {
  for(const p of players.values()) if(p.uid!==except) send(p.ws,obj);
}
function sendTo(uid,obj){ const p=players.get(uid); if(p) send(p.ws,obj); }

function zonePlayers(zone) { return Array.from(players.values()).filter(p=>p.zone===zone); }

function publicPlayer(p) {
  return { uid:p.uid,name:p.name,classId:p.classId,level:p.level,x:+p.x.toFixed(2),y:+p.y.toFixed(2),
    hp:Math.round(p.hp),maxHp:p.maxHp,zone:p.zone,gearRarity:p.gearRarity };
}
function roster() { return Array.from(players.values()).map(publicPlayer); }
function broadcastRoster() { broadcast({t:'roster',players:roster()}); }
function broadcastMarket() { broadcast({t:'market',orders:Array.from(orders.values())}); }
function syncInitial(p) {
  send(p.ws,{t:'wallet',gold:p.gold});
  send(p.ws,{t:'market',orders:Array.from(orders.values())});
  broadcastRoster();
}
function idempotent(k) {
  if(!k) return true;              // без ключа разрешаем (старые клиенты)
  if(seenKeys.has(k)) return false;
  seenKeys.add(k);
  if(seenKeys.size>4000) seenKeys.clear();
  return true;
}
function tradeKey(a,b) { return [a,b].sort().join('|'); }
function tradeSession(p,msg) {
  const other=msg.with || msg.from || (msg.to);
  const tk=tradeKey(p.uid,other);
  return { tk, s:trades.get(tk) };
}
function marketFee(price) { return Math.max(1,Math.ceil(price*0.05)); }
function record(type,amount,text) {
  ledger.push({t:Date.now(),type,amount,text});
  if(ledger.length>500) ledger.shift();
}

/* ------------------------- обработка сообщений ------------------------- */
function handle(p, msg) {
  if(!p || !msg || typeof msg!=='object') return;
  switch(msg.t) {
    case 'hello': {
      // Повторный hello приходит при выборе другого класса в уже открытой игре:
      // обновляем только представление (имя/класс), НЕ кошелёк и не уровень —
      // сервер остаётся авторитетным по прогрессии и Серебру.
      if(msg.name) p.name=String(msg.name).slice(0,16);
      if(msg.classId) p.classId=A2.CLASS(msg.classId).id;
      send(p.ws,{t:'welcome',uid:p.uid,zone:p.zone,players:zonePlayers(p.zone).map(publicPlayer)});
      broadcastRoster();
      break;
    }
    case 'input': {
      const seq=Number(msg.seq)||0;
      if(seq<=p.seq) return;                     // идемпотентность / защита от реплея
      const nx=Number(msg.x), ny=Number(msg.y);
      if(!Number.isFinite(nx)||!Number.isFinite(ny)) return;
      const dt=Math.max(0.016,(Date.now()-p.lastAt)/1000);
      const d=Math.hypot(nx-p.x,ny-p.y);
      if(d>6.2*dt+0.9) {                         // античит: телепорт/спидхак
        send(p.ws,{t:'correction',x:+p.x.toFixed(2),y:+p.y.toFixed(2),reason:'speed'});
        return;
      }
      const W=worlds.get(p.zone);
      if(!A2.World.canMove(W,A2.clamp(nx,0,C.ZONE_N),A2.clamp(ny,0,C.ZONE_N))) {
        send(p.ws,{t:'correction',x:+p.x.toFixed(2),y:+p.y.toFixed(2),reason:'collision'});
        return;
      }
      p.x=A2.clamp(nx,2,C.ZONE_N-3); p.y=A2.clamp(ny,2,C.ZONE_N-3);
      p.seq=seq; p.lastAt=Date.now(); p.lastInput=msg;
      if(Number.isFinite(msg.level)) p.level=A2.clamp(parseInt(msg.level,10),1,60);
      if(msg.zone && msg.zone!==p.zone && worlds.has(msg.zone)) p.zone=msg.zone;
      if(msg.gearRarity) p.gearRarity=String(msg.gearRarity).slice(0,20);
      if(Number.isFinite(msg.hp)) p.hp=A2.clamp(Number(msg.hp),0,p.maxHp);
      break;
    }
    case 'cast': {
      const now=Date.now(), name=String(msg.name||'basic').slice(0,40);
      const cd=p.cds[name]||0;
      if(now<cd) return;                          // серверный кулдаун
      p.cds[name]=now+350;
      const W=worlds.get(p.zone);
      const range=msg.range?Number(msg.range):3.4;
      const tx=Number(msg.tx), ty=Number(msg.ty);
      const cx=Number.isFinite(tx)?tx:p.x, cy=Number.isFinite(ty)?ty:p.y;
      const dmg=Math.round(18000*(1+p.level*0.05)*(Number(msg.coeff)||1));
      let hits=0;
      for(const m of W.mobs) {
        if(!m.alive || A2.dist(m.x,m.y,cx,cy)>range) continue;
        m.hp-=dmg; m.hitFlash=1; hits++;
        if(m.hp<=0) {
          A2.World.kill(W,m);
          log(p.name+' поверг '+(m.nameOverride||m.ru));
          send(p.ws,{t:'event',text:'† '+(m.nameOverride||m.ru)+' · +'+m.xp+' XP',color:'#8fd08a'});
          // лут с владельцем на 30 с
          W.drops.push({uid:'srv'+Math.random().toString(36).slice(2,8),x:m.x,y:m.y,t:W.time,
            item:{rarity:m.boss?'legendary':m.elite?'epic':'rare'},gold:m.gold,owner:p.uid,ownerUntil:W.time+30});
        }
      }
      if(hits) send(p.ws,{t:'event',text:'✦ '+name+' · '+hits+' целей'});
      break;
    }
    case 'chat': {
      const text=String(msg.text||'').slice(0,180).replace(/[<>]/g,'');
      if(!text) return;
      const ch=['local','global','trade','party'].includes(msg.ch)?msg.ch:'local';
      const m={t:'chat',ch,name:p.name,text,color:'#e9efed'};
      if(ch==='party' && p.party) { for(const u of parties.get(p.party)||[]) sendTo(u,m); }
      else if(ch==='local') { for(const q of zonePlayers(p.zone)) send(q.ws,m); }
      else broadcast(m);
      break;
    }
    case 'party': {
      const act=msg.act, target=String(msg.target||'');
      if(act==='invite' && players.has(target)) {
        sendTo(target,{t:'party',act:'invite',from:p.uid,name:p.name});
        send(p.ws,{t:'event',text:'Приглашение отправлено: '+players.get(target).name});
      } else if(act==='accept') {
        const from=String(msg.from||'');
        if(!players.has(from)) return;
        let arr=parties.get(from)||[from];
        if(arr.length>=5) { send(p.ws,{t:'event',text:'Группа полна (5)'}); return; }
        if(!arr.includes(p.uid)) arr.push(p.uid);
        parties.set(from,arr); p.party=from;
        for(const u of arr) sendTo(u,{t:'party',members:arr.map(u=>publicPlayer(players.get(u)).name)});
        log('Группа: '+arr.length+' игрока');
      } else if(act==='leave') {
        for(const k of Array.from(parties.keys())) {
          const arr=parties.get(k).filter(u=>u!==p.uid);
          if(arr.length<2) parties.delete(k); else parties.set(k,arr);
        }
        p.party=null;
      }
      break;
    }
    /* ------------------------------ рынок ------------------------------ */
    case 'market_list': {
      const o=msg.order;
      if(!o || !o.item || !o.item.uid || !Number.isFinite(o.price)) return;
      if(!idempotent(msg.key)) return;
      const uid=String(o.item.uid);
      if(!p.items.has(uid) || issued.has(uid)) { send(p.ws,{t:'event',text:'Предмет уже выставлен или не ваш'}); return; }
      const price=A2.clamp(Math.round(o.price),1,1e9);
      const fee=marketFee(price);
      if(p.gold<fee) { send(p.ws,{t:'event',text:'Не хватает Серебра на комиссию 5%'}); return; }
      p.gold-=fee; p.items.delete(uid); issued.add(uid);
      const order={ id:o.id||('srv_'+Math.random().toString(36).slice(2,10)), sellerUid:p.uid,
        sellerName:p.name, item:o.item, price, ts:Date.now(), ghost:false };
      orders.set(order.id,order);
      record('fee',-fee,'Комиссия рынка от '+p.name);
      send(p.ws,{t:'wallet',gold:p.gold});
      send(p.ws,{t:'event',text:'Лот выставлен: '+(o.item.name||'предмет')});
      log(p.name+' выставил лот за '+price+' S');
      broadcastMarket(); break;
    }
    case 'market_buy': {
      const id=String(msg.id||''), o=orders.get(id);
      if(!o || o.sellerUid===p.uid) return;
      if(!idempotent(msg.key)) return;
      if(p.gold<o.price) { send(p.ws,{t:'event',text:'Не хватает Серебра'}); return; }
      const seller=players.get(o.sellerUid);
      const fee=marketFee(o.price);
      p.gold-=o.price;
      if(seller) seller.gold+=o.price-fee;
      p.items.add(String(o.item.uid)); issued.delete(String(o.item.uid));
      orders.delete(id);
      send(p.ws,{t:'grant_item',item:o.item});
      send(p.ws,{t:'wallet',gold:p.gold});
      if(seller) { send(seller.ws,{t:'wallet',gold:seller.gold});
        send(seller.ws,{t:'market_sold',by:p.name,gold:o.price-fee,item:o.item.name}); }
      record('trade_market',o.price,p.name+' купил у '+(seller?seller.name:'рынка'));
      log('Рынок: '+p.name+' купил лот за '+o.price+' S');
      broadcastMarket(); break;
    }
    case 'market_cancel': {
      const id=String(msg.id||''), o=orders.get(id);
      if(!o || o.sellerUid!==p.uid) return;
      if(!idempotent(msg.key)) return;
      orders.delete(id); issued.delete(String(o.item.uid)); p.items.add(String(o.item.uid));
      send(p.ws,{t:'grant_item',item:o.item});
      broadcastMarket(); break;
    }
    /* ---------------------------- торговля 1:1 ---------------------------- */
    case 'trade_invite': {
      const q=players.get(String(msg.to||'')); if(!q) return;
      send(q.ws,{t:'trade_request',from:p.uid,name:p.name});
      send(p.ws,{t:'event',text:'Приглашение отправлено: '+q.name}); break;
    }
    case 'trade_accept': {
      const q=players.get(String(msg.from||'')); if(!q) return;
      const tk=tradeKey(p.uid,q.uid);
      const s={ a:p.uid, b:q.uid, offers:{}, confirms:{} };
      s.offers[p.uid]={uids:[],items:[],gold:0}; s.offers[q.uid]={uids:[],items:[],gold:0};
      trades.set(tk,s);
      for(const uid of [p.uid,q.uid]) sendTo(uid,{t:'trade_state',items:[],gold:0,confirm:false,with:uid===p.uid?q.uid:p.uid});
      log('Торговля: '+p.name+' и '+q.name); break;
    }
    case 'trade_offer': {
      const peerUid=String(msg.with||'');
      const tk=tradeKey(p.uid,peerUid), s=trades.get(tk); if(!s) return;
      const uids=(Array.isArray(msg.items)?msg.items:[]).map(String).slice(0,6);
      for(const u of uids) if(!p.items.has(u)) { send(p.ws,{t:'event',text:'Предмет не принадлежит вам'}); return; }
      const gold=A2.clamp(Math.round(Number(msg.gold)||0),0,Math.max(0,p.gold));
      if(!Number.isFinite(gold)) return;
      const items=Array.isArray(msg.detail)?msg.detail:uids.map(u=>({uid:u,name:'Предмет',rarity:'rare',slot:'ring',price:10,ilvl:1,affixes:[],plus:0}));
      s.offers[p.uid]={uids,items,gold}; s.confirms[p.uid]=false;
      const q=players.get(peerUid);
      if(q) send(q.ws,{t:'trade_state',items,gold,confirm:false});
      send(p.ws,{t:'event',text:'Предложение передано'}); break;
    }
    case 'trade_confirm': {
      const peerUid=String(msg.with||'');
      const tk=tradeKey(p.uid,peerUid), s=trades.get(tk); if(!s) return;
      s.confirms[p.uid]=true;
      const q=players.get(peerUid);
      if(q) send(q.ws,{t:'trade_state',items:s.offers[p.uid].items,gold:s.offers[p.uid].gold,confirm:true});
      if(!s.confirms[peerUid]) return;
      // атомарный обмен: проверяем владение ещё раз
      const A=players.get(s.a), B=players.get(s.b); if(!A||!B) { trades.delete(tk); return; }
      const oa=s.offers[s.a], ob=s.offers[s.b];
      for(const u of oa.uids) if(!A.items.has(u)) { trades.delete(tk); return; }
      for(const u of ob.uids) if(!B.items.has(u)) { trades.delete(tk); return; }
      A.gold=A.gold-oa.gold+ob.gold; B.gold=B.gold-ob.gold+oa.gold;
      for(const u of oa.uids) { A.items.delete(u); B.items.add(u); }
      for(const u of ob.uids) { B.items.delete(u); A.items.add(u); }
      send(A.ws,{t:'trade_done',items:ob.items,gold:A.gold});
      send(B.ws,{t:'trade_done',items:oa.items,gold:B.gold});
      send(A.ws,{t:'wallet',gold:A.gold}); send(B.ws,{t:'wallet',gold:B.gold});
      record('trade_p2p',oa.gold-ob.gold,'Обмен '+A.name+' ↔ '+B.name);
      log('Обмен завершён: '+A.name+' ↔ '+B.name);
      trades.delete(tk); break;
    }
    case 'trade_cancel': {
      const peerUid=String(msg.with||'');
      const tk=tradeKey(p.uid,peerUid);
      if(trades.has(tk)) trades.delete(tk);
      if(players.has(peerUid)) sendTo(peerUid,{t:'trade_cancel'});
      break;
    }
    /* ------------------------------ социал ------------------------------ */
    case 'whisper': {
      const text=String(msg.text||'').slice(0,180).replace(/[<>]/g,'');
      const to=String(msg.to||'');
      let q=players.get(to);
      if(!q) q=Array.from(players.values()).find(x=>x.name.toLowerCase()===to.toLowerCase());
      if(!q || !text) return;
      const m={t:'whisper',name:p.name,text,from:p.uid};
      send(q.ws,m); send(p.ws,{t:'whisper',name:'→ '+q.name,text,from:q.uid}); break;
    }
    case 'emote': {
      const text=String(msg.text||'машет рукой').slice(0,60).replace(/[<>]/g,'');
      for(const q of zonePlayers(p.zone)) send(q.ws,{t:'emote',name:p.name,text});
      break;
    }
    case 'who': send(p.ws,{t:'roster',players:roster()}); break;
    case 'pingmap': {
      for(const q of zonePlayers(p.zone)) send(q.ws,{t:'event',text:'◈ '+p.name+' отметил точку на карте'});
      break;
    }
    case 'sync_items': {
      // Реестр предметов, сгенерированных клиентом: запрещаем чужие и уже
      // выставленные uid, ограничиваем пакет. Сервер остаётся авторитетным
      // по владению и Серебру, поэтому дубликат не проходит в рынок/торговлю.
      if(Array.isArray(msg.uids)) msg.uids.slice(0,120).forEach(raw=>{
        const u=String(raw||'').slice(0,48);
        if(!u || issued.has(u)) return;
        for(const q of players.values()) if(q.uid!==p.uid && q.items.has(u)) return;
        p.items.add(u);
      });
      break;
    }
    case 'ping': send(p.ws,{t:'pong',ts:msg.ts}); break;
  }
}

/* --------------------------------- тик --------------------------------- */
function tick(dt) {
  for(const [zone,W] of worlds) {
    const ps=zonePlayers(zone).map(p=>({uid:p.uid,x:p.x,y:p.y,dead:p.hp<=0}));
    A2.World.update(W,dt,ps,{
      onMobHit:(m,tgt,dmg)=>{
        const p=players.get(tgt&&tgt.uid); if(!p) return;
        p.hp=Math.round(p.hp-dmg*0.35);
        if(p.hp<=0){ p.hp=p.maxHp; p.x=12; p.y=16; send(p.ws,{t:'event',text:'Возрождение у Светоча'}); }
      },
      onTelegraph:(m,tg)=>{
        for(const p of zonePlayers(zone)) if(A2.dist(p.x,p.y,tg.x,tg.y)<tg.radius) {
          p.hp=Math.max(0,Math.round(p.hp-m.dmg*0.8));
          if(p.hp<=0){ p.hp=p.maxHp; p.x=12; p.y=16; send(p.ws,{t:'event',text:'Возрождение у Светоча'}); }
        }
      },
      onPhase:(m,ph)=>{ for(const p of zonePlayers(zone)) send(p.ws,{t:'event',text:'ФАЗА '+ph+' · '+m.nameOverride}); },
      onRespawn:()=>{}
    });
  }
  // регенерация и дропы с истёкшим владельцем
  for(const p of players.values()) p.hp=Math.min(p.maxHp,p.hp+Math.round(p.maxHp*0.006));
  for(const W of worlds.values()) for(const d of W.drops) if(d.ownerUntil && W.time>d.ownerUntil) d.owner=null;
}

function snapshots() {
  for(const p of players.values()) {
    const W=worlds.get(p.zone);
    const near=zonePlayers(p.zone).filter(q=>A2.dist(q.x,q.y,p.x,p.y)<40).map(publicPlayer);
    const mobs=W.mobs.filter(m=>m.alive && A2.dist(m.x,m.y,p.x,p.y)<26)
      .map(m=>({uid:String(m.uid),id:m.id,x:+m.x.toFixed(2),y:+m.y.toFixed(2),hp:Math.round(m.hp),maxHp:m.maxHp,lvl:m.lvl}));
    const ev=events.filter(e=>e.t>Date.now()-1500).map(e=>e.text).slice(-3);
    send(p.ws,{t:'snap',tick:Date.now(),players:near,mobs,events:ev,serverTime:Date.now()});
  }
}

function start() {
  let acc=0, snap=0, last=Date.now();
  const timer=setInterval(()=>{
    const now=Date.now(), dt=Math.min(0.1,(now-last)/1000); last=now;
    acc+=dt; snap+=dt;
    let n=0; while(acc>=C.TICK && n<4){ tick(C.TICK); acc-=C.TICK; n++; }
    if(snap>=C.SNAPSHOT){ snap=0; snapshots(); }
  },16);
  timer.unref && timer.unref();
  return timer;
}

function stats() {
  return { version:'G2.1', tickHz:30, snapshotHz:20, aoi:C.AOI,
    players:players.size, zones:worlds.size,
    mobs:Array.from(worlds.values()).reduce((a,W)=>a+W.mobs.filter(m=>m.alive).length,0),
    parties:parties.size, orders:orders.size, trades:trades.size, ledger:ledger.length,
    uptime:Math.round((Date.now()-lastTick)/1000),
    canon:'data.js + world.js (vm)', maxPlayers:C.MAX_PLAYERS };
}

module.exports = { A2, worlds, players, orders, trades, ledger, addPlayer, removePlayer, handle, start, stats, send, broadcast, broadcastRoster, broadcastMarket, syncInitial, roster, log };
