-- ==========================================================================
-- ARKEON: Пепел Завета · Схема OLTP (PostgreSQL 17, шард по realm_id)
-- Автор: Backend Architect · Версия 1.0 · См. docs/10-db.md
--
-- Три контура хранения:
--   1) GLOBAL  (CockroachDB, multi-region): аккаунты, платежи, баны, флаги.
--   2) REALM   (PostgreSQL 17, 12 шардов/регион): персонажи, предметы,
--               Ledger, рынок, гильдии, мир. Один шард = один реалм 4 000 CCU.
--   3) ANALYTICS (Kafka -> ClickHouse + S3 Parquet): события, телеметрия.
--
-- Инварианты (см. docs/10-db.md §5):
--   I1 один item_uid = один владелец = одна локация;
--   I2 каждая проводка сбалансирована (SUM(debit)=SUM(credit) в tx_id);
--   I3 баланс кошелька неотрицателен;
--   I4 все мутации идемпотентны по idempotency_key;
--   I5 клиент НИКОГДА не пишет в эти таблицы напрямую.
-- ==========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE SCHEMA IF NOT EXISTS global;
CREATE SCHEMA IF NOT EXISTS realm;
CREATE SCHEMA IF NOT EXISTS audit;

-- ===== Перечисления =====
CREATE TYPE realm.item_location AS ENUM ('inventory','equipped','bank','guild_bank','market_escrow','trade_escrow','contract_escrow','loot_bag','auction_escrow','destroyed');
CREATE TYPE realm.bind_mode AS ENUM ('free','bind_on_equip','bind_on_pickup','account_bound');
CREATE TYPE realm.rarity AS ENUM ('common','rare','epic','legendary','mythic','unique');
CREATE TYPE realm.law_zone AS ENUM ('green','yellow','red','black');
CREATE TYPE realm.order_side AS ENUM ('buy','sell');
CREATE TYPE realm.order_status AS ENUM ('open','filled','cancelled','expired');
CREATE TYPE global.ban_kind AS ENUM ('chat','economy','pvp','account');

-- ==========================================================================
-- 1. GLOBAL: аккаунты, авторизация, платежи, соответствие
-- ==========================================================================
CREATE TABLE global.accounts (
  account_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  region_home       TEXT NOT NULL CHECK (region_home IN ('EU','NA','APAC','CIS')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','deleted')),
  age_gate_passed   BOOLEAN NOT NULL DEFAULT false,
  locale            TEXT NOT NULL DEFAULT 'en',
  mfa_enabled       BOOLEAN NOT NULL DEFAULT false,
  tos_version       TEXT NOT NULL,
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX accounts_region_idx ON global.accounts(region_home) WHERE status = 'active';

CREATE TABLE global.account_identities (
  identity_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES global.accounts(account_id),
  provider          TEXT NOT NULL CHECK (provider IN ('google','apple','steam','epic','email')),
  provider_subject  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE TABLE global.account_devices (
  device_id         TEXT PRIMARY KEY,
  account_id        UUID NOT NULL REFERENCES global.accounts(account_id),
  platform          TEXT NOT NULL CHECK (platform IN ('android','ios','windows')),
  attestation       TEXT NOT NULL CHECK (attestation IN ('trusted','suspicious','failed')),
  first_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE global.sessions (
  session_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES global.accounts(account_id),
  device_id         TEXT NOT NULL REFERENCES global.account_devices(device_id),
  realm_id          SMALLINT,
  refresh_hash      TEXT NOT NULL,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ
);
CREATE INDEX sessions_active_idx ON global.sessions(account_id) WHERE revoked_at IS NULL;

-- Премиальный кошелёк. Кристаллы Зари НЕ конвертируются и НЕ передаются.
CREATE TABLE global.premium_wallet (
  account_id        UUID PRIMARY KEY REFERENCES global.accounts(account_id),
  balance_dc        BIGINT NOT NULL DEFAULT 0 CHECK (balance_dc >= 0),
  lifetime_spent_dc BIGINT NOT NULL DEFAULT 0,
  revision          BIGINT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE global.billing_transactions (
  tx_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES global.accounts(account_id),
  store             TEXT NOT NULL CHECK (store IN ('google','apple','steam','epic','web')),
  store_order_id    TEXT NOT NULL,
  product_id        TEXT NOT NULL,             -- ТОЛЬКО косметика / BP
  amount_dc         BIGINT NOT NULL CHECK (amount_dc > 0),
  fiat_amount       NUMERIC(12,2),
  currency          CHAR(3),
  status            TEXT NOT NULL CHECK (status IN ('pending','settled','refunded','chargeback')),
  idempotency_key   TEXT NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store, store_order_id)
);

CREATE TABLE global.entitlements (
  entitlement_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES global.accounts(account_id),
  cosmetic_id       TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('purchase','battlepass','achievement','event','compensation')),
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, cosmetic_id)
);

CREATE TABLE global.bans (
  ban_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES global.accounts(account_id),
  kind              global.ban_kind NOT NULL,
  risk_score        SMALLINT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  reason_code       TEXT NOT NULL,
  issued_by         TEXT NOT NULL,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  appeal_state      TEXT NOT NULL DEFAULT 'none' CHECK (appeal_state IN ('none','pending','upheld','reversed')),
  evidence_hash     TEXT
);

CREATE TABLE global.consent_log (
  consent_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES global.accounts(account_id),
  purpose           TEXT NOT NULL CHECK (purpose IN ('voice_record','analytics','marketing','personalization')),
  granted           BOOLEAN NOT NULL,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE global.gdpr_erasure_queue (
  account_id        UUID PRIMARY KEY REFERENCES global.accounts(account_id),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  scope             TEXT NOT NULL DEFAULT 'pii_only'   -- игровые события остаются обезличенными
);

CREATE TABLE global.feature_flags (
  flag_key          TEXT PRIMARY KEY,
  enabled           BOOLEAN NOT NULL DEFAULT false,
  rollout_pct       SMALLINT NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE global.config_versions (
  config_key        TEXT NOT NULL,
  version           BIGINT NOT NULL,
  payload           JSONB NOT NULL,           -- боевые коэффициенты/таблицы дропа
  checksum          TEXT NOT NULL,
  published_by      TEXT NOT NULL,
  published_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (config_key, version)
);

-- ==========================================================================
-- 2. REALM: персонажи и прогрессия
-- ==========================================================================
CREATE TABLE realm.realms (
  realm_id          SMALLINT PRIMARY KEY,
  region            TEXT NOT NULL CHECK (region IN ('EU','NA','APAC','CIS')),
  name              TEXT NOT NULL UNIQUE,
  capacity_ccu      INT NOT NULL DEFAULT 4000,
  status            TEXT NOT NULL DEFAULT 'online'
);

CREATE TABLE realm.characters (
  character_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL,                     -- FK логический: global БД отделена
  realm_id          SMALLINT NOT NULL REFERENCES realm.realms(realm_id),
  name              TEXT NOT NULL,
  class_id          TEXT NOT NULL CHECK (class_id IN ('warrior','paladin','assassin','ranger','mage','necromancer')),
  spec_id           TEXT,
  level             SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 60),
  xp                BIGINT NOT NULL DEFAULT 0,
  paragon_level     SMALLINT NOT NULL DEFAULT 0 CHECK (paragon_level <= 300),
  item_power        INT NOT NULL DEFAULT 300,
  law_zone          realm.law_zone NOT NULL DEFAULT 'green',
  last_pos          JSONB NOT NULL DEFAULT '{"x":0,"y":0,"z":0}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE (realm_id, lower(name))
);
CREATE INDEX characters_account_idx ON realm.characters(account_id);
CREATE INDEX characters_name_trgm ON realm.characters USING gin (name gin_trgm_ops);

CREATE TABLE realm.character_stats (
  character_id      UUID PRIMARY KEY REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  hp                INT NOT NULL DEFAULT 12000,
  attack            INT NOT NULL DEFAULT 1800,
  defense           INT NOT NULL DEFAULT 2400,
  crit_chance       NUMERIC(5,4) NOT NULL DEFAULT 0.05,
  crit_multiplier   NUMERIC(5,4) NOT NULL DEFAULT 1.50,
  elemental_resist  JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision          BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE realm.currencies (
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  currency          TEXT NOT NULL CHECK (currency IN ('silver','valor','ashes')),
  balance           BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  revision          BIGINT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, currency)
);

CREATE TABLE realm.skill_loadouts (
  loadout_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  slot_index        SMALLINT NOT NULL CHECK (slot_index BETWEEN 0 AND 9),
  skills            JSONB NOT NULL,                  -- 6 skill_id + ultimate
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (character_id, slot_index)
);

CREATE TABLE realm.talent_allocations (
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  branch            TEXT NOT NULL,
  node_key          TEXT NOT NULL,
  rank              SMALLINT NOT NULL CHECK (rank BETWEEN 1 AND 3),
  PRIMARY KEY (character_id, branch, node_key)
);

CREATE TABLE realm.paragon_allocations (
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  board             TEXT NOT NULL,
  node_key          TEXT NOT NULL,
  allocated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, board, node_key)
);

CREATE TABLE realm.reputations (
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  faction_id        TEXT NOT NULL CHECK (faction_id IN ('conclave','freeport','chorus','circle','throne')),
  rank              SMALLINT NOT NULL DEFAULT 0 CHECK (rank BETWEEN 0 AND 9),
  points            INT NOT NULL DEFAULT 0,
  choice_flag       TEXT,                            -- взаимоисключающий выбор на 7 ранге
  PRIMARY KEY (character_id, faction_id)
);

CREATE TABLE realm.achievements (
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  achievement_id    TEXT NOT NULL,
  unlocked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  progress          JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (character_id, achievement_id)
);

CREATE TABLE realm.collections (
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  collection_id     TEXT NOT NULL,
  entries           JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_at      TIMESTAMPTZ,
  PRIMARY KEY (character_id, collection_id)
);

CREATE TABLE realm.titles (
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  title_id          TEXT NOT NULL,
  equipped          BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (character_id, title_id)
);
CREATE UNIQUE INDEX titles_one_equipped ON realm.titles(character_id) WHERE equipped;

CREATE TABLE realm.battlepass_progress (
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  season_id         SMALLINT NOT NULL,
  tier              SMALLINT NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 100),
  xp                INT NOT NULL DEFAULT 0,
  premium_unlocked  BOOLEAN NOT NULL DEFAULT false,
  claimed_tiers     JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (character_id, season_id)
);

CREATE TABLE realm.pvp_ratings (
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  season_id         SMALLINT NOT NULL,
  mode              TEXT NOT NULL,
  rating            NUMERIC(7,2) NOT NULL DEFAULT 1500,
  rd                NUMERIC(6,2) NOT NULL DEFAULT 350,
  volatility        NUMERIC(6,4) NOT NULL DEFAULT 0.06,
  rank_tier         SMALLINT NOT NULL DEFAULT 0,
  games             INT NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, season_id, mode)
);
CREATE INDEX pvp_ratings_lb ON realm.pvp_ratings(season_id, mode, rating DESC);

CREATE TABLE realm.matchmaking_queue (
  ticket_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id) ON DELETE CASCADE,
  mode              TEXT NOT NULL,
  input_type        TEXT NOT NULL CHECK (input_type IN ('touch','kbm','gamepad')),
  rating            NUMERIC(7,2) NOT NULL,
  party_id          UUID,
  enqueued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  tolerance         INT NOT NULL DEFAULT 25
);
CREATE INDEX mm_queue_lookup ON realm.matchmaking_queue(mode, input_type, rating, enqueued_at);

CREATE TABLE realm.matches (
  match_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode              TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  winning_team      SMALLINT,
  server_instance   TEXT NOT NULL,
  seed              TEXT NOT NULL
);

CREATE TABLE realm.match_participants (
  match_id          UUID NOT NULL REFERENCES realm.matches(match_id),
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id),
  team              SMALLINT NOT NULL,
  damage            BIGINT NOT NULL DEFAULT 0,
  healing           BIGINT NOT NULL DEFAULT 0,
  deaths            SMALLINT NOT NULL DEFAULT 0,
  rating_delta      NUMERIC(6,2),
  PRIMARY KEY (match_id, character_id)
);

-- ==========================================================================
-- 3. ПРЕДМЕТЫ: один UID, один владелец, вся история в ledger
-- ==========================================================================
CREATE TABLE realm.item_definitions (
  def_id            TEXT PRIMARY KEY,
  name_key          TEXT NOT NULL,
  rarity            realm.rarity NOT NULL,
  tier              SMALLINT NOT NULL CHECK (tier BETWEEN 2 AND 8),
  slot              TEXT NOT NULL,
  base_ip           INT NOT NULL,
  affix_budget      INT NOT NULL,
  affix_pool        JSONB NOT NULL,
  set_id            TEXT,
  stat_power        INT NOT NULL DEFAULT 0,          -- 0 у косметики, проверяется линтером
  is_cosmetic       BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE realm.item_instances (
  item_uid          UUID PRIMARY KEY,                -- UUIDv7 генерируется СЕРВЕРОМ
  def_id            TEXT NOT NULL REFERENCES realm.item_definitions(def_id),
  owner_id          UUID NOT NULL REFERENCES realm.characters(character_id),
  location          realm.item_location NOT NULL DEFAULT 'inventory',
  container_ref     UUID,                            -- bank/guild/escrow/loot_bag id
  bind              realm.bind_mode NOT NULL DEFAULT 'free',
  rarity            realm.rarity NOT NULL,
  item_power        INT NOT NULL,
  affixes           JSONB NOT NULL DEFAULT '[]'::jsonb,
  sockets           JSONB NOT NULL DEFAULT '[]'::jsonb,
  runes             JSONB NOT NULL DEFAULT '[]'::jsonb,
  gems              JSONB NOT NULL DEFAULT '[]'::jsonb,
  set_id            TEXT,
  enchant_level     SMALLINT NOT NULL DEFAULT 0 CHECK (enchant_level BETWEEN 0 AND 12),
  reroll_count      SMALLINT NOT NULL DEFAULT 0 CHECK (reroll_count <= 25),
  durability        SMALLINT NOT NULL DEFAULT 100,
  max_durability    SMALLINT NOT NULL DEFAULT 100,
  repair_count      SMALLINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT NOT NULL,                   -- 'drop:<drop_id>' | 'craft:<tx_id>' | 'grant:<tx_id>'
  revision          BIGINT NOT NULL DEFAULT 0,
  prev_hash         TEXT,
  row_hash          TEXT NOT NULL,                  -- HMAC-цепочка истории владения
  CHECK (durability <= max_durability),
  CHECK (location <> 'destroyed' OR owner_id IS NOT NULL)
);
CREATE UNIQUE INDEX item_single_owner ON realm.item_instances(item_uid);
CREATE INDEX item_owner_location ON realm.item_instances(owner_id, location);
CREATE INDEX item_container ON realm.item_instances(container_ref) WHERE container_ref IS NOT NULL;
-- I1: предмет не может одновременно лежать в двух контейнерах одного типа
CREATE UNIQUE INDEX item_no_double_escrow ON realm.item_instances(item_uid)
  WHERE location IN ('market_escrow','trade_escrow','contract_escrow','auction_escrow');

CREATE TABLE realm.item_history (
  seq               BIGSERIAL PRIMARY KEY,
  item_uid          UUID NOT NULL REFERENCES realm.item_instances(item_uid),
  tx_id             UUID NOT NULL,
  event             TEXT NOT NULL CHECK (event IN ('created','moved','equipped','enchanted','rerolled','socketed','repaired','bound','burned')),
  from_owner        UUID,
  to_owner          UUID,
  from_location     realm.item_location,
  to_location       realm.item_location,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  hash              TEXT NOT NULL                    -- hash = HMAC(secret, prev_hash || row)
);
CREATE INDEX item_history_item ON realm.item_history(item_uid, seq);

CREATE TABLE realm.drop_audit (
  drop_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id      UUID NOT NULL,
  source            TEXT NOT NULL,                   -- mob_id / boss_id / cache_id
  server_tick       BIGINT NOT NULL,
  rng_seed          TEXT NOT NULL,                  -- HMAC(server_secret, drop_id||char||tick)
  rolled_value      NUMERIC(10,8) NOT NULL,
  result_rarity     realm.rarity NOT NULL,
  item_uid          UUID,
  pity_counter      SMALLINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX drop_audit_char ON realm.drop_audit(character_id, created_at DESC);

CREATE TABLE realm.loot_bags (
  bag_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone              realm.law_zone NOT NULL,
  victim_id         UUID NOT NULL,
  killer_id         UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  burned_pct        SMALLINT NOT NULL               -- 0 / 25 / 30 по зоне закона
);

-- ==========================================================================
-- 4. LEDGER: двойная запись, идемпотентность, escrow, саги
-- ==========================================================================
CREATE TABLE realm.ledger_accounts (
  account_key       TEXT PRIMARY KEY,               -- 'char:<uuid>:silver' | 'market:fee' | 'burn'
  owner_id          UUID,
  kind              TEXT NOT NULL CHECK (kind IN ('wallet','fee','escrow','burn','guild')),
  balance           BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  revision          BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE realm.idempotency_keys (
  idempotency_key   TEXT PRIMARY KEY,
  tx_id             UUID NOT NULL,
  result_payload    JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE realm.ledger_transactions (
  tx_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              TEXT NOT NULL CHECK (kind IN ('faucet','mint','sink','transfer','market','trade','contract','craft','guild_tax','burn','refund')),
  idempotency_key   TEXT UNIQUE REFERENCES realm.idempotency_keys(idempotency_key),
  initiator         UUID,
  status            TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('pending','committed','rolled_back')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta              JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE realm.ledger_entries (
  entry_id          BIGSERIAL PRIMARY KEY,
  tx_id             UUID NOT NULL REFERENCES realm.ledger_transactions(tx_id),
  account_key       TEXT NOT NULL REFERENCES realm.ledger_accounts(account_key),
  debit             BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit            BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency          TEXT NOT NULL DEFAULT 'silver',
  item_uid          UUID,                            -- для предметных проводок
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (debit = 0 OR credit = 0)                   -- строка — либо дебет, либо кредит
);
CREATE INDEX ledger_entries_tx ON realm.ledger_entries(tx_id);
CREATE INDEX ledger_entries_account ON realm.ledger_entries(account_key, created_at DESC);

-- I2: триггер сбалансированности проводок
CREATE OR REPLACE FUNCTION realm.fn_validate_ledger() RETURNS trigger AS $$
DECLARE d BIGINT; c BIGINT;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c
  FROM realm.ledger_entries WHERE tx_id = NEW.tx_id;
  IF d <> c THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED tx=% debit=% credit=%', NEW.tx_id, d, c;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_balance_check
  AFTER INSERT ON realm.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION realm.fn_validate_ledger();

-- I3: неотрицательный баланс кошелька
CREATE OR REPLACE FUNCTION realm.fn_wallet_nonnegative() RETURNS trigger AS $$
BEGIN
  IF NEW.balance < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_BALANCE account=%', NEW.account_key;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER wallet_nonnegative BEFORE UPDATE ON realm.ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION realm.fn_wallet_nonnegative();

CREATE TABLE realm.escrow (
  escrow_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              TEXT NOT NULL CHECK (kind IN ('market','trade','contract','auction','saga')),
  item_uid          UUID REFERENCES realm.item_instances(item_uid),
  silver            BIGINT NOT NULL DEFAULT 0,
  owner_id          UUID NOT NULL,
  counterparty      UUID,
  expires_at        TIMESTAMPTZ NOT NULL,
  released_at       TIMESTAMPTZ
);
CREATE INDEX escrow_open ON realm.escrow(expires_at) WHERE released_at IS NULL;

CREATE TABLE realm.sagas (
  saga_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('started','reserved','committed','compensating','failed','done')),
  source_realm      SMALLINT NOT NULL,
  target_realm      SMALLINT NOT NULL,
  payload           JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm.saga_steps (
  saga_id           UUID NOT NULL REFERENCES realm.sagas(saga_id),
  step_no           SMALLINT NOT NULL,
  action            TEXT NOT NULL,
  compensating_action TEXT NOT NULL,
  status            TEXT NOT NULL,
  PRIMARY KEY (saga_id, step_no)
);

-- ==========================================================================
-- 5. РЫНОК, АУКЦИОН, ТРЕЙД, КОНТРАКТЫ, КРАФТ
-- ==========================================================================
CREATE TABLE realm.market_orders (
  order_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id      UUID NOT NULL REFERENCES realm.characters(character_id),
  item_uid          UUID REFERENCES realm.item_instances(item_uid),
  def_id            TEXT,
  side              realm.order_side NOT NULL,
  price             BIGINT NOT NULL CHECK (price > 0),
  quantity          INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  filled            INT NOT NULL DEFAULT 0,
  status            realm.order_status NOT NULL DEFAULT 'open',
  listing_fee       BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  CHECK (side = 'buy' OR item_uid IS NOT NULL)
);
CREATE INDEX market_book ON realm.market_orders(def_id, side, price, created_at) WHERE status = 'open';
CREATE INDEX market_owner ON realm.market_orders(character_id) WHERE status = 'open';

CREATE TABLE realm.market_trades (
  trade_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_order_id      UUID NOT NULL REFERENCES realm.market_orders(order_id),
  sell_order_id     UUID NOT NULL REFERENCES realm.market_orders(order_id),
  buyer_id          UUID NOT NULL,
  seller_id         UUID NOT NULL,
  item_uid          UUID NOT NULL,
  price             BIGINT NOT NULL,
  sale_fee          BIGINT NOT NULL,
  tx_id             UUID NOT NULL REFERENCES realm.ledger_transactions(tx_id),
  executed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (buy_order_id, sell_order_id)
);
CREATE INDEX market_trades_time ON realm.market_trades(executed_at DESC);

CREATE TABLE realm.market_ohlc (
  def_id            TEXT NOT NULL,
  bucket            TIMESTAMPTZ NOT NULL,
  open              BIGINT NOT NULL, high BIGINT NOT NULL, low BIGINT NOT NULL, close BIGINT NOT NULL,
  volume            BIGINT NOT NULL,
  PRIMARY KEY (def_id, bucket)
);

CREATE TABLE realm.auctions (
  auction_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_uid          UUID NOT NULL REFERENCES realm.item_instances(item_uid),
  seller_id         UUID NOT NULL,
  reserve_price     BIGINT NOT NULL,
  deposit           BIGINT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at           TIMESTAMPTZ NOT NULL,
  anti_snipe_ext    SMALLINT NOT NULL DEFAULT 120,  -- +2 мин при ставке в последние 60 с
  status            TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE realm.auction_bids (
  auction_id        UUID NOT NULL REFERENCES realm.auctions(auction_id),
  bid_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bidder_id         UUID NOT NULL,
  amount            BIGINT NOT NULL,
  placed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE realm.trade_offers (
  trade_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  a_id              UUID NOT NULL, b_id UUID NOT NULL,
  a_silver          BIGINT NOT NULL DEFAULT 0, b_silver BIGINT NOT NULL DEFAULT 0,
  a_confirmed       BOOLEAN NOT NULL DEFAULT false, b_confirmed BOOLEAN NOT NULL DEFAULT false,
  fee               BIGINT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'open',
  tx_id             UUID REFERENCES realm.ledger_transactions(tx_id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (a_id <> b_id)
);
CREATE TABLE realm.trade_offer_items (
  trade_id          UUID NOT NULL REFERENCES realm.trade_offers(trade_id),
  item_uid          UUID NOT NULL UNIQUE REFERENCES realm.item_instances(item_uid),
  from_side         CHAR(1) NOT NULL CHECK (from_side IN ('a','b')),
  PRIMARY KEY (trade_id, item_uid)
);

CREATE TABLE realm.contracts (
  contract_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id      UUID NOT NULL,
  executor_id       UUID,
  recipe_id         TEXT NOT NULL,
  reward_silver     BIGINT NOT NULL,
  deposit_silver    BIGINT NOT NULL,
  materials         JSONB NOT NULL DEFAULT '[]'::jsonb,
  escrow_id         UUID NOT NULL REFERENCES realm.escrow(escrow_id),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','fulfilled','expired','disputed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE TABLE realm.craft_jobs (
  job_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id      UUID NOT NULL,
  station_id        TEXT NOT NULL,
  recipe_id         TEXT NOT NULL,
  fee_silver        BIGINT NOT NULL,
  focus_spent       SMALLINT NOT NULL DEFAULT 0,
  output_item_uid   UUID,
  tx_id             UUID REFERENCES realm.ledger_transactions(tx_id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE realm.gathering_nodes (
  node_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id         TEXT NOT NULL,
  tier              SMALLINT NOT NULL CHECK (tier BETWEEN 2 AND 8),
  pos               JSONB NOT NULL,
  respawn_seconds   INT NOT NULL,
  last_harvested_at TIMESTAMPTZ,
  state             TEXT NOT NULL DEFAULT 'ready'
);
CREATE INDEX gathering_region ON realm.gathering_nodes(region_id, tier, state);

-- ==========================================================================
-- 6. СОЦИАЛ, ГИЛЬДИИ, ТЕРРИТОРИИ, ЧАТЫ, ГОЛОС
-- ==========================================================================
CREATE TABLE realm.clans (
  clan_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm.clan_members (
  clan_id           UUID NOT NULL REFERENCES realm.clans(clan_id),
  character_id      UUID NOT NULL UNIQUE,
  PRIMARY KEY (clan_id, character_id)
);

CREATE TABLE realm.guilds (
  guild_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,
  realm_id          SMALLINT NOT NULL REFERENCES realm.realms(realm_id),
  treasury          BIGINT NOT NULL DEFAULT 0 CHECK (treasury >= 0),
  tax_rate          NUMERIC(4,3) NOT NULL DEFAULT 0.05 CHECK (tax_rate BETWEEN 0 AND 0.20),
  rating            INT NOT NULL DEFAULT 1000,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm.guild_ranks (
  guild_id          UUID NOT NULL REFERENCES realm.guilds(guild_id),
  rank_no           SMALLINT NOT NULL CHECK (rank_no BETWEEN 1 AND 9),
  name              TEXT NOT NULL,
  permissions       BIT(24) NOT NULL,               -- битовая маска 24 прав
  daily_withdraw_silver BIGINT NOT NULL DEFAULT 0,
  daily_withdraw_items  SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, rank_no)
);
CREATE TABLE realm.guild_members (
  guild_id          UUID NOT NULL REFERENCES realm.guilds(guild_id),
  character_id      UUID NOT NULL UNIQUE,
  rank_no           SMALLINT NOT NULL,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  contribution      BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, character_id)
);
CREATE TABLE realm.guild_bank_log (
  seq               BIGSERIAL PRIMARY KEY,
  guild_id          UUID NOT NULL,
  actor_id          UUID NOT NULL,
  item_uid          UUID,
  silver_delta      BIGINT NOT NULL DEFAULT 0,
  action            TEXT NOT NULL,
  tx_id             UUID REFERENCES realm.ledger_transactions(tx_id),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm.alliances (
  alliance_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm.alliance_members (
  alliance_id       UUID NOT NULL REFERENCES realm.alliances(alliance_id),
  guild_id          UUID NOT NULL UNIQUE,
  PRIMARY KEY (alliance_id, guild_id)
);
CREATE TABLE realm.guild_treaties (
  treaty_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  a_id              UUID NOT NULL, b_id UUID NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('alliance','nap','war')),
  signed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL
);
CREATE TABLE realm.guild_wars (
  war_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id       UUID NOT NULL, defender_id UUID NOT NULL,
  declared_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  starts_at         TIMESTAMPTZ NOT NULL,
  deposit_silver    BIGINT NOT NULL,
  score_a           INT NOT NULL DEFAULT 0, score_b INT NOT NULL DEFAULT 0,
  state             TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE realm.territories (
  territory_id      SMALLINT PRIMARY KEY,
  region_id         TEXT NOT NULL,
  tier              SMALLINT NOT NULL,
  pos               JSONB NOT NULL,
  upkeep_silver     BIGINT NOT NULL,
  owner_guild_id    UUID REFERENCES realm.guilds(guild_id)
);
CREATE TABLE realm.territory_ownership_log (
  seq               BIGSERIAL PRIMARY KEY,
  territory_id      SMALLINT NOT NULL REFERENCES realm.territories(territory_id),
  from_guild_id     UUID, to_guild_id UUID,
  reason            TEXT NOT NULL,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm.sieges (
  siege_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id         SMALLINT NOT NULL,
  castle_id         SMALLINT NOT NULL DEFAULT 1,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  attacker_alliance UUID, defender_guild UUID,
  stage             TEXT NOT NULL DEFAULT 'scheduled',
  winner_guild_id   UUID,
  participants      INT NOT NULL DEFAULT 0
);
CREATE TABLE realm.guild_rating (
  season_id         SMALLINT NOT NULL,
  guild_id          UUID NOT NULL REFERENCES realm.guilds(guild_id),
  points            INT NOT NULL DEFAULT 0,
  PRIMARY KEY (season_id, guild_id)
);

CREATE TABLE realm.friends (
  owner_id          UUID NOT NULL, friend_id UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, friend_id),
  CHECK (owner_id <> friend_id)
);
CREATE TABLE realm.enemies (
  owner_id          UUID NOT NULL, enemy_id UUID NOT NULL,
  bounty_silver     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, enemy_id),
  CHECK (owner_id <> enemy_id)
);
CREATE TABLE realm.parties (
  party_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              TEXT NOT NULL CHECK (kind IN ('party','raid8','raid16','raid24','siege')),
  leader_id         UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm.party_members (
  party_id          UUID NOT NULL REFERENCES realm.parties(party_id),
  character_id      UUID NOT NULL UNIQUE,
  role              TEXT,
  PRIMARY KEY (party_id, character_id)
);

CREATE TABLE realm.chat_channels (
  channel_id        TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('global','local','trade','whisper','party','raid','guild','alliance','system')),
  shard_no          SMALLINT NOT NULL DEFAULT 0,
  capacity          INT NOT NULL DEFAULT 500
);
CREATE TABLE realm.chat_messages (
  msg_id            UUID NOT NULL DEFAULT gen_random_uuid(),
  channel_id        TEXT NOT NULL,
  sender_id         UUID NOT NULL,
  body_hash         TEXT NOT NULL,                  -- PII/текст отдельно, здесь только хеш
  lang              CHAR(2),
  risk_score        SMALLINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (msg_id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE realm.chat_messages_default PARTITION OF realm.chat_messages DEFAULT;
CREATE INDEX chat_msg_channel ON realm.chat_messages(channel_id, created_at DESC);

CREATE TABLE realm.chat_moderation (
  case_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       UUID NOT NULL,
  reported_id       UUID NOT NULL,
  msg_id            UUID,
  classifier_label  TEXT,
  state             TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','upheld','dismissed')),
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm.voice_sessions (
  session_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id        TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('party','raid','guild','officer','proximity')),
  consent_record    BOOLEAN NOT NULL DEFAULT false,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  recording_hash    TEXT
);

-- ==========================================================================
-- 7. МИР, СОБЫТИЯ, АНТИЧИТ, АНАЛИТИКА (указатели)
-- ==========================================================================
CREATE TABLE realm.world_object_state (
  object_id         TEXT PRIMARY KEY,
  region_id         TEXT NOT NULL,
  class             TEXT NOT NULL CHECK (class IN ('decor','cover','objective')),
  state_bits        SMALLINT NOT NULL DEFAULT 0,
  hp                INT,
  revision          BIGINT NOT NULL DEFAULT 0,
  restores_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE realm.world_events (
  event_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id         TEXT NOT NULL,
  kind              TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  outcome           JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_impact      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE realm.world_state_votes (
  season_id         SMALLINT NOT NULL,
  account_id        UUID NOT NULL,                  -- 1 аккаунт = 1 голос, вес не зависит от доната
  choice            TEXT NOT NULL CHECK (choice IN ('restore','rewrite','silence')),
  voted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, account_id)
);
CREATE TABLE realm.region_state (
  season_id         SMALLINT NOT NULL,
  region_id         TEXT NOT NULL,
  beacon_state      JSONB NOT NULL,
  modifier          JSONB NOT NULL,
  PRIMARY KEY (season_id, region_id)
);

CREATE TABLE audit.anti_cheat_flags (
  flag_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id      UUID NOT NULL,
  feature_vector    JSONB NOT NULL,
  risk_score        SMALLINT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  action            TEXT NOT NULL CHECK (action IN ('none','shadow_limit','spark_check','throttle','ban')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ac_flags_risk ON audit.anti_cheat_flags(risk_score DESC, created_at DESC);
CREATE TABLE audit.replay_index (
  replay_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          UUID,
  character_id      UUID,
  s3_key            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL
);
CREATE TABLE audit.analytics_events (
  event_id          UUID NOT NULL DEFAULT gen_random_uuid(),
  account_hash      TEXT NOT NULL,                  -- хешированный ID, PII не хранится
  event_type        TEXT NOT NULL,
  realm_id          SMALLINT,
  payload           JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE audit.analytics_events_default PARTITION OF audit.analytics_events DEFAULT;
CREATE INDEX analytics_type_time ON audit.analytics_events(event_type, created_at DESC);

-- ==========================================================================
-- 8. ОТЧЁТЫ: детекция дюпов, инфляция, концентрация богатства
-- ==========================================================================
CREATE OR REPLACE VIEW realm.v_ledger_imbalance AS
SELECT tx_id, SUM(debit) AS debit, SUM(credit) AS credit
FROM realm.ledger_entries
GROUP BY tx_id
HAVING SUM(debit) <> SUM(credit);

CREATE OR REPLACE VIEW realm.v_item_owner_conflicts AS
SELECT item_uid, COUNT(DISTINCT owner_id) AS owners, COUNT(*) AS rows
FROM realm.item_instances
GROUP BY item_uid
HAVING COUNT(DISTINCT owner_id) > 1;

-- Ночная реконсиляция (запуск каждые 5 минут, alert P1 при >0 строк):
-- SELECT * FROM realm.v_ledger_imbalance;
-- SELECT * FROM realm.v_item_owner_conflicts;
-- SELECT i.item_uid FROM realm.item_instances i
--   LEFT JOIN realm.item_history h ON h.item_uid = i.item_uid AND h.seq = (
--     SELECT MAX(seq) FROM realm.item_history WHERE item_uid = i.item_uid)
--   WHERE i.owner_id IS DISTINCT FROM COALESCE(h.to_owner, i.owner_id);

CREATE OR REPLACE VIEW realm.v_economy_daily AS
SELECT date_trunc('day', created_at) AS day,
       kind,
       SUM(CASE WHEN kind IN ('faucet','mint') THEN credit ELSE 0 END) AS faucet,
       SUM(CASE WHEN kind IN ('sink','burn','market','craft','guild_tax') THEN debit ELSE 0 END) AS sinks
FROM realm.ledger_entries e
JOIN realm.ledger_transactions t USING (tx_id)
GROUP BY 1, 2;

CREATE OR REPLACE VIEW realm.v_top_silver_holders AS
SELECT owner_id, balance,
       NTILE(100) OVER (ORDER BY balance DESC) AS percentile
FROM realm.ledger_accounts
WHERE kind = 'wallet';

-- ==========================================================================
-- 9. Партиционирование и эксплуатационные замечания
--   · realm.chat_messages / audit.analytics_events — ежедневные партиции,
--     retention 30 дней в PG, затем выгрузка в S3 Parquet и DROP PARTITION.
--   · ledger_entries — партиционирование по месяцам + BRIN по created_at.
--   · item_instances — шардирование по первым 2 байтам item_uid (Citus) при > 8M строк.
--   · Горячая книга ордеров живёт в Redis ZSET, PostgreSQL — источник истины.
--   · Ни один клиент не имеет прав на INSERT/UPDATE/DELETE в схемах realm/global/audit;
--     роль arkeon_client выдаётся только на VIEW-отчёты (read-only).
-- ==========================================================================
