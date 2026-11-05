export interface EventDraft {
  _id?: string;
  sourceId: string;
  sourceName: string;
  title: string;
  description: string | null;
  start: string;
  end: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  url: string;
  venue: string | null;
  address: string | null;
  city: string;
  lat: number | null;
  lon: number | null;
  organizer: string | null;
  categoryHint?: import("@mievents/shared").EventCategory;
  priceMin?: number | null;
  priceMax?: number | null;
}

export interface SourceResult {
  sourceId: string;
  events: EventDraft[];
  error?: string;
}

export interface VenueDraft {
  name: string;
  address: string | null;
  city: string;
  lat: number | null;
  lon: number | null;
  source: string;
  url: string | null;
}

export interface VenueSourceResult {
  sourceId: string;
  venues: VenueDraft[];
  error?: string;
}

export interface SyncSummary {
  fetched: number;
  inserted: number;
  updated: number;
  geocoded: number;
  venuesSynced: number;
  skipped: number;
  reconciled?: number;
  durationMs: number;
  errors: string[];
}

export interface SyncOptions {
  fromDate?: string;
  toDate?: string;
  geocode?: boolean;
  maxGeocode?: number;
  geocodeSleepMs?: number;
  sources?: Record<string, boolean>;
  syncVenues?: boolean;
  limits?: Record<string, number>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

import { addDaysIso, todayRome } from "./text.js";

export function syncWindow(now = new Date(), days = 15): { fromDate: string; toDate: string } {
  const from = todayRome(now);
  return { fromDate: from, toDate: addDaysIso(from, days) };
}
