export type EventCategory =
  | "sagra"
  | "fiera"
  | "concerto"
  | "teatro"
  | "mostra"
  | "sport"
  | "famiglia"
  | "altro";

export const EVENT_CATEGORIES: EventCategory[] = [
  "sagra",
  "fiera",
  "concerto",
  "teatro",
  "mostra",
  "sport",
  "famiglia",
  "altro",
];

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface MiEvent {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  type: string | null;
  start: string;
  end: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  venue: string | null;
  address: string | null;
  city: string;
  province: string;
  cap: string | null;
  organizer: string | null;
  website: string | null;
  programUrl: string | null;
  source: string;
  sourceUrl: string;
  lat: number | null;
  lon: number | null;
  saved: boolean;
  fetchedAt: string;
}

export interface EventFilters {
  q?: string;
  city?: string;
  category?: EventCategory | "saved";
  from?: string;
  to?: string;
  bbox?: string;
  savedOnly?: boolean;
  includePast?: boolean;
  all?: boolean;
  geoOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface EventsResponse {
  total: number;
  events: MiEvent[];
}

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  geocoded: number;
  durationMs: number;
  errors: string[];
}

export const SAGRE_VIEW_ID = "f2tm-32s5";

export const SAGRE_RESOURCE_URL = `https://www.dati.lombardia.it/resource/${SAGRE_VIEW_ID}.json`;

export const SAGRE_AREA_PUBBLICA_VIEW_ID = "hs8z-dcey";

export const SAGRE_AREA_PUBBLICA_RESOURCE_URL = `https://www.dati.lombardia.it/resource/${SAGRE_AREA_PUBBLICA_VIEW_ID}.json`;

export interface SagreRow {
  istat: string | null;
  comune: string | null;
  prov: string | null;
  denom: string | null;
  tipo: string | null;
  n_ediz: string | null;
  descriz: string | null;
  data_in: string | null;
  ora_in: string | null;
  data_fine: string | null;
  ora_fine: string | null;
  toponimo: string | null;
  indirizzo: string | null;
  civico: string | null;
  cap: string | null;
  somminis: string | null;
  sito_web: string | null;
  url_programma: { url: string | null; description?: string | null } | null;
  nome_org: string | null;
}

export interface SagreAreaPubblicaRow {
  denom: string | null;
  comune: string | null;
  prov: string | null;
  tipo: string | null;
  descriz: string | null;
  data_in: string | null;
  ora_in: string | null;
  data_fine: string | null;
  ora_fine: string | null;
  toponimo: string | null;
  indirizzo: string | null;
  civico: string | null;
  cap: string | null;
  sito_web: string | null;
  url_programma: { url: string | null; description?: string | null } | null;
  nome_org: string | null;
  geo_x: string | null;
  geo_y: string | null;
  location: { type: string; coordinates: [number, number] } | null;
}
