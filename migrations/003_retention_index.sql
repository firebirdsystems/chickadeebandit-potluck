-- Sweep index for the events retention window (manifest row_policies.events
-- retain_days, keyed on `date` — the date the gathering happened, so the window
-- runs from the event rather than from when the row was created).
-- The existing (date, archived) index serves the UI's upcoming/archived reads;
-- the runner scans by (date, id), which is what it orders and pages on.
-- Slots and claims follow the event through their ON DELETE CASCADE foreign
-- keys; guest_signups has none and is declared as a dependent table instead.
CREATE INDEX IF NOT EXISTS app_potluck__events_retention_idx
  ON app_potluck__events(date, id);
