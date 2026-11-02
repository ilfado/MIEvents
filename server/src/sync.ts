import type { DatabaseSync } from "node:sqlite";
import { SAGRE_RESOURCE_URL, type MiEvent, type SagreRow, type SyncResult } from "@mievents/shared";
import { geocodeAddress } from "./geocode.js";
import { normalizeRow } from "./normalize.js";
import { fetchMilanotodayEvents, connectorEventToMiEvent } from "./connectors.js";
import { upsertVenue, geocodeVenue, attachVenueCoords } from "./venues.js";
import {
  fetchCheventiEvents,
  fetchWikidataEvents,
  fetchWpVenueEvents,
  fetchNewsRssEvents,
  toMiEvent,
  type ConnectorEvent,
} from "./connectors2.js";
import { apiKeysFromEnv, bitArtistsFromEnv, fetchTicketmasterEvents, fetchEventbriteEvents, fetchBandsintownEvents, DEFAULT_BIT_ARTISTS } from "./connectors3.js";

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
    cheventi?: boolean;
    wikidata?: boolean;
    wpVenues?: boolean;
    newsRss?: boolean;
    ticketing?: boolean;
    maxMilanotodayDetails?: number;
    maxCheventiPages?: number;
    maxBitArtists?: number;
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
      const seenVenues = new Set<string>();
      let budget = opts.maxGeocode ?? events.length;
      for (const e of events) {
        if (budget <= 0) break;
        const venueKey = e.venue ?? e.address ?? "";
        if (venueKey && seenVenues.has(venueKey)) {
          const attached = attachVenueCoords(db, e);
          e.lat = attached.lat;
          e.lon = attached.lon;
          continue;
        }
        if (venueKey) {
          seenVenues.add(venueKey);
          const v = upsertVenue(db, { name: e.venue ?? e.address ?? "", address: e.address, city: e.city }, fetchedAt);
          const geo = await geocodeVenue(db, v, { sleepMs: opts.geocodeSleepMs ?? 1100, fetchImpl });
          if (geo?.lat != null) {
            e.lat = geo.lat;
            e.lon = geo.lon;
            geocoded++;
          }
        } else {
          const point = await geocodeAddress(e, { sleepMs: opts.geocodeSleepMs ?? 1100, fetchImpl });
          if (point) {
            e.lat = point.lat;
            e.lon = point.lon;
            geocoded++;
          }
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

  const insertConnectorEvents = async (ces: ConnectorEvent[], geocode: boolean) => {
    for (const ce of ces) {
      const e = toMiEvent(ce, fetchedAt);
      if (geocode && (e.venue || e.address)) {
        const v = upsertVenue(db, { name: e.venue ?? e.address ?? "", address: e.address, city: e.city }, fetchedAt);
        const cached = attachVenueCoords(db, e);
        if (cached.lat != null) {
          e.lat = cached.lat;
          e.lon = cached.lon;
        } else if (e.lat == null) {
          const geo = await geocodeVenue(db, v, { sleepMs: opts.geocodeSleepMs ?? 1100, fetchImpl });
          if (geo?.lat != null) {
            e.lat = geo.lat;
            e.lon = geo.lon;
            geocoded++;
          }
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
    feedEvents += ces.length;
  };

  const connectorJobs: Array<() => Promise<ConnectorEvent[]>> = [];
  if (opts.milanotoday !== false) {
    connectorJobs.push(async () =>
      (await fetchMilanotodayEvents({ fetchImpl, maxDetails: opts.maxMilanotodayDetails ?? 40, from: fromDate })).map((ce) => ({
        ...ce,
        timeStart: null,
        timeEnd: null,
        lat: null,
        lon: null,
      })),
    );
  }
  if (opts.cheventi !== false) {
    connectorJobs.push(() => fetchCheventiEvents({ fetchImpl, maxPages: opts.maxCheventiPages ?? 2 }));
  }
  if (opts.wikidata !== false) {
    connectorJobs.push(() => fetchWikidataEvents({ fetchImpl }));
  }
  if (opts.wpVenues !== false) {
    connectorJobs.push(() =>
      fetchWpVenueEvents({
        fetchImpl,
        baseUrl: "https://www.santeria.milano.it",
        sourceName: "Santeria Milano",
        restPath: "eventi",
        maxItems: 50,
      }),
    );
  }
  if (opts.newsRss !== false) {
    connectorJobs.push(() =>
      fetchNewsRssEvents({
        fetchImpl,
        feedUrl: "https://vivimilano.corriere.it/concerti-e-spettacoli/feed/",
        sourceId: "vivimilano-spettacoli",
        sourceName: "ViviMilano Spettacoli",
        maxItems: 20,
        fetchDetail: false,
      }),
    );
    connectorJobs.push(() =>
      fetchNewsRssEvents({
        fetchImpl,
        feedUrl: "https://milanoevents.it/category/eventi-milano/feed/",
        sourceId: "milanoevents",
        sourceName: "MilanoEvents.it",
        maxItems: 20,
        fetchDetail: false,
      }),
    );
    connectorJobs.push(() =>
      fetchNewsRssEvents({
        fetchImpl,
        feedUrl: "https://www.eventiatmilano.it/tag/concerti/feed/",
        sourceId: "eventiatmilano-concerti",
        sourceName: "Eventi@Milano",
        maxItems: 20,
        fetchDetail: false,
      }),
    );
  }

  for (const job of connectorJobs) {
    try {
      const ces = await job();
      await insertConnectorEvents(ces, opts.geocode ?? false);
    } catch (err) {
      errors.push(`connector: ${(err as Error).message}`);
    }
  }

  const keys = apiKeysFromEnv();
  if (opts.ticketing !== false) {
    if (keys.ticketmaster) {
      try {
        await insertConnectorEvents(await fetchTicketmasterEvents(keys.ticketmaster, { fetchImpl }), false);
      } catch (err) {
        errors.push(`ticketmaster: ${(err as Error).message}`);
      }
    }
    if (keys.eventbrite) {
      try {
        await insertConnectorEvents(await fetchEventbriteEvents(keys.eventbrite, { fetchImpl }), false);
      } catch (err) {
        errors.push(`eventbrite: ${(err as Error).message}`);
      }
    }
    if (keys.bandsintown) {
      try {
        const artists = bitArtistsFromEnv();
        const list = artists.length > 0 ? artists : DEFAULT_BIT_ARTISTS;
        await insertConnectorEvents(
          await fetchBandsintownEvents(keys.bandsintown, { fetchImpl, artists: list, maxArtists: opts.maxBitArtists ?? 25 }),
          false,
        );
      } catch (err) {
        errors.push(`bandsintown: ${(err as Error).message}`);
      }
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
