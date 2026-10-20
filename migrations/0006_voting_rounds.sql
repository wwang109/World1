CREATE TABLE community_rounds (
  id TEXT PRIMARY KEY,
  opens_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('open','closing','no_winner','blocked','merged')),
  candidates_json TEXT CHECK(candidates_json IS NULL OR json_valid(candidates_json)),
  winner_json TEXT CHECK(winner_json IS NULL OR json_valid(winner_json)),
  merge_receipt_json TEXT CHECK(merge_receipt_json IS NULL OR json_valid(merge_receipt_json)),
  blocked_reason TEXT,
  CHECK(closes_at-opens_at=604800000)
);
CREATE TABLE community_merge_operations (
  round_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  expected_head_sha TEXT NOT NULL,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
);
