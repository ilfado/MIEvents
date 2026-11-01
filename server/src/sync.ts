import type { DatabaseSync } from "node:sqlite";
import { SAGRE_RESOURCE_URL, type MiEvent, type SagreRow, type SyncResult } from "@mievents/shared";
import { geocodeAddress } from "./geocode.js";
import { normalizeRow } from "./normalize.js";
import { fetchMilanotodayEvents, connectorEventToMiEvent } from "./connectors.js";

const UA = "MIEvents/0.1 (https://github.com/ilfado/MIEvents)";
const PAGE = 500;

function soql(where: string, orderBy: string, offset: number): string {
  return `SELECT * WHERE ${where} ORDER BY ${orderBy} LIMIT ${PAGE} OFFSET ${offset}`;
}

async function fetchPage(query: string, fetchImpl: typeof fetch): Promise<SagreRow[]> {
  const url = `${SAGRE_RESOURCE_URL}?$query=${encodeURIComponent(query)}`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Socrata ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("Unexpected Socrata response");
  return data as SagreRow[];
}

export async function syncEvents(
  db: DatabaseSync,
  opts: {
    fromDate?: string;
    geocode?: boolean;
    maxGeocode?: number;
    geocodeSleepMs?: number;
    feeds?: boolean;
    milanotoday?: boolean;
    maxMilanotodayDetails?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SyncResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const started = Date.now();
  const fromDate = opts.fromDate ?? new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();
  const where = `upper(prov) = 'MI' AND data_in >= '${fromDate}' AND denom IS NOT NULL`;
  const errors: string[] = [];
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let geocoded = 0;
  let feedEvents = 0;

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

  for (let offset = 0; ; offset += PAGE) {
    const query = soql(where, "data_in", offset);
    let rows: SagreRow[];
    try {
      rows = await fetchPage(query, fetchImpl);
    } catch (err) {
      errors.push(`offset ${offset}: ${(err as Error).message}`);
      break;
    }
    if (rows.length === 0) break;
    fetched += rows.length;
    const events: MiEvent[] = [];
    for (const row of rows) {
      const e = normalizeRow(row, fetchedAt);
      if (e) events.push(e);
    }
    if (opts.geocode) {
      let budget = opts.maxGeocode ?? events.length;
      for (const e of events) {
        if (budget <= 0) break;
        const point = await geocodeAddress(e, {
          sleepMs: opts.geocodeSleepMs ?? 1100,
          fetchImpl,
        });
        if (point) {
          e.lat = point.lat;
          e.lon = point.lon;
          geocoded++;
        }
        budget--;
      }
    }
    for (const e of events) {
      const existing = db.prepare("SELECT id FROM events WHERE id = ?").get(e.id);
      upsert.run(
        e.id, e.title, e.description, e.category, e.type, e.start, e.end,
        e.timeStart, e.timeEnd, e.venue, e.address, e.city, e.province, e.cap,
        e.organizer, e.website, e.programUrl, e.source, e.sourceUrl,
        e.lat, e.lon, e.fetchedAt, e.saved ? 1 : 0,
      );
      if (existing) updated++;
      else inserted++;
    }
    if (rows.length < PAGE) break;
  }

  if (opts.milanotoday !== false) {
    try {
      const events = await fetchMilanotodayEvents({ fetchImpl, maxDetails: opts.maxMilanotodayDetails ?? 40 });
      feedEvents += events.length;
      for (const ce of events) {
        const e = connectorEventToMiEvent(ce, fetchedAt);
        if (opts.geocode && e.address) {
          const point = await geocodeAddress(e, { sleepMs: opts.geocodeSleepMs ?? 1100, fetchImpl });
          if (point) {
            e.lat = point.lat;
            e.lon = point.lon;
            geocoded++;
          }
        }
        const existing = db.prepare("SELECT id FROM events WHERE id = ?").get(e.id);
        upsert.run(
          e.id, e.title, e.description, e.category, e.type, e.start, e.end,
          e.timeStart, e.timeEnd, e.venue, e.address, e.city, e.province, e.cap,
          e.organizer, e.website, e.programUrl, e.source, e.sourceUrl,
          e.lat, e.lon, e.fetchedAt, e.saved ? 1 : 0,
        );
        if (existing) updated++;
        else inserted++;
      }
    } catch (err) {
      errors.push(`milanotoday-eventi: ${(err as Error).message}`);
    }
  }

  db.prepare("INSERT INTO sync_state(key, value) VALUES ('last_sync', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(fetchedAt);
  db.prepare("INSERT INTO sync_state(key, value) VALUES ('last_from_date', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(fromDate);
  db.prepare("INSERT INTO sync_state(key, value) VALUES ('last_feed_events', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(String(feedEvents));

  return { fetched, inserted, updated, geocoded, durationMs: Date.now() - started, errors };
}
