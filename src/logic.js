// Pure, testable logic extracted from index.html.
// No DOM, no network — safe to import from Node for unit tests.

export function fmtDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

export function memberById(members, id) {
  return members.find(m => m.id === id) ?? null;
}

export function sortEventSlots(slots, eventId) {
  return slots
    .filter(s => s.event_id === eventId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

export function sortSlotClaims(claims, slotId) {
  return claims
    .filter(c => c.slot_id === slotId)
    .sort((a, b) => a.claimed_at.localeCompare(b.claimed_at));
}

export function claimedCount(claims, slotId) {
  return sortSlotClaims(claims, slotId).length;
}

export function eventTotals(slots, claims, eventId) {
  const ss = sortEventSlots(slots, eventId);
  const capacity = ss.reduce((sum, s) => sum + Number(s.capacity || 0), 0);
  const claimed = ss.reduce((sum, s) => sum + claimedCount(claims, s.id), 0);
  return { claimed, capacity, pct: capacity ? Math.min(100, Math.round((claimed / capacity) * 100)) : 0 };
}

export function claimErrorMessage(json) {
  switch (json?.reason) {
    case "slot_full": return "Someone just claimed the last opening.";
    case "already_claimed": return "You already claimed this slot.";
    case "slot_closed": return "That slot is no longer open.";
    default: return json?.error || "Could not claim that slot.";
  }
}
