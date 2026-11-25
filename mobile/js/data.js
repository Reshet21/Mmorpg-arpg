/* =====================================================================
 * ARKEON · G2 «МИР ЗАВЕТА» · data.js
 * Канонические данные: биомы, 6 классов, 6 редкостей, мобы, НПС, квесты,
 * таланты, предметы. Никаких внешних зависимостей; числа согласованы с
 * data/canon.json и data/classes.json (docs/03, 05, 07, 16).
 * ===================================================================== */
(function () {
  'use strict';
  const A2 = window.A2 || (window.A2 = {});

  A2.VERSION = 'G2.5';
  A2.C = {
    TICK: 1 / 30, SNAPSHOT: 1 / 20, WEAPON_HIT: 21600,
    TILE_W: 64, TILE_H: 32, H_UNIT: 26,
    ZONE_N: 40, VIEW_R: 17,
    PLAYER_HP: 12000, K_DEF: 3720, CRIT: 1.5, BASE_CRIT: 0.05,
    DODGE_IFRAME: 0.30, DODGE_CD: 5.5, DODGE_CHARGES: 2,
    XP_BASE: 900, XP_GROWTH: 1.31, MAX_LEVEL: 60,
    AOI: 120, MAX_PLAYERS: 200, PITY: 40,
    SAVE_KEY: 'arkeon_g2_save_v4', SAVE_VERSION: 4
  };
  A2.ELEMENTS = ['Физический', 'Огонь', 'Лёд', 'Молния', 'Скверна', 'Свет', 'Тьма'];
  A2.REACTIONS = {
    'Огонь+Лёд': { ru: 'Пар', coeff: 2.80, color: '#9fe8ff' },
    'Огонь+Молния': { ru: 'Перегрузка', coeff: 3.40, color: '#ffe27a' },
    'Физический+Лёд': { ru: 'Стеклование', coeff: 1.20, color: '#bfe9ff' },
    'Огонь+Скверна': { ru: 'Взрыв', coeff: 3.00, color: '#c07bff' },
    'Скверна+Свет': { ru: 'Очищение', coeff: 1.00, color: '#f0d27a' },
    'Свет+Тьма': { ru: 'Затемнение', coeff: 1.00, color: '#8b6cc0' }
  };

  A2.RARITIES = [
    { id: 'common',    ru: 'Обычная',    abbr: 'О', color: '#c9d4d8', glow: 0.0, weight: 0.560, mult: 1.00, aff: 0 },
    { id: 'rare',      ru: 'Редкая',     abbr: 'Р', color: '#5fa8e8', glow: 0.2, weight: 0.270, mult: 1.24, aff: 2 },
    { id: 'epic',      ru: 'Эпическая',  abbr: 'Э', color: '#b07ae8', glow: 0.4, weight: 0.115, mult: 1.55, aff: 3 },
    { id: 'legendary', ru: 'Легендарная',abbr: 'Л', color: '#f0b45c', glow: 0.7, weight: 0.040, mult: 1.98, aff: 4 },
    { id: 'mythic',    ru: 'Мифическая', abbr: 'М', color: '#ff7a4d', glow: 0.9, weight: 0.012, mult: 2.48, aff: 5 },
    { id: 'unique',    ru: 'Уникальная', abbr: 'У', color: '#4fd6d0', glow: 1.0, weight: 0.003, mult: 3.10, aff: 6 }
  ];
  A2.RARITY = id => A2.RARITIES.find(r => r.id === id) || A2.RARITIES[0];

  /* ---------------------------- 6 классов канона ---------------------------- */
  A2.CLASSES = [
    { id:'warrior', ru:'Воин', en:'Vanguard', icon:'⚔', color:'#e8b25c', role:'Танк / ближний урон',
      res:'Ярость', resMax:100, resStart:45, regen:5, range:3.2, hpMult:1.18,
      skills:['Рассекающий','Клинок Рубежа','Рывок Щита','Стойка Бастиона','Вихрь Стали','Разломный Удар'],
      ult:'Последний Рубеж', element:'Физический' },
    { id:'paladin', ru:'Паладин', en:'Luminar', icon:'✜', color:'#f0d27a', role:'Танк / лекарь',
      res:'Убеждённость', resMax:120, resStart:60, regen:6, range:3.6, hpMult:1.14,
      skills:['Удар Веры','Молот Зари','Щит Светоча','Стопа Возжигателя','Карающий Луч','Печать Порядка'],
      ult:'Возжигание', element:'Свет' },
    { id:'assassin', ru:'Ассасин', en:'Nightblade', icon:'✧', color:'#8b6cc0', role:'Берст / контроль',
      res:'Очки Тени', resMax:100, resStart:50, regen:9, range:2.8, hpMult:0.92,
      skills:['Теневой Разрез','Отравленный Укол','Шаг Сквозь Трещину','Каскад Лезвий','Метка Жертвы','Контршаг'],
      ult:'Танец Семи Теней', element:'Тьма' },
    { id:'ranger', ru:'Лучник', en:'Pathfinder', icon:'➶', color:'#8fd08a', role:'Дальний урон / зона',
      res:'Фокус', resMax:100, resStart:70, regen:10, range:10.5, hpMult:0.95,
      skills:['Быстрый Выстрел','Пробивающая Стрела','Залп Трёх','Ловушка Троп','Шаг Охотника','Грозовая Стрела'],
      ult:'Клич Стаи', element:'Молния' },
    { id:'mage', ru:'Маг', en:'Aetherist', icon:'✺', color:'#4fd6d0', role:'Стихии / AoE',
      res:'Мана', resMax:100, resStart:100, regen:18, range:8.5, hpMult:0.90,
      skills:['Искра Эфира','Огненный Вихрь','Ледяная Игла','Цепь Молний','Астральный Барьер','Разрыв Стихий'],
      ult:'Седьмое Солнце', element:'Огонь' },
    { id:'necromancer', ru:'Некромант', en:'Ashbound', icon:'☠', color:'#b07ae8', role:'Призыв / проклятия',
      res:'Пепел Душ', resMax:100, resStart:40, regen:7, range:7.5, hpMult:1.02,
      skills:['Костяной Осколок','Поднять Скелета','Жатва Пепла','Проклятие Немого','Костяная Стена','Обмен Плоти'],
      ult:'Голем из Пепла', element:'Скверна' }
  ];
  A2.CLASS = id => A2.CLASSES.find(c => c.id === id) || A2.CLASSES[0];

  /* ------------------------------- 4 зоны ------------------------------- */
  A2.ZONES = [
    { id:'haven', ru:'Пристань Завета', en:'Covenant Haven', lv:[1,6], weather:'leaves', time:0.18,
      ground:['#3b3a30','#494634','#302f27'], accent:'#f0d27a', fog:'#2b2b22', sky:'#3f4236',
      props:['house','stall','well','statue','lamp','banner','flower','tent'],
      mobs:[], elite:null, boss:null, npc:[], safe:true,
      next:'grove', prev:null, spawn:[20,23], backSpawn:[33,33],
      music:'Пристань', desc:'Последний безопасный город. Здесь ещё держат слово.' },
    { id:'grove', ru:'Роща Завета', en:'Covenant Grove', lv:[1,15], weather:'leaves', time:0.28,
      ground:['#243b2c','#2d4a34','#1c3024'], accent:'#6fb26a', fog:'#14241c', sky:'#20352a',
      props:['oak','pine','boulder','grass','ruin','campfire','banner','flower'],
      mobs:['pepelnik','volk','drevny','shaman'], elite:'stareyshina', boss:'strazh',
      npc:[], next:'ash', prev:'haven', spawn:[6,6], backSpawn:[33,33],
      campSpots:[[16,9],[27,9],[18,27],[29,28],[24,32],[33,17],[12,25],[25,5]],
      music:'Роща', desc:'Первый Светоч ещё теплится. Лес помнит клятву.' },
    { id:'ash', ru:'Пепельная пустошь', en:'Ashen Waste', lv:[16,30], weather:'ash', time:0.52,
      ground:['#3a322c','#4a3a30','#2b2521'], accent:'#e08a4c', fog:'#2a201a', sky:'#3a2a22',
      props:['deadtree','boulder','ruin','campfire','crystal','bone','banner'],
      mobs:['pepelnik','golem','gryfon','kultist'], elite:'kapitan', boss:'pepelnyj',
      npc:['serg','mira'], next:'frost', prev:'grove', spawn:[6,6], backSpawn:[33,33],
      music:'Пустошь', desc:'Здесь сгорела первая армия Конклава.' },
    { id:'frost', ru:'Ледяной Рубеж', en:'Frostwall', lv:[31,45], weather:'snow', time:0.72,
      ground:['#2c3b48','#3b5060','#1e2c38'], accent:'#9fe8ff', fog:'#182a38', sky:'#1e3142',
      props:['pine','ice','boulder','ruin','campfire','bridge','banner'],
      mobs:['volk','ledyanoy','golem','prizrak'], elite:'voevoda', boss:'moroz',
      npc:['hilda','tomas'], next:'rift', prev:'ash', spawn:[6,6], backSpawn:[33,33],
      music:'Рубеж', desc:'Стена, где слово впервые предали.' },
    { id:'rift', ru:'Разлом', en:'The Rift', lv:[46,60], weather:'ember', time:0.90,
      ground:['#332433','#432b40','#241a28'], accent:'#c07bff', fog:'#1b1122', sky:'#2a1830',
      props:['crystal','deadtree','bone','ruin','campfire','obelisk','banner'],
      mobs:['kultist','demoon','prizrak','golem'], elite:'arhont', boss:'semoy',
      npc:['vesper','kira'], next:null, prev:'frost', spawn:[6,6], backSpawn:[33,33],
      music:'Разлом', desc:'Мир перестал держать слово. Отсюда он начал лгать.' }
  ];
  A2.ZONE = id => A2.ZONES.find(z => z.id === id) || A2.ZONES[0];

  /* ------------------------------- мобы ------------------------------- */
  // kind определяет процедурный спрайт; ai — поведение; loot — вес дропа.
  A2.MOBS = [
    { id:'maket', ru:'Учебный манекен', kind:'dummy', hp:0.06, dmg:0, armor:0, speed:0, aggro:0, xp:0.25, loot:0.8, ai:'dummy', element:'Физический', color:'#c8a870' },
    { id:'pepelnik', ru:'Пепельник', kind:'imp',     hp:0.28, dmg:0.22, armor:0.5, speed:1.9, aggro:7,  xp:1.0, loot:1.0, ai:'chase',  element:'Огонь', color:'#d2724c' },
    { id:'volk',     ru:'Пепельный волк', kind:'wolf', hp:0.24, dmg:0.30, armor:0.4, speed:3.1, aggro:9,  xp:1.1, loot:0.9, ai:'pack',   element:'Физический', color:'#8e8172' },
    { id:'drevny',   ru:'Древень', kind:'treant',   hp:0.75, dmg:0.28, armor:1.3, speed:1.2, aggro:6,  xp:1.7, loot:1.3, ai:'guard',  element:'Физический', color:'#5d8a52' },
    { id:'shaman',   ru:'Шаман Тления', kind:'caster',hp:0.35, dmg:0.42, armor:0.5, speed:1.8, aggro:11, xp:1.5, loot:1.4, ai:'caster', element:'Скверна', color:'#a878e0' },
    { id:'golem',    ru:'Каменный голем', kind:'golem',hp:1.25, dmg:0.40, armor:1.8, speed:1.1, aggro:6,  xp:2.0, loot:1.7, ai:'guard',  element:'Физический', color:'#7d8b94' },
    { id:'gryfon',   ru:'Пепельный грифон', kind:'flyer', hp:0.45, dmg:0.38, armor:0.6, speed:3.4, aggro:12, xp:1.8, loot:1.5, ai:'chase',  element:'Огонь', color:'#c98a5c' },
    { id:'kultist',  ru:'Кузнец Клятвы', kind:'caster',hp:0.42, dmg:0.48, armor:0.7, speed:1.9, aggro:12, xp:1.9, loot:1.6, ai:'caster', element:'Тьма', color:'#8b6cc0' },
    { id:'ledyanoy', ru:'Ледяной страж', kind:'golem', hp:0.95, dmg:0.46, armor:1.6, speed:1.4, aggro:8,  xp:2.2, loot:1.8, ai:'guard',  element:'Лёд', color:'#9fe8ff' },
    { id:'prizrak',  ru:'Призрак Завета', kind:'ghost', hp:0.38, dmg:0.52, armor:0.3, speed:2.6, aggro:14, xp:2.1, loot:1.7, ai:'chase',  element:'Тьма', color:'#b8c8e8' },
    { id:'demoon',   ru:'Истязатель Разлома', kind:'demon', hp:0.85, dmg:0.62, armor:1.1, speed:2.2, aggro:13, xp:2.7, loot:2.2, ai:'caster', element:'Скверна', color:'#c07bff' }
  ];
  A2.MOB = id => A2.MOBS.find(m => m.id === id) || A2.MOBS[0];
  A2.ELITES = {
    stareyshina:{ ru:'Старейшина Корней', mob:'drevny',   hp:6.5, dmg:1.8, color:'#f0b45c' },
    kapitan:    { ru:'Капитан Пепла',     mob:'kultist',  hp:6.0, dmg:2.0, color:'#ff9a5c' },
    voevoda:    { ru:'Воевода Стужи',     mob:'ledyanoy', hp:7.0, dmg:2.2, color:'#9fe8ff' },
    arhont:     { ru:'Архонт Лжи',        mob:'demoon',   hp:8.0, dmg:2.5, color:'#c07bff' }
  };
  A2.BOSSES = {
    strazh:  { ru:'Страж Рубежа',     hp:26, dmg:2.4, phases:4, enrage:90, color:'#e0574f' },
    pepelnyj:{ ru:'Пепельный Хор',    hp:30, dmg:2.8, phases:4, enrage:100, color:'#ff9a5c' },
    moroz:   { ru:'Мороз Без Имени',  hp:34, dmg:3.1, phases:4, enrage:110, color:'#9fe8ff' },
    semoy:   { ru:'Седьмое Солнце',   hp:42, dmg:3.6, phases:5, enrage:120, color:'#c07bff' }
  };

  /* ------------------------------- предметы ------------------------------- */
  A2.SLOTS = [
    { id:'weapon',  ru:'Оружие',   icon:'⚔', stat:'dmg',  base:1.00 },
    { id:'offhand', ru:'Левая рука',icon:'⛨', stat:'armor',base:0.62 },
    { id:'helm',    ru:'Шлем',     icon:'♛', stat:'hp',   base:0.58 },
    { id:'chest',   ru:'Нагрудник',icon:'▣', stat:'armor',base:0.85 },
    { id:'gloves',  ru:'Перчатки', icon:'✋', stat:'crit', base:0.42 },
    { id:'boots',   ru:'Сапоги',   icon:'⇧', stat:'speed',base:0.42 },
    { id:'amulet',  ru:'Амулет',   icon:'◈', stat:'power',base:0.50 },
    { id:'ring',    ru:'Кольцо',   icon:'○', stat:'power',base:0.46 }
  ];
  A2.BASE_NAMES = {
    weapon:['Клинок','Меч','Секира','Посох','Лук','Коса','Булава','Кинжал'],
    offhand:['Щит','Барьер','Фолиант','Колчан','Печать'], helm:['Шлем','Капюшон','Венец','Маска'],
    chest:['Латы','Панцирь','Роба','Мантия','Доспех'], gloves:['Рукавицы','Перчатки','Краги'],
    boots:['Сапоги','Ботфорты','Сандалии'], amulet:['Амулет','Талисман','Медальон'], ring:['Кольцо','Печатка','Обруч']
  };
  A2.SUFFIX = ['Рубежа','Пепла','Завета','Стужи','Искры','Тления','Клятвы','Рассвета','Бездны','Семи Огней'];
  A2.AFFIXES = [
    { id:'str',   ru:'Сила',            min:12,  max:48,  stat:'power' },
    { id:'agi',   ru:'Ловкость',        min:10,  max:40,  stat:'crit'  },
    { id:'vit',   ru:'Выносливость',    min:140, max:620, stat:'hp'    },
    { id:'arm',   ru:'Броня',           min:80,  max:360, stat:'armor' },
    { id:'crit',  ru:'Крит. шанс',      min:0.5, max:3.2, stat:'critPct', suffix:'%' },
    { id:'critd', ru:'Крит. урон',      min:3,   max:14,  stat:'critDmg', suffix:'%' },
    { id:'haste', ru:'Скорость атаки',  min:0.5, max:3.0, stat:'haste',  suffix:'%' },
    { id:'cdr',   ru:'Снижение КД',     min:0.5, max:2.8, stat:'cdr',    suffix:'%' },
    { id:'elem',  ru:'Урон стихией',    min:3,   max:15,  stat:'elem',   suffix:'%' },
    { id:'leech', ru:'Похищение жизни', min:0.4, max:2.2, stat:'leech',  suffix:'%' },
    { id:'gold',  ru:'Добыча золота',   min:2,   max:10,  stat:'gold',   suffix:'%' },
    { id:'xp',    ru:'Добыча опыта',    min:2,   max:9,   stat:'xp',     suffix:'%' }
  ];
  A2.SETS = [
    { id:'rubezh', ru:'Доспех Рубежа', pieces:4, bonus:'+18% брони, щит при BREAK' },
    { id:'pepel',  ru:'Пепел Конклава', pieces:4, bonus:'+22% урона Огнём, реакция не имеет КД' },
    { id:'zavet',  ru:'Семь Клятв',    pieces:5, bonus:'+15% урона группы, Гармония каждые 8 с' },
    { id:'stuzha', ru:'Хор Стужи',     pieces:4, bonus:'заморозка при 3 попаданиях, +12% DR' }
  ];
  A2.RUNES = ['Руна Ярости','Руна Света','Руна Тени','Руна Стужи','Руна Искры','Руна Тления'];
  A2.GEMS  = ['Самоцвет Силы','Самоцвет Воли','Самоцвет Точности','Самоцвет Пепла'];
  A2.MATS  = ['Пепельная руда','Древесина Завета','Ледяной кристалл','Осколок Разлома','Кожа зверя','Кость'];

  /* -------------------------------- НПС -------------------------------- */
  A2.NPCS = [
    { id:'eldara', ru:'Эльдара',   role:'Хранительница Светоча', zone:'haven', x:20, y:18, color:'#f0d27a',
      lines:['Мир не погиб. Он перестал держать слово.','Семь Светочей горели. Шесть ещё теплятся.','Сначала научись держать клятву — потом выходи за ворота.'],
      services:['quest','heal'], quests:[], story:true },
    { id:'borin',  ru:'Борин',     role:'Кузнец', zone:'haven', x:16, y:21, color:'#e8b25c',
      lines:['Сталь помнит каждый удар. Покажи, что принёс.','Заточка до +12. Выше — только клятва.'],
      services:['vendor','forge','salvage','market','trade'], quests:['q3'] },
    { id:'irina',  ru:'Ирина',     role:'Наставница', zone:'haven', x:24, y:21, color:'#4fd6d0',
      lines:['Каждый класс держит свою клятву. Выбери свою.','Таланты можно перековать в городе раз в сутки.'],
      services:['trainer','respec'], quests:[] },
    { id:'veya',   ru:'Вея',       role:'Лекарь Пристани', zone:'haven', x:17, y:25, color:'#8fd08a',
      lines:['В городе не умирают. Здесь просто снова начинают.','Если устал — постой у Светоча.'],
      services:['heal','vendor'], quests:[] },
    { id:'orin',   ru:'Орин',      role:'Казначей гильдии', zone:'haven', x:23, y:25, color:'#f0b45c',
      lines:['Комиссия в пять процентов сжигает Серебро. Так Завет держит цену.','Всё, что продаёшь, кто-то раньше нашёл.'],
      services:['vendor','market','trade'], quests:[] },
    { id:'dorn',   ru:'Дорн',      role:'Страж ворот', zone:'haven', x:31, y:31, color:'#9db0bd',
      lines:['За воротами Роща. Сначала манекены, потом Пепельники.','Дорога к вратам выложена камнем — не собьёшься.'],
      services:['quest','portal'], quests:[], story:true },
    { id:'torin',  ru:'Торин',     role:'Наставник двора', zone:'haven', x:28, y:27, color:'#c8a870',
      lines:['Три удара по манекену, и рука вспомнит, что умела.','Учебный двор безопасен: здесь даже сталь не отвечает.'],
      services:['trainer','vendor'], quests:[] },
    { id:'yaran',  ru:'Яран',      role:'Дозорный Рощи', zone:'grove', x:8, y:8, color:'#8fd08a',
      lines:['Держись тропы: первые лагеря дальше, у корней.','Пепельники пришли с пеплом первой армии.'],
      services:['quest','heal','vendor'], quests:['q1','q2'] },
    { id:'lidia',  ru:'Лидия',     role:'Торговка у тропы', zone:'grove', x:12, y:16, color:'#8fd08a',
      lines:['Держись тропы — я ставлю прилавок там, где ещё безопасно.','Лишнее разберу, нужное продам.'],
      services:['vendor','salvage','market'], quests:[] },
    { id:'serg',   ru:'Серж',      role:'Капитан дозора', zone:'ash', x:20, y:20, color:'#ff9a5c',
      lines:['Пустошь не прощает пауз. Считай мёртвых, не удары.'], services:['quest','vendor'], quests:['q4','q5'] },
    { id:'mira',   ru:'Мира',      role:'Торговка реликвиями', zone:'ash', x:14, y:26, color:'#b07ae8',
      lines:['Всё, что продаю, я сначала сама нашла. Почти всё.'], services:['vendor','gamble','market'], quests:['q6'] },
    { id:'hilda',  ru:'Хильда',    role:'Воевода Стены', zone:'frost', x:18, y:13, color:'#9fe8ff',
      lines:['Здесь предали слово впервые. Держи строй.'], services:['quest','heal','portal'], quests:['q7','q8'] },
    { id:'tomas',  ru:'Томас',     role:'Картограф', zone:'frost', x:25, y:24, color:'#8fd08a',
      lines:['Карта врёт меньше, чем люди. Но тоже врёт.'], services:['vendor','map','market','trade'], quests:['q9'] },
    { id:'vesper', ru:'Веспер',    role:'Голос Разлома', zone:'rift', x:20, y:18, color:'#c07bff',
      lines:['Ты пришёл услышать правду? Её здесь не осталось.','Убей то, что носит моё имя, и получишь покой.'],
      services:['quest','portal','forge'], quests:['q10','q11','q12'] },
    { id:'kira',   ru:'Кира',      role:'Сборщица душ', zone:'rift', x:11, y:29, color:'#4fd6d0',
      lines:['Каждая душа — это чей-то невыполненный обет.'], services:['vendor','salvage'], quests:[] }
  ];
  A2.NPC = id => A2.NPCS.find(n => n.id === id);

  /* ------------------------------- квесты ------------------------------- */
  // type: kill | collect | talk | explore | elite | boss | event
  A2.QUESTS = [
    { id:'q1', ru:'Первый пепел',     zone:'grove', npc:'yaran', type:'kill',    target:'pepelnik', need:8,
      xp:1400, gold:320, rep:15, item:1, next:'q2', text:'Роща задыхается. Очисти корни от Пепельников.' },
    { id:'q2', ru:'Корни помнят',    zone:'grove', npc:'yaran', type:'collect', target:'Древесина Завета', need:5,
      xp:2100, gold:480, rep:20, item:1, next:'q3', text:'Принеси древесину: из неё кузнец выкует оберег.' },
    { id:'q3', ru:'Сталь и клятва',  zone:'grove', npc:'borin',  type:'elite',   target:'stareyshina', need:1,
      xp:3600, gold:760, rep:30, item:2, next:'q4', text:'Старейшина Корней одичал. Останови его.' },
    { id:'q4', ru:'Дозор пустоши',   zone:'ash',   npc:'serg',   type:'kill',    target:'kultist', need:12,
      xp:5200, gold:980, rep:35, item:2, next:'q5', text:'Кузнецы Клятвы снова собирают армию.' },
    { id:'q5', ru:'Пепельный Хор',   zone:'ash',   npc:'serg',   type:'boss',    target:'pepelnyj', need:1,
      xp:9800, gold:2100, rep:60, item:3, next:'q6', text:'Собери группу. Хор поёт только когда горит.' },
    { id:'q6', ru:'Реликвия Миры',   zone:'ash',   npc:'mira',   type:'collect', target:'Пепельная руда', need:8,
      xp:6400, gold:1300, rep:40, item:2, next:'q7', text:'Руда из первой армии всё ещё тёплая.' },
    { id:'q7', ru:'Стена молчит',    zone:'frost', npc:'hilda',  type:'kill',    target:'ledyanoy', need:10,
      xp:8200, gold:1700, rep:45, item:2, next:'q8', text:'Стражи не узнают своих. Разбуди их.' },
    { id:'q8', ru:'Мороз без имени', zone:'frost', npc:'hilda',  type:'boss',    target:'moroz', need:1,
      xp:14000, gold:2900, rep:70, item:3, next:'q9', text:'Он носит имя, которое мы вычеркнули.' },
    { id:'q9', ru:'Карта, которая врёт', zone:'frost', npc:'tomas', type:'explore', target:'rift_gate', need:1,
      xp:9000, gold:1900, rep:50, item:2, next:'q10', text:'Дойди до врат Разлома и вернись с отметкой.' },
    { id:'q10', ru:'Голос Разлома',  zone:'rift',  npc:'vesper', type:'kill',    target:'demoon', need:14,
      xp:12000, gold:2400, rep:55, item:2, next:'q11', text:'Истязатели говорят его голосом.' },
    { id:'q11', ru:'Архонт Лжи',     zone:'rift',  npc:'vesper', type:'elite',   target:'arhont', need:1,
      xp:16000, gold:3200, rep:65, item:3, next:'q12', text:'Он знает, где седьмой Светоч.' },
    { id:'q12', ru:'Мир помнит',     zone:'rift',  npc:'vesper', type:'boss',    target:'semoy', need:1,
      xp:34000, gold:7200, rep:120, item:4, next:null, text:'Последний акт Завета. Оставь след в летописи.' }
  ];
  A2.QUEST = id => A2.QUESTS.find(q => q.id === id);

  /* ------------------------- АКТ I · ПРОЛОГ ------------------------- */
  // Девять глав ведут новичка от пробуждения в безопасном городе до ворот.
  // Каждая глава выдаёт ровно одну вещь экипировки: снаряжение собирается
  // постепенно, а не падает легендарками на первой секунде.
  A2.STORY = [
    { id:'c1', act:'АКТ I · ПРОЛОГ', ru:'Пробуждение', zone:'haven', npc:'eldara',
      text:'Ты просыпаешься у последнего Светоча. Шесть остальных погасли, седьмой едва теплятся. Эльдара говорит, что мир не погиб — он просто перестал держать слово. Сначала надо вспомнить, как его держать.',
      objective:{ type:'talk', target:'eldara', need:1, ru:'Поговорить с Эльдарой у Светоча' },
      waypoint:{ zone:'haven', x:20, y:19.5 },
      reward:{ xp:160, gold:90, ilvl:2, slot:'chest', rarity:'common', ru:'Походный плащ Завета' },
      hint:'Подойдите к Эльдаре у центрального Светоча и нажмите «Взаим.' },
    { id:'c2', act:'АКТ I · ПРОЛОГ', ru:'Голоса Пристани', zone:'haven', npc:'borin',
      text:'В Пристани Завета ещё живут ремесло, торговля и память. Эльдара просит обойти мастеровых: кузнеца Борина, наставницу Ирину и лекаря Вею. Каждый хранит часть того, что мир забыл.',
      objective:{ type:'meet', targets:['borin','irina','veya'], need:3, ru:'Познакомиться с 3 жителями Пристани' },
      waypoint:{ zone:'haven', x:20, y:22 },
      reward:{ xp:240, gold:130, ilvl:3, slot:'helm', rarity:'common', ru:'Капюшон Пристани' },
      hint:'НПС отмечены жёлтым на мини-карте. Поговорите с Борином, Ириной и Веей.' },
    { id:'c3', act:'АКТ I · ПРОЛОГ', ru:'Дорога к учебному двору', zone:'haven', npc:'torin',
      text:'За площадью, по выложенной камнем дороге, лежит учебный двор. Там даже сталь не отвечает ударом — можно вспомнить руку без риска.',
      objective:{ type:'reach', target:'yard', need:1, ru:'Дойти до учебного двора' },
      waypoint:{ zone:'haven', x:28.5, y:28 },
      reward:{ xp:320, gold:170, ilvl:4, slot:'boots', rarity:'common', ru:'Сапоги дозорного' },
      hint:'Идите по каменной дороге на юго-восток, к манекенам. Цель отмечена на мини-карте.' },
    { id:'c4', act:'АКТ I · ПРОЛОГ', ru:'Снаряжение', zone:'haven', npc:'irina',
      text:'Плащ, выданный Эльдарой, лежит в сумке. Ирина напоминает: вещь ничего не значит, пока не надета. Открой «Снаряжение» и надень её сами — или доверься кнопке «Надеть лучшее».',
      objective:{ type:'equip', target:'any', need:1, ru:'Надеть любой предмет из сумки' },
      waypoint:null,
      reward:{ xp:420, gold:210, ilvl:5, slot:'gloves', rarity:'rare', ru:'Перчатки первой клятвы' },
      hint:'Нажмите «⚔ Снаряжение» в нижней панели (или тап по портрету) и наденьте предмет.' },
    { id:'c5', act:'АКТ I · ПРОЛОГ', ru:'Пробный удар', zone:'haven', npc:'torin',
      text:'Три удара по манекенам — и рука вспомнит, что умела. Манекены не атакуют и быстро восстанавливаются: это не бой, это память тела.',
      objective:{ type:'kill', target:'maket', need:3, ru:'Разбить 3 учебных манекена' },
      waypoint:{ zone:'haven', x:28.5, y:28 },
      reward:{ xp:560, gold:270, ilvl:6, slot:'amulet', rarity:'rare', ru:'Оберег Светоча', mats:4 },
      hint:'Подойдите к манекенам: автоатака включится сама. Лут подберётся магнитом.' },
    { id:'c6', act:'АКТ I · ПРОЛОГ', ru:'Первая добыча', zone:'haven', npc:'orin',
      text:'Даже с манекена что-то остаётся. Орин учит считать добычу: вещи поднимаются сами, а всё лишнее можно продать или разобрать.',
      objective:{ type:'loot', target:'any', need:3, ru:'Подобрать 3 предмета' },
      waypoint:null,
      reward:{ xp:680, gold:310, ilvl:7, slot:'ring', rarity:'rare', ru:'Кольцо Пристани' },
      hint:'Добейте ещё манекенов или нажмите «✦ Забрать лут», если вещи лежат рядом.' },
    { id:'c7', act:'АКТ I · ПРОЛОГ', ru:'Сталь и клятва', zone:'haven', npc:'borin',
      text:'Борин берёт первый осколок и закаляет вещь. «Заточка до +12, — говорит он. — Выше — только клятва».',
      objective:{ type:'enchant', target:'any', need:1, ru:'Заточить предмет в кузнице' },
      waypoint:{ zone:'haven', x:16, y:21 },
      reward:{ xp:820, gold:400, ilvl:8, slot:'weapon', rarity:'rare', ru:'Клинок Пристани', mats:3 },
      hint:'Поговорите с Борином → «Кузница», либо откройте Снаряжение → «Заточить всё».' },
    { id:'c8', act:'АКТ I · ПРОЛОГ', ru:'Прилавок', zone:'haven', npc:'orin',
      text:'Казначей объясняет закон города: пять процентов комиссии сжигают Серебро, чтобы цена не расползалась. Продайте или выставьте одну лишнюю вещь.',
      objective:{ type:'sell', target:'any', need:1, ru:'Продать или выставить предмет' },
      waypoint:{ zone:'haven', x:23, y:25 },
      reward:{ xp:960, gold:520, ilvl:9, slot:'offhand', rarity:'rare', ru:'Печать Завета' },
      hint:'Сумка → предмет → «Продать» или «На рынок». Можно сразу у Орина.' },
    { id:'c9', act:'АКТ I · ПРОЛОГ', ru:'За ворота', zone:'haven', npc:'dorn',
      text:'Дорн отпирает ворота. За ними — Роща, первые лагеря и длинная цепочка Завета из двенадцати глав. Пристань останется позади, но вернуться можно всегда.',
      objective:{ type:'gate', target:'grove', need:1, ru:'Пройти через ворота в Рощу Завета' },
      waypoint:{ zone:'haven', x:35, y:35 },
      reward:{ xp:1300, gold:750, ilvl:12, slot:'chest', rarity:'epic', ru:'Доспех Возжённого', mats:5 },
      hint:'Идите к воротам на юго-востоке и нажмите «Взаим.» у портала.' }
  ];
  A2.STORY_COUNT = A2.STORY.length;

  /* ------------------------------ таланты ------------------------------ */
  A2.TALENTS = [
    { id:'steel', ru:'Сталь', color:'#e8b25c', nodes:[
      { id:'t1', ru:'Закалка',      desc:'+8% брони',            mod:{armor:0.08} },
      { id:'t2', ru:'Тяжёлый Шаг',  desc:'−10% урона от AoE',   mod:{aoeDR:0.10} },
      { id:'t3', ru:'Незыблемость', desc:'иммунитет к отбрасыванию', mod:{ccRes:0.25} },
      { id:'t4', ru:'Второй Дых',   desc:'+12% макс. HP',        mod:{hp:0.12} },
      { id:'t5', ru:'Живой Щит',    desc:'щит 6% HP после крита', mod:{shieldOnCrit:0.06} },
      { id:'t6', ru:'Клятва Рубежа',desc:'+15% урона после BREAK',mod:{breakDmg:0.15} }
    ]},
    { id:'blood', ru:'Кровь', color:'#e0574f', nodes:[
      { id:'b1', ru:'Жажда',        desc:'+1.5% похищения жизни', mod:{leech:0.015} },
      { id:'b2', ru:'Рваные Раны',  desc:'+10% урона по раненым', mod:{wounded:0.10} },
      { id:'b3', ru:'Берсерк',      desc:'+0.4% урона за 1% потерянного HP', mod:{berserk:0.4} },
      { id:'b4', ru:'Кровавый Счёт',desc:'каждые 3 удара +8% урона', mod:{combo:0.08} },
      { id:'b5', ru:'Смертельный Темп', desc:'+6% скорости атаки', mod:{haste:0.06} },
      { id:'b6', ru:'Пепел в Жилах',desc:'крит +12% урона',      mod:{critDmg:0.12} }
    ]},
    { id:'banner', ru:'Знамя', color:'#4fd6d0', nodes:[
      { id:'n1', ru:'Голос',        desc:'+8% опыта',            mod:{xp:0.08} },
      { id:'n2', ru:'Строй',        desc:'+6% брони группы',    mod:{partyArmor:0.06} },
      { id:'n3', ru:'Общий Боезапас', desc:'+10% радиус подбора', mod:{pickup:0.10} },
      { id:'n4', ru:'Сигнал Контратаки', desc:'+9% урона после доджа', mod:{dodgeDmg:0.09} },
      { id:'n5', ru:'Знаменосец',   desc:'+12% золота',          mod:{gold:0.12} },
      { id:'n6', ru:'Воля Полководца', desc:'+18% урона ультимейта', mod:{ult:0.18} }
    ]}
  ];

  /* ------------------------------ утилиты ------------------------------ */
  A2.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  A2.lerp = (a, b, t) => a + (b - a) * t;
  A2.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  A2.hash = (x, y, s) => {
    let h = (x * 374761393 + y * 668265263 + (s | 0) * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  A2.rng = seed => { let s = (seed | 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return ((s >>> 0) / 4294967296); }; };
  A2.pick = (arr, r) => arr[Math.floor((r || Math.random()) * arr.length) % arr.length];
  A2.pairKey = (a, b) => {
    const ia = A2.ELEMENTS.indexOf(a), ib = A2.ELEMENTS.indexOf(b);
    return ia <= ib ? a + '+' + b : b + '+' + a;
  };
  A2.fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
  A2.xpNext = lv => Math.round(A2.C.XP_BASE * Math.pow(A2.C.XP_GROWTH, lv - 1));
})();
