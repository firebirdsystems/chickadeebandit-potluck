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
  return body[1]
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_]+)\s+(TEXT|INTEGER|REAL|BLOB)\b/))
    .filter(Boolean)
    .map((m) => m[1]);
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
