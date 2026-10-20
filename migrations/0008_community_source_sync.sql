CREATE TABLE community_source_sync (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_poll_at INTEGER NOT NULL DEFAULT 0,
  checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json))
);
