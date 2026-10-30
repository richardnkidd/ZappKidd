-- Backend migration 002: remember the change a user asked for while the task store has not confirmed it yet,
-- so a failed write can be retried without the user re-typing, and the row keeps showing what the store holds.
ALTER TABLE task_links ADD COLUMN pending_changes TEXT;   -- JSON, e.g. {"title":"…","due":"2027-01-05"} or {"complete":"evidence"}
