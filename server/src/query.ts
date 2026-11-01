import type { DatabaseSync } from "node:sqlite";
import { EVENT_CATEGORIES, type EventFilters, type EventsResponse } from "@mievents/shared";
import { rowToEvent, type EventRow } from "./db.js";

function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [s, w, n, e] = parts;
  if (s > n || w > e) return null;
  return [s, w, n, e];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string, field: string): string {
  const m = ISO_DATE.exec(value);
  if (!m) {
    throw Object.assign(new Error(`Invalid ${field} date, expected YYYY-MM-DD`), { statusCode: 400 });
  }
  const [, y, mo, d] = m.map(Number) as unknown as [string, number, number, number];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw Object.assign(new Error(`Invalid ${field} date, expected YYYY-MM-DD`), { statusCode: 400 });
  }
  return value;
}

export function ftsQuery(q: string): string {
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/[*"]/g, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(" AND ") + "*";
}

export function queryEvents(db: DatabaseSync, f: EventFilters): EventsResponse {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const q = f.q?.trim();
  if (q) {
    clauses.push(
      "events.rowid IN (SELECT rowid FROM events_fts WHERE events_fts MATCH ?)",
    );
    params.push(ftsQuery(q));
  }
  if (f.city) {
    clauses.push("upper(city) LIKE ?");
    params.push(`%${f.city.trim().toUpperCase()}%`);
  }
  if (f.category && f.category !== "saved") {
    if (!EVENT_CATEGORIES.includes(f.category)) {
      throw Object.assign(new Error(`Invalid category: ${f.category}`), { statusCode: 400 });
    }
    clauses.push("category = ?");
    params.push(f.category);
  }
  if (f.savedOnly || f.category === "saved") {
    clauses.push("saved = 1");
  }
  if (f.from) {
    clauses.push("date(start) >= date(?)");
    params.push(parseIsoDate(f.from, "from"));
  }
  if (f.to) {
    clauses.push("date(start) <= date(?)");
    params.push(parseIsoDate(f.to, "to"));
  }
  if (!f.from && !f.to && !f.includePast) {
    clauses.push("date(COALESCE(end, start)) >= date('now', 'localtime')");
  }
  if (f.bbox) {
    const b = parseBbox(f.bbox);
    if (!b) throw Object.assign(new Error("Invalid bbox, expected south,west,north,east"), { statusCode: 400 });
    clauses.push("lat IS NOT NULL AND lon IS NOT NULL AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?");
    params.push(b[0], b[2], b[1], b[3]);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM events ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT events.* FROM events ${where} ORDER BY date(start) ASC, time_start ASC LIMIT 2000`)
    .all(...params) as unknown as EventRow[];
  return { total, events: rows.map(rowToEvent) };
}

export function listCities(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT DISTINCT city FROM events ORDER BY city ASC").all() as { city: string }[];
  return rows.map((r) => r.city);
}

export function setSaved(db: DatabaseSync, id: string, saved: boolean): boolean {
  const res = db.prepare("UPDATE events SET saved = ? WHERE id = ?").run(saved ? 1 : 0, id);
  return res.changes > 0;
}

export function getEvent(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}
