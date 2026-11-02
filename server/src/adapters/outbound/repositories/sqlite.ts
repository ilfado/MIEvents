import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { EVENT_CATEGORIES, type EventCategory, type EventFilters, type EventsResponse, type MiEvent } from "@mievents/shared";
import type { EventRepository, VenueRepository } from "../../../application/ports.js";

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  type: string | null;
  start: string;
  end: string | null;
  time_start: string | null;
  time_end: string | null;
  venue: string | null;
  address: string | null;
  city: string;
  province: string;
  cap: string | null;
  organizer: string | null;
  website: string | null;
  program_url: string | null;
  source: string;
  source_url: string;
  lat: number | null;
  lon: number | null;
  fetched_at: string;
  saved: number;
}

export function openDb(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      type TEXT,
      start TEXT NOT NULL,
      end TEXT,
      time_start TEXT,
      time_end TEXT,
      venue TEXT,
      address TEXT,
      city TEXT NOT NULL,
      province TEXT NOT NULL,
      cap TEXT,
      organizer TEXT,
      website TEXT,
      program_url TEXT,
      source TEXT NOT NULL,
      source_url TEXT NOT NULL,
      lat REAL,
      lon REAL,
      fetched_at TEXT NOT NULL,
      saved INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_events_start ON events(start);
    CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
    CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
    CREATE INDEX IF NOT EXISTS idx_events_geo ON events(lat, lon);
    CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      title, description, city, venue, organizer,
      content='events', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS events_fts_ai AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, title, description, city, venue, organizer)
      VALUES (new.rowid, new.title, new.description, new.city, new.venue, new.organizer);
    END;
    CREATE TRIGGER IF NOT EXISTS events_fts_ad AFTER DELETE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, title, description, city, venue, organizer)
      VALUES ('delete', old.rowid, old.title, old.description, old.city, old.venue, old.organizer);
    END;
    CREATE TRIGGER IF NOT EXISTS events_fts_au AFTER UPDATE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, title, description, city, venue, organizer)
      VALUES ('delete', old.rowid, old.title, old.description, old.city, old.venue, old.organizer);
      INSERT INTO events_fts(rowid, title, description, city, venue, organizer)
      VALUES (new.rowid, new.title, new.description, new.city, new.venue, new.organizer);
    END;
    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT NOT NULL,
      lat REAL,
      lon REAL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_venues_name ON venues(name);
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export function rowToEvent(r: EventRow): MiEvent {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category as EventCategory,
    type: r.type,
    start: r.start,
    end: r.end,
    timeStart: r.time_start,
    timeEnd: r.time_end,
    venue: r.venue,
    address: r.address,
    city: r.city,
    province: r.province,
    cap: r.cap,
    organizer: r.organizer,
    website: r.website,
    programUrl: r.program_url,
    source: r.source,
    sourceUrl: r.source_url,
    lat: r.lat,
    lon: r.lon,
    saved: r.saved === 1,
    fetchedAt: r.fetched_at,
  };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string, field: string): string {
  const m = ISO_DATE.exec(value);
  if (!m) throw Object.assign(new Error(`Invalid ${field} date, expected YYYY-MM-DD`), { statusCode: 400 });
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
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

function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [s, w, n, e] = parts;
  if (s > n || w > e) return null;
  return [s, w, n, e];
}

export function createEventRepository(db: DatabaseSync): EventRepository {
  const upsert = db.prepare(`
    INSERT INTO events (
      id, title, description, category, type, start, end, time_start, time_end,
      venue, address, city, province, cap, organizer, website, program_url,
      source, source_url, lat, lon, fetched_at, saved
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, description=excluded.description, category=excluded.category,
      type=excluded.type, start=excluded.start, end=excluded.end,
      time_start=excluded.time_start, time_end=excluded.time_end, venue=excluded.venue,
      address=excluded.address, city=excluded.city, province=excluded.province,
      cap=excluded.cap, organizer=excluded.organizer, website=excluded.website,
      program_url=excluded.program_url, lat=COALESCE(events.lat, excluded.lat),
      lon=COALESCE(events.lon, excluded.lon), fetched_at=excluded.fetched_at
  `);
  const upsertDraft = db.prepare(`
    INSERT INTO events (
      id, title, description, category, type, start, end, time_start, time_end,
      venue, address, city, province, cap, organizer, website, program_url,
      source, source_url, lat, lon, fetched_at, saved
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, description=excluded.description, category=excluded.category,
      type=excluded.type, start=excluded.start, end=excluded.end,
      time_start=excluded.time_start, time_end=excluded.time_end, venue=excluded.venue,
      address=excluded.address, city=excluded.city, province=excluded.province,
      cap=excluded.cap, organizer=excluded.organizer, website=excluded.website,
      program_url=excluded.program_url, lat=COALESCE(events.lat, excluded.lat),
      lon=COALESCE(events.lon, excluded.lon), fetched_at=excluded.fetched_at
  `);
  return {
    upsertEvent(e) {
      const existing = db.prepare("SELECT id FROM events WHERE id = ?").get(e.id);
      upsertDraft.run(
        e.id, e.title, e.description, e.category, e.sourceName, e.start, e.end,
        e.timeStart, e.timeEnd, e.venue, e.address, e.city, "MI", null,
        e.organizer, null, e.url, e.sourceName, e.url,
        e.lat, e.lon, e.fetchedAt, e.saved ? 1 : 0,
      );
      return existing ? "updated" : "inserted";
    },
    findEvent: (id) => db.prepare("SELECT id FROM events WHERE id = ?").get(id),
    setSaved(id, saved) {
      return db.prepare("UPDATE events SET saved = ? WHERE id = ?").run(saved ? 1 : 0, id).changes > 0;
    },
    listEvents(f) {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      const q = f.q?.trim();
      if (q) {
        clauses.push("events.rowid IN (SELECT rowid FROM events_fts WHERE events_fts MATCH ?)");
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
      if (f.savedOnly || f.category === "saved") clauses.push("saved = 1");
      if (f.from) {
        clauses.push("date(start) >= date(?)");
        params.push(parseIsoDate(f.from, "from"));
      }
      if (f.to) {
        clauses.push("date(start) <= date(?)");
        params.push(parseIsoDate(f.to, "to"));
      }
      if (!f.all && !f.includePast) {
        clauses.push("date(COALESCE(end, start)) >= date('now', 'localtime')");
        clauses.push("date(start) <= date('now', 'localtime', '+15 days')");
      }
      if (f.geoOnly || f.bbox) {
        clauses.push("lat IS NOT NULL AND lon IS NOT NULL");
      }
      if (f.bbox) {
        const b = parseBbox(f.bbox);
        if (!b) throw Object.assign(new Error("Invalid bbox, expected south,west,north,east"), { statusCode: 400 });
        clauses.push("lat IS NOT NULL AND lon IS NOT NULL AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?");
        params.push(b[0], b[2], b[1], b[3]);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = (db.prepare(`SELECT COUNT(*) AS c FROM events ${where}`).get(...params) as { c: number }).c;
      const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
      const offset = Math.max(f.offset ?? 0, 0);
      const rows = db
        .prepare(`SELECT events.* FROM events ${where} ORDER BY date(start) ASC, time_start ASC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as unknown as EventRow[];
      return { total, events: rows.map(rowToEvent) };
    },
    listCities() {
      return (db.prepare("SELECT DISTINCT city FROM events ORDER BY city ASC").all() as { city: string }[]).map((r) => r.city);
    },
    getEvent(id) {
      const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
      return row ? rowToEvent(row) : null;
    },
    setSyncState(key, value) {
      db.prepare("INSERT INTO sync_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
    },
    getSyncState() {
      const rows = db.prepare("SELECT key, value FROM sync_state").all() as { key: string; value: string }[];
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  };
}

export function venueId(name: string, address: string | null, city: string): string {
  const key = `${name.trim().toLowerCase()}|${(address ?? "").trim().toLowerCase()}|${city.trim().toUpperCase()}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export function createVenueRepository(db: DatabaseSync): VenueRepository {
  return {
    upsertVenue(v, now) {
      const id = venueId(v.name, v.address, v.city);
      const existing = db
        .prepare("SELECT id, name, address, city, lat, lon FROM venues WHERE id = ?")
        .get(id) as { id: string; name: string; address: string | null; city: string; lat: number | null; lon: number | null } | undefined;
      if (existing) return existing;
      db.prepare("INSERT INTO venues(id, name, address, city, lat, lon, updated_at) VALUES (?,?,?,?,?,?,?)").run(
        id, v.name.trim(), v.address, v.city.toUpperCase(), null, null, now,
      );
      return { id, name: v.name.trim(), address: v.address, city: v.city.toUpperCase(), lat: null, lon: null };
    },
    coordsFor(venue, address) {
      if (!venue && !address) return null;
      return (
        (db
          .prepare(
            "SELECT lat, lon FROM venues WHERE lat IS NOT NULL AND (lower(name) = lower(?) OR (? IS NOT NULL AND lower(address) LIKE '%' || lower(?) || '%')) LIMIT 1",
          )
          .get(venue ?? "", address, address ?? "") as { lat: number; lon: number } | undefined) ?? null
      );
    },
    setVenueCoords(id, lat, lon) {
      db.prepare("UPDATE venues SET lat = ?, lon = ?, updated_at = ? WHERE id = ?").run(lat, lon, new Date().toISOString(), id);
    },
    listVenues() {
      return db.prepare("SELECT id, name, address, city, lat, lon FROM venues ORDER BY name LIMIT 500").all();
    },
  };
}
