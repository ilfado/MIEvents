import type { DatabaseSync } from "node:sqlite";
import type { EventDraft, SourceResult, SyncSummary } from "../core/types.js";

export interface EventRepository {
  upsertEvent(e: EventDraft & { id: string; category: string; saved: boolean; fetchedAt: string }): "inserted" | "updated";
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
  coordsFor(venue: string | null, address: string | null): { lat: number; lon: number } | null;
  setVenueCoords(id: string, lat: number, lon: number): void;
  listVenues(): unknown[];
}

export interface Geocoder {
  geocode(query: string): Promise<{ lat: number; lon: number } | null>;
}

export interface EventSource {
  id: string;
  run(ctx: SourceContext): Promise<SourceResult>;
}

export interface SourceContext {
  fetchImpl: typeof fetch;
  fromDate: string;
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
