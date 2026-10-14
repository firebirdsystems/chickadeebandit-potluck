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

/**
 * Guest sign-ups that chose a given slot. Share-link rows and member claims are
 * SEPARATE ledgers — the hub's per-option capacity counts only the submit table
 * (`guest_signups`), and `slots.guest_capacity` is the allowance it compares
 * against — so this deliberately never mixes with `sortSlotClaims`.
 */
export function guestSignupsForSlot(guestSignups, slotId) {
  if (!slotId) return [];
  return guestSignups.filter(g => g.slot_id === slotId);
}

export function guestCount(guestSignups, slotId) {
  return guestSignupsForSlot(guestSignups, slotId).length;
}

/**
 * Sign-ups that named no slot (the public field is optional, so an event with
 * no slots still accepts guests) or one that has since been deleted.
 */
export function unslottedGuestSignups(guestSignups, slots, eventId) {
  const ids = new Set(slots.filter(s => s.event_id === eventId).map(s => s.id));
  return guestSignups.filter(g => g.event_id === eventId && !ids.has(g.slot_id));
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

// ── Creating a potluck ───────────────────────────────────────────────────────
// The event and its dish slots go to the hub as ONE batch, so a failure part-way
// leaves nothing behind and a retry cannot make a second potluck. The hub takes
// 25 statements a batch and 100 bound values a statement: a slot row binds 7, so
// 14 rows share an INSERT and up to 24 such INSERTs follow the event's (336
// slots). The form stops well short of that, at a list a person can still read.
export const SLOT_ROWS_PER_INSERT = 14;
export const MAX_SLOTS = 100;

/** The statements that create `event` with `newSlots`, or null when there are too many slots. */
export function potluckCreateStatements(event, newSlots) {
  if (newSlots.length > MAX_SLOTS) return null;
  const statements = [{
    sql: `INSERT INTO app_potluck__events (id, title, date, location, notes, created_by_id, created_by_name, created_at, archived)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    params: [event.id, event.title, event.date, event.location, event.notes, event.created_by_id, event.created_by_name, event.created_at],
  }];
  for (let i = 0; i < newSlots.length; i += SLOT_ROWS_PER_INSERT) {
    const rows = newSlots.slice(i, i + SLOT_ROWS_PER_INSERT);
    // guest_capacity mirrors the member allowance at creation — the two ledgers
    // are separate, so a slot offers the same number of openings to share-link
    // guests as to members until an organizer retunes it on the slot card.
    statements.push({
      sql: `INSERT INTO app_potluck__slots (id, event_id, name, capacity, guest_capacity, sort_order, created_at)
            VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      params: rows.flatMap(s => [s.id, s.event_id, s.name, s.capacity, s.capacity, s.sort_order, s.created_at]),
    });
  }
  return statements;
}

/**
 * Fields the in-app search matches against (see hub-sdk `searchMatch`).
 * Location and notes count as well as the title — a gathering is
 * found again by where it was.
 */
export function searchableFields(item) {
  return [item.title, item.location, item.notes, item.created_by_name];
}

export const CALENDAR_EXPORT_HORIZON_DAYS = 180;
export const CALENDAR_EXPORT_MAX_EVENTS = 100;

/** Local YYYY-MM-DD for a Date. */
function isoDay(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Build the `calendar_events` payload from upcoming gatherings.
 *
 * Shape matches what the hub's cross-app aggregation consumes — see
 * `normalizeExportedEvent` in packages/hub/src/cloudflare/calendar-feed.ts.
 * Only the gathering is exported. A slot is a dish role and a claim is who
 * agreed to fill it: neither is a dated thing, and a household that put
 * "Desserts" on its calendar beside "Thanksgiving Dinner" would be reading the
 * sign-up sheet, not its schedule.
 *
 * The events table carries a `date` and no time column, so every entry is
 * all-day and `start` has no `T` in it — the hub derives `allDay` from that
 * absence on its own.
 *
 * `notes` is deliberately NOT exported. This payload reaches the household's
 * ICS feed, which external calendar services fetch, and a note is free text a
 * member wrote for the household. Location IS exported: telling you where to
 * go is what a calendar entry is FOR.
 */
export function buildCalendarEvents(events, todayIso, from = new Date()) {
  // Day arithmetic through the Date constructor rather than milliseconds, so a
  // DST boundary inside the horizon cannot shift the cutoff by a day.
  const horizon = isoDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + CALENDAR_EXPORT_HORIZON_DAYS));
  return events
    .filter(e => !Number(e.archived) && e.date >= todayIso && e.date <= horizon)
    .map(e => ({
      id: e.id,
      title: e.title,
      description: "Potluck",
      location: e.location || "",
      start: e.date,
      end: e.date,
      all_day: true,
      member_ids: [],
      source_label: "Potluck",
    }))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, CALENDAR_EXPORT_MAX_EVENTS);
}
