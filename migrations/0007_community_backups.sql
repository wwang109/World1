CREATE TABLE community_round_backups (
  round_id TEXT PRIMARY KEY REFERENCES community_rounds(id),
  operation_id TEXT NOT NULL UNIQUE,
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  confirmed_at INTEGER NOT NULL CHECK(confirmed_at>0)
);
CREATE TRIGGER community_backups_no_update BEFORE UPDATE ON community_round_backups BEGIN SELECT RAISE(ABORT,'immutable-community-backup'); END;
CREATE TRIGGER community_backups_no_delete BEFORE DELETE ON community_round_backups BEGIN SELECT RAISE(ABORT,'immutable-community-backup'); END;
