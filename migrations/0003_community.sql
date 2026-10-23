CREATE TABLE community_proposals (
  repository_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK(pr_number > 0),
  head_sha TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  moderation_revision INTEGER NOT NULL DEFAULT 0,
  moderation_state TEXT,
  reviewed_head_sha TEXT,
  technical_json TEXT CHECK(technical_json IS NULL OR json_valid(technical_json)),
  PRIMARY KEY(repository_id, pr_number)
);
CREATE TABLE community_assets (
  repository_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  PRIMARY KEY(repository_id, pr_number, head_sha, path)
);
CREATE TABLE community_moderation (
  account_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  revision INTEGER NOT NULL,
  note TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(account_id, operation_id),
  UNIQUE(repository_id, pr_number, revision)
);
CREATE TABLE community_releases (
  repository_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  approved_head_sha TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  content_sha TEXT NOT NULL,
  PRIMARY KEY(repository_id, pr_number, deployment_id)
);
