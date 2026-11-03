import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import type { MiEvent } from "@mievents/shared";
import { EMPTY_FILTERS, fetchCities, fetchEvents, toggleSaved, type Filters } from "./api.js";
import { EventCard } from "./components/EventCard.js";
import { applyQuickDate, FiltersBar } from "./components/FiltersBar.js";
import type { QuickDate } from "./dates.js";

const EventMap = lazy(() => import("./components/EventMap.js").then((m) => ({ default: m.EventMap })));

export default function App() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [quickDate, setQuickDate] = useState<QuickDate>("");
  const [events, setEvents] = useState<MiEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [cities, setCities] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterByArea, setFilterByArea] = useState(false);
  const [showStreets, setShowStreets] = useState(true);
  const bboxRef = useRef<string | undefined>(undefined);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchCities().then(setCities).catch(() => setCities([]));
  }, []);

  const load = useCallback(async (f: Filters, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchEvents({ ...f, bbox: filterByArea ? bboxRef.current : undefined, geoOnly: view === "map" });
      setEvents((prev) => (append ? [...prev, ...res.events] : res.events));
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterByArea]);

  const loadMore = useCallback(() => {
    void load({ ...filters, offset: events.length }, true);
  }, [load, filters, events.length]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(filters), filters.q ? 350 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, load]);

  const onSelect = useCallback((e: MiEvent) => {
    setSelectedId(e.id);
    if (view === "list") {
      setView("map");
    }
  }, [view]);

  const onSelectFromMap = useCallback((e: MiEvent) => {
    setSelectedId(e.id);
    const el = listRef.current?.querySelector(`[data-event-id="${e.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [view]);

  const onToggleSaved = useCallback(async (e: MiEvent) => {
    try {
      const updated = await toggleSaved(e);
      setEvents((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const onBbox = useCallback((bbox: string) => {
    bboxRef.current = bbox;
    if (filterByArea) void load(filters);
  }, [filterByArea, load, filters]);

  const onToggleArea = useCallback(() => {
    setFilterByArea((v) => !v);
  }, []);

  const selected = useMemo(() => events.find((e) => e.id === selectedId) ?? null, [events, selectedId]);
  const hasFilters = Boolean(filters.q.trim() || filters.city || filters.category || filters.priceBand || filters.from || filters.to || quickDate);

  return (
    <div className="app">
      <header className="header">
        <h1><img src="/logo-512.png" alt="" className="logo" /> MIEvents</h1>
        <p className="subtitle">Eventi delle prossime 2 settimane a Milano + provincia</p>
        <nav className="view-switch" role="tablist">
          <button type="button" role="tab" aria-selected={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            Lista
          </button>
          <button type="button" role="tab" aria-selected={view === "map"} className={view === "map" ? "active" : ""} onClick={() => setView("map")}>
            Mappa
          </button>
        </nav>
      </header>

      <FiltersBar
        filters={filters}
        quickDate={quickDate}
        cities={cities}
        onChange={setFilters}
        onQuickDate={(q) => {
          setQuickDate(q);
          setFilters((f) => applyQuickDate(f, q));
        }}
        resultCount={total}
      />

      {error && <p className="error">{error}</p>}
      {loading && <p className="loading">CARICAMENTO…</p>}

      {view === "list" ? (
        <main className="event-list" ref={listRef}>
          {!loading && events.length === 0 && (
            <div className="empty">
              <p>NESSUN EVENTO CON QUESTI FILTRI.</p>
              {hasFilters && (
                <button
                  type="button"
                  className="btn-reset"
                  onClick={() => {
                    setFilters({ ...EMPTY_FILTERS });
                    setQuickDate("");
                  }}
                >
                  AZZERA FILTRI
                </button>
              )}
            </div>
          )}
          {events.map((e) => (
            <div key={e.id} data-event-id={e.id}>
              <EventCard event={e} selected={e.id === selectedId} onSelect={onSelect} onToggleSaved={onToggleSaved} />
            </div>
          ))}
          {!loading && events.length < total && (
            <button type="button" className="btn-reset load-more" onClick={loadMore}>
              CARICA ALTRI ({events.length}/{total})
            </button>
          )}
        </main>
      ) : (
        <main className="map-wrap">
          <Suspense fallback={<div className="map-canvas map-fallback">CARICAMENTO MAPPA…</div>}>
            <ErrorBoundary fallback={<div className="map-canvas map-fallback">MAPPA NON DISPONIBILE — USA LA LISTA</div>}>
            <EventMap
              events={events}
              selectedId={selectedId}
              onSelect={onSelectFromMap}
              onBbox={onBbox}
              filterByArea={filterByArea}
              onToggleArea={onToggleArea}
              showStreets={showStreets}
              onToggleStreets={() => setShowStreets((v) => !v)}
            />
            </ErrorBoundary>
          </Suspense>
          {selected && (
            <div className="map-detail">
              <EventCard event={selected} selected onSelect={onSelectFromMap} onToggleSaved={onToggleSaved} />
            </div>
          )}
        </main>
      )}

      <footer className="footer">
        Fonte: Regione Lombardia (CC0), MilanoToday, Cheventi.it, Wikidata · Mappa © OpenStreetMap contributors © CARTO
      </footer>
    </div>
  );
}
