import { createHash } from "node:crypto";
import type { EventSource } from "../ports.js";
import type { EventDraft, SourceResult, SyncOptions, SyncSummary } from "../../core/types.js";
import { categorize } from "../../core/categorize.js";
import { syncWindow } from "../../core/types.js";
import { lombardiaSagreSource } from "../../adapters/outbound/fetchers/lombardia.js";
import { lombardiaAreaPubblicaSource } from "../../adapters/outbound/fetchers/lombardia-area-pubblica.js";
import { tribeSources } from "../../adapters/outbound/fetchers/tribe.js";
import { milanotodaySource } from "../../adapters/outbound/fetchers/milanotoday.js";
import { cheventiSource } from "../../adapters/outbound/fetchers/cheventi.js";
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
}

export function defaultSources(env: NodeJS.ProcessEnv): EventSource[] {
  return [
    lombardiaSagreSource,
    lombardiaAreaPubblicaSource,
    ...tribeSources,
    milanotodaySource,
    cheventiSource,
    wikidataSource,
    santeriaSource,
    ...newsRssSources,
    ...ticketingSources(env),
  ];
}

export function draftId(d: EventDraft): string {
  return createHash("sha1").update(`${d.sourceId}|${d.url}|${d.start}`).digest("hex").slice(0, 16);
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

  const extra = deps.extraSources ?? [];
  const sources = extra.length > 0
    ? extra
    : defaultSources(env).filter((s) => opts.sources?.[s.id] !== false);

  const ctx = {
    fetchImpl,
    fromDate,
    toDate,
    geocode: opts.geocode ?? true,
    geocodeSleepMs: opts.geocodeSleepMs ?? 1100,
    maxGeocode: opts.maxGeocode ?? 200,
    limits: opts.limits ?? {},
    env,
    venues: deps.venues,
    geocoder: deps.geocoder,
    now: () => new Date().toISOString(),
  };

  let geocodeBudget = ctx.maxGeocode;

  const persist = async (drafts: EventDraft[]) => {
    for (const d of drafts) {
      let lat = d.lat;
      let lon = d.lon;
      if (lat == null && (d.venue || d.address)) {
        const venueName = d.venue ?? d.address ?? "";
        const v = deps.venues.upsertVenue({ name: venueName, address: d.address, city: d.city }, fetchedAt);
        const cached = deps.venues.coordsFor(d.venue, d.address);
        if (cached) {
          lat = cached.lat;
          lon = cached.lon;
        } else if (ctx.geocode && geocodeBudget > 0) {
          geocodeBudget--;
          const q = [d.address, d.venue, d.city, "MI"].filter(Boolean).join(", ");
          const point = await deps.geocoder.geocode(q);
          if (point) {
            deps.venues.setVenueCoords(v.id, point.lat, point.lon);
            lat = point.lat;
            lon = point.lon;
            geocoded++;
          }
          await new Promise((r) => setTimeout(r, ctx.geocodeSleepMs));
        }
      }
      if (lat == null && d.venue) {
        const byName = deps.venues.coordsFor(d.venue, null);
        if (byName) {
          lat = byName.lat;
          lon = byName.lon;
        }
      }
      const category = categorize(`${d.title} ${d.description ?? ""}`);
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
    try {
      const result: SourceResult = await source.run(ctx);
      await persist(result.events);
    } catch (err) {
      errors.push(`${source.id}: ${(err as Error).message}`);
    }
  }

  deps.events.setSyncState("last_sync", fetchedAt);
  deps.events.setSyncState("last_from_date", fromDate);
  deps.events.setSyncState("last_to_date", toDate);
  deps.events.setSyncState("last_total", String(fetched));

  return { fetched, inserted, updated, geocoded, durationMs: Date.now() - started, errors };
}
