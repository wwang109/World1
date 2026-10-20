CREATE TABLE IF NOT EXISTS eligible_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  rules_revision TEXT NOT NULL,
  content_sha TEXT NOT NULL,
  run_json TEXT NOT NULL CHECK(json_valid(run_json))
);
CREATE UNIQUE INDEX IF NOT EXISTS eligible_one_active_run ON eligible_runs(account_id) WHERE active=1;
CREATE TABLE IF NOT EXISTS eligible_encounters (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES eligible_runs(id),
  account_id TEXT NOT NULL,
  state_revision INTEGER NOT NULL,
  reward_class TEXT NOT NULL CHECK(reward_class IN ('boss','none')),
  role TEXT NOT NULL CHECK(role IN ('regular','boss','challenge','extra')),
  status TEXT NOT NULL CHECK(status IN ('pending','settled')),
  encounter_json TEXT NOT NULL CHECK(json_valid(encounter_json))
);
CREATE UNIQUE INDEX IF NOT EXISTS eligible_one_pending_encounter ON eligible_encounters(run_id) WHERE status='pending';
CREATE TRIGGER IF NOT EXISTS eligible_encounter_identity BEFORE UPDATE ON eligible_encounters
WHEN NEW.id != OLD.id OR NEW.run_id != OLD.run_id OR NEW.account_id != OLD.account_id
 OR NEW.state_revision != OLD.state_revision OR NEW.reward_class != OLD.reward_class OR NEW.role != OLD.role
 OR NEW.encounter_json != OLD.encounter_json
BEGIN SELECT RAISE(ABORT,'immutable canonical encounter'); END;
CREATE TABLE IF NOT EXISTS eligible_operations (
  account_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  run_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  PRIMARY KEY(account_id,operation_id)
);
CREATE TABLE IF NOT EXISTS eligible_effects (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  delivery_json TEXT NOT NULL CHECK(json_valid(delivery_json))
);
CREATE TABLE IF NOT EXISTS eligible_ghosts (id TEXT PRIMARY KEY,revision_key TEXT NOT NULL,band INTEGER NOT NULL,created_at INTEGER NOT NULL,ghost_json TEXT NOT NULL CHECK(json_valid(ghost_json)));
CREATE TABLE IF NOT EXISTS eligible_ghost_cursors (revision_key TEXT NOT NULL,band INTEGER NOT NULL,cursor INTEGER NOT NULL,PRIMARY KEY(revision_key,band));
CREATE TABLE IF NOT EXISTS eligible_ghost_deliveries (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS eligible_commit_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE IF NOT EXISTS eligible_executor_revisions (
  rules_revision TEXT NOT NULL,
  content_sha TEXT NOT NULL,
  source_digest TEXT,
  approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0,1)),
  active_references INTEGER NOT NULL DEFAULT 0 CHECK(active_references >= 0),
  PRIMARY KEY(rules_revision,content_sha)
);
CREATE TRIGGER IF NOT EXISTS eligible_executor_insert AFTER INSERT ON eligible_runs
BEGIN
 INSERT INTO eligible_executor_revisions(rules_revision,content_sha,active_references)
 VALUES(NEW.rules_revision,NEW.content_sha,NEW.active)
 ON CONFLICT(rules_revision,content_sha) DO UPDATE SET active_references=active_references+NEW.active;
END;
CREATE TRIGGER IF NOT EXISTS eligible_executor_retire AFTER UPDATE OF active ON eligible_runs
WHEN NEW.active != OLD.active
BEGIN
 UPDATE eligible_executor_revisions SET active_references=active_references+NEW.active-OLD.active
 WHERE rules_revision=OLD.rules_revision AND content_sha=OLD.content_sha;
END;
