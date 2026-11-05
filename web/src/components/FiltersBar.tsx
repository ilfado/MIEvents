import { useState } from "react";
import { EVENT_CATEGORIES, PRICE_BANDS, PRICE_BAND_LABELS, type EventCategory } from "@mievents/shared";
import { EMPTY_FILTERS, type Filters } from "../api.js";
import { categoryLabel } from "../format.js";
import { QUICK_CATEGORIES, quickDateRange, type QuickDate } from "../dates.js";

export interface ActiveFilter {
  key: string;
  label: string;
  clear: () => void;
}

export function FiltersBar({
  filters,
  quickDate,
  cities,
  onChange,
  onQuickDate,
  resultCount,
}: {
  filters: Filters;
  quickDate: QuickDate;
  cities: string[];
  onChange: (f: Filters) => void;
  onQuickDate: (q: QuickDate) => void;
  resultCount: number;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const active: ActiveFilter[] = [];
  if (filters.q.trim()) active.push({ key: "q", label: `cerca: "${filters.q.trim()}"`, clear: () => set({ q: "" }) });
  if (quickDate) {
    const range = quickDateRange(quickDate);
    active.push({
      key: "qd",
      label: quickDate === "today" ? `stasera ${range?.from ?? ""}` : `weekend ${range?.from ?? ""}→${range?.to ?? ""}`,
      clear: () => onQuickDate(""),
    });
  }
  if (filters.city) active.push({ key: "city", label: `luogo: ${filters.city}`, clear: () => set({ city: "" }) });
  if (filters.category) active.push({ key: "cat", label: `tipo: ${categoryLabel(filters.category)}`, clear: () => set({ category: "" }) });
  if (filters.priceBand) active.push({ key: "price", label: `prezzo: ${PRICE_BAND_LABELS[filters.priceBand]}`, clear: () => set({ priceBand: "" }) });
  if (filters.from || filters.to) {
    active.push({
      key: "date",
      label: `data: ${filters.from || "…"} → ${filters.to || "…"}`,
      clear: () => { set({ from: "", to: "" }); onQuickDate(""); },
    });
  }

  const resetAll = () => {
    onChange({ ...EMPTY_FILTERS });
    onQuickDate("");
  };

  return (
    <div className="filters">
      <div className="filters-row">
        <input
          type="search"
          placeholder="CERCA EVENTO, LUOGO, ORGANIZZATORE…"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          aria-label="Cerca eventi"
          inputMode="search"
        />
      </div>

      <div className="chips" role="group" aria-label="Filtri rapidi">
        {([["today", "Stasera"], ["weekend", "Weekend"]] as Array<[QuickDate, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`chip ${quickDate === value ? "chip-active" : ""}`}
            aria-pressed={quickDate === value}
            onClick={() => onQuickDate(quickDate === value ? "" : value)}
          >
            {label}
          </button>
        ))}
        {QUICK_CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`chip ${filters.category === c.value ? "chip-active" : ""}`}
            aria-pressed={filters.category === c.value}
            onClick={() => set({ category: filters.category === c.value ? "" : (c.value as EventCategory) })}
          >
            {c.label}
          </button>
        ))}
        {PRICE_BANDS.map((b) => (
          <button
            key={b}
            type="button"
            className={`chip ${filters.priceBand === b ? "chip-active" : ""}`}
            aria-pressed={filters.priceBand === b}
            onClick={() => set({ priceBand: filters.priceBand === b ? "" : b })}
          >
            {PRICE_BAND_LABELS[b]}
          </button>
        ))}
        <button
          type="button"
          className={`chip chip-advanced ${advancedOpen ? "chip-active" : ""}`}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? "▲ Altri filtri" : "▼ Altri filtri"}
        </button>
        <span className="result-count" aria-live="polite">{resultCount} eventi</span>
      </div>

      {active.length > 0 && (
        <div className="active-filters" aria-label="Filtri attivi">
          <span className="af-label">Attivi:</span>
          {active.map((a) => (
            <button key={a.key} type="button" className="af-badge" onClick={a.clear} title={`Rimuovi ${a.label}`}>
              {a.label} ✕
            </button>
          ))}
          <button type="button" className="af-badge" onClick={resetAll}>azzera ✕</button>
        </div>
      )}

      {advancedOpen && (
        <div className="filters-advanced">
          <div className="filters-row">
            <select value={filters.city} onChange={(e) => set({ city: e.target.value })} aria-label="Comune">
              <option value="">TUTTI I COMUNI</option>
              {cities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={filters.category}
              onChange={(e) => set({ category: e.target.value as EventCategory | "saved" | "" })}
              aria-label="Tipologia"
            >
              <option value="">TUTTE LE TIPOLOGIE</option>
              <option value="saved">★ SOLO SALVATI</option>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{categoryLabel(c).toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="filters-row">
            <label className="date-field">
              DAL
              <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} aria-label="Data inizio" />
            </label>
            <label className="date-field">
              AL
              <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} aria-label="Data fine" />
            </label>
            <button type="button" className="btn-reset" onClick={resetAll}>AZZERA</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function applyQuickDate(filters: Filters, kind: QuickDate): Filters {
  const range = quickDateRange(kind);
  if (!range) return { ...filters, from: "", to: "" };
  return { ...filters, from: range.from, to: range.to };
}
