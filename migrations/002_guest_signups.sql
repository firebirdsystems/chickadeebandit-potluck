-- External guest dish sign-ups, submitted through a writable share link
-- (premium `sharing`). Dedicated table — external rows have no member identity,
-- so they stay out of the member-scoped `claims`/`slots` capacity system.
--
-- The hub's share-submit path sets only id, event_id (fk), and the declared
-- plaintext fields; created_at defaults so the hub needn't set it.
CREATE TABLE IF NOT EXISTS app_potluck__guest_signups (
  id          TEXT    PRIMARY KEY,
  event_id    TEXT    NOT NULL,
  guest_name  TEXT    NOT NULL DEFAULT '',
  dish        TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS guest_signups_event ON app_potluck__guest_signups(event_id);
