import type { VenueRepository, VenueSource, VenueSourceContext } from "../ports.js";
import type { VenueDraft } from "../../core/types.js";
import { pinForVenue } from "../../core/venue-pins.js";
import { venueSources } from "../../adapters/outbound/fetchers/venues.js";

export interface VenueSyncDeps {
  venues: VenueRepository;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  extraVenueSources?: VenueSource[];
}

export interface VenueSyncOptions {
  sources?: Record<string, boolean>;
  limits?: Record<string, number>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export interface VenueSyncSummary {
  venuesSynced: number;
  errors: string[];
}

export function mergeVenueDraft(venues: VenueRepository, d: VenueDraft, now: string): void {
  const pin = pinForVenue(d.name, d.address);
  const existing = venues.findByName(d.name);
  if (!existing) {
    const v = venues.upsertVenue(
      { name: d.name, address: pin?.address ?? d.address, city: pin?.city ?? (d.city || "MILANO") },
      now,
    );
    if (pin) {
      venues.setVenueCoords(v.id, pin.lat, pin.lon);
    } else if (d.lat != null && d.lon != null && Number.isFinite(d.lat) && Number.isFinite(d.lon)) {
      venues.setVenueCoords(v.id, d.lat, d.lon);
    }
    venues.updateVenueMeta(v.id, d.address, d.city, d.source, now);
    return;
  }
  if (pin) {
    venues.setVenueCoords(existing.id, pin.lat, pin.lon);
  } else if (existing.lat == null && d.lat != null && d.lon != null && Number.isFinite(d.lat) && Number.isFinite(d.lon)) {
    venues.setVenueCoords(existing.id, d.lat, d.lon);
  }
  venues.updateVenueMeta(existing.id, d.address, d.city, d.source, now);
}

export async function runVenueSync(deps: VenueSyncDeps, opts: VenueSyncOptions = {}): Promise<VenueSyncSummary> {
  const fetchImpl = opts.fetchImpl ?? deps.fetchImpl ?? fetch;
  const env = opts.env ?? deps.env ?? process.env;
  const now = new Date().toISOString();
  const errors: string[] = [];
  let venuesSynced = 0;

  const extra = deps.extraVenueSources ?? [];
  const sources = extra.length > 0
    ? extra
    : venueSources(env).filter((s) => opts.sources?.[s.id] !== false);

  const ctx: VenueSourceContext = {
    fetchImpl,
    limits: opts.limits ?? {},
    env,
    now: () => new Date().toISOString(),
  };

  for (const source of sources) {
    try {
      const result = await source.run(ctx);
      for (const v of result.venues) {
        try {
          mergeVenueDraft(deps.venues, v, now);
          venuesSynced++;
        } catch (err) {
          errors.push(`${source.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      errors.push(`${source.id}: ${(err as Error).message}`);
    }
  }

  return { venuesSynced, errors };
}
