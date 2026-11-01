import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MiEvent } from "@mievents/shared";
import { EMPTY_FILTERS, fetchCities, fetchEvents, toggleSaved, type Filters } from "./api.js";
import { EventCard } from "./components/EventCard.js";
import { applyQuickDate, FiltersBar } from "./components/FiltersBar.js";
import type { QuickDate } from "./dates.js";
import { lazy, Suspense } from "react";

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
  const [recenterKey, setRecenterKey] = useState(0);
  const bboxRef = useRef<string | undefined>(undefined);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void fetchCities().then(setCities).catch(() => setCities([]));
  }, []);

  const load = useCallback(async (f: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchEvents({ ...f, bbox: bboxRef.current });
      setEvents(res.events);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(filters), filters.q ? 350 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, load]);

  const onSelect = useCallback((e: MiEvent) => {
    setSelectedId(e.id);
    setView("map");
    setRecenterKey((k) => k + 1);
  }, []);

  const onToggleSaved = useCallback(
    async (e: MiEvent) => {
      try {
        const updated = await toggleSaved(e);
        setEvents((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [],
  );

  const onBbox = useCallback((bbox: string) => {
    bboxRef.current = bbox;
  }, []);

  const selected = useMemo(() => events.find((e) => e.id === selectedId) ?? null, [events, selectedId]);

  return (
    <div className="app">
      <header className="header">
        <h1>MIEvents</h1>
        <p className="subtitle">Eventi a Milano e provincia · lista e mappa</p>
        <nav className="view-switch" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
            Lista
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "map"}
            className={view === "map" ? "active" : ""}
            onClick={() => setView("map")}
          >
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
      {loading && <p className="loading">Caricamento…</p>}

      {view === "list" ? (
        <main className="event-list">
          {!loading && events.length === 0 && <p className="empty">Nessun evento trovato con questi filtri.</p>}
          {events.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              selected={e.id === selectedId}
              onSelect={onSelect}
              onToggleSaved={onToggleSaved}
            />
          ))}
        </main>
      ) : (
        <main className="map-wrap">
          <Suspense fallback={<div className="map map-fallback">Caricamento mappa…</div>}>
            <EventMap events={events} selectedId={selectedId} onSelect={onSelect} onBbox={onBbox} recenterKey={recenterKey} />
          </Suspense>
          {selected && (
            <div className="map-detail">
              <EventCard event={selected} selected onSelect={onSelect} onToggleSaved={onToggleSaved} />
            </div>
          )}
        </main>
      )}

      <footer className="footer">
        Fonte: <a href="https://www.dati.lombardia.it/Commercio/Sagre-e-fiere-su-area-pubblica-in-provincia-di-Mil/f2tm-32s5">Regione Lombardia — Sagre e fiere su area pubblica in provincia di Milano</a> (CC0).
        Mappa © OpenStreetMap.
      </footer>
    </div>
  );
}
