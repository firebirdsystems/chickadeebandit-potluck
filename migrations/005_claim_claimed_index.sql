-- claim_summary orders by claimed_at under LIMIT 500. The existing
-- (slot_id, claimed_at) index serves per-slot reads but cannot serve an
-- unfiltered ordering, since claimed_at is not its leading column.
CREATE INDEX IF NOT EXISTS app_potluck__claims_claimed_idx
  ON app_potluck__claims(claimed_at);
