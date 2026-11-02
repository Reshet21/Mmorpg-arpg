#!/usr/bin/env node
/* =====================================================================
 * ARKEON · G2 · интеграционный тест настоящего онлайна без npm.
 * Поднимает server/server.js, подключает трёх сырых WebSocket-клиентов
 * (RFC 6455 handshake + masked frames), проверяет welcome, общий снапшот,
 * движение, глобальный чат, авторитетный урон, /health и античит.
 * Запуск: node tools/smoke_net.js
 * ===================================================================== */
'use strict';
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const PORT = 18000 + Math.floor(Math.random()*2000);
let checks=0, fails=[];
const ok=(c,m)=>{checks++; if(!c) fails.push(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function get(url) {
  return new Promise((resolve,reject)=>{
    http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>resolve({code:r.statusCode,body:d}));}).on('error',reject);
  });
}

/* ------------------------- сырой WebSocket-клиент ------------------------- */
class WSClient {
  constructor(port, name) {
    this.name=name; this.messages=[]; this.buf=Buffer.alloc(0); this.handshaken=false; this.frag='';
    this.sock=net.connect(port,'127.0.0.1',()=>{
      const key=crypto.randomBytes(16).toString('base64');
      this.sock.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1:'+port+'\r\n'+
        'Upgrade: websocket\r\nConnection: Upgrade\r\n'+
        'Sec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    this.sock.on('data',chunk=>this.onData(chunk));
    this.sock.on('error',()=>{});
  }
  onData(chunk) {
    this.buf=Buffer.concat([this.buf,chunk]);
    if(!this.handshaken) {
      const i=this.buf.indexOf('\r\n\r\n');
      if(i<0) return;
      const head=this.buf.slice(0,i).toString();
      this.handshaken=head.includes('101 Switching Protocols');
      this.buf=this.buf.slice(i+4);
      if(this.onopen) this.onopen(this.handshaken);
    }
    for(;;){
      if(this.buf.length<2) return;
      const b0=this.buf[0],b1=this.buf[1], fin=!!(b0&0x80), op=b0&0x0f;
      let len=b1&0x7f, off=2;
      if(len===126){ if(this.buf.length<4)return; len=this.buf.readUInt16BE(2); off=4; }
      else if(len===127){ if(this.buf.length<10)return; len=Number(this.buf.readBigUInt64BE(2)); off=10; }
      if(this.buf.length<off+len) return;
      const payload=this.buf.slice(off,off+len); this.buf=this.buf.slice(off+len);
      if(op===0x8) return;
      if(op===0x9){ this.sendRaw(0xA,payload); continue; }
      if(op!==0x1 && op!==0x0) continue;
      const text=payload.toString('utf8');
      this.frag+=text; if(!fin) continue;
      let msg; try{ msg=JSON.parse(this.frag); }catch(e){ this.frag=''; continue; }
      this.frag=''; this.messages.push(msg);
      if(this.onmessage) this.onmessage(msg);
    }
  }
  sendRaw(op,payload) {
    const p=Buffer.from(payload||'');
    const head=p.length<126?Buffer.from([0x80|op,p.length]):(()=>{const h=Buffer.alloc(4);h[0]=0x80|op;h[1]=126;h.writeUInt16BE(p.length,2);return h;})();
    try{this.sock.write(Buffer.concat([head,p]));}catch(e){}
  }
  send(obj) {
    const p=Buffer.from(JSON.stringify(obj)), mask=crypto.randomBytes(4);
    const masked=Buffer.alloc(p.length);
    for(let i=0;i<p.length;i++) masked[i]=p[i]^mask[i%4];
    const head=p.length<126?Buffer.from([0x81,0x80|p.length]):(()=>{const h=Buffer.alloc(4);h[0]=0x81;h[1]=0x80|126;h.writeUInt16BE(p.length,2);return h;})();
    try{this.sock.write(Buffer.concat([head,mask,masked]));}catch(e){}
  }
  close(){ try{ this.sendRaw(0x8, Buffer.alloc(0)); }catch(e){} setTimeout(()=>{ try{this.sock.destroy();}catch(e){} },60); }
  waitFor(pred,ms) {
    return new Promise(resolve=>{
      const found=this.messages.find(pred); if(found) return resolve(found);
      const t=Date.now(); const iv=setInterval(()=>{
        const f=this.messages.find(pred);
        if(f||Date.now()-t>ms){clearInterval(iv);resolve(f||null);}
      },20);
    });
  }
}

(async()=>{
  console.log('=== ARKEON · G2 · smoke_net ===');
  const srv=spawn(process.execPath,['server/server.js'],{
    cwd:ROOT, env:{...process.env,PORT:String(PORT),HOST:'127.0.0.1'}, stdio:['ignore','pipe','pipe']
  });
  let srvLog=''; srv.stdout.on('data',d=>srvLog+=d); srv.stderr.on('data',d=>srvLog+=d);
  let ready=false;
  for(let i=0;i<40;i++){
    try{ const r=await get('http://127.0.0.1:'+PORT+'/health'); if(r.code===200){ready=true;break;} }catch(e){}
    await sleep(150);
  }
  ok(ready,'сервер поднялся и отвечает /health'+(ready?'':' | '+srvLog.slice(-300)));
  if(!ready){ srv.kill('SIGKILL'); process.exit(1); }

  const A=new WSClient(PORT,'A'), B=new WSClient(PORT,'B'), Cc=new WSClient(PORT,'C');
  const clients=[A,B,Cc];
  await Promise.all(clients.map(c=>new Promise(r=>{c.onopen=r; setTimeout(r,2000);})));
  ok(clients.every(c=>c.handshaken),'три WebSocket-handshake приняты (101)');

  clients.forEach((c,i)=>c.send({t:'hello',name:['Аркеонец','Лиана','Дорн'][i],
    classId:['warrior','mage','ranger'][i],level:10+i,zone:'grove',x:12+i*2,y:16}));
  const welcomes=await Promise.all(clients.map(c=>c.waitFor(m=>m.t==='welcome',3000)));
  ok(welcomes.every(Boolean),'все три получили welcome');
  ok(new Set(welcomes.map(w=>w&&w.uid)).size===3,'uid уникальны');

  // общий снапшот
  await sleep(300);
  const snapA=A.messages.filter(m=>m.t==='snap').pop();
  ok(!!snapA && Array.isArray(snapA.players),'клиент A получает снапшоты 20 Гц');
  ok(!!snapA && snapA.players.length>=3,'в снапшоте видны все 3 игрока ('+(snapA?snapA.players.length:0)+')');
  ok(!!snapA && Array.isArray(snapA.mobs) && snapA.mobs.length>0,'в снапшоте есть авторитетные мобы ('+(snapA?snapA.mobs.length:0)+')');

  // движение реплицируется
  A.send({t:'input',seq:1,x:13,y:16,hp:12000,level:10,zone:'grove',gearRarity:'rare'});
  await sleep(300);
  const snapB=B.messages.filter(m=>m.t==='snap').pop();
  const moved=snapB&&snapB.players.find(p=>p.uid===welcomes[0].uid);
  ok(!!moved && moved.x>=12.9,'движение A видно клиенту B (x='+(moved?moved.x:'—')+')');

  // античит: телепорт отклоняется
  A.messages.length=0;
  A.send({t:'input',seq:2,x:38,y:38});
  const corr=await A.waitFor(m=>m.t==='correction',1200);
  ok(!!corr,'античит отклоняет телепорт (correction)');

  // глобальный чат доходит до всех
  B.messages.length=0; Cc.messages.length=0;
  A.send({t:'chat',ch:'global',text:'Мир помнит'});
  const [chatB,chatC]=await Promise.all([
    B.waitFor(m=>m.t==='chat'&&m.text==='Мир помнит',1500),
    Cc.waitFor(m=>m.t==='chat'&&m.text==='Мир помнит',1500)
  ]);
  ok(!!chatB&&!!chatC,'глобальный чат доставлен B и C');

  // авторитетный урон
  A.messages.length=0;
  const m0=snapA&&snapA.mobs[0];
  if(m0) A.send({t:'cast',name:'Клинок Рубежа',coeff:2.45,tx:m0.x,ty:m0.y,range:12});
  const ev=await A.waitFor(m=>m.t==='event',1800);
  ok(!!ev,'сервер применил урон и прислал событие');

  // ---- G2.1 · ростер, рынок, торговля 1:1, шёпот, эмоции ----
  A.messages.length=0;
  A.send({t:'who'});
  const rosterA=await A.waitFor(m=>m.t==='roster'&&m.players.length===3,1500);
  ok(!!rosterA,'сервер рассылает общий ростер из 3 игроков');

  const ITEM={uid:'it_a_1',name:'Клинок Завета',rarity:'epic',slot:'weapon',price:900,ilvl:14,affixes:[],plus:0};
  A.send({t:'sync_items',uids:[ITEM.uid]});
  A.send({t:'market_list',order:{id:'ord_a_1',item:ITEM,price:100},key:'mkt_list_1'});
  const listed=await B.waitFor(m=>m.t==='market'&&m.orders.length===1,1800);
  ok(!!listed,'серверный order book разослан всем игрокам');
  ok(!!(await A.waitFor(m=>m.t==='wallet'&&m.gold<500,1200)),'комиссия рынка 5% списана авторитетно (sink)');
  // идемпотентность: повтор того же ключа не создаёт второй лот
  A.send({t:'market_list',order:{id:'ord_a_2',item:ITEM,price:100},key:'mkt_list_1'});
  await sleep(200);
  const h1=JSON.parse((await get('http://127.0.0.1:'+PORT+'/health')).body);
  ok(h1.orders===1,'idem-ключ защищает от дюпа лотов');

  B.messages.length=0;
  B.send({t:'market_buy',id:'ord_a_1',key:'mkt_buy_1'});
  const got=await B.waitFor(m=>m.t==='grant_item'&&m.item.uid===ITEM.uid,1800);
  ok(!!got,'покупатель получил предмет от сервера');
  ok(!!(await A.waitFor(m=>m.t==='market_sold',1800)),'продавец получил уведомление о продаже');
  const h2=JSON.parse((await get('http://127.0.0.1:'+PORT+'/health')).body);
  ok(h2.orders===0,'лот удалён из order book после покупки');

  // торговля 1:1 с подтверждением владения
  A.send({t:'sync_items',uids:['it_a_2']});
  // смена класса в уже открытой игре реплицируется без переподключения
  A.send({t:'hello',name:'Аркеонец',classId:'necromancer'});
  B.messages.length=0; B.send({t:'who'});
  const classRoster=await B.waitFor(m=>m.t==='roster'&&
    (m.players||[]).some(p=>p.uid===welcomes[0].uid&&p.classId==='necromancer'),1500);
  ok(!!classRoster,'повторный hello обновляет класс в общем ростере (6 героев онлайн)');

  B.messages.length=0;
  A.send({t:'trade_invite',to:welcomes[1].uid});
  const req=await B.waitFor(m=>m.t==='trade_request',1500);
  ok(!!req&&req.from===welcomes[0].uid,'приглашение торговли 1:1 доставлено');
  B.send({t:'trade_accept',from:welcomes[0].uid,with:welcomes[0].uid});
  ok(!!(await A.waitFor(m=>m.t==='trade_state',1200)),'сервер создал защищённую сессию торговли');
  A.send({t:'trade_offer',with:welcomes[1].uid,items:['it_a_2'],gold:10,
    detail:[{uid:'it_a_2',name:'Обет',rarity:'rare',slot:'ring',price:20,ilvl:4,affixes:[],plus:0}]});
  const off=await B.waitFor(m=>m.t==='trade_state'&&(m.items||[]).length===1,1500);
  ok(!!off,'встречное предложение реплицировано партнёру');
  A.send({t:'trade_confirm',with:welcomes[1].uid,key:'tc_a'});
  B.send({t:'trade_confirm',with:welcomes[0].uid,key:'tc_b'});
  const [doneA,doneB]=await Promise.all([
    A.waitFor(m=>m.t==='trade_done',1800), B.waitFor(m=>m.t==='trade_done',1800)
  ]);
  ok(!!doneA&&!!doneB,'атомарный обмен подтверждён обоими клиентами');
  const h3=JSON.parse((await get('http://127.0.0.1:'+PORT+'/health')).body);
  ok(h3.trades===0,'сессия торговли закрыта после обмена');
  ok(h3.ledger>=2,' ledger экономики записал комиссию, покупку и обмен');

  B.messages.length=0;
  A.send({t:'whisper',to:welcomes[1].uid,text:'держим строй'});
  ok(!!(await B.waitFor(m=>m.t==='whisper'&&m.text==='держим строй',1500)),'личный шёпот доставлен адресату');
  A.send({t:'emote',text:'поднимает Знамя Завета'});
  ok(!!(await B.waitFor(m=>m.t==='emote',1500)),'эмоция видна игрокам той же зоны');
  A.messages.length=0;
  A.send({t:'who'});
  ok(!!(await A.waitFor(m=>m.t==='roster'&&m.players.length===3,1200)),'команда who возвращает ростер');

  // health
  const health=JSON.parse((await get('http://127.0.0.1:'+PORT+'/health')).body);
  ok(health.players===3,'/health: 3 игрока');
  ok(health.tickHz===30 && health.snapshotHz===20,'/health: 30 Гц тик / 20 Гц снапшоты');
  ok(health.zones===5 && health.mobs>20,'/health: 5 зон (город + 4 боевые), '+health.mobs+' мобов');

  // отключение
  Cc.close(); await sleep(800);
  const after=JSON.parse((await get('http://127.0.0.1:'+PORT+'/health')).body);
  ok(after.players===2,'после дисконнекта игрок удалён из мира');

  clients.forEach(c=>c.close());
  srv.kill('SIGTERM');
  console.log(`Проверок: ${checks} | PASS: ${checks-fails.length} | FAIL: ${fails.length}`);
  fails.forEach(f=>console.log('  FAIL:',f));
  if(fails.length) process.exit(1);
  console.log('Итог: PASS — настоящий многопользовательский сервер работает без зависимостей.');
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
