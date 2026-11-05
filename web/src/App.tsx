import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import type { MiEvent } from "@mievents/shared";
import { eventsReducer, initialEventsState } from "@mievents/shared";
import { EMPTY_FILTERS, fetchCities, fetchEvents, toggleSaved, type Filters } from "./api.js";
import { EventCard } from "./components/EventCard.js";
import { LightMap } from "./components/LightMap.js";
import { applyQuickDate, FiltersBar } from "./components/FiltersBar.js";
import type { QuickDate } from "./dates.js";

const MAP_LIMIT = 500;
const LIST_LIMIT = 100;
const BBOX_DEBOUNCE_MS = 300;

export default function App() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [quickDate, setQuickDate] = useState<QuickDate>("");
  const [evState, dispatch] = useReducer(eventsReducer, initialEventsState);
  const [cities, setCities] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [error, setError] = useState<string | null>(null);
  const [filterByArea, setFilterByArea] = useState(false);
  const bboxRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const viewRef = useRef(view);
  viewRef.current = view;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchCities().then(setCities).catch(() => setCities([]));
  }, []);

  const load = useCallback(async (f: Filters, append = false) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = nextRequestIdRef.current + 1;
    nextRequestIdRef.current = id;
    dispatch({ type: "start", id });
    setError(null);
    try {
      const isMap = viewRef.current === "map";
      const res = await fetchEvents(
        { ...f, bbox: filterByAreaRef.current ? bboxRef.current : undefined, geoOnly: isMap, limit: isMap ? MAP_LIMIT : LIST_LIMIT },
        { signal: ctrl.signal },
      );
      dispatch({ type: "success", id, events: res.events, total: res.total, append });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      dispatch({ type: "error", id, message: (e as Error).message });
      setError((e as Error).message);
    }
  }, []);
  const nextRequestIdRef = useRef(0);
  const filterByAreaRef = useRef(filterByArea);
  filterByAreaRef.current = filterByArea;
  const loadRef = useRef(load);
  loadRef.current = load;

  const loadMore = useCallback(() => {
    void load({ ...filtersRef.current, offset: evState.items.length }, true);
  }, [load, evState.items.length]);

  useEffect(() => {
    const t = setTimeout(() => void load(filters), filters.q ? 350 : 0);
    return () => clearTimeout(t);
  }, [filters, load, view]);

  const onSelect = useCallback((e: MiEvent) => {
    setSelectedId(e.id);
    if (viewRef.current === "list") setView("map");
  }, []);

  const onSelectFromMap = useCallback((e: MiEvent) => {
    setSelectedId(e.id);
  }, []);

  const onShowInList = useCallback((e: MiEvent) => {
    setSelectedId(e.id);
    setView("list");
    setTimeout(() => {
      listRef.current?.querySelector(`[data-event-id="${e.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }, []);

  const onToggleSaved = useCallback(async (e: MiEvent) => {
    try {
      const updated = await toggleSaved(e);
      dispatch({
        type: "success",
        id: nextRequestIdRef.current,
        events: evState.items.map((p) => (p.id === updated.id ? updated : p)),
        total: evState.total,
        append: false,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [evState.items, evState.total]);

  const bboxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBbox = useCallback((bbox: string) => {
    bboxRef.current = bbox;
    if (!filterByAreaRef.current) return;
    if (bboxTimerRef.current) clearTimeout(bboxTimerRef.current);
    bboxTimerRef.current = setTimeout(() => void loadRef.current(filtersRef.current), BBOX_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => {
    if (bboxTimerRef.current) clearTimeout(bboxTimerRef.current);
  }, []);

  const onToggleArea = useCallback(() => {
    setFilterByArea((v) => !v);
  }, []);

  const selected = useMemo(() => evState.items.find((e) => e.id === selectedId) ?? null, [evState.items, selectedId]);
  const hasFilters = Boolean(filters.q.trim() || filters.city || filters.category || filters.priceBand || filters.from || filters.to || quickDate);
  const notShown = evState.total - evState.items.length;

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
        resultCount={evState.total}
      />

      {error && <p className="error">{error}</p>}
      {evState.loading && <p className="loading">CARICAMENTO…</p>}

      {view === "list" ? (
        <main className="event-list" ref={listRef}>
          {!evState.loading && evState.items.length === 0 && (
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
          {evState.items.map((e) => (
            <div key={e.id} data-event-id={e.id}>
              <EventCard event={e} selected={e.id === selectedId} onSelect={onSelect} onToggleSaved={onToggleSaved} />
            </div>
          ))}
          {!evState.loading && evState.items.length < evState.total && (
            <button type="button" className="btn-reset load-more" onClick={loadMore}>
              CARICA ALTRI ({evState.items.length}/{evState.total})
            </button>
          )}
        </main>
      ) : (
        <main className="map-wrap">
          <ErrorBoundary fallback={<div className="map-canvas map-fallback">MAPPA NON DISPONIBILE — USA LA LISTA</div>}>
            <LightMap
              events={evState.items}
              selectedId={selectedId}
              onSelect={onSelectFromMap}
              onShowInList={onShowInList}
              onBackgroundTap={() => setSelectedId(null)}
              onBbox={onBbox}
              filterByArea={filterByArea}
              onToggleArea={onToggleArea}
            />
          </ErrorBoundary>
          {view === "map" && notShown > 0 && (
            <p className="map-more">+{notShown} EVENTI NON MOSTRATI — ATTIVA “FILTRA PER AREA” O ZOOMA</p>
          )}
          {selected && (
            <div className="map-detail">
              <EventCard event={selected} selected onSelect={onSelectFromMap} onToggleSaved={onToggleSaved} />
            </div>
          )}
        </main>
      )}

      <footer className="footer">
        Fonti: Regione Lombardia (CC0), MilanoToday, Eventi@Milano/Base/Magazzini (Tribe), Cheventi.it, Metalitalia, Radio Punk, Alcatraz, Magnolia, Wikidata, RSS · Mappa © OpenStreetMap contributors · tile © Wikimedia Maps (via proxy)
      </footer>
    </div>
  );
}
