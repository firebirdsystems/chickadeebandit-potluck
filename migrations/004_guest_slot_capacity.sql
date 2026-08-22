-- Guests picked a free-text dish and a static category, so nothing tied a
-- share-link sign-up to a dish slot and nothing bounded it: two visitors could
-- both take the last dessert opening. `values_from` + `capacity_column` on the
-- submit field fixes both — the hub resolves the slot list for the public form
-- and folds the capacity claim into the INSERT's own WHERE.
--
-- `slot_id` holds the slot's raw id (the hub writes the option's `id_column`
-- value verbatim). Empty string means "no slot chosen" — the field is optional,
-- because an event with no slots at all must still accept sign-ups.
ALTER TABLE app_potluck__guest_signups ADD COLUMN slot_id TEXT NOT NULL DEFAULT '';

-- The guest allowance is deliberately a SECOND cell, not `slots.capacity`.
-- Occupancy for the hub's claim is a COUNT over the SUBMIT table alone, so
-- reusing `capacity` would let a capacity-2 slot take two member claims AND two
-- guest dishes. Guest sign-ups and member claims are separate ledgers by
-- design; giving each its own allowance makes that explicit rather than
-- accidentally doubled, and lets an organizer close a slot to guests only by
-- zeroing this cell (the hub fails CLOSED on NULL or non-positive capacity).
ALTER TABLE app_potluck__slots ADD COLUMN guest_capacity INTEGER NOT NULL DEFAULT 0;

-- Existing slots mirror their member allowance so live events keep accepting
-- guests instead of showing every option "(full)" the moment this lands.
-- Column-to-column, and both columns are plaintext (`capacity` is declared in
-- db_plaintext_columns, `guest_capacity` joins it) — a migration runs OUTSIDE
-- the app-DB codec, so this is the only kind of backfill that is safe here.
UPDATE app_potluck__slots SET guest_capacity = capacity;

-- The hub's occupancy subquery counts guest rows per (event, slot); the
-- existing guest_signups_event index does not cover the slot predicate.
CREATE INDEX IF NOT EXISTS guest_signups_slot ON app_potluck__guest_signups(slot_id);
