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

export function queryEvents(db: DatabaseSync, f: EventFilters): EventsResponse {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (f.q) {
    clauses.push("(title LIKE ? OR description LIKE ? OR city LIKE ? OR venue LIKE ? OR organizer LIKE ?)");
    const like = `%${f.q}%`;
    params.push(like, like, like, like, like);
  }
  if (f.city) {
    clauses.push("upper(city) LIKE ?");
    params.push(`%${f.city.toUpperCase()}%`);
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
    params.push(f.from);
  }
  if (f.to) {
    clauses.push("date(start) <= date(?)");
    params.push(f.to);
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
    .prepare(`SELECT * FROM events ${where} ORDER BY date(start) ASC, time_start ASC LIMIT 2000`)
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
