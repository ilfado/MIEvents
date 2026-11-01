import { useState } from "react";
import { EVENT_CATEGORIES, type EventCategory } from "@mievents/shared";
import { EMPTY_FILTERS, type Filters } from "../api.js";
import { categoryLabel } from "../format.js";
import { QUICK_CATEGORIES, quickDateRange, type QuickDate } from "../dates.js";

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
  const hasAdvanced = Boolean(filters.city || filters.from || filters.to);

  return (
    <div className="filters">
      <div className="filters-row">
        <input
          type="search"
          placeholder="Cerca per titolo, luogo, organizzatore…"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          aria-label="Cerca eventi"
          inputMode="search"
        />
      </div>

      <div className="chips" role="group" aria-label="Filtri rapidi">
        {([["today", "Oggi"], ["weekend", "Questo weekend"]] as Array<[QuickDate, string]>).map(([value, label]) => (
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
        <button
          type="button"
          className={`chip chip-advanced ${advancedOpen || hasAdvanced ? "chip-active" : ""}`}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? "▲ Filtri" : "▼ Filtri"}
          {hasAdvanced && !advancedOpen ? " •" : ""}
        </button>
        <span className="result-count">{resultCount} eventi</span>
      </div>

      {advancedOpen && (
        <div className="filters-advanced">
          <div className="filters-row">
            <select value={filters.city} onChange={(e) => set({ city: e.target.value })} aria-label="Comune">
              <option value="">Tutti i comuni</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filters.category}
              onChange={(e) => set({ category: e.target.value as EventCategory | "saved" | "" })}
              aria-label="Tipologia"
            >
              <option value="">Tutte le tipologie</option>
              <option value="saved">★ Solo salvati</option>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="filters-row">
            <label className="date-field">
              Dal
              <input
                type="date"
                value={filters.from}
                onChange={(e) => set({ from: e.target.value })}
                aria-label="Data inizio"
              />
            </label>
            <label className="date-field">
              Al
              <input
                type="date"
                value={filters.to}
                onChange={(e) => set({ to: e.target.value })}
                aria-label="Data fine"
              />
            </label>
            <button
              type="button"
              className="btn-reset"
              onClick={() => {
                onChange({ ...EMPTY_FILTERS });
                onQuickDate("");
              }}
            >
              Azzera
            </button>
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
