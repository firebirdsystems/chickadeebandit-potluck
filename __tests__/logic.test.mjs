import { describe, it, expect } from "vitest";
import {
  fmtDate, claimErrorMessage, memberById,
  sortEventSlots, sortSlotClaims, claimedCount, eventTotals,
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
