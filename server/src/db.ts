import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import type { EventCategory, MiEvent } from "@mievents/shared";

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
