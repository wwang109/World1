CREATE TABLE ghosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  band INTEGER NOT NULL,
  fight_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  owner_local_id TEXT NOT NULL,
  defense_wins INTEGER NOT NULL DEFAULT 0,
  defense_losses INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ghosts_band_idx ON ghosts (band);

CREATE TABLE band_cursor (
  band INTEGER PRIMARY KEY,
  cursor INTEGER NOT NULL DEFAULT 0
);
