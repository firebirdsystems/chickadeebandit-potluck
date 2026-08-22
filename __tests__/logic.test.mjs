import { describe, it, expect } from "vitest";
import {
  fmtDate, claimErrorMessage, memberById,
  sortEventSlots, sortSlotClaims, claimedCount, eventTotals, searchableFields,
  guestSignupsForSlot, guestCount, unslottedGuestSignups,
} from "../src/logic.js";

describe("fmtDate", () => {
  it("returns empty for falsy", () => expect(fmtDate("")).toBe(""));
  it("formats a date string", () => expect(fmtDate("2026-07-08")).toBe("Jul 8, 2026"));
});

describe("memberById", () => {
  const members = [{ id: "a", name: "Alex" }];
  it("resolves and defaults to null", () => {
    expect(memberById(members, "a").name).toBe("Alex");
    expect(memberById(members, "z")).toBe(null);
  });
});

describe("sortEventSlots", () => {
  const slots = [
    { id: "1", event_id: "e1", sort_order: 2, name: "B" },
    { id: "2", event_id: "e1", sort_order: 1, name: "A" },
    { id: "3", event_id: "e2", sort_order: 1, name: "Z" },
    { id: "4", event_id: "e1", sort_order: 1, name: "C" },
  ];
  it("filters by event and sorts by order then name", () => {
    expect(sortEventSlots(slots, "e1").map(s => s.id)).toEqual(["2", "4", "1"]);
  });
});

describe("sortSlotClaims", () => {
  const claims = [
    { id: "1", slot_id: "s1", claimed_at: "2026-01-02" },
    { id: "2", slot_id: "s1", claimed_at: "2026-01-01" },
    { id: "3", slot_id: "s2", claimed_at: "2026-01-01" },
  ];
  it("filters by slot and sorts by claimed_at", () => {
    expect(sortSlotClaims(claims, "s1").map(c => c.id)).toEqual(["2", "1"]);
  });
});

describe("claimedCount", () => {
  const claims = [{ slot_id: "s1", claimed_at: "a" }, { slot_id: "s1", claimed_at: "b" }, { slot_id: "s2", claimed_at: "c" }];
  it("counts claims for a slot", () => expect(claimedCount(claims, "s1")).toBe(2));
});

describe("eventTotals", () => {
  const slots = [
    { id: "s1", event_id: "e1", capacity: 3, sort_order: 1, name: "A" },
    { id: "s2", event_id: "e1", capacity: 1, sort_order: 2, name: "B" },
  ];
  const claims = [
    { slot_id: "s1", claimed_at: "a" },
    { slot_id: "s1", claimed_at: "b" },
  ];
  it("sums capacity and claimed and computes pct", () => {
    expect(eventTotals(slots, claims, "e1")).toEqual({ claimed: 2, capacity: 4, pct: 50 });
  });
  it("handles zero capacity", () => {
    expect(eventTotals([], [], "e1")).toEqual({ claimed: 0, capacity: 0, pct: 0 });
  });
});

describe("claimErrorMessage", () => {
  it("maps known reasons", () => {
    expect(claimErrorMessage({ reason: "slot_full" })).toMatch(/last opening/);
    expect(claimErrorMessage({ reason: "already_claimed" })).toMatch(/already claimed/);
    expect(claimErrorMessage({ reason: "slot_closed" })).toMatch(/no longer open/);
  });
  it("falls back to error text then default", () => {
    expect(claimErrorMessage({ error: "boom" })).toBe("boom");
    expect(claimErrorMessage(null)).toBe("Could not claim that slot.");
  });
});

describe("searchableFields", () => {
  it("matches on where a gathering was, not just its title", () => {
    const fields = searchableFields({ title: "Summer social", location: "Riverside park", notes: "bring a chair", created_by_name: "Ada" });
    expect(fields).toContain("Riverside park");
    expect(fields).toContain("bring a chair");
  });
});

describe("the guest ledger", () => {
  const slots = [
    { id: "s1", event_id: "e1", name: "Sides", capacity: 2, guest_capacity: 2, sort_order: 0 },
    { id: "s2", event_id: "e1", name: "Desserts", capacity: 1, guest_capacity: 0, sort_order: 1 },
  ];
  const guests = [
    { id: "g1", event_id: "e1", slot_id: "s1", guest_name: "Sam", dish: "Cornbread" },
    { id: "g2", event_id: "e1", slot_id: "", guest_name: "Ada", dish: "Punch" },
    { id: "g3", event_id: "e1", slot_id: "gone", guest_name: "Rae", dish: "Rolls" },
    { id: "g4", event_id: "e2", slot_id: "s9", guest_name: "Other event", dish: "Ignored" },
  ];

  it("groups sign-ups by the slot the visitor picked", () => {
    expect(guestSignupsForSlot(guests, "s1").map(g => g.id)).toEqual(["g1"]);
    expect(guestCount(guests, "s1")).toBe(1);
    expect(guestCount(guests, "s2")).toBe(0);
  });

  it("never treats the empty slot_id as a slot", () => {
    // The public field is optional, so unslotted rows store "". Matching on it
    // would sweep every one of them onto whichever slot asked first.
    expect(guestSignupsForSlot(guests, "")).toEqual([]);
    expect(guestSignupsForSlot(guests, null)).toEqual([]);
  });

  it("surfaces sign-ups with no slot, or a slot since deleted", () => {
    // Both must stay visible to the household — a deleted slot must not take
    // its guests' dishes down with it.
    expect(unslottedGuestSignups(guests, slots, "e1").map(g => g.id)).toEqual(["g2", "g3"]);
  });

  it("scopes to one event", () => {
    expect(unslottedGuestSignups(guests, slots, "e1").some(g => g.id === "g4")).toBe(false);
  });
});
