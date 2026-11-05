import type { DatabaseSync } from "node:sqlite";
import type { EventDraft, SourceResult, SyncSummary, VenueSourceResult } from "../core/types.js";

export interface EventRepository {
  upsertEvent(e: EventDraft & { id: string; category: string; saved: boolean; fetchedAt: string }): "inserted" | "updated";
  updateCoords(id: string, lat: number, lon: number): void;
  findEvent(id: string): unknown | undefined;
  setSaved(id: string, saved: boolean): boolean;
  listEvents(f: import("@mievents/shared").EventFilters): import("@mievents/shared").EventsResponse;
  listCities(): string[];
  getEvent(id: string): import("@mievents/shared").MiEvent | null;
  setSyncState(key: string, value: string): void;
  getSyncState(): Record<string, string>;
}

export interface VenueRepository {
  upsertVenue(v: { name: string; address: string | null; city: string }, now: string): { id: string; name: string; address: string | null; city: string; lat: number | null; lon: number | null };
  findByName(name: string): { id: string; name: string; address: string | null; city: string; lat: number | null; lon: number | null } | null;
  updateVenueMeta(id: string, address: string | null, city: string, source: string | null, now: string): void;
  coordsFor(venue: string | null, address: string | null, city?: string): { lat: number; lon: number } | null;
  setVenueCoords(id: string, lat: number, lon: number): void;
  markGeocodeFailed(id: string, at: string): void;
  isGeocodeFailedRecently(id: string, now: string): boolean;
  listVenues(): unknown[];
}

export interface Geocoder {
  geocode(query: string): Promise<{ lat: number; lon: number } | null>;
}

export interface EventSource {
  id: string;
  run(ctx: SourceContext): Promise<SourceResult>;
}

export interface VenueSource {
  id: string;
  run(ctx: VenueSourceContext): Promise<VenueSourceResult>;
}

export interface VenueSourceContext {
  fetchImpl: typeof fetch;
  limits: Record<string, number>;
  env: NodeJS.ProcessEnv;
  now: () => string;
}

export interface SourceContext {
  fetchImpl: typeof fetch;
  fromDate: string;
  toDate: string;
  geocode: boolean;
  geocodeSleepMs: number;
  maxGeocode: number;
  limits: Record<string, number>;
  env: NodeJS.ProcessEnv;
  venues: VenueRepository;
  geocoder: Geocoder;
  now: () => string;
}

export interface SyncService {
  run(opts?: import("../core/types.js").SyncOptions): Promise<SyncSummary>;
}

export type Db = DatabaseSync;
