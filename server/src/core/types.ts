export interface EventDraft {
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
}

export interface SourceResult {
  sourceId: string;
  events: EventDraft[];
  error?: string;
}

export interface SyncSummary {
  fetched: number;
  inserted: number;
  updated: number;
  geocoded: number;
  durationMs: number;
  errors: string[];
}

export interface SyncOptions {
  fromDate?: string;
  geocode?: boolean;
  maxGeocode?: number;
  geocodeSleepMs?: number;
  sources?: Record<string, boolean>;
  limits?: Record<string, number>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}
