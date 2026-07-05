SELECT
  id,
  slot_id,
  member_id,
  note,
  claimed_at
FROM app_potluck__claims
ORDER BY claimed_at ASC
LIMIT 500
