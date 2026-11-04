import { createHash } from "node:crypto";
import type { EventSource, VenueSource } from "../ports.js";
import type { EventDraft, SourceResult, SyncOptions, SyncSummary } from "../../core/types.js";
import { categorize } from "../../core/categorize.js";
import { isBigEvent } from "../../core/big-events.js";
import { parsePriceText } from "../../core/price.js";
import { pinForVenue } from "../../core/venue-pins.js";
import { syncWindow } from "../../core/types.js";
import { distKm, MI_CITY_RE, MILANO_CENTER } from "../../core/text.js";
import { runVenueSync } from "./venue-sync.js";
import { lombardiaSagreSource } from "../../adapters/outbound/fetchers/lombardia.js";
import { lombardiaAreaPubblicaSource } from "../../adapters/outbound/fetchers/lombardia-area-pubblica.js";
import { tribeSources } from "../../adapters/outbound/fetchers/tribe.js";
import { milanotodaySource } from "../../adapters/outbound/fetchers/milanotoday.js";
import { cheventiSource } from "../../adapters/outbound/fetchers/cheventi.js";
import { metalitaliaSource } from "../../adapters/outbound/fetchers/metalitalia.js";
import { radiopunkSource } from "../../adapters/outbound/fetchers/radiopunk.js";
import { alcatrazSource, magnoliaSource } from "../../adapters/outbound/fetchers/wp-clubs.js";
import { wikidataSource } from "../../adapters/outbound/fetchers/wikidata.js";
import { santeriaSource } from "../../adapters/outbound/fetchers/wp-venues.js";
import { newsRssSources } from "../../adapters/outbound/fetchers/news-rss.js";
import { ticketingSources } from "../../adapters/outbound/fetchers/ticketing.js";

export interface SyncDeps {
  events: import("../ports.js").EventRepository;
  venues: import("../ports.js").VenueRepository;
  geocoder: import("../ports.js").Geocoder;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  extraSources?: EventSource[];
  extraVenueSources?: VenueSource[];
}

export function defaultSources(env: NodeJS.ProcessEnv): EventSource[] {
  return [
    lombardiaSagreSource,
    lombardiaAreaPubblicaSource,
    ...tribeSources,
    milanotodaySource,
    cheventiSource,
    metalitaliaSource,
    radiopunkSource,
    alcatrazSource,
    magnoliaSource,
    wikidataSource,
    santeriaSource,
    ...newsRssSources,
    ...ticketingSources(env),
  ];
}

export function draftId(d: EventDraft): string {
  if (d._id) return d._id;
  return createHash("sha1").update(`${d.sourceId}|${d.url}|${d.start}`).digest("hex").slice(0, 16);
}

export interface SyncRunner {
  run(opts?: SyncOptions): Promise<SyncSummary> | null;
  isRunning(): boolean;
}

export function createSyncRunner(deps: SyncDeps): SyncRunner {
  let current: Promise<SyncSummary> | null = null;
  return {
    run(opts) {
      if (current) return null;
      current = runSync(deps, opts).finally(() => {
        current = null;
      });
      return current;
    },
    isRunning: () => current !== null,
  };
}

export async function runSync(deps: SyncDeps, opts: SyncOptions = {}): Promise<SyncSummary> {
  const started = Date.now();
  const fetchImpl = opts.fetchImpl ?? deps.fetchImpl ?? fetch;
  const env = opts.env ?? deps.env ?? process.env;
  const win = syncWindow();
  const fromDate = opts.fromDate ?? win.fromDate;
  const toDate = opts.toDate ?? win.toDate;
  const fetchedAt = new Date().toISOString();
  const errors: string[] = [];
  let inserted = 0;
  let updated = 0;
  let geocoded = 0;
  let fetched = 0;
  let venuesSynced = 0;
  let skipped = 0;

  const extra = deps.extraSources ?? [];
  const sources = extra.length > 0
    ? extra
    : defaultSources(env).filter((s) => opts.sources?.[s.id] !== false);

  const ctx = {
    fetchImpl,
    fromDate,
    toDate,
    geocode: opts.geocode ?? true,
    geocodeSleepMs: opts.geocodeSleepMs ?? 1100,  // Nominatim policy: max 1 req/s
    maxGeocode: opts.maxGeocode ?? 15,
    limits: opts.limits ?? {},
    env,
    venues: deps.venues,
    geocoder: deps.geocoder,
    now: () => new Date().toISOString(),
  };

  let geocodeBudget = ctx.maxGeocode;
  const venueCache = new Map<string, { id: string }>();
  const coordsCache = new Map<string, { lat: number; lon: number } | null>();

  if (opts.syncVenues !== false) {
    const vs = await runVenueSync(
      { venues: deps.venues, fetchImpl, env, extraVenueSources: deps.extraVenueSources },
      { limits: ctx.limits, fetchImpl, env },
    );
    venuesSynced = vs.venuesSynced;
    for (const e of vs.errors) errors.push(e);
  }

  const persist = async (drafts: EventDraft[]) => {
    for (const d of drafts) {
      if (isBigEvent(d.venue, d.address, d.title) || /candlelight/i.test(d.title)) {
        skipped++;
        continue;
      }
      if (d.priceMin == null && d.priceMax == null) {
        const p = parsePriceText(`${d.title} ${d.description ?? ""}`);
        if (p) {
          d.priceMin = p.min;
          d.priceMax = p.max;
        }
      }
      if (d.priceMax != null && d.priceMax >= 35) {
        skipped++;
        continue;
      }
      const pin = d.venue || d.address ? pinForVenue(d.venue, d.address) : null;
      let lat = d.lat ?? pin?.lat ?? null;
      let lon = d.lon ?? pin?.lon ?? null;
      if (d.venue || d.address) {
        const venueName = d.venue ?? d.address ?? "";
        let v = venueCache.get(venueName);
        if (!v) {
          v = deps.venues.upsertVenue({ name: venueName, address: d.address ?? pin?.address ?? null, city: pin?.city ?? d.city }, fetchedAt);
          venueCache.set(venueName, v);
        }
        const ckey = `${d.venue ?? ""}\u0000${d.address ?? ""}`;
        let cached = coordsCache.has(ckey) ? coordsCache.get(ckey) ?? null : deps.venues.coordsFor(d.venue, d.address);
        if (!coordsCache.has(ckey)) coordsCache.set(ckey, cached);
        if (pin && !cached) {
          deps.venues.setVenueCoords(v.id, pin.lat, pin.lon);
          cached = { lat: pin.lat, lon: pin.lon };
          coordsCache.set(ckey, cached);
        }
        if (lat == null && cached) {
          lat = cached.lat;
          lon = cached.lon;
        }
        if (lat != null && lon != null && !cached) {
          deps.venues.setVenueCoords(v.id, lat, lon);
          coordsCache.set(ckey, { lat, lon });
        }
        if (lat == null && ctx.geocode && geocodeBudget > 0) {
          geocodeBudget--;
          const q = [d.address, d.venue, d.city, "MI"].filter(Boolean).join(", ");
          const point = await deps.geocoder.geocode(q);
          if (point) {
            deps.venues.setVenueCoords(v.id, point.lat, point.lon);
            coordsCache.set(ckey, point);
            lat = point.lat;
            lon = point.lon;
            geocoded++;
          } else {
            coordsCache.set(ckey, null);
          }
          await new Promise((r) => setTimeout(r, ctx.geocodeSleepMs));
        }
      }
      if (lat != null && lon != null) {
        if (distKm(lat, lon, MILANO_CENTER.lat, MILANO_CENTER.lon) > 100) {
          skipped++;
          continue;
        }
      } else if (!MI_CITY_RE.test(`${d.venue ?? ""} ${d.address ?? ""} ${d.city}`)) {
        skipped++;
        continue;
      }
      const category = d.categoryHint ?? categorize(`${d.title} ${d.description ?? ""}`);
      if ((category === "concerto" || category === "teatro") && d.priceMax != null && d.priceMax < 5) {
        d.priceMin = null;
        d.priceMax = null;
      }
      const res = deps.events.upsertEvent({
        ...d,
        id: draftId(d),
        category,
        lat,
        lon,
        saved: false,
        fetchedAt,
      } as never);
      if (res === "inserted") inserted++;
      else updated++;
    }
    fetched += drafts.length;
  };

  for (const source of sources) {
    const t0 = Date.now();
    try {
      const result: SourceResult = await source.run(ctx);
      console.log(`[sync] ${source.id}: ok ${result.events.length} eventi in ${Date.now() - t0}ms`);
      await persist(result.events);
    } catch (err) {
      console.log(`[sync] ${source.id}: ERRORE ${(err as Error).message}`);
      errors.push(`${source.id}: ${(err as Error).message}`);
    }
  }

  deps.events.setSyncState("last_sync", fetchedAt);
  deps.events.setSyncState("last_from_date", fromDate);
  deps.events.setSyncState("last_to_date", toDate);
  deps.events.setSyncState("last_total", String(fetched));
  deps.events.setSyncState("last_venues", String(venuesSynced));

  return { fetched, inserted, updated, geocoded, venuesSynced, skipped, durationMs: Date.now() - started, errors };
}
