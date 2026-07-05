SELECT
  e.id,
  e.title,
  e.date,
  e.location,
  e.notes,
  COUNT(s.id) AS slot_count,
  COALESCE(SUM(s.capacity), 0) AS total_capacity
FROM app_potluck__events e
LEFT JOIN app_potluck__slots s ON s.event_id = e.id
WHERE e.archived = 0
GROUP BY e.id
ORDER BY e.date ASC
LIMIT 200
