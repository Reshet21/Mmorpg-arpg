/* =====================================================================
 * ARKEON · G2 · rpg.js
 * Полноценный гринд-цикл: 60 уровней, 8 слотов экипировки, 6 редкостей,
 * аффиксы/сеты/руны/самоцветы, заточка +12, перековка, pity 40,
 * дроп-таблицы, материалы, золото, 3 ветки талантов, 12 квестов,
 * репутация, НПС-сервисы, диалоги, сохранение, формула урона канона.
 * ===================================================================== */
(function () {
  'use strict';
  const A2 = window.A2, C = A2.C;

  const NAMES = ['Возжённый','Пепельный Странник','Хранитель','Дозорный','Свидетель','Клятвопреступник'];

  function createCharacter(classId, name) {
    const cls = A2.CLASS(classId);
    const ch = {
      classId: cls.id, name: name || A2.pick(NAMES), level: 1, xp: 0,
      hp: 0, maxHp: 0, res: cls.resStart, maxRes: cls.resMax,
      gold: 250, inventory: [], equip: {}, mats: {}, rep: {}, kills: 0,
      talents: { steel:0, blood:0, banner:0 }, talentPoints: 0,
      quests: {}, pity: 0, ult: 0, dodgeCharges: C.DODGE_CHARGES, dodgeCd: 0,
      achievements: [], playtime: 0, dead: false, gearRarity: 'common', stats: {}
    };
    // стартовый набор: обычное оружие и нагрудник
    ['weapon','chest'].forEach(s => { const it = rollItem(1, 'grove', { slot:s, rarity:'common' }); ch.equip[s] = it; });
    recompute(ch); ch.hp = ch.maxHp;
    return ch;
  }

  function itemPower(it) {
    if (!it) return 0;
    return Math.round((it.power||0) + (it.armor||0)*0.35 + (it.affixes||[]).reduce((a,f)=>a+Math.abs(f.value)*2,0) + (it.plus||0)*18);
  }
  function itemName(it) {
    if (!it) return '—';
    return it.name + (it.plus ? ' +' + it.plus : '');
  }
  function rollItem(lvl, zoneId, opts) {
    opts = opts || {};
    let rarity;
    if (opts.rarity) rarity = A2.RARITY(opts.rarity);
    else {
      const r = Math.random(), z = A2.ZONE(zoneId);
      let acc = 0; rarity = A2.RARITIES[0];
      const boost = Math.min(0.10, (lvl - z.lv[0]) * 0.0015);
      for (const rr of A2.RARITIES) { acc += rr.weight * (rr.mult > 1.5 ? 1 + boost : 1); if (r <= acc) { rarity = rr; break; } }
    }
    const slot = opts.slot || A2.pick(A2.SLOTS).id;
    const base = A2.SLOTS.find(s => s.id === slot);
    const ilvl = Math.max(1, Math.round(lvl + (Math.random()*4|0)));
    const power = Math.round((26 + ilvl * 4.2) * rarity.mult * base.base);
    const affixes = [];
    const pool = A2.AFFIXES.slice();
    for (let i = 0; i < rarity.aff; i++) {
      const a = pool.splice(Math.floor(Math.random()*pool.length),1)[0];
      if (!a) break;
      const v = a.min + Math.random()*(a.max-a.min);
      affixes.push({ id:a.id, ru:a.ru, value: a.max>=10 ? Math.round(v) : Math.round(v*10)/10, suffix:a.suffix||'', stat:a.stat });
    }
    const set = (rarity.mult >= 1.55 && Math.random() < 0.22) ? A2.pick(A2.SETS).id : null;
    const it = {
      uid: 'it' + Math.random().toString(36).slice(2,9), slot, name: A2.pick(A2.BASE_NAMES[slot]) + ' ' + A2.pick(A2.SUFFIX),
      rarity: rarity.id, ilvl, power, armor: Math.round(power*0.42), affixes,
      set, plus: 0, rune: rarity.mult >= 1.98 && Math.random()<.35 ? A2.pick(A2.RUNES) : null,
      gem: rarity.mult >= 1.98 && Math.random()<.35 ? A2.pick(A2.GEMS) : null,
      price: Math.round(power*2.4*rarity.mult)
    };
    return it;
  }

  function talentMods(ch) {
    const m = {};
    for (const br of A2.TALENTS) {
      const n = ch.talents[br.id] || 0;
      for (let i=0;i<n;i++) { const node=br.nodes[i]; if(node) for (const k in node.mod) m[k]=(m[k]||0)+node.mod[k]; }
    }
    return m;
  }
  function setBonus(ch) {
    const cnt = {};
    for (const s in ch.equip) { const it=ch.equip[s]; if (it && it.set) cnt[it.set]=(cnt[it.set]||0)+1; }
    const active=[];
    for (const id in cnt) { const set=A2.SETS.find(s=>s.id===id); if(set && cnt[id]>=2) active.push({ru:set.ru,pieces:cnt[id],bonus:set.bonus}); }
    return active;
  }
  function recompute(ch) {
    const cls = A2.CLASS(ch.classId), tm = talentMods(ch);
    let power=0, armor=0, hp=0, critPct=C.BASE_CRIT*100, critDmg=50, haste=0, cdr=0, elem=0, leech=0, gold=0, xp=0, speed=2.8, pickup=2.2;
    for (const s in ch.equip) {
      const it=ch.equip[s]; if(!it) continue;
      const rr=A2.RARITY(it.rarity);
      power += it.power*(1+(it.plus||0)*0.09);
      armor += it.armor*(1+(it.plus||0)*0.09);
      for (const f of it.affixes||[]) {
        switch(f.stat){
          case 'power': power+=f.value*3; break; case 'armor': armor+=f.value; break;
          case 'hp': hp+=f.value; break; case 'critPct': critPct+=f.value; break;
          case 'critDmg': critDmg+=f.value; break; case 'haste': haste+=f.value; break;
          case 'cdr': cdr+=f.value; break; case 'elem': elem+=f.value; break;
          case 'leech': leech+=f.value; break; case 'gold': gold+=f.value; break;
          case 'xp': xp+=f.value; break;
        }
      }
      if (it.rune) power += 22; if (it.gem) armor += 30;
    }
    for (const s of setBonus(ch)) { armor += s.pieces*35; elem += s.pieces*1.5; }
    const lv = ch.level;
    const st = {
      power: Math.round(power + 60 + lv*22),
      armor: Math.round(armor + 320 + lv*26),
      maxHp: Math.round((C.PLAYER_HP*cls.hpMult*(1+lv*0.055) + hp) * (1+(tm.hp||0))),
      critPct: A2.clamp(critPct + (tm.critPct||0), 0, 65),
      critDmg: critDmg/100 + (tm.critDmg||0),
      haste: A2.clamp(haste/100 + (tm.haste||0), 0, 0.45),
      cdr: A2.clamp(cdr/100 + (tm.cdr||0), 0, 0.45),
      elem: elem/100 + (tm.elem||0), leech: leech/100 + (tm.leech||0),
      gold: gold/100 + (tm.gold||0), xp: xp/100 + (tm.xp||0),
      speed: speed*(1+(tm.pickup||0)*0.1), pickup: pickup*(1+(tm.pickup||0)),
      aoeDR: tm.aoeDR||0, wounded: tm.wounded||0, comboB: tm.combo||0, shieldOnCrit:tm.shieldOnCrit||0,
      breakDmg:tm.breakDmg||0, dodgeDmg:tm.dodgeDmg||0, ult:tm.ult||0, ccRes:tm.ccRes||0
    };
    st.dmg = C.WEAPON_HIT * 1.34 * 1.298 * (1 + st.power/2600) * (1 + lv*0.018);
    ch.stats = st;
    ch.maxRes = cls.resMax;
    ch.gearRarity = bestRarity(ch);
    ch.hp = Math.min(ch.hp || st.maxHp, st.maxHp);
    return st;
  }
  function bestRarity(ch) {
    let best = 0;
    for (const s in ch.equip) { const it=ch.equip[s]; if(it){ const i=A2.RARITIES.findIndex(r=>r.id===it.rarity); if(i>best) best=i; } }
    return A2.RARITIES[best].id;
  }

  /* ------------------------------ прогрессия ------------------------------ */
  function grantXP(G, amount) {
    const ch=G.char, mult=1+ch.stats.xp+(G.eventBonus||0);
    const gained=Math.round(amount*mult);
    ch.xp += gained;
    G.onXP && G.onXP(gained);
    let ups=0;
    while (ch.level < C.MAX_LEVEL && ch.xp >= A2.xpNext(ch.level)) {
      ch.xp -= A2.xpNext(ch.level); ch.level++; ups++;
      ch.talentPoints += 1; ch.hp = ch.stats.maxHp;
      recompute(ch); ch.hp=ch.maxHp;
      G.onLevel && G.onLevel(ch.level);
    }
    if (ups) recompute(ch);
    return gained;
  }
  function grantGold(G, amount) {
    const v=Math.round(amount*(1+G.char.stats.gold)); G.char.gold+=v; G.onGold&&G.onGold(v); return v;
  }
  function talentUp(G, branch) {
    const ch=G.char;
    if (ch.talentPoints<=0) return false;
    const br=A2.TALENTS.find(b=>b.id===branch); if(!br) return false;
    if ((ch.talents[branch]||0)>=br.nodes.length) return false;
    ch.talents[branch]++; ch.talentPoints--; recompute(ch); return true;
  }
  function respec(G) {
    const ch=G.char;
    if (ch.gold<500) return false;
    ch.gold-=500; ch.talentPoints=ch.level-1;
    ch.talents={steel:0,blood:0,banner:0}; recompute(ch); return true;
  }

  /* -------------------------------- лут -------------------------------- */
  function dropItem(G, mob, force) {
    const ch=G.char, z=G.world.zone;
    ch.pity++;
    let rarity = null;
    if (ch.pity >= C.PITY) { rarity = 'legendary'; ch.pity = 0; }
    const it = rollItem(mob.lvl, z.id, rarity ? {rarity} : {});
    if (it.rarity !== 'common' && it.rarity !== 'rare') ch.pity = 0;
    const d = { uid:'d'+Math.random().toString(36).slice(2,8), x:mob.x+(Math.random()-0.5)*1.4,
      y:mob.y+(Math.random()-0.5)*1.4, t:G.world.time, item:it, owner:null, gold:0 };
    G.world.drops.push(d);
    G.onLoot && G.onLoot(it, d);
    // материалы
    if (Math.random()<0.42) {
      const mat = A2.pick(A2.MATS); ch.mats[mat]=(ch.mats[mat]||0)+1;
      G.onMaterial && G.onMaterial(mat);
    }
    if (force) for(let i=0;i<(force-1);i++) dropItem(G,mob,1);
  }
  function pickup(G, d) {
    const ch=G.char;
    if (d.item) { ch.inventory.push(d.item); G.log('Подобрано: '+itemName(d.item), A2.RARITY(d.item.rarity).color); }
    if (d.gold) grantGold(G,d.gold);
    d.t = -999;
  }
  function equip(G, it) {
    const ch=G.char, old=ch.equip[it.slot];
    const idx=ch.inventory.indexOf(it); if(idx<0) return false;
    ch.inventory.splice(idx,1);
    if(old) ch.inventory.push(old);
    ch.equip[it.slot]=it; recompute(ch);
    G.log('Надето: '+itemName(it), A2.RARITY(it.rarity).color);
    return true;
  }
  function salvage(G, it) {
    const ch=G.char;
    const idx=ch.inventory.indexOf(it); if(idx<0) return false;
    ch.inventory.splice(idx,1);
    const mat=A2.pick(A2.MATS); ch.mats[mat]=(ch.mats[mat]||0)+ (it.rarity==='common'?1:2);
    grantGold(G, Math.round(it.price*0.35));
    G.log('Разобрано: '+itemName(it)+' → '+mat, '#9db0bd');
    return true;
  }
  function enchant(G, slot) {
    const ch=G.char, it=ch.equip[slot]; if(!it||it.plus>=12) return false;
    const cost=120*(it.plus+1);
    if(ch.gold<cost) return false;
    ch.gold-=cost; it.plus++; recompute(ch);
    G.log('Заточка: '+itemName(it), it.plus>=10?'#ff7a4d':'#f0d27a'); return true;
  }
  function reroll(G, slot) {
    const ch=G.char, it=ch.equip[slot]; if(!it||!it.affixes||!it.affixes.length) return false;
    if(ch.mats['Осколок Разлома']<1 && ch.gold<400) return false;
    if(ch.mats['Осколок Разлома']>0) ch.mats['Осколок Разлома']--; else ch.gold-=400;
    for(const f of it.affixes) { const a=A2.AFFIXES.find(x=>x.id===f.id); if(a) f.value = a.max>=10?Math.round(a.min+Math.random()*(a.max-a.min)):Math.round((a.min+Math.random()*(a.max-a.min))*10)/10; }
    recompute(ch); G.log('Перековка: '+itemName(it),'#4fd6d0'); return true;
  }
  function buy(G, it) {
    const ch=G.char; if(ch.gold<it.price) return false;
    ch.gold-=it.price; ch.inventory.push(it); return true;
  }

  /* ------------------------------- квесты ------------------------------- */
  function questAvailable(G, q) {
    const ch=G.char;
    if (ch.quests[q.id] && (ch.quests[q.id].done || ch.quests[q.id].active)) return false;
    const prev=A2.QUESTS.find(p=>p.next===q.id);
    return !prev || (ch.quests[prev.id] && ch.quests[prev.id].done);
  }
  function questsFor(G, npc) {
    return A2.QUESTS.filter(q=>q.npc===npc.id && (questAvailable(G,q) || (G.char.quests[q.id]&&G.char.quests[q.id].active)));
  }
  function startQuest(G, id) {
    const q=A2.QUEST(id), ch=G.char; if(!q) return false;
    ch.quests[id]={active:true,done:false,progress:0};
    G.log('Квест принят: «'+q.ru+'»','#f0d27a'); G.onQuest&&G.onQuest(q,'start'); return true;
  }
  function questProgress(G, type, target, amount) {
    const ch=G.char;
    for (const id in ch.quests) {
      const st=ch.quests[id]; if(!st.active||st.done) continue;
      const q=A2.QUEST(id); if(!q) continue;
      const ok = (q.type==='kill'&&type==='kill'&&q.target===target) ||
                 (q.type==='elite'&&type==='elite'&&q.target===target) ||
                 (q.type==='boss'&&type==='boss'&&q.target===target) ||
                 (q.type==='collect'&&type==='material'&&q.target===target) ||
                 (q.type==='explore'&&type==='explore'&&q.target===target) ||
                 (q.type==='talk'&&type==='talk'&&q.target===target);
      if(ok) { st.progress += (amount||1); G.onQuest&&G.onQuest(q,'progress',st.progress,q.need);
        if(st.progress>=q.need) G.log('«'+q.ru+'» готово к сдаче','#8fd08a'); }
    }
  }
  function completeQuest(G, id) {
    const q=A2.QUEST(id), ch=G.char, st=ch.quests[id];
    if(!q||!st||!st.active||st.done||st.progress<q.need) return false;
    st.done=true; st.active=false;
    grantXP(G,q.xp); grantGold(G,q.gold);
    ch.rep[q.zone]=(ch.rep[q.zone]||0)+q.rep;
    for(let i=0;i<q.item;i++) { const it=rollItem(Math.max(ch.level,q.lvl? A2.ZONE(q.zone).lv[1]:1),q.zone); ch.inventory.push(it); }
    G.log('Квест завершён: «'+q.ru+'» · +'+q.xp+' XP · +'+q.gold+' S','#8fd08a');
    G.onQuest&&G.onQuest(q,'complete');
    if(q.next) G.log('Открыта следующая глава Завета','#f0d27a');
    return true;
  }
  function activeQuests(G) { return A2.QUESTS.filter(q=>G.char.quests[q.id]&&G.char.quests[q.id].active); }

  /* ------------------------------- НПС ------------------------------- */
  function dialogue(G, npc) {
    const lines=npc.lines.slice(), options=[];
    const qs=questsFor(G,npc);
    qs.forEach(q=>{
      const st=G.char.quests[q.id];
      if(!st) options.push({text:'Взять: «'+q.ru+'»',action:'accept',payload:q.id});
      else if(st.active && st.progress>=q.need) options.push({text:'Сдать: «'+q.ru+'»',action:'complete',payload:q.id});
      else if(st.active) options.push({text:'«'+q.ru+'» · '+st.progress+'/'+q.need,action:'info',payload:q.id});
    });
    if(npc.services.includes('heal')) options.push({text:'Исцелиться (бесплатно)',action:'heal'});
    if(npc.services.includes('forge')) options.push({text:'Кузница · заточка и перековка',action:'forge'});
    if(npc.services.includes('vendor')) options.push({text:'Торговля',action:'shop'});
    if(npc.services.includes('salvage')) options.push({text:'Разобрать ненужное',action:'salvage'});
    if(npc.services.includes('trainer')) options.push({text:'Таланты',action:'talents'});
    if(npc.services.includes('respec')) options.push({text:'Перековать таланты · 500 S',action:'respec'});
    if(npc.services.includes('portal')) options.push({text:'Портал в другую зону',action:'portal'});
    if(npc.services.includes('map')) options.push({text:'Отметить все лагеря на карте',action:'map'});
    if(npc.services.includes('gamble')) options.push({text:'Купить реликвию · 800 S',action:'gamble'});
    return { npc, lines, options };
  }

  /* ------------------------------ формула боя ------------------------------ */
  function mitigation(armor) { return 1 - armor/(armor + C.K_DEF); }
  function hit(G, mob, coeff, element, opts) {
    opts=opts||{};
    const ch=G.char, st=ch.stats, cls=A2.CLASS(ch.classId);
    if(!mob||!mob.alive) return 0;
    let dmg = st.dmg * coeff;
    dmg *= mitigation(mob.armor);
    dmg *= 1 + st.elem*(element && element!=='Физический' ? 1 : 0);
    if(mob.hp/mob.maxHp<0.4) dmg *= 1+st.wounded;
    const crit = Math.random() < st.critPct/100;
    if(crit) dmg *= 1 + st.critDmg;
    dmg *= 0.92 + Math.random()*0.16;
    dmg = Math.max(1,Math.round(dmg));
    mob.hp -= dmg; mob.hitFlash = 1;
    G.damageDealt += dmg;
    G.numbers.push({x:mob.x+(Math.random()-.5),y:mob.y,z:1.4,text:(crit?'✦ ':'')+A2.fmt(dmg),color:crit?'#ffe27a':'#e9efed',life:1,max:1});
    spawnParticles(G,mob.x,mob.y,crit?14:7,elementColor(element||cls.element),1.5);
    if(crit && st.shieldOnCrit) ch.shield=(ch.shield||0)+st.maxHp*st.shieldOnCrit;
    if(st.leech) ch.hp=Math.min(st.maxHp,ch.hp+dmg*st.leech);
    // статус/реакции
    if(element && element!=='Физический') applyElement(G,mob,element,dmg);
    G.onHit && G.onHit(mob,dmg,crit);
    if(mob.hp<=0) {
      const killed=A2.World.kill(G.world,mob);
      ch.kills++;
      grantXP(G,mob.xp); grantGold(G,mob.gold);
      const type = mob.boss?'boss':mob.elite?'elite':'kill';
      const key = mob.boss ? G.world.zone.boss : mob.elite ? G.world.zone.elite : mob.id;
      questProgress(G,type,key,1);
      // дроп
      const rolls = mob.boss?4:mob.elite?2:(Math.random()<0.34?1:0);
      if(rolls) dropItem(G,mob,rolls);
      if(mob.gold) G.world.drops.push({uid:'g'+Math.random().toString(36).slice(2,7),x:mob.x,y:mob.y,t:G.world.time,item:null,gold:mob.gold,owner:null});
      G.onKill && G.onKill(killed,dmg);
    }
    return dmg;
  }
  function elementColor(el) {
    return ({'Огонь':'#ff9a4d','Лёд':'#9fe8ff','Молния':'#ffe27a','Скверна':'#c07bff','Свет':'#f0d27a','Тьма':'#8b6cc0'})[el] || '#e9efed';
  }
  function applyElement(G, mob, el, dmg) {
    const t=G.world.time;
    mob.statuses=(mob.statuses||[]).filter(s=>s.until>t);
    const prev=mob.statuses.find(s=>s.el!==el);
    if(prev) {
      const key=A2.pairKey(prev.el,el), r=A2.REACTIONS[key] || {ru:'Гармония',coeff:2.2,color:'#a878e0'};
      const bonus=Math.round(C.WEAPON_HIT*r.coeff*1.34*1.298*mitigation(mob.armor));
      mob.hp-=bonus; G.damageDealt+=bonus; G.reactions++;
      G.numbers.push({x:mob.x,y:mob.y,z:2.1,text:r.ru,color:r.color,life:1.2,max:1.2});
      spawnParticles(G,mob.x,mob.y,20,r.color,2.2);
      mob.statuses=mob.statuses.filter(s=>s!==prev);
      G.onReaction&&G.onReaction(r.ru,mob);
      if(mob.hp<=0) { A2.World.kill(G.world,mob); G.char.kills++; grantXP(G,mob.xp); dropItem(G,mob,1); G.onKill&&G.onKill(mob,bonus); }
    }
    mob.statuses.push({el,until:t+6});
  }
  function spawnParticles(G,x,y,n,color,power) {
    for(let i=0;i<n;i++){
      const a=Math.random()*6.28, v=(0.6+Math.random()*1.5)*(power||1);
      G.particles.push({x,y,z:0.6+Math.random()*1.2,vx:Math.cos(a)*v,vy:Math.sin(a)*v,vz:1+Math.random()*2.4,
        size:1+Math.random()*2.2,color,life:0.5+Math.random()*0.6,max:1.1,light:Math.random()<0.12});
    }
    if(G.particles.length>600) G.particles.splice(0,G.particles.length-600);
  }
  function hurtPlayer(G, amount, mob) {
    const ch=G.char;
    if(ch.dead || ch.iframe>0) return false;
    const red=1-(ch.stats.armor/(ch.stats.armor+C.K_DEF))*0.62;
    const dmg=Math.max(1,Math.round(amount*red*(1-ch.stats.aoeDR*0.5)));
    ch.shield=ch.shield||0;
    let left=dmg;
    if(ch.shield>0){ const a=Math.min(ch.shield,left); ch.shield-=a; left-=a; }
    ch.hp-=left;
    G.damageTaken+=left;
    G.numbers.push({x:G.player.x,y:G.player.y,z:1.6,text:'−'+A2.fmt(left),color:'#ff8a7a',life:1,max:1});
    spawnParticles(G,G.player.x,G.player.y,8,'#e0574f',1);
    G.cam.shake=Math.min(9,G.cam.shake+2.5); G.flash=Math.min(1,G.flash+0.12);
    G.onHurt&&G.onHurt(left,mob);
    if(ch.hp<=0){ ch.hp=0; ch.dead=true; G.log('Возжённый пал. Возрождение у Светоча…','#e0574f'); }
    return true;
  }

  /* ------------------------------ сохранение ------------------------------ */
  function save(G) {
    if (typeof localStorage==='undefined') return;
    try {
      const ch=G.char;
      localStorage.setItem(C.SAVE_KEY, JSON.stringify({
        v:2, classId:ch.classId,name:ch.name,level:ch.level,xp:ch.xp,gold:ch.gold,
        inventory:ch.inventory,equip:ch.equip,mats:ch.mats,rep:ch.rep,kills:ch.kills,
        talents:ch.talents,talentPoints:ch.talentPoints,quests:ch.quests,pity:ch.pity,
        achievements:ch.achievements,playtime:ch.playtime,zone:G.world.id,x:ch.x,y:ch.y
      }));
    } catch(e) {}
  }
  function load() {
    if (typeof localStorage==='undefined') return null;
    try { const s=localStorage.getItem(C.SAVE_KEY); return s?JSON.parse(s):null; } catch(e){ return null; }
  }
  function restore(G, data) {
    if(!data) return false;
    const ch=createCharacter(data.classId||'warrior',data.name);
    Object.assign(ch,{level:data.level||1,xp:data.xp||0,gold:data.gold||0,
      inventory:data.inventory||[],equip:data.equip||{},mats:data.mats||{},rep:data.rep||{},
      kills:data.kills||0,talents:data.talents||{steel:0,blood:0,banner:0},
      talentPoints:data.talentPoints||0,quests:data.quests||{},pity:data.pity||0,
      achievements:data.achievements||[],playtime:data.playtime||0});
    G.char=ch; recompute(ch); ch.hp=ch.stats.maxHp;
    G.pendingZone=data.zone||'grove'; G.pendingPos={x:data.x||12,y:data.y||16};
    return true;
  }

  A2.RPG = { createCharacter, rollItem, itemPower, itemName, recompute, talentMods, setBonus,
    grantXP, grantGold, talentUp, respec, dropItem, pickup, equip, salvage, enchant, reroll, buy,
    questAvailable, questsFor, startQuest, questProgress, completeQuest, activeQuests,
    dialogue, mitigation, hit, elementColor, applyElement, spawnParticles, hurtPlayer,
    save, load, restore };
})();
