CREATE TABLE community_wallets (
  account_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance)='integer' AND balance>=0 AND balance<=9007199254740991),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0)
);
CREATE TABLE community_point_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta<>0 AND abs(delta)<=9007199254740991),
  reason TEXT NOT NULL CHECK(reason IN ('boss','support','correction')),
  source_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(account_id,source_key),
  UNIQUE(account_id,operation_id),
  CHECK(reason<>'boss' OR delta=1),
  CHECK(reason<>'support' OR delta<0)
);
CREATE INDEX community_ledger_account ON community_point_ledger(account_id,created_at);
CREATE TRIGGER community_ledger_no_update BEFORE UPDATE ON community_point_ledger BEGIN SELECT RAISE(ABORT,'immutable-community-ledger'); END;
CREATE TRIGGER community_ledger_no_delete BEFORE DELETE ON community_point_ledger BEGIN SELECT RAISE(ABORT,'immutable-community-ledger'); END;
