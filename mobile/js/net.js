/* =====================================================================
 * ARKEON · G2 · net.js
 * Сетевой слой: WebSocket-клиент авторитетного сервера (30 Гц тик,
 * 20 Гц снапшоты, AOI, предсказание своего движения, интерполяция
 * удалённых игроков, чат, группа, пинг, реконнект) + честный офлайн-режим
 * с союзниками-призраками, когда сервер недоступен (GitHub Pages).
 * ===================================================================== */
(function () {
  'use strict';
  const A2 = window.A2, C = A2.C;

  const GHOST_NAMES = ['Лиана','Корвин','Сэра','Дорн','Иветта','Рен','Мельхиор','Айра'];
  const GHOST_LINES = [
    'Держу левый фланг.', 'Элита на севере, не в одиночку.', 'У меня упал легендарный пояс.',
    'Волна идёт, собираемся у костра.', 'Кто прикроет каст?', 'Светоч ещё тёплый.',
    'Разлом шепчет снова.', 'Разобрал лишнее, теперь легче.'
  ];
  const GHOST_CLASSES = ['paladin','ranger','necromancer','assassin','mage','warrior'];

  function makeGhost(G, i) {
    const a = i * 1.7;
    return {
      uid:'ghost_'+i, name:GHOST_NAMES[i%GHOST_NAMES.length], classId:GHOST_CLASSES[i%GHOST_CLASSES.length],
      level:Math.max(1,Math.min(60,G.char.level + (i%3) - 1)),
      x:A2.clamp(G.player.x+Math.cos(a)*(3+i),2,C.ZONE_N-3),
      y:A2.clamp(G.player.y+Math.sin(a)*(3+i),2,C.ZONE_N-3),
      hp:12000, maxHp:12000, isRemote:true, ghost:true, moving:false, iframe:0,
      attackAnim:0, gearRarity:['rare','epic','common','legendary'][i%4],
      chatCd:8+i*5, wanderA:a, targetUid:null, atkCd:0
    };
  }

  function create(G) {
    const net = {
      state:'offline', url:'', ws:null, uid:null, ping:0, lastPong:0, retry:0,
      players:new Map(), buffer:new Map(), ghosts:[], chatLog:[], party:[],
      serverPlayers:0, tick:0, lastSend:0, seq:0, enabled:false
    };

    function setStatus(s) {
      net.state=s; G.onNet && G.onNet('status',s);
    }
    function urlFromEnv() {
      if (typeof location !== 'undefined' && location.search) {
        const m=/(?:^|[?&])server=([^&]+)/.exec(location.search);
        if(m) return decodeURIComponent(m[1]);
      }
      try { if(typeof localStorage!=='undefined') { const saved=localStorage.getItem('arkeon_server'); if(saved) return saved; } } catch(e){}
      // Если игру раздаёт сам authoritative-сервер (node server/server.js),
      // подключаемся к WS того же origin без ручного ввода адреса.
      if (typeof location !== 'undefined' && location.host && location.protocol) {
        const h = location.host.toLowerCase();
        if (h.endsWith('github.io') || h.includes('jsdelivr') || h.includes('e2b.app')) return '';
        return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      }
      return '';
    }

    function startGhosts() {
      net.ghosts=[];
      const n=4;
      for(let i=0;i<n;i++) net.ghosts.push(makeGhost(G,i));
      syncEntities();
      G.log('Офлайн-мир: '+n+' союзника-призрака сражаются рядом','#9db0bd');
      G.onNet && G.onNet('ghosts',n);
    }
    function syncEntities() {
      const own=G.player;
      G.entities=[own].concat(net.ghosts);
      for(const p of net.players.values()) if(!G.entities.includes(p)) G.entities.push(p);
    }

    function send(obj) {
      if(net.ws && net.ws.readyState===1) { try { net.ws.send(JSON.stringify(obj)); } catch(e){} }
    }
    function handle(msg) {
      switch(msg.t) {
        case 'welcome':
          net.uid=msg.uid; net.serverPlayers=msg.players.length;
          setStatus('online');
          net.ghosts=[]; syncEntities();
          G.log('ОНЛАЙН · '+msg.uid.slice(0,6)+' · игроков: '+msg.players.length,'#4fd6d0');
          if(msg.zone && msg.zone!==G.world.id) G.requestZone && G.requestZone(msg.zone);
          break;
        case 'snap':
          net.tick=msg.tick; net.serverPlayers=msg.players.length;
          const seen=new Set();
          for(const p of msg.players) {
            if(p.uid===net.uid) { if(p.hp!==undefined && G.char.hp>p.hp) G.char.hp=p.hp; continue; }
            seen.add(p.uid);
            let e=net.players.get(p.uid);
            if(!e) {
              e={uid:p.uid,name:p.name,classId:p.classId,level:p.level,x:p.x,y:p.y,
                hp:p.hp,maxHp:p.maxHp,isRemote:true,ghost:false,moving:false,iframe:0,
                attackAnim:0,gearRarity:p.gearRarity||'rare',prev:{x:p.x,y:p.y},next:{x:p.x,y:p.y},t:0};
              net.players.set(p.uid,e); syncEntities();
              G.log(p.name+' вошёл в мир','#4fd6d0');
            }
            e.prev={x:e.next.x,y:e.next.y}; e.next={x:p.x,y:p.y}; e.t=0;
            e.hp=p.hp; e.maxHp=p.maxHp; e.level=p.level; e.moving=Math.abs(p.x-e.prev.x)+Math.abs(p.y-e.prev.y)>0.01;
          }
          for(const uid of Array.from(net.players.keys())) if(!seen.has(uid)) {
            const e=net.players.get(uid); G.log(e.name+' покинул мир','#9db0bd'); net.players.delete(uid);
            const i=G.entities.indexOf(e); if(i>=0) G.entities.splice(i,1);
          }
          if(msg.mobs) for(const m of msg.mobs) {
            const local=G.world.mobs.find(x=>x && String(x.uid)===String(m.uid));
            if(local && local.alive) { local.x=m.x; local.y=m.y; if(m.hp!==undefined) local.hp=m.hp; }
          }
          if(msg.events) msg.events.forEach(ev=>G.onNet&&G.onNet('event',ev));
          break;
        case 'chat':
          net.chatLog.push({ch:msg.ch||'local',name:msg.name,text:msg.text,color:msg.color||'#e9efed'});
          if(net.chatLog.length>60) net.chatLog.shift();
          G.onChat && G.onChat(net.chatLog[net.chatLog.length-1]);
          break;
        case 'party':
          net.party=msg.members||[]; G.onNet&&G.onNet('party',net.party); break;
        case 'pong':
          net.ping=Math.round(performance.now()-msg.ts); break;
        case 'event':
          G.log('⚑ '+msg.text,'#f0d27a'); break;
      }
    }

    function connect(url) {
      const explicit = !!url;
      net.auto = !explicit;
      url=url||urlFromEnv();
      if(!url) { setStatus('offline'); startGhosts(); return false; }
      if(typeof WebSocket==='undefined') { setStatus('offline'); startGhosts(); return false; }
      try { if(typeof localStorage!=='undefined') localStorage.setItem('arkeon_server',url); } catch(e){}
      net.url=url; setStatus('connecting'); net.enabled=true;
      try {
        const ws=new WebSocket(url);
        net.ws=ws;
        ws.onopen=()=>{
          net.retry=0;
          send({t:'hello',name:G.char.name,classId:G.char.classId,level:G.char.level,zone:G.world.id,x:G.player.x,y:G.player.y});
          setInterval(()=>{ if(net.state==='online') send({t:'ping',ts:performance.now()}); },5000);
        };
        ws.onmessage=ev=>{ try{ handle(JSON.parse(ev.data)); }catch(e){} };
        ws.onclose=()=>{
          if(net.state!=='offline') { setStatus('offline'); G.log('Связь потеряна. Офлайн-мир восстановлен.','#e0a44f'); startGhosts(); }
          net.retry++;
          if(!net.auto && net.retry<=5 && net.enabled) setTimeout(()=>connect(net.url), Math.min(15000,1000*net.retry*net.retry));
        };
        ws.onerror=()=>{};
      } catch(e) { setStatus('offline'); startGhosts(); return false; }
      return true;
    }
    function disconnect() {
      net.enabled=false;
      if(net.ws) { try{ net.ws.close(); }catch(e){} net.ws=null; }
      setStatus('offline'); startGhosts();
    }

    function pushLocalChat(name,text,ch) {
      const c={ch:ch||'local',name,text,color:'#e9efed'};
      net.chatLog.push(c); if(net.chatLog.length>60) net.chatLog.shift();
      G.onChat&&G.onChat(c);
    }
    function chat(text,ch) {
      if(!text) return;
      if(net.state==='online') send({t:'chat',ch:ch||'local',text:String(text).slice(0,180)});
      else {
        pushLocalChat(G.char.name,text,ch);
        const g=A2.pick(net.ghosts);
        if(g && Math.random()<0.7) setTimeout(()=>pushLocalChat(g.name,A2.pick(GHOST_LINES),'local'),700+Math.random()*1400);
      }
    }

    function update(dt) {
      // интерполяция удалённых игроков
      for(const e of net.players.values()) {
        e.t=Math.min(1,e.t+dt*C.SNAPSHOT*1.0);
        e.x=A2.lerp(e.prev.x,e.next.x,e.t); e.y=A2.lerp(e.prev.y,e.next.y,e.t);
      }
      // ИИ призраков: сопровождение, агро, автоатака, «чат»
      for(const g of net.ghosts) {
        const mob=A2.World.mobsNear(G.world,g.x,g.y,7).find(m=>m.alive);
        let tx=G.player.x,ty=G.player.y;
        if(mob) { tx=mob.x; ty=mob.y; g.targetUid=mob.uid; } else { g.targetUid=null; }
        const d=A2.dist(g.x,g.y,tx,ty);
        const keep=mob?2.4:2.6+ (g.uid.charCodeAt(6)%3);
        g.moving=false; g.atkCd-=dt;
        if(d>keep) {
          const a=Math.atan2(ty-g.y,tx-g.x);
          const nx=g.x+Math.cos(a)*dt*2.4, ny=g.y+Math.sin(a)*dt*2.4;
          if(A2.World.canMove(G.world,nx,ny)) { g.x=nx; g.y=ny; g.moving=true; }
        }
        if(mob && d<3 && g.atkCd<=0) {
          g.atkCd=1.5;
          const dmg=Math.round(G.char.stats.dmg*0.18*(1- A2.World.mobStats(mob.id,mob.lvl,false,null).armor*0.00003));
          mob.hp-=Math.max(1,dmg); mob.hitFlash=1;
          A2.RPG.spawnParticles(G,mob.x,mob.y,5,A2.CLASS(g.classId).color,1);
          if(mob.hp<=0) {
            A2.World.kill(G.world,mob);
            G.char.kills++;
            A2.RPG.grantXP(G,Math.round(mob.xp*0.35));
            A2.RPG.questProgress(G,'kill',mob.id,1);
            if(Math.random()<0.25) A2.RPG.dropItem(G,mob,1);
          }
        }
        g.chatCd-=dt;
        if(g.chatCd<=0) { g.chatCd=22+Math.random()*30; pushLocalChat(g.name,A2.pick(GHOST_LINES),'local'); }
      }
      // отправка своего состояния 20 Гц
      if(net.state==='online') {
        net.lastSend+=dt;
        if(net.lastSend>=C.SNAPSHOT) {
          net.lastSend=0; net.seq++;
          send({t:'input',seq:net.seq,x:+G.player.x.toFixed(2),y:+G.player.y.toFixed(2),
            hp:Math.round(G.char.hp),level:G.char.level,zone:G.world.id,gearRarity:G.char.gearRarity});
        }
      }
    }

    net.connect=connect; net.disconnect=disconnect; net.send=send; net.chat=chat;
    net.update=update; net.syncEntities=syncEntities; net.startGhosts=startGhosts;
    net.status=()=>({state:net.state,count:net.state==='online'?net.serverPlayers:net.ghosts.length,
      ping:net.ping,url:net.url,ghosts:net.ghosts.length});
    net.autoConnect=()=>connect();
    return net;
  }

  A2.Net = { create, GHOST_NAMES, GHOST_LINES };
})();
