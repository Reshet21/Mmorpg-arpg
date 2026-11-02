/* =====================================================================
 * ARKEON · G2 · market.js
 * Рынок предметов и торговля 1:1 в стиле Diablo / PoE / Albion:
 * ордера, фильтры (слот/редкость/цена/поиск), рекомендованная цена,
 * комиссия 5% (sink), история сделок, выставление/покупка/снятие,
 * общий order book на сервере и офлайн-ордера союзников-призраков,
 * защищённая передача предмета, шепот и приглашения игроков.
 * ===================================================================== */
(function () {
  'use strict';
  const A2 = window.A2;

  const ICON = { weapon:'⚔', offhand:'⛨', helm:'♛', chest:'▣', gloves:'✋', boots:'⇧', amulet:'◈', ring:'○' };
  const GHOST_NAMES = ['Лиана','Корвин','Сэра','Дорн','Иветта','Рен','Мельхиор','Айра'];
  let seq = 0;
  const key = () => 'k' + (++seq) + '_' + Math.random().toString(36).slice(2, 8);

  function create(G) {
    const M = {
      orders: [], history: [], ledger: [],
      filter: { slot:'all', rarity:'all', min:0, max:0, q:'' },
      trade: { active:false, with:null, offer:{ items:[], gold:0 }, their:{ items:[], gold:0 },
               meConfirm:false, peerConfirm:false, ghost:true, log:[] },
      roster: [], whispers: [], emotes: [],
      newItems: 0, seeded:false
    };

    const snd = (n,a) => A2.Audio && A2.Audio.play(n,a);
    const netSend = obj => { if (G.net && G.net.state === 'online') G.net.send(obj); };
    const online = () => !!(G.net && G.net.state === 'online');

    function suggest(it) {
      const r = A2.RARITIES.findIndex(x => x.id === it.rarity);
      return Math.max(10, Math.round(it.price * 1.28 * (1 + r * 0.24) * (1 + (it.plus||0)*0.14)));
    }
    function fee(price) { return Math.max(1, Math.ceil(price * 0.05)); }
    function icon(it) { return ICON[it && it.slot] || '◇'; }

    /* ------------------------- офлайн-ордера призраков ------------------------- */
    function seed() {
      if (M.seeded) return;
      M.seeded = true;
      const z = G.world ? G.world.zone : A2.ZONES[0];
      const pool = ['weapon','chest','helm','ring','amulet','boots','gloves','offhand'];
      const rarities = ['common','rare','rare','epic','epic','legendary','mythic','common','rare','epic','legendary','rare'];
      for (let i = 0; i < 14; i++) {
        const slot = pool[i % pool.length];
        const it = A2.RPG.rollItem(Math.max(3, G.char.level + (i % 7) - 2), z.id, { slot, rarity: rarities[i % rarities.length] });
        const price = Math.round(suggest(it) * (0.82 + (i % 5) * 0.09));
        M.orders.push({ id:'gho_'+i, sellerUid:'ghost_'+(i%4), sellerName:GHOST_NAMES[i % GHOST_NAMES.length],
          item:it, price, ts:Date.now()-i*41000, ghost:true });
      }
      G.log && G.log('Офлайн-рынок: 14 лотов от союзников-призраков','#9db0bd');
    }

    function setOrders(list) {
      if (!Array.isArray(list)) return;
      const me = G.net && G.net.uid;
      M.orders = list.filter(o => o && o.item && Number.isFinite(o.price))
        .map(o => Object.assign({}, o, { mine: !!o.mine || (!!me && o.sellerUid === me), ghost: !!o.ghost }));
    }
    function filtered() {
      const f = M.filter;
      return M.orders.filter(o => {
        if (f.slot !== 'all' && o.item.slot !== f.slot) return false;
        if (f.rarity !== 'all' && o.item.rarity !== f.rarity) return false;
        if (f.min && o.price < f.min) return false;
        if (f.max && o.price > f.max) return false;
        if (f.q && (A2.RPG.itemName(o.item)+' '+o.sellerName).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
        return true;
      }).sort((a,b) => a.price-b.price || b.ts-a.ts);
    }

    /* ------------------------------- ордера ------------------------------- */
    function list(it, price) {
      const ch = G.char;
      if (!it || ch.inventory.indexOf(it) < 0) { G.toast && G.toast('Предмет не в сумке',1.5); return false; }
      price = Math.round(Number(price) || suggest(it));
      if (price < 1 || price > 1e9) { G.toast && G.toast('Некорректная цена',1.5); return false; }
      const f = fee(price);
      if (ch.gold < f) { G.toast && G.toast('Нужно '+f+' S на комиссию',2); return false; }
      ch.gold -= f;
      ch.inventory.splice(ch.inventory.indexOf(it),1);
      const order = { id:'ord_'+key(), sellerUid:(G.net&&G.net.uid)||'local', sellerName:ch.name,
        item:it, price, ts:Date.now(), ghost:false, mine:true };
      if (online()) { if (G.net.syncItems) G.net.syncItems(); netSend({ t:'market_list', order, key:key() }); }
      else M.orders.push(order);
      M.ledger.push({ type:'fee', amount:-f, t:Date.now(), text:'Комиссия рынка 5%' });
    if (A2.RPG && A2.RPG.storyEvent) A2.RPG.storyEvent(G,'sell',it.slot,1);
      M.history.push({ t:Date.now(), text:'Выставлен '+A2.RPG.itemName(it)+' за '+price+' S' });
      G.log && G.log('▣ Лот выставлен: '+A2.RPG.itemName(it)+' · '+price+' S · комиссия '+f+' S','#f0d27a');
      snd('market'); return true;
    }
    function buy(id) {
      const o = M.orders.find(x => x.id === id);
      if (!o) { G.toast && G.toast('Лот уже продан',1.5); return false; }
      if (o.mine) { G.toast && G.toast('Это ваш лот — снимите его',1.5); return false; }
      if (online()) { netSend({ t:'market_buy', id, key:key() }); return true; }
      if (G.char.gold < o.price) { G.toast && G.toast('Не хватает Серебра',2); snd('ui'); return false; }
      if (G.char.inventory.length >= 40) { G.toast && G.toast('Сумка полна (40)',2); return false; }
      G.char.gold -= o.price;
      G.char.inventory.push(o.item);
      M.newItems++;
      M.orders.splice(M.orders.indexOf(o),1);
      M.history.push({ t:Date.now(), text:'Куплен '+A2.RPG.itemName(o.item)+' у '+o.sellerName+' за '+o.price+' S' });
      M.ledger.push({ type:'buy', amount:-o.price, t:Date.now(), text:'Покупка на рынке' });
      G.log && G.log('✦ Куплено: '+A2.RPG.itemName(o.item)+' · −'+o.price+' S', A2.RARITY(o.item.rarity).color);
      snd('loot', o.item.rarity); snd('coin');
      return true;
    }
    function cancel(id) {
      const i = M.orders.findIndex(x => x.id === id);
      if (i < 0) return false;
      const o = M.orders[i];
      if (!o.mine) { G.toast && G.toast('Чужой лот',1.5); return false; }
      if (G.char.inventory.length >= 40) { G.toast && G.toast('Сумка полна',2); return false; }
      M.orders.splice(i,1);
      // онлайн: предмет вернёт сервер сообщением grant_item — не дублируем его локально
      if (online()) netSend({ t:'market_cancel', id, key:key() });
      else G.char.inventory.push(o.item);
      M.history.push({ t:Date.now(), text:'Лот снят: '+A2.RPG.itemName(o.item) });
      snd('ui'); return true;
    }

    /* ------------------------------- торговля ------------------------------- */
    function tradeInvite(uid, name) {
      const t = M.trade;
      t.active = true; t.with = { uid, name, ghost: !online() };
      t.offer = { items:[], gold:0 }; t.their = { items:[], gold:0 };
      t.meConfirm = false; t.peerConfirm = false; t.pending = online() ? 'waiting' : false; t.log = [];
      if (online()) netSend({ t:'trade_invite', to:uid, key:key() });
      else {
        // офлайн: призрак предлагает случайный предмет и Серебро
        const it = A2.RPG.rollItem(G.char.level, G.world.zone.id, { rarity:'epic' });
        t.their = { items:[it], gold: Math.round(120 + G.char.level*18) };
        t.peerConfirm = true;
        t.log.push(name+' предлагает '+A2.RPG.itemName(it)+' и '+t.their.gold+' S');
        G.toast && G.toast('Торговля с '+name+' (призрак)',2.5);
      }
      snd('trade'); return true;
    }
    function tradeAccept(from) {
      const t = M.trade;
      t.active = true; t.with = t.with || { uid:from, name:'Игрок', ghost:false };
      t.pending = false;
      if (online()) netSend({ t:'trade_accept', from, with:from, key:key() });
      snd('trade'); return true;
    }
    function tradeSetOffer(items, gold) {
      const t = M.trade;
      t.offer = { items:items.slice(0,6), gold:Math.max(0,Math.min(G.char.gold,Math.round(Number(gold)||0))) };
      t.meConfirm = false;
      if (online()) netSend({ t:'trade_offer', with:t.with && t.with.uid, items:t.offer.items.map(x=>x.uid), gold:t.offer.gold,
        key:key(), detail:t.offer.items });
      return true;
    }
    function tradeConfirm() {
      const t = M.trade;
      if (!t.active) return false;
      if (online()) { t.meConfirm = true; netSend({ t:'trade_confirm', with:t.with && t.with.uid, key:key() }); G.toast && G.toast('Ожидание второго игрока…',2); return true; }
      // офлайн: мгновенный обмен с призраком
      if (G.char.inventory.length + t.their.items.length > 40) { G.toast && G.toast('Сумка полна',2); return false; }
      for (const it of t.offer.items) { const i=G.char.inventory.indexOf(it); if(i>=0) G.char.inventory.splice(i,1); }
      G.char.gold = G.char.gold - t.offer.gold + t.their.gold;
      for (const it of t.their.items) { G.char.inventory.push(it); M.newItems++; }
      M.history.push({ t:Date.now(), text:'Обмен с '+t.with.name+' завершён' });
      M.ledger.push({ type:'trade', amount:t.their.gold-t.offer.gold, t:Date.now(), text:'Торговля 1:1' });
      G.log && G.log('⚑ Обмен с '+t.with.name+' завершён','#4fd6d0');
      snd('trade'); snd('loot', t.their.items[0] ? t.their.items[0].rarity : 'rare');
      tradeCancel(true); return true;
    }
    function tradeCancel(silent) {
      const t = M.trade;
      if (!silent && online() && t.active) netSend({ t:'trade_cancel', with:t.with && t.with.uid, key:key() });
      t.active=false; t.with=null; t.offer={items:[],gold:0}; t.their={items:[],gold:0};
      t.meConfirm=false; t.peerConfirm=false; t.pending=false; t.log=[];
      return true;
    }

    /* ---------------------------- сетевые события ---------------------------- */
    function applyNet(msg) {
      switch (msg.t) {
        case 'market': setOrders(msg.orders); break;
        case 'wallet': if (Number.isFinite(msg.gold)) G.char.gold = Math.max(0, Math.round(msg.gold)); break;
        case 'grant_item': {
          if (!msg.item) break;
          if (G.char.inventory.length < 40) { G.char.inventory.push(msg.item); M.newItems++;
            G.log && G.log('✦ Получено: '+A2.RPG.itemName(msg.item), A2.RARITY(msg.item.rarity).color);
            snd('loot', msg.item.rarity); }
          if (G.net && G.net.syncItems) G.net.syncItems();
          break;
        }
        case 'market_sold': {
          G.log && G.log('▣ Ваш лот купил '+msg.by+' · +'+msg.gold+' S','#8fd08a');
          M.history.push({t:Date.now(),text:'Продажа: '+msg.by+' · +'+msg.gold+' S'});
          snd('coin'); break;
        }
        case 'trade_request': {
          const t=M.trade; t.active=true; t.with={uid:msg.from,name:msg.name,ghost:false};
          t.offer={items:[],gold:0}; t.their={items:[],gold:0}; t.meConfirm=false; t.peerConfirm=false;
          t.pending=true;
          G.log && G.log('⚑ '+msg.name+' предлагает торговлю · откройте панель «Игроки → Торговля»','#4fd6d0');
          G.toast && G.toast('Входящее предложение торговли от '+msg.name,3);
          snd('trade'); break;
        }
        case 'trade_state': {
          const t=M.trade; if(!t.active) break;
          t.pending = false;   // сервер создал сессию — показываем торговое окно
          t.their = { items: msg.items||[], gold: Math.round(msg.gold||0) };
          t.peerConfirm = !!msg.confirm;
          break;
        }
        case 'trade_done': {
          // списываем свои предложенные предметы до добавления чужих — защита от дюпа на клиенте
          for (const it of (M.trade.offer.items||[])) {
            const i=G.char.inventory.findIndex(x=>x.uid===it.uid); if(i>=0) G.char.inventory.splice(i,1);
          }
          for (const it of (msg.items||[])) if (G.char.inventory.length<40) { G.char.inventory.push(it); M.newItems++; }
          if (Number.isFinite(msg.gold)) G.char.gold = Math.max(0, Math.round(msg.gold));
          if (G.net && G.net.syncItems) G.net.syncItems();
          G.log && G.log('⚑ Обмен завершён · +'+(msg.items||[]).length+' предметов','#4fd6d0');
          M.history.push({t:Date.now(),text:'Серверный обмен с '+(M.trade.with?M.trade.with.name:'игроком')});
          snd('trade'); tradeCancel(true); break;
        }
        case 'trade_cancel': G.log && G.log('⚑ Торговля отменена','#9db0bd'); tradeCancel(true); break;
        case 'whisper': M.whispers.push({from:msg.name,text:msg.text,t:Date.now()});
          if (M.whispers.length>40) M.whispers.shift();
          G.onChat && G.onChat({ch:'шёпот',name:msg.name,text:msg.text,color:'#b07ae8'});
          snd('whisper'); break;
        case 'emote': M.emotes.push({name:msg.name,text:msg.text,t:Date.now()});
          if (M.emotes.length>20) M.emotes.shift();
          G.log && G.log('✧ '+msg.name+' '+msg.text,'#8fd08a'); break;
        case 'roster': M.roster = Array.isArray(msg.players) ? msg.players : []; break;
      }
    }

    M.seed=seed; M.setOrders=setOrders; M.filtered=filtered; M.suggest=suggest; M.fee=fee;
    M.icon=icon; M.list=list; M.buy=buy; M.cancel=cancel;
    M.tradeInvite=tradeInvite; M.tradeAccept=tradeAccept; M.tradeSetOffer=tradeSetOffer;
    M.tradeConfirm=tradeConfirm; M.tradeCancel=tradeCancel; M.applyNet=applyNet;
    M.status=()=>({ orders:M.orders.length, online:online(), trade:M.trade.active,
      newItems:M.newItems, history:M.history.length, roster:M.roster.length });
    return M;
  }

  A2.Market = { create, ICON };
})();
