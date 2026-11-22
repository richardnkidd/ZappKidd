-- Kadode schema v1. OWNER: lead (shape) / backend agent (may add later numbered migrations; never edit applied ones).
-- All household data is scoped by household_id. JSON columns hold validated objects (see src/shared/types.ts).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

CREATE TABLE households (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  home_timezone     TEXT NOT NULL DEFAULT 'Pacific/Honolulu',
  display_timezone  TEXT NOT NULL DEFAULT 'Pacific/Honolulu',
  data_label        TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE people (
  id            TEXT NOT NULL,
  household_id  TEXT NOT NULL REFERENCES households(id),
  display_name  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('adult','pet')),
  aliases       TEXT NOT NULL DEFAULT '[]',   -- JSON array
  descriptor    TEXT,
  anchors       TEXT NOT NULL DEFAULT '{}',   -- JSON TravelerAnchorCodes
  PRIMARY KEY (household_id, id)
);

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  household_id   TEXT NOT NULL REFERENCES households(id),
  person_id      TEXT NOT NULL,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT,                         -- scrypt; NULL = no password set (cannot log in outside dev identities)
  is_dev_identity INTEGER NOT NULL DEFAULT 0,  -- 1 = isolated development identity; refused in staging/production
  disabled       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash       TEXT PRIMARY KEY,              -- sha256 of the random token; the token itself is never stored
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  user_agent    TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE records (
  id             TEXT NOT NULL,                -- `${type}:${key}`
  household_id   TEXT NOT NULL REFERENCES households(id),
  type           TEXT NOT NULL,
  key            TEXT NOT NULL,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL,
  owner          TEXT,
  owner_proposed INTEGER NOT NULL DEFAULT 0,
  visibility     TEXT NOT NULL DEFAULT 'household' CHECK (visibility IN ('household','private')),
  created_by     TEXT,
  data           TEXT NOT NULL DEFAULT '{}',   -- JSON, type-specific
  source         TEXT,                         -- JSON SourceRef (latest import), raw source preserved
  locally_edited TEXT NOT NULL DEFAULT '[]',   -- JSON array of field paths edited in-app since import
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT,
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, type, key)
);
CREATE INDEX records_type ON records(household_id, type);

-- Every source snapshot ever imported for a record (one row per record per import run that changed it).
CREATE TABLE source_snapshots (
  household_id   TEXT NOT NULL,
  record_id      TEXT NOT NULL,
  import_run_id  TEXT NOT NULL,
  raw_sha256     TEXT NOT NULL,
  raw            TEXT NOT NULL,                -- JSON
  PRIMARY KEY (household_id, record_id, import_run_id)
);

CREATE TABLE import_runs (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  source_label  TEXT NOT NULL,
  files         TEXT NOT NULL,                 -- JSON [{name, sha256, bytes}]
  fileset_sha256 TEXT NOT NULL,                -- sha256 over sorted file hashes => idempotency key
  counts        TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX import_runs_fileset ON import_runs(household_id, fileset_sha256);

CREATE TABLE import_changes (
  id             TEXT PRIMARY KEY,
  household_id   TEXT NOT NULL,
  import_run_id  TEXT NOT NULL,
  record_id      TEXT NOT NULL,
  change         TEXT NOT NULL,
  field          TEXT,
  before         TEXT,
  after          TEXT,
  rationale      TEXT,
  correction_id  TEXT
);
CREATE INDEX import_changes_run ON import_changes(import_run_id);

-- Reviewed-model corrections applied once per (correction, record); makes corrections idempotent.
CREATE TABLE corrections_applied (
  household_id   TEXT NOT NULL,
  correction_id  TEXT NOT NULL,
  record_id      TEXT NOT NULL,
  applied_at     TEXT NOT NULL,
  import_run_id  TEXT NOT NULL,
  PRIMARY KEY (household_id, correction_id, record_id)
);

CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL,
  at            TEXT NOT NULL,
  actor         TEXT NOT NULL,
  record_id     TEXT,
  action        TEXT NOT NULL,
  before        TEXT,
  after         TEXT,
  reason        TEXT,
  undone_by     TEXT
);
CREATE INDEX audit_record ON audit_log(household_id, record_id, at);
CREATE INDEX audit_at ON audit_log(household_id, at);

CREATE TABLE task_links (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL,
  adapter         TEXT NOT NULL CHECK (adapter IN ('fixture','snapshot','script')),
  canonical_id    TEXT,
  record_id       TEXT,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL,
  due             TEXT,
  due_basis       TEXT NOT NULL,
  owner           TEXT,
  notes           TEXT,
  proposal_note   TEXT,
  sync_state      TEXT NOT NULL,
  last_synced_at  TEXT,
  last_error      TEXT,
  remote_revision TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (household_id, adapter, canonical_id)
);

-- Append-only journal of every adapter operation (request, response, readback) for receipts.
CREATE TABLE task_sync_journal (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL,
  task_link_id  TEXT NOT NULL,
  at            TEXT NOT NULL,
  actor         TEXT NOT NULL,
  operation     TEXT NOT NULL,                 -- create | update | complete | readback | list
  request       TEXT,
  response      TEXT,
  outcome       TEXT NOT NULL                  -- ok | error | mismatch
);

CREATE TABLE settings (
  household_id  TEXT NOT NULL,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,                 -- JSON
  PRIMARY KEY (household_id, key)
);
