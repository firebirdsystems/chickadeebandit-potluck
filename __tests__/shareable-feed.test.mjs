import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

const migrationsDir = join(__dirname, "../migrations");
const schema = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), "utf-8"))
  .join("\n");

// Mirrors the hub's BUILTIN_APP_DB_PLAINTEXT_COLS + suffix rules
// (packages/hub/src/cloudflare/manifest-common.ts). A column the hub filters or
// orders on must be plaintext: ciphertext is AES-GCM with a random IV, so an
// equality against an encrypted column silently matches nothing.
const BUILTIN_PLAINTEXT = new Set([
  "id", "household_id", "created_at", "updated_at", "sent_at", "read_at",
  "expires_at", "last_synced_at", "completed", "all_day",
  "status", "type", "category", "week", "emoji", "icon",
  "position", "sort_order", "pinned", "key", "version",
  "visibility", "audience",
  "membership_type", "membership_roles",
]);

function isPlaintext(column) {
  return (
    BUILTIN_PLAINTEXT.has(column) ||
    /_(id|at|date|by)$/.test(column) ||
    (manifest.db_plaintext_columns ?? []).includes(column)
  );
}

function columnsOf(table) {
  const body = schema.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS app_potluck__${table} \\(([\\s\\S]*?)\\n\\);`),
  );
  expect(body, `no CREATE TABLE for ${table}`).toBeTruthy();
  const created = body[1]
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_]+)\s+(TEXT|INTEGER|REAL|BLOB)\b/))
    .filter(Boolean)
    .map((m) => m[1]);
  // Later migrations add columns by ALTER, and the manifest may well point at
  // one of those (slot_id, guest_capacity) — read them too, or this helper
  // reports a live column as missing.
  const altered = [...schema.matchAll(
    new RegExp(`ALTER TABLE app_potluck__${table} ADD COLUMN ([a-z_]+)\\b`, "g"),
  )].map((m) => m[1]);
  return [...created, ...altered];
}

const feed = manifest.shareable.event.feed;
const submit = manifest.shareable.event.submit;

describe("shareable.event.feed", () => {
  it("reads the guest sign-up table the share form writes to", () => {
    expect(feed.table).toBe(submit.table);
    expect(feed.fk_column).toBe(submit.fk_column);
    expect(feed.fk_column).toBe("event_id");
  });

  it("projects only columns that exist on guest_signups", () => {
    const columns = columnsOf("guest_signups");
    for (const col of feed.columns) {
      expect(columns, `feed projects unknown column ${col.column}`).toContain(col.column);
    }
  });

  it("orders on a plaintext column that exists", () => {
    expect(columnsOf("guest_signups")).toContain(feed.order_column);
    expect(isPlaintext(feed.order_column), `${feed.order_column} must be plaintext to order on`).toBe(true);
  });

  // Projected columns are decrypted on read, so they carry no plaintext
  // requirement — only filters and ordering do. `category` is projected but not
  // in db_plaintext_columns, and that is fine.
  it("declares no filters it cannot enforce", () => {
    for (const filter of feed.where ?? []) {
      expect(isPlaintext(filter.column), `${filter.column} must be plaintext to filter on`).toBe(true);
    }
    if (feed.parent_where) {
      expect(isPlaintext(feed.parent_where.column)).toBe(true);
    }
  });

  it("cannot truncate: the feed shows every row the app will ever hold", () => {
    expect(feed.max_items).toBe(submit.max_submissions);
    expect(feed.max_items).toBe(manifest.row_policies.guest_signups.max_rows);
  });

  it("reads oldest-first, the order a sign-up sheet fills in", () => {
    expect(feed.order).toBe("oldest");
  });

  it("no longer duplicates the dish list as a comma-joined aggregate", () => {
    const aggregates = manifest.shareable.event.aggregates ?? [];
    expect(aggregates.some((a) => a.op === "list" && a.table === "guest_signups")).toBe(false);
    expect(aggregates.some((a) => a.op === "count" && a.table === "guest_signups")).toBe(true);
  });

  it("publishes every column the guest was asked for, and nothing else", () => {
    const projected = new Set(feed.columns.map((c) => c.column));
    const submitted = new Set(submit.fields.map((f) => f.column));
    for (const col of projected) {
      expect(submitted, `feed publishes ${col}, which no guest typed`).toContain(col);
    }
  });
});

// The dynamic slot select: the hub resolves `slots` for the public form and
// folds a per-option capacity claim into the INSERT's own WHERE, so two
// visitors can never take the same last opening.
describe("shareable.event.submit.slot_id (values_from)", () => {
  const slotField = submit.fields.find((f) => f.column === "slot_id");

  it("is a select sourcing its choices from the slots table", () => {
    expect(slotField).toBeTruthy();
    expect(slotField.type).toBe("select");
    expect(slotField.values, "values and values_from are mutually exclusive").toBeUndefined();
    expect(slotField.values_from.table).toBe("slots");
    expect(slotField.values_from.fk_column).toBe("event_id");
  });

  it("keys options on the same column the shared row's children point at", () => {
    expect(columnsOf("slots")).toContain(slotField.values_from.fk_column);
    expect(columnsOf("slots")).toContain(slotField.values_from.id_column);
    expect(columnsOf("slots")).toContain(slotField.values_from.label_column);
  });

  it("writes the chosen option id into a real, plaintext column", () => {
    expect(columnsOf("guest_signups")).toContain("slot_id");
    expect(isPlaintext("slot_id"), "the hub writes the option id raw, outside the codec").toBe(true);
  });

  it("matches and compares only plaintext columns", () => {
    // id_column is matched raw against the visitor's answer; capacity_column is
    // a numeric SQL comparison. Neither works against AES-GCM ciphertext.
    expect(isPlaintext(slotField.values_from.id_column)).toBe(true);
    expect(isPlaintext(slotField.values_from.capacity_column)).toBe(true);
  });

  it("bounds guests with their OWN allowance, never the member capacity", () => {
    // Occupancy is a COUNT over the submit table alone, so pointing this at
    // `capacity` would let a slot take its full member claims AND that many
    // guest dishes on top.
    expect(slotField.values_from.capacity_column).toBe("guest_capacity");
    expect(slotField.values_from.capacity_column).not.toBe("capacity");
    expect(columnsOf("slots")).toContain("guest_capacity");
  });

  it("stays optional, so an event with no slots still accepts sign-ups", () => {
    // Empty options resolve to a disabled select; required would then fail
    // closed and lock every guest out of a slot-less potluck.
    expect(slotField.required).toBe(false);
  });

  it("never publishes the raw option id back to the public page", () => {
    // The feed prints stored values and cannot join, so projecting slot_id
    // would show visitors a UUID.
    expect(feed.columns.some((c) => c.column === "slot_id")).toBe(false);
  });

  it("stays inside the hub's single-statement bind budget", () => {
    // id + fk, one per field, one per fixed value, parent admission
    // (parent id + visible_where values + max_rows), one per dynamic select.
    const gate = manifest.shareable.event.visible_where?.values?.length ?? 0;
    const dynamic = submit.fields.filter((f) => f.values_from).length;
    const total = 2 + submit.fields.length
      + Object.keys(submit.fixed_values ?? {}).length
      + 1 + gate
      + (manifest.row_policies.guest_signups.max_rows ? 1 : 0)
      + dynamic;
    expect(total).toBeLessThanOrEqual(80);
  });
});

// Guest rows are authored by anonymous visitors through a path that bypasses
// every member-side gate, so the table stays endpoint_only: the app may read
// the rows but may never edit or delete them. Widening it to adult_writable
// would hand every adult in a shared space edit rights over sign-ups on someone
// else's potluck — steward_writes_only is inert outside a roster, and potluck
// cannot be roster-installed anyway (its catalog contexts carry no
// shared_space.roster token) — a worse trade than living without a delete
// affordance.
describe("row_policies.guest_signups", () => {
  const policy = manifest.row_policies.guest_signups;

  it("stays write-closed to members", () => {
    expect(policy.kind).toBe("endpoint_only");
    expect(policy.read).toBe("everyone");
  });

  it("declares no member-facing write surface over external rows", () => {
    expect(policy.steward_writes_only).toBeUndefined();
    expect(policy.audit_writes).toBeUndefined();
  });

  it("keeps the per-link and per-table caps in step", () => {
    expect(policy.max_rows).toBe(submit.max_submissions);
  });
});
