/**
 * Potluck had no retention and no delete affordance: events, their slots and
 * claims, and every guest signup accumulated for the life of the household.
 * Events expire 730 days after the gathering itself (`date`, not `created_at`,
 * so the window runs from when the potluck happened). Slots and claims follow
 * through their ON DELETE CASCADE foreign keys; guest_signups has none, so it
 * is declared as a dependent table.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));
const init = readFileSync(join(__dirname, "../migrations/001_init.sql"), "utf-8");
const retentionIdx = readFileSync(join(__dirname, "../migrations/003_retention_index.sql"), "utf-8");

describe("events retention", () => {
  const retain = manifest.row_policies.events.retain_days;

  it("expires events 730 days after the event date", () => {
    expect(retain.default).toBe(730);
    expect(retain.timestamp_column).toBe("date");
    expect(retain.override_key).toBe("potluck_history");
  });

  it("keys the window on a plaintext column — the runner reads it in raw SQL", () => {
    expect(manifest.db_plaintext_columns).toContain("date");
  });

  it("carries guest_signups, the only child without a cascading foreign key", () => {
    expect(retain.dependent_tables).toEqual([{ table: "guest_signups", foreign_key: "event_id" }]);
    expect(init).toMatch(/FOREIGN KEY \(event_id\) REFERENCES app_potluck__events\(id\) ON DELETE CASCADE/);
    expect(init).toMatch(/FOREIGN KEY \(slot_id\) REFERENCES app_potluck__slots\(id\) ON DELETE CASCADE/);
  });

  it("has a sweep index the runner can page on", () => {
    expect(retentionIdx).toMatch(/ON app_potluck__events\(date, id\)/);
  });
});
