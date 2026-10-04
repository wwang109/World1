CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE account_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX account_sessions_account_idx ON account_sessions (account_id);

CREATE TABLE account_links (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE INDEX account_links_account_idx ON account_links (account_id);

CREATE TABLE auth_codes (
  code_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  account_id TEXT,
  subject TEXT,
  return_to TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX auth_codes_subject_idx ON auth_codes (purpose, subject, created_at);
