import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { geocodeAddress } from "./geocode.js";

export interface Venue {
  id: string;
  name: string;
  address: string | null;
  city: string;
  lat: number | null;
  lon: number | null;
}

export function venueId(name: string, address: string | null, city: string): string {
  const key = `${name.trim().toLowerCase()}|${(address ?? "").trim().toLowerCase()}|${city.trim().toUpperCase()}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export function upsertVenue(
  db: DatabaseSync,
  v: { name: string; address: string | null; city: string },
  now: string,
): Venue {
  const id = venueId(v.name, v.address, v.city);
  const existing = db
    .prepare("SELECT id, name, address, city, lat, lon FROM venues WHERE id = ?")
    .get(id) as Venue | undefined;
  if (existing) return existing;
  const venue: Venue = { id, name: v.name.trim(), address: v.address, city: v.city.toUpperCase(), lat: null, lon: null };
  db.prepare("INSERT INTO venues(id, name, address, city, lat, lon, updated_at) VALUES (?,?,?,?,?,?,?)").run(
    id, venue.name, venue.address, venue.city, null, null, now,
  );
  return venue;
}

export async function geocodeVenue(
  db: DatabaseSync,
  venue: Venue,
  opts: { sleepMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Venue | null> {
  if (venue.lat != null && venue.lon != null) return venue;
  const point = await geocodeAddress(
    { address: venue.address, city: venue.city, cap: null, province: "MI" },
    { sleepMs: opts.sleepMs ?? 1100, fetchImpl: opts.fetchImpl },
  );
  if (!point) return null;
  db.prepare("UPDATE venues SET lat = ?, lon = ?, updated_at = ? WHERE id = ?").run(
    point.lat, point.lon, new Date().toISOString(), venue.id,
  );
  return { ...venue, lat: point.lat, lon: point.lon };
}

export function attachVenueCoords(
  db: DatabaseSync,
  e: { venue: string | null; address: string | null; city: string; lat: number | null; lon: number | null },
): { lat: number | null; lon: number | null } {
  if (e.lat != null && e.lon != null) return { lat: e.lat, lon: e.lon };
  if (!e.venue && !e.address) return { lat: e.lat, lon: e.lon };
  const row = db
    .prepare("SELECT lat, lon FROM venues WHERE lat IS NOT NULL AND (lower(name) = lower(?) OR (? IS NOT NULL AND lower(address) LIKE '%' || lower(?) || '%')) LIMIT 1")
    .get(e.venue ?? "", e.address, e.address ?? "") as { lat: number; lon: number } | undefined;
  if (row) return { lat: row.lat, lon: row.lon };
  return { lat: e.lat, lon: e.lon };
}

export function listVenues(db: DatabaseSync): Venue[] {
  return db.prepare("SELECT id, name, address, city, lat, lon FROM venues ORDER BY name LIMIT 500").all() as unknown as Venue[];
}
