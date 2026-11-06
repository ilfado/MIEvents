import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import type { MiEvent } from "@mievents/shared";
import { applyClientFilters, eventsReducer, geoEvents, initialEventsState, withSaved } from "@mievents/shared";
import { EMPTY_FILTERS, fetchCities, fetchEvents, type Filters } from "./api.js";
import { loadSavedIds, toggleSavedId } from "./saved.js";
import { EventCard } from "./components/EventCard.js";
import { LightMap } from "./components/LightMap.js";
import { PixelShades } from "./components/PixelIcons.js";
import { applyQuickDate, FiltersBar } from "./components/FiltersBar.js";
import type { QuickDate } from "./dates.js";
import type { PriceBand } from "@mievents/shared";

const FETCH_LIMIT = 500;
const BBOX_DEBOUNCE_MS = 300;

const SAVED_MSG_CARI = ["Uella", "Salvato, sciura", "Ciumbia"];
const SAVED_MSG_GRATIS = ["Poverètt", "Dai su", "Un abbraccio"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function savedMessage(band: PriceBand | null): string {
  if (band === "cari") return pick(SAVED_MSG_CARI);
  if (band === "gratis") return pick(SAVED_MSG_GRATIS);
  return "Salvato, Tac";
}

export default function App() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [quickDate, setQuickDate] = useState<QuickDate>("");
  const [evState, dispatch] = useReducer(eventsReducer, initialEventsState);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => loadSavedIds());
  const [cities, setCities] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [error, setError] = useState<string | null>(null);
  const [filterByArea, setFilterByArea] = useState(false);
  const [areaEvents, setAreaEvents] = useState<MiEvent[] | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("stasera-theme") === "dark" ? "dark" : "light"
  );
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bboxRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const nextIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchCities().then(setCities).catch(() => setCities([]));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("stasera-theme", theme);
    } catch {
      /* storage non disponibile */
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0d0f10" : "#f2f0ea");
  }, [theme]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const fetchAll = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = ++nextIdRef.current;
    dispatch({ type: "start", id });
    setError(null);
    try {
      const res = await fetchEvents({ ...EMPTY_FILTERS, limit: FETCH_LIMIT }, { signal: ctrl.signal });
      dispatch({ type: "success", id, events: res.events, total: res.total, append: false });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      dispatch({ type: "error", id, message: (e as Error).message });
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const fetchArea = useCallback(async (bbox: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = ++nextIdRef.current;
    dispatch({ type: "start", id });
    try {
      const res = await fetchEvents({ ...filters, bbox, geoOnly: true, limit: FETCH_LIMIT }, { signal: ctrl.signal });
      dispatch({ type: "success", id, events: res.events, total: res.total, append: false });
      setAreaEvents(res.events);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);
    }
  }, [filters]);

  const bboxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBbox = useCallback((bbox: string) => {
    bboxRef.current = bbox;
    if (!filterByArea) return;
    if (bboxTimerRef.current) clearTimeout(bboxTimerRef.current);
    bboxTimerRef.current = setTimeout(() => void fetchArea(bbox), BBOX_DEBOUNCE_MS);
  }, [filterByArea, fetchArea]);
  useEffect(() => () => {
    if (bboxTimerRef.current) clearTimeout(bboxTimerRef.current);
  }, []);

  const onToggleArea = useCallback(() => {
    setFilterByArea((v) => {
      const nv = !v;
      if (nv && bboxRef.current) void fetchArea(bboxRef.current);
      else setAreaEvents(null);
      return nv;
    });
  }, [fetchArea]);

  const onSelect = useCallback((e: MiEvent) => {
    setSelectedId(e.id);
    if (view === "list") setView("map");
  }, [view]);

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

  const onToggleSaved = useCallback((e: MiEvent) => {
    const willSave = !savedIds.has(e.id);
    setSavedIds((prev) => toggleSavedId(prev, e.id));
    if (willSave) showToast(savedMessage(e.priceBand));
  }, [savedIds, showToast]);

  const visible = useMemo(() => {
    const base = withSaved(areaEvents ?? evState.items, savedIds);
    return applyClientFilters(base, filters);
  }, [areaEvents, evState.items, filters, savedIds]);

  const mapEvents = useMemo(() => geoEvents(visible), [visible]);
  const selected = useMemo(() => visible.find((e) => e.id === selectedId) ?? null, [visible, selectedId]);
  const hasFilters = Boolean(filters.q.trim() || filters.city || filters.category || filters.priceBand || filters.from || filters.to || quickDate);

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <h1><img src="/logo-512.png" alt="" className="logo" /> <span className="brand-box">Stasera?</span></h1>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-pressed={theme === "dark"}
            aria-label={theme === "dark" ? "Torna alla modalità chiara" : "Attiva la modalità scura"}
            title={theme === "dark" ? "Togli gli occhiali" : "Metti gli occhiali"}
          >
            <PixelShades />
          </button>
        </div>
        <p className="subtitle">Eventi low-cost delle prossime 2 settimane a Milano + provincia, senza sbatti</p>
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
        resultCount={visible.length}
      />

      {error && <p className="error">{error}</p>}
      {evState.loading && <p className="loading">CARICAMENTO…</p>}

      {view === "list" ? (
        <main className="event-list" ref={listRef}>
          {!evState.loading && visible.length === 0 && (
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
          {visible.map((e) => (
            <div key={e.id} data-event-id={e.id}>
              <EventCard event={e} selected={e.id === selectedId} onSelect={onSelect} onToggleSaved={onToggleSaved} />
            </div>
          ))}
        </main>
      ) : (
        <main className="map-wrap">
          <ErrorBoundary fallback={<div className="map-canvas map-fallback">MAPPA NON DISPONIBILE — USA LA LISTA</div>}>
            <LightMap
              events={mapEvents}
              selectedId={selectedId}
              onSelect={onSelectFromMap}
              onShowInList={onShowInList}
              onBackgroundTap={() => setSelectedId(null)}
              onBbox={onBbox}
              filterByArea={filterByArea}
              onToggleArea={onToggleArea}
            />
          </ErrorBoundary>
          {view === "map" && evState.total > mapEvents.length && !areaEvents && (
            <p className="map-more">+{evState.total - mapEvents.length} EVENTI SENZA COORDINATE — NON IN MAPPA</p>
          )}
          {selected && (
            <div className="map-detail">
              <EventCard event={selected} selected onSelect={onSelectFromMap} onToggleSaved={onToggleSaved} />
            </div>
          )}
        </main>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">{toast}</div>
      )}

      <footer className="footer">
        Fonti: Regione Lombardia (CC0), MilanoToday, Eventi@Milano/Base/Magazzini (Tribe), Cheventi.it, Metalitalia, Radio Punk, Alcatraz, Magnolia, Wikidata, RSS · Mappa © OpenStreetMap contributors · tile © Wikimedia Maps (via proxy)
      </footer>
    </div>
  );
}
